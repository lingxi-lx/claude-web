import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInstallerNoise, warmUp, warmupSpec } from './mcp-warm.js';

describe('warmupSpec', () => {
  it('picks the package runners, in any spelling of the command', () => {
    expect(warmupSpec({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] })).toEqual({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: {} });
    expect(warmupSpec(JSON.stringify({ command: 'uvx', args: ['mcp-server-fetch'], env: { A: '1', B: 2 } }))).toEqual({ command: 'uvx', args: ['mcp-server-fetch'], env: { A: '1' } });
    expect(warmupSpec({ command: 'C:\\Program Files\\nodejs\\npx.cmd', args: ['-y', 'x'] })?.command).toBe('C:\\Program Files\\nodejs\\npx.cmd');
    expect(warmupSpec({ command: '/usr/local/bin/bunx' })).toEqual({ command: '/usr/local/bin/bunx', args: [], env: {} });
  });
  it('leaves everything else alone', () => {
    expect(warmupSpec({ type: 'stdio', command: 'node', args: ['server.js'] })).toBeNull();
    expect(warmupSpec({ type: 'http', url: 'https://mcp.example/mcp' })).toBeNull();
    expect(warmupSpec({ type: 'sse', command: 'npx' })).toBeNull();
    expect(warmupSpec('not json')).toBeNull();
    expect(warmupSpec({ command: 'npx-helper' })).toBeNull();
  });
});

describe('isInstallerNoise', () => {
  it('npm / uv progress is not the server talking', () => {
    for (const l of ['', 'npm warn deprecated glob@7.2.3: no longer supported', 'npm WARN exec The following package was not found', 'npm notice New minor version', 'Installed 12 packages in 30ms', 'Resolved 5 packages in 1.2s', 'Downloading pydantic-core (1.9MiB)'])
      expect(isInstallerNoise(l), l).toBe(true);
  });
  it('anything else is', () => {
    expect(isInstallerNoise('Knowledge Graph MCP Server running on stdio')).toBe(false);
    expect(isInstallerNoise('Error: Cannot find module')).toBe(false);
  });
});

describe('warmUp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-warm-'));
  const script = (name: string, body: string) => { const f = path.join(dir, name); fs.writeFileSync(f, body); return f; };

  it('ends when the server exits at end of input', async () => {
    const f = script('eof.js', "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));");
    const r = await warmUp({ command: process.execPath, args: [f], env: {} }, { timeoutMs: 20_000 });
    expect(r).toMatchObject({ ok: true });
    expect(r.timedOut).toBeUndefined();
  });

  it('ends a moment after a server that ignores end of input speaks', async () => {
    const f = script('talk.js', "console.error('npm warn deprecated x'); setTimeout(() => console.error('server running on stdio'), 100); setInterval(() => {}, 1000);");
    const r = await warmUp({ command: process.execPath, args: [f], env: {} }, { timeoutMs: 20_000, settleMs: 100 });
    expect(r).toMatchObject({ ok: true });
    expect(r.ms).toBeLessThan(15_000);
  });

  it('gives up at the cap on one that never says anything', async () => {
    const f = script('mute.js', 'setInterval(() => {}, 1000);');
    const r = await warmUp({ command: process.execPath, args: [f], env: {} }, { timeoutMs: 500 });
    expect(r).toMatchObject({ ok: false, timedOut: true });
  });

  it('a command that is not there is an answer, not a throw', async () => {
    const r = await warmUp({ command: path.join(dir, 'no-such-runner'), args: [], env: {} }, { timeoutMs: 5000 });
    expect(r.ok).toBe(false);
  });
});
