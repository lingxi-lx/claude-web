import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { SidecarManager, platformKey, sidecarManifest } from './sidecar.js';

const dirs: string[] = [];
const mks = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sidecar-')); dirs.push(d); return d; };
afterEach(() => {
  delete process.env.CW_SIDECAR_GEMINI_BIN;
  delete process.env.CW_SIDECAR_GEMINI_CMD;
  for (const d of dirs.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* held */ } }
});

const manifestWith = (id: 'gemini' | 'workbuddy', url: string, sha256: string, size: number, entry: string) => ({
  gemini: { version: 'v-test', healthPath: '/x', platforms: { [platformKey()]: { url, sha256, size, entry } } },
  workbuddy: { version: 'v-test', healthPath: '/x', platforms: { [platformKey()]: { url, sha256, size, entry } } },
});

describe('SidecarManager install', () => {
  it('downloads, verifies and stores the binary; a bad hash is refused', async () => {
    const d = mks();
    const bytes = Buffer.from('#!/bin/sh\necho hi\n');
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    const srv = http.createServer((_q, res) => res.writeHead(200).end(bytes));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(srv.address() as any).port}/bin`;
    try {
      const good = new SidecarManager({ dir: path.join(d, 'sc', 'gemini'), manifest: manifestWith('gemini', url, sha, bytes.length, process.platform === 'win32' ? 'g.exe' : 'g') });
      const bin = await good.install('gemini');
      expect(fs.readFileSync(bin)).toEqual(bytes);
      expect(good.status('gemini').installed).toBe(true);

      // a separate folder: install() short-circuits on the binary the good run already placed
      const bad = new SidecarManager({ dir: path.join(d, 'bad', 'gemini'), manifest: manifestWith('gemini', url, '0'.repeat(64), bytes.length, 'g') });
      await expect(bad.install('gemini')).rejects.toThrow(/SHA256/);
      expect(bad.status('gemini').installed).toBe(false);
    } finally {
      srv.closeAllConnections();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

describe('SidecarManager bundled build', () => {
  it('uses the binary the installer shipped, without downloading', () => {
    const d = mks();
    const entry = process.platform === 'win32' ? 'gemini-web2api.exe' : 'gemini-web2api';
    const dir = path.join(d, 'resources', 'sidecars', platformKey(), 'gemini');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, entry), 'x');
    const m = new SidecarManager({ dir: path.join(d, 'data'), bundledDir: path.join(d, 'resources', 'sidecars') });
    expect(m.status('gemini')).toMatchObject({ installed: true, version: sidecarManifest.gemini.version });
    expect(m.binary('gemini')).toBe(path.join(dir, entry));
  });
});

describe('SidecarManager lifecycle', () => {
  it('starts a fake sidecar, keeps its log, restarts it after a crash and stops it', async () => {
    const d = mks();
    const script = path.join(d, 'fake-sidecar.mjs');
    fs.writeFileSync(script, `
import http from 'node:http';
const i = process.argv.indexOf('--port');
const port = Number(process.argv[i + 1]);
http.createServer((q, s) => { s.writeHead(q.url === '/health' ? 200 : 404).end('ok'); }).listen(port, '127.0.0.1');
console.log('fake-sidecar up on ' + port);
`);
    process.env.CW_SIDECAR_GEMINI_BIN = process.execPath;
    const m = new SidecarManager({ dir: path.join(d, 'sc') });
    const spec = {
      args: ({ port }: { port: number }) => [script, '--port', String(port)],
      health: async (port: number) => {
        try { return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
      },
    };
    try {
      await m.start('gemini', spec as any);
      expect(m.status('gemini')).toMatchObject({ running: true, health: 'ok', version: 'dev' });
      const firstPort = m.status('gemini').port;
      expect(firstPort).toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 300));
      expect(await m.logs('gemini')).toContain('fake-sidecar up on');

      // crash it: the supervisor brings it back (on a fresh port)
      const run = (m as any).runs.get('gemini');
      run.child.kill();
      const back = await (async () => {
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 250));
          if (m.status('gemini').health === 'ok') return true;
        }
        return false;
      })();
      expect(back).toBe(true);
      expect(m.status('gemini').health).toBe('ok');
    } finally {
      await m.stopAll();
      expect(m.status('gemini').running).toBe(false);
    }
  });

  it('spawns one process even when two callers start it at once', async () => {
    const d = mks();
    const mark = path.join(d, 'spawns.txt');
    const script = path.join(d, 'once-sidecar.mjs');
    fs.writeFileSync(script, `
import fs from 'node:fs';
import http from 'node:http';
fs.appendFileSync(process.env.MARK, 'x\\n');
const i = process.argv.indexOf('--port');
const port = Number(process.argv[i + 1]);
http.createServer((q, s) => s.writeHead(200).end('ok')).listen(port, '127.0.0.1');
`);
    process.env.CW_SIDECAR_GEMINI_CMD = JSON.stringify([process.execPath, script]);
    const m = new SidecarManager({ dir: path.join(d, 'sc-once') });
    const spec = {
      args: ({ port }: { port: number }) => ['--port', String(port)],
      env: () => ({ MARK: mark }),
      health: async (port: number) => {
        try { return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
      },
    };
    try {
      await Promise.all([m.start('gemini', spec as any), m.start('gemini', spec as any)]);
      expect(fs.readFileSync(mark, 'utf8').trim().split('\n')).toHaveLength(1);
    } finally {
      await m.stopAll();
    }
  }, 20_000);

  it('a stop during startup leaves nothing running', async () => {
    const d = mks();
    const script = path.join(d, 'slow-sidecar.mjs');
    fs.writeFileSync(script, `
import http from 'node:http';
const i = process.argv.indexOf('--port');
http.createServer((q, s) => s.writeHead(200).end('ok')).listen(Number(process.argv[i + 1]), '127.0.0.1');
`);
    process.env.CW_SIDECAR_GEMINI_CMD = JSON.stringify([process.execPath, script]);
    const m = new SidecarManager({ dir: path.join(d, 'sc-stop') });
    const spec = { args: ({ port }: { port: number }) => ['--port', String(port)], health: async () => false };
    const starting = m.start('gemini', spec as any);
    await new Promise((r) => setTimeout(r, 300));
    await m.stop('gemini');
    await expect(starting).rejects.toThrow(/取消|启动失败/);
    expect(m.status('gemini').running).toBe(false);
    expect((m as any).runs.size).toBe(0);
  }, 20_000);

  it('a fresh start cancels the crash restart that was waiting to fire', async () => {
    const d = mks();
    const mark = path.join(d, 'spawns-restart.txt');
    const script = path.join(d, 'restart-sidecar.mjs');
    fs.writeFileSync(script, `
import fs from 'node:fs';
import http from 'node:http';
fs.appendFileSync(process.env.MARK, 'x\\n');
const i = process.argv.indexOf('--port');
http.createServer((q, s) => s.writeHead(200).end('ok')).listen(Number(process.argv[i + 1]), '127.0.0.1');
`);
    process.env.CW_SIDECAR_GEMINI_CMD = JSON.stringify([process.execPath, script]);
    const m = new SidecarManager({ dir: path.join(d, 'sc-restart') });
    const spec = {
      args: ({ port }: { port: number }) => ['--port', String(port)],
      env: () => ({ MARK: mark }),
      health: async (port: number) => {
        try { return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
      },
    };
    try {
      await m.start('gemini', spec as any);
      (m as any).runs.get('gemini').child.kill();
      for (let i = 0; i < 40 && !(m as any).timers.has('gemini'); i++) await new Promise((r) => setTimeout(r, 50));
      expect((m as any).timers.has('gemini')).toBe(true);
      const slow = { ...spec, prepare: async () => { await new Promise((r) => setTimeout(r, 800)); } };
      const p = m.start('gemini', slow as any);
      expect((m as any).timers.has('gemini')).toBe(false);
      await p;
      // the old 1 s timer would have fired by now; it must not have spawned a second process
      await new Promise((r) => setTimeout(r, 1200));
      expect(fs.readFileSync(mark, 'utf8').trim().split('\n')).toHaveLength(2);
    } finally {
      await m.stopAll();
    }
  }, 20_000);

  it('kills a running sidecar after three failed health checks in a row', async () => {
    const m = new SidecarManager({ dir: mks(), healthMs: 40 });
    let killed = 0;
    const run = { port: 1, health: 'ok', healthFails: 0, checking: false, child: { kill: () => { killed++; } } } as any;
    (m as any).runs.set('gemini', run);
    const spec = { args: () => [], health: async () => false };
    (m as any).monitor('gemini', run, spec);
    for (let i = 0; i < 30 && !killed; i++) await new Promise((r) => setTimeout(r, 30));
    (m as any).clearMonitor(run);
    expect(killed).toBe(1);
    expect(run.healthFails).toBeGreaterThanOrEqual(3);
  });

  it('takes a launcher plus its argument as the dev command', async () => {
    const d = mks();
    const script = path.join(d, 'cmd-sidecar.mjs');
    fs.writeFileSync(script, `
import http from 'node:http';
const i = process.argv.indexOf('--port');
const port = Number(process.argv[i + 1]);
http.createServer((q, s) => s.writeHead(200).end('ok')).listen(port, '127.0.0.1');
console.log('cmd-sidecar up on ' + port);
`);
    process.env.CW_SIDECAR_GEMINI_CMD = JSON.stringify([process.execPath, script]);
    const m = new SidecarManager({ dir: path.join(d, 'sc-cmd') });
    const spec = {
      args: ({ port }: { port: number }) => ['--port', String(port)],
      health: async (port: number) => {
        try { return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
      },
    };
    try {
      await m.start('gemini', spec as any);
      expect(m.status('gemini')).toMatchObject({ running: true, version: 'dev' });
    } finally {
      await m.stopAll();
    }
  });
});
