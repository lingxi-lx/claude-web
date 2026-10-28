import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PluginRunner, readManifest } from './runtime.js';
import { PluginService } from './service.js';
import type { MetaStore } from '../meta/store.js';

const tmp: string[] = [];
async function mkPlugin(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-plugins-'));
  tmp.push(root);
  const dir = path.join(root, 'p');
  await fs.mkdir(dir);
  for (const [n, c] of Object.entries(files)) await fs.writeFile(path.join(dir, n), c, 'utf8');
  return root;
}
afterAll(async () => { for (const d of tmp) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function fakeMeta(): MetaStore {
  const settings: Record<string, unknown> = {};
  return {
    settings: () => settings,
    setSetting: async (k: string, v: unknown) => { settings[k] = v; },
    provider: () => undefined,
  } as unknown as MetaStore;
}

const manifest = (extra: Record<string, unknown> = {}) => JSON.stringify({ id: 'p1', name: 'P1', main: 'index.js', hooks: ['request-before'], ...extra });

// Every way a plugin could reach a builtin that opens sockets; each attempt reports "opened" or "refused: …".
const SNEAKY = `
const tries = {
  getBuiltinModule: async (port) => { const n = process.getBuiltinModule('node:net'); await connect(n, port); },
  getBuiltinModuleHttp: async (port) => { const h = process.getBuiltinModule('http'); await get(h, port); },
  esmHttps: async (port) => { const h = await import('node:https'); await get(h, port, true); },
  esmNet: async (port) => { const n = await import('net'); await connect(n.default || n, port); },
  requireNet: async (port) => { await connect(require('net'), port); },
  internalHttpClient: async (port) => { const c = await import('_http_client'); await new Promise((res, rej) => { const r = new c.ClientRequest({ host: '127.0.0.1', port }); r.on('error', rej); r.on('socket', () => res()); r.end(); }); },
  moduleLoad: async (port) => { await connect(module.constructor._load('net'), port); },
  ownHooks: async () => { module.constructor.registerHooks({ resolve: (s, c, n) => n(s, c) }); },
  binding: async () => { process.binding('tcp_wrap'); },
  stdoutSocket: async (port) => { const S = process.stdout.constructor; const s = new S(); await connect({ connect: (p, h, cb) => s.connect(p, h, cb) }, port); },
  childProcess: async () => { require('child_process').execSync('echo hi'); },
};
function connect(n, port) { return new Promise((res, rej) => { const s = n.connect(port, '127.0.0.1', () => { s.end(); res(); }); s.on && s.on('error', rej); }); }
function get(h, port, tls) { return new Promise((res, rej) => { const r = h.request({ host: '127.0.0.1', port, method: 'GET', rejectUnauthorized: false }); r.on('socket', (s) => s.on('connect', res)); r.on('error', () => res()); r.end(); setTimeout(() => rej(new Error('no socket')), 2000); }); }
exports.requestBefore = async (p) => {
  const out = {};
  for (const [k, fn] of Object.entries(tries)) {
    try { await fn(p.port); out[k] = 'opened'; } catch (e) { out[k] = 'refused: ' + String((e && e.message) || e); }
  }
  return out;
};
`;

describe('plugin network ban', () => {
  let server: net.Server;
  let port = 0;
  let connections = 0;
  beforeAll(async () => {
    server = net.createServer((s) => { connections++; s.destroy(); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as net.AddressInfo).port;
  });
  afterAll(() => { server.close(); });

  for (const isolation of ['permission', 'process'] as const) {
    it(`no builtin path opens a socket (${isolation} isolation)`, async () => {
      const root = await mkPlugin({ 'plugin.json': manifest(), 'index.js': SNEAKY });
      const dir = path.join(root, 'p');
      const runner = new PluginRunner(dir, await readManifest(dir), { secret: async () => undefined, isolation, unrestrictedAllowed: () => true });
      try {
        const before = connections;
        const out = await runner.call<Record<string, string>>('request-before', { port });
        for (const [k, v] of Object.entries(out)) expect(`${k}: ${v}`).toMatch(new RegExp(`^${k}: refused`));
        expect(Object.keys(out)).toHaveLength(11);
        expect(connections).toBe(before);
      } finally { runner.stop(); }
    }, 20_000);
  }
});

describe('process isolation', () => {
  it('the runner refuses to start without the per-plugin opt-in, and always when secrets are declared', async () => {
    const root = await mkPlugin({ 'plugin.json': manifest(), 'index.js': 'exports.requestBefore = async () => "ran";' });
    const dir = path.join(root, 'p');
    const off = new PluginRunner(dir, await readManifest(dir), { secret: async () => undefined, isolation: 'process' });
    await expect(off.call('request-before', {})).rejects.toThrow(/not allowed/);
    expect(off.running).toBe(false);

    const root2 = await mkPlugin({ 'plugin.json': manifest({ permissions: { secrets: ['provider:x'] } }), 'index.js': 'exports.requestBefore = async () => "ran";' });
    const dir2 = path.join(root2, 'p');
    const sec = new PluginRunner(dir2, await readManifest(dir2), { secret: async () => undefined, isolation: 'process', unrestrictedAllowed: () => true });
    await expect(sec.call('request-before', {})).rejects.toThrow(/secrets/);
    expect(sec.running).toBe(false);
  });

  it('the service needs allowUnrestricted, and never enables a plugin asking for secrets', async () => {
    const root = await mkPlugin({ 'plugin.json': manifest(), 'index.js': 'exports.requestBefore = async (p) => ({ ...p, touched: true });' });
    const svc = new PluginService({ meta: fakeMeta(), dir: root, isolation: 'process' });
    await svc.init();
    await expect(svc.enable('p1', true)).rejects.toThrow();
    expect(svc.list().plugins[0].enabled).toBe(false);
    expect(await svc.runHook('request-before', { a: 1 })).toEqual({ a: 1 });
    await svc.enable('p1', true, true);
    expect(svc.list().plugins[0].unrestricted).toBe(true);
    expect(await svc.runHook('request-before', { a: 1 })).toEqual({ a: 1, touched: true });
    svc.stop();

    const root2 = await mkPlugin({ 'plugin.json': manifest({ permissions: { secrets: ['provider:x'] } }), 'index.js': 'exports.requestBefore = async (p) => p;' });
    const svc2 = new PluginService({ meta: fakeMeta(), dir: root2, isolation: 'process' });
    await svc2.init();
    await expect(svc2.enable('p1', true, true)).rejects.toThrow();
    expect(svc2.hasHook('request-before')).toBe(false);
  }, 20_000);
});

describe('approval covers the code', () => {
  let svc: PluginService | null = null;
  afterEach(() => { svc?.stop(); svc = null; });

  it('changed code needs approving again, before the next spawn too', async () => {
    const root = await mkPlugin({ 'plugin.json': manifest(), 'index.js': 'exports.requestBefore = async (p) => ({ ...p, v: 1 });', 'lib.js': '// helper' });
    svc = new PluginService({ meta: fakeMeta(), dir: root, isolation: 'permission' });
    await svc.init();
    await svc.enable('p1', true);
    expect(svc.list().plugins[0].approved).toBe(true);

    // changed after the last read, before the child starts: the spawn is refused
    await fs.writeFile(path.join(root, 'p', 'lib.js'), '// changed', 'utf8');
    const skipped: string[] = [];
    expect(await svc.runHook('request-before', { a: 1 }, (id) => skipped.push(id))).toEqual({ a: 1 });
    expect(skipped).toEqual(['p1']);
    let view = svc.list().plugins[0];
    expect(view.approved).toBe(false);
    expect(view.codeChanged).toBe(true);

    // re-approved, it runs; a changed main after a reload is not approved
    await svc.enable('p1', true);
    expect(await svc.runHook('request-before', { a: 1 })).toEqual({ a: 1, v: 1 });
    svc.stop();
    await fs.writeFile(path.join(root, 'p', 'index.js'), 'exports.requestBefore = async (p) => ({ ...p, v: 2 });', 'utf8');
    await svc.reload();
    view = svc.list().plugins[0];
    expect(view.approved).toBe(false);
    expect(view.codeChanged).toBe(true);
    expect(svc.hasHook('request-before')).toBe(false);
    await expect(svc.enable('p1')).rejects.toThrow();
  }, 20_000);

  it('a change the watcher saw first is reported as skipped too (not silent)', async () => {
    const root = await mkPlugin({ 'plugin.json': manifest(), 'index.js': 'exports.requestBefore = async (p) => ({ ...p, v: 1 });', 'lib.js': '// helper' });
    svc = new PluginService({ meta: fakeMeta(), dir: root, isolation: 'permission' });
    await svc.init();
    await svc.enable('p1', true);
    await fs.writeFile(path.join(root, 'p', 'lib.js'), '// changed', 'utf8');
    for (let i = 0; i < 50 && svc.list().plugins[0].approved; i++) await new Promise((r) => setTimeout(r, 100));
    expect(svc.list().plugins[0].approved).toBe(false);
    const skipped: string[] = [];
    expect(await svc.runHook('request-before', { a: 1 }, (id) => skipped.push(id))).toEqual({ a: 1 });
    expect(skipped).toEqual(['p1']);
  }, 20_000);

  it('code added while the process is running never runs unapproved (the running process is stopped)', async () => {
    const lazy = "exports.requestBefore = async (p) => { let l = null; try { l = require('./lazy.js'); } catch {} return { ...p, lazy: l }; };";
    const root = await mkPlugin({ 'plugin.json': manifest(), 'index.js': lazy });
    svc = new PluginService({ meta: fakeMeta(), dir: root, isolation: 'permission' });
    await svc.init();
    await svc.enable('p1', true);
    expect(await svc.runHook('request-before', { a: 1 })).toEqual({ a: 1, lazy: null });

    await fs.writeFile(path.join(root, 'p', 'lazy.js'), "module.exports = 'UNAPPROVED';", 'utf8');
    // the watcher stops the process and re-hashes; wait for it to see the change
    for (let i = 0; i < 50 && svc.list().plugins[0].approved; i++) await new Promise((r) => setTimeout(r, 100));
    const out = await svc.runHook('request-before', { a: 1 }) as Record<string, unknown>;
    expect(out.lazy).not.toBe('UNAPPROVED');
    expect(svc.list().plugins[0].codeChanged).toBe(true);
  }, 20_000);
});
