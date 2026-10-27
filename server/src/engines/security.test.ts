// Review E1 / E4: an engine process sees none of our secrets, and only a window on this computer manages engines.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawned = vi.hoisted(() => [] as { bin: string; opts: any }[]);
vi.mock('node:child_process', async (orig) => {
  const real = await orig<typeof import('node:child_process')>();
  return {
    ...real,
    spawn: (bin: string, _args: string[], opts: any) => {
      spawned.push({ bin, opts });
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.exitCode = null;
      return child;
    },
  };
});

const { engineEnv, startProcess } = await import('./process.js');
const { handleEngineRequest } = await import('./handlers.js');

const SECRET = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|^ANTHROPIC_|^OPENAI_|^CLAUDE_|^ELECTRON_|PROXY/i;

const planted = {
  ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'https://x', OPENAI_API_KEY: 'sk-test',
  CLAUDE_CODE_OAUTH_TOKEN: 'oauth', CLAUDE_WEB_DIR: '/x', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', GITHUB_TOKEN: 'ghp',
  HTTPS_PROXY: 'http://user:pass@10.0.0.1:3128', AWS_SECRET_ACCESS_KEY: 'a', GEMINI_API_KEY: 'g',
};

afterEach(() => {
  for (const k of Object.keys(planted)) delete process.env[k];
  spawned.length = 0;
});

describe('engine environment (E1)', () => {
  it('the env handed to spawn holds only the allow-list and the engine\'s own variables', () => {
    Object.assign(process.env, planted);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-engine-env-'));
    try {
      startProcess('engine-bin', [], { cwd: root, env: { MAGPIE_ADDR: '127.0.0.1:1' }, root, id: 'test-engine' });
    } finally {
      setTimeout(() => fs.rmSync(root, { recursive: true, force: true }), 50);
    }
    const { opts } = spawned[0];
    expect(opts.windowsHide).toBe(true);
    const keys = Object.keys(opts.env);
    expect(keys.filter((k) => SECRET.test(k))).toEqual([]);
    expect(opts.env.MAGPIE_ADDR).toBe('127.0.0.1:1');
    expect(keys.some((k) => k.toUpperCase() === 'PATH')).toBe(true);
    for (const v of Object.values(planted)) expect(Object.values(opts.env)).not.toContain(v);
  });

  it('a proxy goes in only when network.proxy has one in use', () => {
    const base = { Path: 'C:\\bin', SystemRoot: 'C:\\Windows', HTTPS_PROXY: 'http://env:3128', OPENAI_API_KEY: 'k' };
    const off = engineEnv(base, {}, null);
    expect(off).toEqual({ Path: 'C:\\bin', SystemRoot: 'C:\\Windows' });
    const on = engineEnv(base, {}, 'http://127.0.0.1:7890');
    expect(on.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
    expect(on.NO_PROXY).toContain('127.0.0.1');
    expect(on.OPENAI_API_KEY).toBeUndefined();
  });
});

describe('engines.* from another machine or a phone (E4)', () => {
  const svc: any = new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) });
  it('everything but the status is refused for a remote caller', async () => {
    for (const req of [
      { kind: 'engines.install', id: 'cliproxyapi' }, { kind: 'engines.upgrade', id: 'cliproxyapi' }, { kind: 'engines.rollback', id: 'cliproxyapi' },
      { kind: 'engines.connect', id: 'magpie', port: 8080 }, { kind: 'engines.start', id: 'magpie' }, { kind: 'engines.stop', id: 'magpie' },
      { kind: 'engines.uninstall', id: 'magpie' }, { kind: 'engines.logs', id: 'magpie' },
    ] as any[]) await expect(handleEngineRequest(svc, req, true), req.kind).rejects.toThrow();
    const statuses = vi.fn(async () => []);
    await expect(handleEngineRequest({ statuses } as any, { kind: 'engines.status' }, true)).resolves.toEqual({ engines: [] });
  });

  it('a window on this computer still manages them', async () => {
    const logs = vi.fn(async () => 'x');
    await expect(handleEngineRequest({ logs } as any, { kind: 'engines.logs', id: 'magpie' }, false)).resolves.toEqual({ text: 'x' });
  });
});
