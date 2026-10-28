import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaStore } from '../meta/store.js';
import { SecretService } from '../secrets/service.js';
import { UpstreamService } from './service.js';

async function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-upsvc-'));
  const meta = new MetaStore(path.join(dir, 'meta.json'));
  await meta.load();
  return { meta, svc: new UpstreamService({ meta, secrets: new SecretService() }) };
}

describe('UpstreamService', () => {
  it('adds an account and resolves it as a translated Anthropic target', async () => {
    const { svc } = await make();
    const { account } = await svc.add({ kind: 'claude', name: 'A', credential: 'sk-ant-oat01-abc', probe: false });
    const [t] = await svc.resolveMembers({ accountId: account.id }, 'claude-sonnet-4-6');
    expect(t).toMatchObject({ id: account.id, type: 'anthropic', auth: 'oauth', forceTranslate: true });
    expect(t.apiKey).toBe('sk-ant-oat01-abc');
  });

  it('orders a pool by strategy and skips disabled accounts', async () => {
    const { svc } = await make();
    const a = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-a', probe: false })).account;
    const b = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-b', probe: false })).account;
    await svc.update(b.id, { enabled: false });
    const g = await svc.upsertGroup({ kind: 'claude', name: 'Pool', strategy: 'failover', members: [a.id, b.id] });
    expect(svc.order(g).map((x) => x.id)).toEqual([a.id]);
  });

  it('applies the pool model map', async () => {
    const { svc } = await make();
    const a = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-a', probe: false })).account;
    const g = await svc.upsertGroup({ kind: 'claude', name: 'Pool', strategy: 'failover', members: [a.id], modelMap: { 'claude-*': 'claude-sonnet-4-6' } });
    const [t] = await svc.resolveMembers({ upstreamGroupId: g.id }, 'claude-haiku-4-5');
    expect(t.name).toBe(a.name);
    // the model is applied by GatewayService through target.model
    expect(t.model).toBe('claude-sonnet-4-6');
  });

  it('removes a pool and refuses unknown members', async () => {
    const { svc } = await make();
    const g = await svc.upsertGroup({ kind: 'claude', name: 'Pool', strategy: 'failover', members: [] });
    await svc.removeGroup(g.id);
    expect(svc.groups()).toEqual([]);
    expect(await svc.resolveMembers({ upstreamGroupId: g.id }, 'x')).toEqual([]);
  });

  it('keeps one conversation key on one account inside the pool', async () => {
    const { svc } = await make();
    const a = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-a', probe: false })).account;
    const b = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-b', probe: false })).account;
    const g = await svc.upsertGroup({ kind: 'claude', name: 'Pool', strategy: 'round-robin', members: [a.id, b.id] });
    const first = (await svc.resolveMembers({ upstreamGroupId: g.id }, 'm', 'session-1'))[0].id;
    const again = (await svc.resolveMembers({ upstreamGroupId: g.id }, 'm', 'session-1'))[0].id;
    expect(again).toBe(first);
    svc.affinity.dropAccount(first);
    expect(svc.affinity.get(g.id, 'session-1')).toBeUndefined();
  });
});

describe('a fresh setup', () => {
  it('puts added accounts into a 默认 gateway group so the root /v1 works with no setup', async () => {
    const { meta, svc } = await make();
    const a = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-a', probe: false })).account;
    const b = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-b', probe: false })).account;
    const groups = meta.gatewayGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'default', name: '默认' });
    expect(groups[0].members).toEqual([{ accountId: a.id }, { accountId: b.id }]);

    // the user's own groups are never touched; a new account still joins the existing 默认 entry (add and it works)
    groups.push({ id: 'custom', name: 'Custom', strategy: 'failover', members: [] });
    const c = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-c', probe: false })).account;
    expect(groups.find((g) => g.id === 'custom')!.members).toEqual([]);
    expect(groups[0].members.some((m) => m.accountId === c.id)).toBe(true);
  });

  it('does not invent a 默认 group when the user only has their own', async () => {
    const { meta, svc } = await make();
    meta.gatewayGroups().push({ id: 'custom', name: 'Custom', strategy: 'failover', members: [] });
    const a = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-d', probe: false })).account;
    expect(meta.gatewayGroups().map((g) => g.id)).toEqual(['custom']);
    expect(meta.gatewayGroups()[0].members).toEqual([]);
    // and the account can be routed on request
    expect(await svc.attachDefault(a.id)).toMatchObject({ groupId: 'default' });
    expect(meta.gatewayGroups().find((g) => g.id === 'default')!.members).toEqual([{ accountId: a.id }]);
  });
});

describe('provider login accounts', () => {
  it('resolves a Copilot account to an OpenAI gateway target with its vendor path and headers', async () => {
    const { svc } = await make();
    const { account } = await svc.add({
      kind: 'provider', providerId: 'copilot', name: 'Copilot', probe: false,
      credential: {
        kind: 'token', providerId: 'copilot', protocol: 'openai', baseUrl: 'https://api.githubcopilot.com',
        token: 'cop-token', headers: { 'editor-version': 'Neovim/0.6.1' }, chatPath: '/chat/completions',
      },
      credentialKind: 'token',
    });
    const [t] = await svc.resolveMembers({ accountId: account.id }, 'gpt-4o');
    expect(t).toMatchObject({
      id: account.id, type: 'openai', protocol: 'openai', baseUrl: 'https://api.githubcopilot.com',
      apiKey: 'cop-token', chatPath: '/chat/completions', headers: { 'editor-version': 'Neovim/0.6.1' }, account: true,
    });
    await svc.store.setHealth(account.id, { models: ['gpt-4o', 'claude-sonnet-4.5'] });
    expect(svc.modelsForMember({ accountId: account.id })).toEqual(['gpt-4o', 'claude-sonnet-4.5']);
  });

  it('keeps a Codex account on the Responses protocol and its backend path', async () => {
    const { svc } = await make();
    const { account } = await svc.add({
      kind: 'provider', providerId: 'codex', name: 'Codex', probe: false,
      credential: {
        kind: 'oauth', providerId: 'codex', protocol: 'responses', baseUrl: 'https://chatgpt.com/backend-api/codex',
        accessToken: 'at', refreshToken: 'rt', headers: { originator: 'codex_cli_rs' }, chatPath: '/responses',
      },
      credentialKind: 'oauth',
    });
    const [t] = await svc.resolveMembers({ accountId: account.id }, 'gpt-5.1-codex');
    expect(t).toMatchObject({ type: 'openai', protocol: 'responses', chatPath: '/responses', apiKey: 'at' });
    expect(t.auth).toBeUndefined(); // not an Anthropic OAuth login
  });

  it('uses a provider pool’s union of models', async () => {
    const { svc } = await make();
    const a = (await svc.add({ kind: 'provider', providerId: 'copilot', probe: false, credential: {
      kind: 'token', providerId: 'copilot', protocol: 'openai', baseUrl: 'https://api.githubcopilot.com', token: 'a',
    } })).account;
    const b = (await svc.add({ kind: 'provider', providerId: 'codex', probe: false, credential: {
      kind: 'oauth', providerId: 'codex', protocol: 'responses', baseUrl: 'https://chatgpt.com/backend-api/codex', accessToken: 'b',
    } })).account;
    await svc.store.setHealth(a.id, { models: ['gpt-4o'] });
    await svc.store.setHealth(b.id, { models: ['gpt-5.1-codex'] });
    const g = await svc.upsertGroup({ kind: 'provider', name: 'Logins', strategy: 'failover', members: [a.id, b.id] });
    expect(svc.modelsForMember({ upstreamGroupId: g.id }).sort()).toEqual(['gpt-4o', 'gpt-5.1-codex']);
    const targets = await svc.resolveMembers({ upstreamGroupId: g.id }, 'gpt-4o');
    expect(targets.map((t) => t.id)).toEqual([a.id]);
  });
});

describe('account concurrency', () => {
  it('gives out maxConcurrent slots and takes them back', async () => {
    const { svc } = await make();
    const a = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-c', probe: false })).account;
    expect(svc.acquire(a.id)).toBe(true); // no cap: always true
    svc.release(a.id);
    await svc.update(a.id, { maxConcurrent: 1 });
    expect(svc.acquire(a.id)).toBe(true);
    expect(svc.acquire(a.id)).toBe(false);
    svc.release(a.id);
    expect(svc.acquire(a.id)).toBe(true);
    svc.release(a.id);
  });
});
