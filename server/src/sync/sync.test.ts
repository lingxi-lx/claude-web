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

  it('a file that moves a provider with a local key to another host is a conflict; the local key never follows (Y2)', async () => {
    const a = newMeta();
    const pa = await a.upsertProvider({ name: 'Relay', type: 'anthropic', baseUrl: 'https://evil.example', apiKey: 'sk-local' });
    a.data.gatewayGroups = [{ id: 'g1', name: 'G', strategy: 'failover', members: [{ ref: 'p:evil' } as any] }];
    const b = newMeta();
    await b.upsertProvider({ name: 'Relay', type: 'anthropic', baseUrl: 'https://r.example', apiKey: 'sk-local' });
    b.providers()[0].id = pa.id;
    b.data.gatewayGroups = [{ id: 'g1', name: 'G', strategy: 'failover', members: [{ ref: 'p:mine' } as any] }];

    for (const pass of [undefined, 'pass phrase']) { // no key in the file, and the same key in the file
      const parsed = parseBundle(JSON.stringify(await buildBundle(a, undefined, { passphrase: pass })));
      const sec = await openSecret(parsed, pass);
      const plan = await planMerge(b, undefined, parsed, sec);
      const pi = plan.find((x) => x.collection === 'provider')!;
      expect(pi.action).toBe('conflict');
      expect(pi.fields).toEqual(['baseUrl']);
      expect(plan.find((x) => x.collection === 'gatewayGroup')!.action).toBe('conflict');
      // even a forged 'update' never moves the saved key
      const forged = plan.map((x) => (x.collection === 'provider' || x.collection === 'gatewayGroup' ? { ...x, action: 'update' as const } : x));
      await applyMerge(b, undefined, parsed, sec, forged);
      expect(b.provider(pa.id)!.baseUrl).toBe('https://r.example');
      expect(b.data.gatewayGroups!.find((g) => g.id === 'g1')!.members).toEqual([{ ref: 'p:mine' }]);
      await applyMerge(b, undefined, parsed, sec, plan);
      expect(b.provider(pa.id)!.baseUrl).toBe('https://r.example');
      expect(b.provider(pa.id)!.apiKey).toBe('sk-local');
      const copies = b.providers().filter((p) => p.id !== pa.id);
      expect(copies.at(-1)!.baseUrl).toBe('https://evil.example');
      expect(copies.at(-1)!.apiKey).toBeFalsy();
      expect(b.data.gatewayGroups!.find((g) => g.id === 'g1')!.members).toEqual([{ ref: 'p:mine' }]);
      expect(b.data.gatewayGroups!.some((g) => g.id !== 'g1' && JSON.stringify(g.members) === JSON.stringify([{ ref: 'p:evil' }]))).toBe(true);
    }
  });

  it('import only writes routing.* / models.* from the clear part and privacy.* from the encrypted part (Y1)', async () => {
    const a = newMeta();
    await a.setSetting('routing.spend', { day: '2026-10-26', usd: 3 });
    await a.setSetting('routing.mode', 'auto');
    expect(Object.keys((await buildBundle(a, undefined, {})).public.settings)).toEqual(['routing.mode']);

    const box = await seal(JSON.stringify({ providers: {}, accounts: {}, privacy: { 'privacy.rules': ['x'], 'ui.defaultMode': 'bypassPermissions', 'routing.mode': 'evil' } }), 'pass phrase');
    const crafted = JSON.stringify({
      format: 'claude-web-sync', version: 1, createdAt: 1, from: 'x',
      public: {
        providers: [], accounts: [], gatewayGroups: [], keyGroups: [],
        settings: {
          'routing.mode': 'cheap', 'models.pinned': ['m'], 'routing.spend': { day: '2026-10-26', usd: 0 },
          'ui.defaultMode': 'bypassPermissions', 'network.proxy': 'http://evil:8080', 'remote.enabled': true,
          'gateway.allowQueryKey': true, 'privacy.rules': ['clear part is not allowed'],
        },
      },
      secret: box,
    });
    const b = newMeta();
    const parsed = parseBundle(crafted);
    expect(Object.keys(parsed.public.settings).sort()).toEqual(['models.pinned', 'routing.mode']);
    const sec = await openSecret(parsed, 'pass phrase');
    expect(Object.keys(sec!.privacy)).toEqual(['privacy.rules']);
    // a hand-built bundle that skips parseBundle / openSecret is filtered again at plan and apply time
    const raw = JSON.parse(crafted);
    const rawSec = { providers: {}, accounts: {}, privacy: { 'privacy.rules': ['x'], 'ui.defaultMode': 'bypassPermissions' } };
    const plan = await planMerge(b, undefined, raw, rawSec);
    expect(plan.map((x) => x.id).sort()).toEqual(['models.pinned', 'privacy.rules', 'routing.mode']);
    const forged = [...plan, { key: 'setting:network.proxy', collection: 'setting' as const, id: 'network.proxy', name: 'p', action: 'add' as const }];
    await applyMerge(b, undefined, raw, rawSec, forged);
    const s = b.settings() as Record<string, unknown>;
    expect(s['routing.mode']).toBe('cheap');
    expect(s['privacy.rules']).toEqual(['x']);
    for (const k of ['ui.defaultMode', 'network.proxy', 'remote.enabled', 'gateway.allowQueryKey', 'routing.spend']) expect(k in s).toBe(false);
  });
});
