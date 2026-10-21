import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaStore } from '../meta/store.js';
import { SecretService } from '../secrets/service.js';
import { UpstreamService } from './service.js';
import type { SidecarAccount, SidecarAccountInput } from './types.js';

const fakeDriver = () => {
  const remote = new Map<string, SidecarAccount>();
  let n = 0;
  const calls: string[] = [];
  return {
    calls,
    remote,
    id: 'gemini' as const,
    ensureReady: async () => { calls.push('ensureReady'); },
    health: async () => ({ ok: true }),
    models: async () => ['gemini-3.6-flash'],
    listAccounts: async () => [...remote.values()],
    addAccount: async (input: SidecarAccountInput) => {
      calls.push('add');
      const remoteId = `r${++n}`;
      const a: SidecarAccount = { remoteId, name: input.name ?? `Gemini ${remoteId}`, enabled: true, health: 'ok' };
      remote.set(remoteId, a);
      return a;
    },
    updateAccount: async (remoteId: string, patch: any) => {
      calls.push('update');
      const a = { ...remote.get(remoteId)!, ...patch };
      remote.set(remoteId, a);
      return a;
    },
    removeAccount: async (remoteId: string) => { calls.push('remove'); remote.delete(remoteId); },
    checkAccount: async (remoteId: string) => {
      calls.push('check');
      return { ...remote.get(remoteId)!, health: 'ok' as const, quota: { checkedAt: 1, windows: [], credits: { remaining: 5, total: 10 } } };
    },
    runTask: async () => { calls.push('task'); return { ok: true, detail: 'kept alive' }; },
    endpoint: async () => ({ baseUrl: 'http://127.0.0.1:41234/v1', apiKey: 'gwk-test' }),
  };
};

async function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-upsc-'));
  const meta = new MetaStore(path.join(dir, 'meta.json'));
  await meta.load();
  const driver = fakeDriver();
  const sidecars = {
    statuses: () => [{ id: 'gemini', installed: true, running: true, health: 'ok', port: 41234 }],
    on: () => {},
    ensure: async () => '/bin/gemini',
    stop: async () => {},
    stopAll: async () => {},
    logs: async () => 'log line',
    status: () => ({ id: 'gemini', installed: true, running: true, health: 'ok', port: 41234 }),
  } as any;
  const svc = new UpstreamService({ meta, secrets: new SecretService(), sidecars, gemini: driver as any });
  return { meta, svc, driver };
}

describe('UpstreamService: sidecar families', () => {
  it('adds the login to the sidecar, mirrors it, and resolves one OpenAI target per family', async () => {
    const { svc, driver } = await make();
    const { account, duplicate } = await svc.add({ kind: 'gemini', name: 'Main', credential: '__Secure-1PSID=x; foo=y' });
    expect(duplicate).toBe(false);
    expect(account.sidecar).toMatchObject({ id: 'gemini', remoteId: 'r1' });
    expect(account.health).toBe('ok');
    expect(driver.remote.get('r1')?.name).toBe('Main');

    // the same cookie again is not a second account, but the sidecar is told again (its DB may be new)
    const again = await svc.add({ kind: 'gemini', credential: '__Secure-1PSID=x; foo=y' });
    expect(again.duplicate).toBe(true);
    expect(again.id).toBe(account.id);
    expect(driver.calls.filter((c) => c === 'add')).toHaveLength(2);

    const [t] = await svc.resolveMembers({ accountId: account.id }, 'gemini-3.6-flash');
    expect(t).toMatchObject({ id: 'sidecar:gemini', type: 'openai', baseUrl: 'http://127.0.0.1:41234/v1', model: 'gemini-3.6-flash' });

    const status = svc.status();
    expect(status.families.find((f) => f.kind === 'gemini')).toMatchObject({ ready: true });
    expect(status.sidecars?.[0]).toMatchObject({ id: 'gemini', running: true, port: 41234 });
  });

  it('delegates renames / enablement, credential replacement, probing and removal', async () => {
    const { svc, driver } = await make();
    const { account } = await svc.add({ kind: 'gemini', name: 'Old', credential: 'a=1' });

    const renamed = await svc.update(account.id, { name: 'New', enabled: false });
    expect(renamed.name).toBe('New');
    expect(renamed.enabled).toBe(false);
    expect(driver.remote.get('r1')).toMatchObject({ name: 'New', enabled: false });

    // a new cookie replaces the sidecar login rather than editing it in place
    await svc.update(account.id, { credential: 'b=2' });
    expect(driver.remote.has('r1')).toBe(false);
    expect(driver.remote.size).toBe(1);
    expect(svc.store.get(account.id)?.sidecar?.remoteId).toBe('r2');

    const probed = await svc.probe(account.id);
    expect(probed.quota?.credits).toEqual({ remaining: 5, total: 10 });

    const task = await svc.runAccountTask(account.id, 'keepalive');
    expect(task).toMatchObject({ ok: true, detail: 'kept alive' });

    await svc.remove(account.id);
    expect(driver.remote.size).toBe(0);
    expect(svc.store.get(account.id)).toBeUndefined();
  });

  it('keeps the sidecar login when a replacement resolves to the same remote id', async () => {
    const { svc, driver } = await make();
    const { account } = await svc.add({ kind: 'gemini', credential: 'a=1' });
    (svc as any).gemini.addAccount = async () => ({ remoteId: 'r1', name: 'Refreshed', enabled: true, health: 'ok' });
    const updated = await svc.update(account.id, { credential: 'b=2' });
    expect(updated.sidecar?.remoteId).toBe('r1');
    expect(driver.remote.has('r1')).toBe(true);
  });

  it('mirrors accounts a sidecar already has (its own OAuth / QR login)', async () => {
    const { svc, driver } = await make();
    driver.remote.set('r9', { remoteId: 'r9', name: 'From QR', enabled: true, health: 'ok', quota: { checkedAt: 1, windows: [], credits: { remaining: 1, total: 2 } } });
    const list = await svc.syncFamily('gemini');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'From QR', health: 'ok', sidecar: { remoteId: 'r9' } });
    expect(list[0].credentialMasked).toBeTruthy();
    await svc.syncFamily('gemini');
    expect(svc.store.list().filter((a) => a.kind === 'gemini')).toHaveLength(1);

    // the same login, now pasted as a cookie: it adopts the synced row instead of making a second one
    (svc as any).gemini.addAccount = async () => ({ remoteId: 'r9', name: 'From QR', enabled: true, health: 'ok' });
    const added = await svc.add({ kind: 'gemini', credential: 'x=1' });
    expect(added.duplicate).toBe(true);
    expect(added.id).toBe(list[0].id);
    expect(svc.store.list().filter((a) => a.kind === 'gemini')).toHaveLength(1);
  });

  it('two syncs at once mirror the same account once', async () => {
    const { svc, driver } = await make();
    driver.remote.set('r9', { remoteId: 'r9', name: 'Once', enabled: true, health: 'ok' });
    const list = driver.listAccounts;
    driver.listAccounts = async () => {
      await new Promise((r) => setTimeout(r, 100));
      return list();
    };
    const [a, b] = await Promise.all([svc.syncFamily('gemini'), svc.syncFamily('gemini')]);
    expect(a).toEqual(b);
    expect(svc.store.list().filter((x) => x.kind === 'gemini')).toHaveLength(1);
  });

  it('a mixed group sends each model to the family that has it', async () => {
    const { svc } = await make();
    const gem = (await svc.add({ kind: 'gemini', credential: 'a=1' })).account;
    const claude = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-x', probe: false })).account;
    expect((await svc.resolveMembers({ accountId: gem.id }, 'gemini-3.6-flash')).map((t) => t.id)).toEqual(['sidecar:gemini']);
    expect(await svc.resolveMembers({ accountId: gem.id }, 'claude-sonnet-4-6')).toEqual([]);
    expect((await svc.resolveMembers({ accountId: claude.id }, 'claude-sonnet-4-6')).map((t) => t.id)).toEqual([claude.id]);
    expect(await svc.resolveMembers({ accountId: claude.id }, 'gemini-3.6-flash')).toEqual([]);
  });

  it('reports an expired sidecar login without throwing', async () => {
    const { svc } = await make();
    const { account } = await svc.add({ kind: 'gemini', credential: 'c=3' });
    (svc as any).gemini.checkAccount = async () => ({ remoteId: 'r1', name: 'x', enabled: true, health: 'expired', lastError: '登录态失效' });
    const probed = await svc.probe(account.id);
    expect(probed.health).toBe('expired');
    expect(probed.lastError).toBe('登录态失效');
  });
});
