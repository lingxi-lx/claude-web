// 同步 (spec §8): the passphrase-sealed part round-trips (a wrong passphrase gives nothing), and merging never
// overwrites a credential — a different one on both sides keeps both.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MetaStore } from '../meta/store.js';
import { buildBundle, openSecret, parseBundle } from './backup.js';
import { open, seal } from './crypto.js';
import { applyMerge, planMerge } from './merge.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const newMeta = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sync-'));
  dirs.push(d);
  return new MetaStore(path.join(d, 'meta.json'));
};
const account = (id: string, credential: string) => ({ id, kind: 'claude' as const, name: `acct ${id}`, enabled: true, credential, credentialKind: 'setup-token' as const, source: 'paste' as const, createdAt: 1, updatedAt: 1, health: 'unknown' as const });

describe('sync crypto', () => {
  it('seal → open round-trips; a wrong passphrase or a changed byte fails, without partial text', async () => {
    const box = await seal('秘密 sk-ant-xyz', 'correct horse');
    expect(box.data).not.toContain('sk-ant');
    expect(await open(box, 'correct horse')).toBe('秘密 sk-ant-xyz');
    await expect(open(box, 'wrong horse!')).rejects.toThrow();
    const tampered = { ...box, data: Buffer.from(Buffer.from(box.data, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64') };
    await expect(open(tampered, 'correct horse')).rejects.toThrow();
  });
  it('a short passphrase and a crafted cost are refused', async () => {
    await expect(seal('x', 'short')).rejects.toThrow();
    const box = await seal('x', 'long enough');
    await expect(open({ ...box, N: 1 << 24 }, 'long enough')).rejects.toThrow();
  });
});

describe('sync bundle and merge', () => {
  it('credentials only travel encrypted; a different credential on both sides keeps both', async () => {
    const a = newMeta();
    const pa = await a.upsertProvider({ name: 'Relay', type: 'anthropic', baseUrl: 'https://r.example', apiKey: 'sk-from-a' });
    a.upstreamAccounts().push(account('acc1', 'cred-a'));
    const bundle = await buildBundle(a, undefined, { passphrase: 'pass phrase' });
    const text = JSON.stringify(bundle);
    expect(text).not.toContain('sk-from-a');
    expect(text).not.toContain('cred-a');

    const b = newMeta();
    await b.upsertProvider({ name: 'Relay', type: 'anthropic', baseUrl: 'https://r.example', apiKey: 'sk-from-b' });
    b.providers()[0].id = pa.id; // the same provider on both machines
    b.upstreamAccounts().push(account('acc1', 'cred-b'));

    const parsed = parseBundle(text);
    await expect(openSecret(parsed, 'not it at all')).rejects.toThrow();
    const sec = await openSecret(parsed, 'pass phrase');
    const plan = await planMerge(b, undefined, parsed, sec);
    expect(plan.find((x) => x.collection === 'provider')!.action).toBe('conflict');
    expect(plan.find((x) => x.collection === 'account')!.action).toBe('conflict');
    const r = await applyMerge(b, undefined, parsed, sec, plan);
    expect(r.conflicts).toBe(2);
    const keys = b.providers().map((p) => p.apiKey).sort();
    expect(keys).toEqual(['sk-from-a', 'sk-from-b']);
    expect(b.provider(pa.id)!.apiKey).toBe('sk-from-b'); // the local one untouched
    expect(b.upstreamAccounts().map((x) => x.credential).sort()).toEqual(['cred-a', 'cred-b']);
    expect(b.upstreamAccounts().find((x) => x.id === 'acc1')!.credential).toBe('cred-b');
  });

  it('a missing local key is filled; without the passphrase part an account cannot be added', async () => {
    const a = newMeta();
    const pa = await a.upsertProvider({ name: 'P', type: 'openai', baseUrl: 'https://p.example/v1', apiKey: 'sk-1' });
    a.upstreamAccounts().push(account('acc2', 'cred'));
    const b = newMeta();
    await b.upsertProvider({ name: 'P', type: 'openai', baseUrl: 'https://p.example/v1' });
    b.providers()[0].id = pa.id;
    const withKey = parseBundle(JSON.stringify(await buildBundle(a, undefined, { passphrase: 'pass phrase' })));
    const sec = await openSecret(withKey, 'pass phrase');
    const plan = await planMerge(b, undefined, withKey, sec);
    await applyMerge(b, undefined, withKey, sec, plan);
    expect(b.provider(pa.id)!.apiKey).toBe('sk-1');

    const plain = parseBundle(JSON.stringify(await buildBundle(a, undefined, {})));
    const plan2 = await planMerge(newMeta(), undefined, plain, null);
    expect(plan2.find((x) => x.collection === 'account')!.action).toBe('skip');
  });
});
