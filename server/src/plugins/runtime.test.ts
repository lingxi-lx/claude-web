import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseManifest } from './manifest';
import { BOOTSTRAP, childArgs, childEnv, permissionFlag, PluginRunner } from './runtime';

const manifest = (extra: Record<string, unknown> = {}) => parseManifest({ id: 'probe', main: 'index.js', hooks: ['source-provider'], ...extra });

describe('child command line and environment', () => {
  it('limits reads / writes, grants processes / workers only when declared, caps the heap', () => {
    const m = manifest();
    const a = childArgs({ flag: '--permission', read: ['/p', '/p/*'], write: ['/d', '/d/*'], manifest: m, entry: '/p/index.js' });
    expect(a).toEqual(['--permission', '--allow-fs-read=/p', '--allow-fs-read=/p/*', '--allow-fs-write=/d', '--allow-fs-write=/d/*', '--max-old-space-size=256', '-e', BOOTSTRAP, '--', '/p/index.js']);
    const g = childArgs({ flag: '--permission', read: [], write: [], manifest: manifest({ permissions: { childProcess: true, workers: true }, maxMemoryMb: 64 }), entry: 'e' });
    expect(g).toContain('--allow-child-process');
    expect(g).toContain('--allow-worker');
    expect(g).toContain('--max-old-space-size=64');
    // without the permission model: still the heap cap, never an --allow flag; the bootstrap is always inline
    expect(childArgs({ flag: null, read: ['/p'], write: ['/d'], manifest: m, entry: 'e' })).toEqual(['--max-old-space-size=256', '-e', BOOTSTRAP, '--', 'e']);
  });

  it('manifest: grants must be booleans; memory within bounds', () => {
    expect(() => manifest({ permissions: { childProcess: 'yes' } })).toThrow();
    expect(() => manifest({ maxMemoryMb: 4096 })).toThrow();
    expect(manifest({ permissions: {} }).permissions.childProcess).toBeUndefined();
  });

  it('a minimal environment: no keys, no PATH unless it may start programs', () => {
    const from = { SystemRoot: 'C:\\Windows', PATH: '/bin', ANTHROPIC_API_KEY: 'k', CLAUDE_WEB_TOKEN: 't', HTTPS_PROXY: 'http://u:p@x' } as NodeJS.ProcessEnv;
    const e = childEnv(manifest(), '/data/probe', from);
    expect(e).toMatchObject({ SystemRoot: 'C:\\Windows', CW_PLUGIN_ID: 'probe', CW_PLUGIN_DATA: '/data/probe' });
    expect(e.PATH).toBeUndefined();
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
    expect(e.CLAUDE_WEB_TOKEN).toBeUndefined();
    expect(e.HTTPS_PROXY).toBeUndefined();
    expect(e.CW_PLUGIN_ALLOW).toBeUndefined();
    const g = childEnv(manifest({ permissions: { childProcess: true } }), undefined, from);
    expect(g.PATH).toBe('/bin');
    expect(g.CW_PLUGIN_ALLOW).toBe('child_process');
    expect(g.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe.runIf(!!permissionFlag() && !process.versions.electron)('a real child under the permission model', () => {
  let root = '';
  let pluginDir = '';
  let dataDir = '';
  let outside = '';
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-plugin-rt-'));
    pluginDir = path.join(root, 'plugins', 'probe');
    dataDir = path.join(root, 'plugins', '.data', 'probe');
    outside = path.join(root, 'outside.txt');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(outside, 'private');
    fs.writeFileSync(path.join(pluginDir, 'index.js'), [
      "const fs = require('fs'); const path = require('path');",
      'const tryIt = (f) => { try { return String(f()); } catch (e) { return "denied:" + (e.code || e.message); } };',
      'exports.sources = async (p, host) => { p.host = host; return {',
      '  writeData: tryIt(() => { fs.writeFileSync(path.join(process.env.CW_PLUGIN_DATA, "x.txt"), "ok"); return fs.readFileSync(path.join(process.env.CW_PLUGIN_DATA, "x.txt"), "utf8"); }),',
      '  writeOwn: tryIt(() => fs.writeFileSync(path.join(__dirname, "hack.js"), "x")),',
      '  readOutside: tryIt(() => fs.readFileSync(p.outside, "utf8")),',
      '  writeOutside: tryIt(() => fs.writeFileSync(p.outside, "x")),',
      "  childProcess: tryIt(() => require('child_process')),",
      "  worker: tryIt(() => require('worker_threads')),",
      '  metadata: await p.host.fetch("https://169.254.169.254/latest/meta-data").then((r) => "status:" + r.status, (e) => "denied:" + e.message),',
      '  envKeys: Object.keys(process.env).filter((k) => /KEY|TOKEN|PROXY|ANTHROPIC|CLAUDE/i.test(k)).join(","),',
      '}; };',
    ].join('\n'));
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

  it('writes only to its data folder; reads nothing outside; no processes / workers', async () => {
    const runner = new PluginRunner(pluginDir, manifest({ permissions: { network: ['*'] } }), { dataDir, secret: async () => undefined });
    try {
      const r = await runner.call<Record<string, string>>('source-provider', { outside });
      expect(r.writeData).toBe('ok');
      expect(r.writeOwn).toMatch(/^denied:/);
      expect(r.readOutside).toMatch(/^denied:/);
      expect(r.writeOutside).toMatch(/^denied:/);
      expect(r.childProcess).toMatch(/^denied:/);
      expect(r.worker).toMatch(/^denied:/);
      expect(r.envKeys).toBe('');
      expect(r.metadata).toMatch(/^denied:.*169\.254\.169\.254/);
      expect(fs.readFileSync(outside, 'utf8')).toBe('private');
    } finally {
      const child = (runner as unknown as { child: import('node:child_process').ChildProcess | null }).child;
      const gone = child && child.exitCode === null ? new Promise((r) => child.once('exit', r)) : null;
      runner.stop();
      await gone;
    }
  }, 20_000);
});
