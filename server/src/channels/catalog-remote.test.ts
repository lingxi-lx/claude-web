import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRemote, normalizeRemoteSetting, remoteCatalogState, updateRemote } from './catalog';

let dir = '';
const prevDir = process.env.CLAUDE_WEB_DIR;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-remote-cat-')); process.env.CLAUDE_WEB_DIR = dir; });
afterAll(() => {
  if (prevDir === undefined) delete process.env.CLAUDE_WEB_DIR; else process.env.CLAUDE_WEB_DIR = prevDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString().trim();
const entries = [{ id: 'acme', name: 'Acme AI', category: 'api', baseUrl: 'https://api.acme.example/v1', protocol: 'openai', evil: 'dropped' }];
const sign = (list: unknown[]) => crypto.sign(null, Buffer.from(JSON.stringify(list), 'utf8'), privateKey).toString('base64');
const lookup = async (host: string) => [{ address: host === 'cat.example.com' ? '93.184.216.34' : '10.0.0.9', family: 4 }];
const serve = (body: unknown) => (async () => new Response(JSON.stringify(body))) as typeof fetch;

describe('remote catalog setting', () => {
  it('needs an https URL and an Ed25519 key; empty is off', () => {
    expect(normalizeRemoteSetting(undefined)).toEqual({});
    expect(normalizeRemoteSetting({ enabled: true, url: 'https://cat.example.com/c.json', publicKey: pem }))
      .toEqual({ enabled: true, url: 'https://cat.example.com/c.json', publicKey: pem });
    expect(() => normalizeRemoteSetting({ url: 'http://cat.example.com/c.json' })).toThrow();
    expect(() => normalizeRemoteSetting({ url: 'https://u:p@cat.example.com/' })).toThrow();
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(() => normalizeRemoteSetting({ publicKey: rsa })).toThrow();
    expect(remoteCatalogState({}, 0)).toMatchObject({ enabled: false, hasKey: false, ready: false, entries: 0 });
  });
});

describe('updateRemote', () => {
  const setting = { enabled: true, url: 'https://cat.example.com/c.json', publicKey: pem };

  it('verifies, sanitizes, keeps the copy for this URL and reports state', async () => {
    const got = await updateRemote(setting, { fetch: serve({ version: 1, entries, signature: sign(entries) }), lookup });
    expect(got).toHaveLength(1);
    expect((got[0] as unknown as Record<string, unknown>).evil).toBeUndefined();
    expect(await loadRemote(setting.url)).toHaveLength(1);
    expect(await loadRemote('https://other.example.com/c.json')).toEqual([]);
    const st = remoteCatalogState(setting, 1);
    expect(st).toMatchObject({ enabled: true, ready: true, hasKey: true, entries: 1 });
    expect(st.fetchedAt).toBeGreaterThan(0);
    expect(st.error).toBeUndefined();
  });

  it('a bad signature is refused, recorded, and the last good copy stays', async () => {
    const tampered = [...entries, { id: 'evil', name: 'Evil' }];
    await expect(updateRemote(setting, { fetch: serve({ version: 2, entries: tampered, signature: sign(entries) }), lookup })).rejects.toThrow();
    expect(remoteCatalogState(setting, 1).error).toBeTruthy();
    expect(await loadRemote(setting.url)).toHaveLength(1);
  });

  it('netguard: a catalog URL on a private address is never fetched', async () => {
    let called = false;
    const f = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
    await expect(updateRemote({ ...setting, url: 'https://intranet.example.com/c.json' }, { fetch: f, lookup })).rejects.toMatchObject({ code: 'EGRESS_DENIED' });
    expect(called).toBe(false);
  });

  it('refuses when off or without a key', async () => {
    await expect(updateRemote({ url: setting.url, publicKey: pem })).rejects.toThrow();
    await expect(updateRemote({ enabled: true, url: setting.url })).rejects.toThrow();
  });
});
