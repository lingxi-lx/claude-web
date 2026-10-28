import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaStore } from '../meta/store.js';
import { SecretService } from '../secrets/service.js';
import { AccountStore, normalizeCredential } from './store.js';

describe('meta store: upstreams', () => {
  it('persists accounts and groups across a reload', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-up-'));
    const file = path.join(dir, 'meta.json');
    const a = new MetaStore(file);
    await a.load();
    a.upstreamAccounts().push({
      id: 'acct_1', kind: 'claude', name: 'Claude 1', enabled: true,
      credential: 'enc:plain:e30=', credentialKind: 'setup-token', source: 'paste',
      createdAt: 1, updatedAt: 1, health: 'unknown',
    });
    a.upstreamGroups().push({ id: 'pool', kind: 'claude', name: 'Pool', strategy: 'failover', members: ['acct_1'], enabled: true, createdAt: 1 });
    await a.saveUpstreams();
    const b = new MetaStore(file);
    await b.load();
    expect(b.upstreamAccounts().map((x) => x.id)).toEqual(['acct_1']);
    expect(b.upstreamGroups()[0].members).toEqual(['acct_1']);
  });

  it('gives LAN and audit config safe defaults without writing them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-up-'));
    const m = new MetaStore(path.join(dir, 'meta.json'));
    expect(m.gatewayLan()).toMatchObject({ enabled: false, bind: '127.0.0.1', port: 0, ipAllowlist: [] });
    expect(m.gatewayAudit()).toMatchObject({ enabled: true, maxBytes: 10 * 1024 * 1024, keepFiles: 5 });
  });
});

describe('AccountStore', () => {
  const make = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-acct-'));
    const meta = new MetaStore(path.join(dir, 'meta.json'));
    await meta.load();
    return { meta, store: new AccountStore(meta, new SecretService()) };
  };

  it('normalizes a setup token and never stores it in plaintext', async () => {
    const { meta, store } = await make();
    const { account } = await store.add({ kind: 'claude', name: 'A', credential: 'sk-ant-oat01-abc' });
    expect(account.credentialKind).toBe('setup-token');
    expect(account.credential.startsWith('enc:')).toBe(true);
    expect(JSON.stringify(meta.data)).not.toContain('sk-ant-oat01-abc');
    expect(await store.revealCredential(account)).toBe(JSON.stringify({ kind: 'setup-token', token: 'sk-ant-oat01-abc' }));
  });

  it('a manual enable / disable clears autoDisabledAt (auto-recovery must not override the user)', async () => {
    const { store } = await make();
    const { account } = await store.add({ kind: 'gemini', credential: 'SID=1; SAPISID=2' });
    await store.setHealth(account.id, { autoDisabledAt: 111, health: 'disabled' });
    await store.update(account.id, { enabled: false });
    expect(store.get(account.id)!.autoDisabledAt).toBeUndefined();
    await store.setHealth(account.id, { autoDisabledAt: 222 });
    await store.update(account.id, { enabled: true });
    expect(store.get(account.id)!.autoDisabledAt).toBeUndefined();
  });

  it('dedupes the same credential of the same kind', async () => {
    const { store } = await make();
    const a = await store.add({ kind: 'claude', credential: 'sk-ant-oat01-abc' });
    const b = await store.add({ kind: 'claude', credential: 'sk-ant-oat01-abc' });
    expect(b.duplicate).toBe(true);
    expect(b.account.id).toBe(a.account.id);
    expect(store.list()).toHaveLength(1);
  });

  it('removes the account from every upstream group and gateway group', async () => {
    const { meta, store } = await make();
    const { account } = await store.add({ kind: 'claude', credential: 'sk-ant-oat01-abc' });
    meta.upstreamGroups().push({ id: 'pool', kind: 'claude', name: 'Pool', strategy: 'failover', members: [account.id], enabled: true, createdAt: 1 });
    meta.gatewayGroups().push({ id: 'main', name: 'Main', strategy: 'failover', members: [{ accountId: account.id }] });
    await store.remove(account.id);
    expect(meta.upstreamGroups()[0].members).toEqual([]);
    expect(meta.gatewayGroups()[0].members).toEqual([]);
  });

  it('parses an OAuth JSON envelope', () => {
    const n = normalizeCredential('claude', { accessToken: 'at', refreshToken: 'rt', expiresAt: 123 });
    expect(n.credentialKind).toBe('oauth');
    expect(JSON.parse(n.credential)).toMatchObject({ kind: 'oauth', accessToken: 'at', refreshToken: 'rt', expiresAt: 123 });
  });

  it('normalizes a pasted provider token with the registry defaults', () => {
    const n = normalizeCredential('provider', 'cop-token', 'token', 'copilot');
    expect(n.credentialKind).toBe('token');
    expect(JSON.parse(n.credential)).toMatchObject({
      kind: 'token', providerId: 'copilot', protocol: 'openai',
      baseUrl: 'https://api.githubcopilot.com', chatPath: '/chat/completions', token: 'cop-token',
    });
  });

  it('keeps an explicit provider envelope and strips credential-overriding headers', () => {
    const n = normalizeCredential('provider', {
      kind: 'oauth', providerId: 'codex', protocol: 'responses', baseUrl: 'https://chatgpt.com/backend-api/codex',
      accessToken: 'at', refreshToken: 'rt', expiresAt: 99,
      headers: { originator: 'codex_cli_rs', authorization: 'stolen', 'X-Api-Key': 'stolen' },
    }, 'oauth', 'codex');
    expect(n.credentialKind).toBe('oauth');
    expect(JSON.parse(n.credential)).toMatchObject({
      kind: 'oauth', providerId: 'codex', protocol: 'responses', accessToken: 'at', refreshToken: 'rt', expiresAt: 99,
      headers: { originator: 'codex_cli_rs' },
    });
  });

  it('dedupes provider accounts by provider + credential, not across providers', async () => {
    const { store } = await make();
    const a = await store.add({ kind: 'provider', providerId: 'copilot', credential: 'same', credentialKind: 'token' });
    const b = await store.add({ kind: 'provider', providerId: 'copilot', credential: 'same', credentialKind: 'token' });
    const c = await store.add({ kind: 'provider', providerId: 'codex', credential: 'same', credentialKind: 'token' });
    expect(b.duplicate).toBe(true);
    expect(c.duplicate).toBe(false);
    expect(store.list()).toHaveLength(2);
    expect(a.account.providerId).toBe('copilot');
  });
});

describe('account proxy', () => {
  const make = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-proxy-'));
    const meta = new MetaStore(path.join(dir, 'meta.json'));
    await meta.load();
    return { meta, store: new AccountStore(meta, new SecretService()) };
  };

  it('accepts http and socks proxies, encrypted at rest', async () => {
    const { meta, store } = await make();
    const { account } = await store.add({ kind: 'claude', credential: 'sk-ant-oat01-p', proxy: 'socks5://127.0.0.1:1080' });
    expect(account.proxy?.startsWith('enc:')).toBe(true);
    expect(JSON.stringify(meta.data)).not.toContain('127.0.0.1:1080');
    expect(await store.revealProxy(account)).toBe('socks5://127.0.0.1:1080');
  });

  it('refuses any other scheme before saving anything', async () => {
    const { store } = await make();
    await expect(store.add({ kind: 'claude', credential: 'sk-ant-oat01-q', proxy: 'ftp://x:1' })).rejects.toThrow(/http/);
    expect(store.list()).toHaveLength(0);
  });
});
