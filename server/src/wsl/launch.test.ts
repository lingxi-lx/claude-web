// launch.test.ts
import { describe, expect, it } from 'vitest';
import { rewriteFlagPaths, rewriteMcpForWsl, stripExecutable, wslArgv, wslEnv } from './launch';

describe('stripExecutable', () => {
  it('native: everything after the command; JS: everything after the script', () => {
    expect(stripExecutable('C:\\x\\claude.exe', ['--output-format', 'stream-json'], 'C:\\x\\claude.exe')).toEqual(['--output-format', 'stream-json']);
    expect(stripExecutable('claude', ['-p'], 'claude')).toEqual(['-p']);
    expect(stripExecutable('node', ['--import', 'g.js', 'C:\\e\\cli.js', '-p'], 'C:\\e\\cli.js')).toEqual(['-p']);
  });
});

describe('rewriteFlagPaths', () => {
  it('Windows paths become WSL paths; JSON and plain words untouched', () => {
    expect(rewriteFlagPaths(['--settings', 'C:\\Users\\Me\\AppData\\Local\\Temp\\cw-flags-1.json', '--mcp-config', '{"mcpServers":{"a":{"command":"C:\\\\x"}}}', '--add-dir', '\\\\wsl.localhost\\Ubuntu\\srv', '--model', 'opus'], 'Ubuntu'))
      .toEqual(['--settings', '/mnt/c/Users/Me/AppData/Local/Temp/cw-flags-1.json', '--mcp-config', '{"mcpServers":{"a":{"command":"C:\\\\x"}}}', '--add-dir', '/srv', '--model', 'opus']);
  });
});

describe('wslArgv', () => {
  it('-d, --cd, then --exec a login sh that execs the CLI with "$@" (no second shell parse of the arguments)', () => {
    expect(wslArgv({ distro: 'Ubuntu', cwd: '/home/me/proj', cli: 'claude', args: ['-p'] })).toEqual(['-d', 'Ubuntu', '--cd', '/home/me/proj', '--exec', 'sh', '-lc', 'exec claude "$@"', 'claude', '-p']);
  });
  it('quotes, backslashes, $ and backticks in arguments arrive unchanged, each its own argv entry', () => {
    const nasty = ['--mcp-config', '{"mcpServers":{"a":{"command":"C:\\x","args":["$(id)"]}}}', '--append-system-prompt', 'a `whoami` $HOME "q" \n; rm -rf ~', "it's"];
    const argv = wslArgv({ distro: 'Ubuntu', cwd: '/home/me/$(id)', cli: 'claude', args: nasty });
    expect(argv.slice(0, 9)).toEqual(['-d', 'Ubuntu', '--cd', '/home/me/$(id)', '--exec', 'sh', '-lc', 'exec claude "$@"', 'claude']);
    expect(argv.slice(9)).toEqual(nasty);
    // the only script the shell parses is our constant: the arguments never become part of it
    expect(argv[7]).toBe('exec claude "$@"');
    expect(argv).not.toContain('--');
  });
});

describe('wslEnv', () => {
  it('names what we set in WSLENV (kept with the user\'s own), never Windows-only variables', () => {
    const e = wslEnv({ PATH: 'C:\\w', WSLENV: 'FOO/p', HOME: 'C:\\Users\\me' }, { PATH: 'C:\\w', WSLENV: 'FOO/p', ANTHROPIC_MODEL: 'x', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', HOME: 'C:\\Users\\me', ELECTRON_RUN_AS_NODE: '1', TEMP: 'C:\\t' });
    expect(e.WSLENV!.split(':').sort()).toEqual(['ANTHROPIC_MODEL', 'CLAUDE_CODE_ENTRYPOINT', 'FOO/p']);
    expect(e.ANTHROPIC_MODEL).toBe('x');
  });
});

describe('rewriteMcpForWsl', () => {
  const exe = 'C:\\Program Files\\Claude Web\\Claude Web.exe';
  const servers = {
    'claude-web-memory': { type: 'stdio' as const, command: exe, args: ['C:\\app\\memory\\mcp.js', '--cwd', '\\\\wsl.localhost\\Ubuntu\\home\\me'], env: { ELECTRON_RUN_AS_NODE: '1' } },
    web: { type: 'stdio' as const, command: exe, args: ['C:\\app\\web\\mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1', CW_WEB_URL: 'http://127.0.0.1:3090/web', CW_WEB_TOKEN_FILE: 'C:\\Users\\me\\.claude-web\\web.token' } },
  };
  it('interop on: the Windows program through /mnt, arguments stay Windows paths, env crosses via WSLENV /u', () => {
    const r = rewriteMcpForWsl(servers, { interop: true });
    expect(r.dropped).toEqual([]);
    expect(r.servers.web.command).toBe('/mnt/c/Program Files/Claude Web/Claude Web.exe');
    expect(r.servers.web.args).toEqual(['C:\\app\\web\\mcp.js']);
    expect(r.servers.web.env.WSLENV.split(':').sort()).toEqual(['CW_WEB_TOKEN_FILE/u', 'CW_WEB_URL/u', 'ELECTRON_RUN_AS_NODE/u']);
    expect(r.servers['claude-web-memory'].args[2]).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me');
  });
  it('interop off: none of them, and which were dropped', () => {
    const r = rewriteMcpForWsl(servers, { interop: false });
    expect(r.servers).toEqual({});
    expect(r.dropped.sort()).toEqual(['claude-web-memory', 'web']);
  });
});
