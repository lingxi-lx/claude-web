// One engine process: spawn hidden, log to a rotating file, stop with its whole process tree.
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { appendFile, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LOCAL_NO_PROXY, mergeNoProxy, proxy } from '../net/proxy.js';

const LOG_MAX = 5 * 1024 * 1024;

export function logFile(root: string, id: string): string { return path.join(root, 'logs', `${id}.log`); }

export function appendLog(root: string, id: string, chunk: Buffer | string): void {
  try {
    const file = logFile(root, id);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFile(file, chunk, () => {});
    try {
      if (statSync(file).size > LOG_MAX) {
        rmSync(`${file}.1`, { force: true });
        renameSync(file, `${file}.1`);
      }
    } catch { /* racing a rotation is harmless */ }
  } catch { /* logging never takes the engine down */ }
}

export async function tailLog(root: string, id: string, lines = 200): Promise<string> {
  try {
    return (await fs.readFile(logFile(root, id), 'utf8')).split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/**
 * What an engine may see of our environment (review E1): the system's own variables a program needs to run and find
 * its config folders, nothing else — no API keys, OAuth tokens, CLAUDE_WEB_* / ANTHROPIC_* / OPENAI_*, nor the
 * dev shell's variables. Matched case-insensitively (Windows spells PATH as `Path`).
 */
const ENV_ALLOW = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR', 'LANG', 'LC_ALL', 'TZ',
]);

/**
 * The engine's environment: the allow-list above, the outbound proxy only when `network.proxy` has one in use
 * (`proxyUrl`, with loopback / the LAN direct), then the engine's own variables.
 */
export function engineEnv(base: NodeJS.ProcessEnv, own: Record<string, string>, proxyUrl: string | null): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && ENV_ALLOW.has(k.toUpperCase())) env[k] = v;
  if (proxyUrl) {
    env.HTTPS_PROXY = env.HTTP_PROXY = env.https_proxy = env.http_proxy = proxyUrl;
    env.NO_PROXY = env.no_proxy = mergeNoProxy(base.NO_PROXY ?? base.no_proxy, LOCAL_NO_PROXY);
  }
  return { ...env, ...own };
}

export function startProcess(bin: string, args: string[], opts: { cwd: string; env: Record<string, string>; root: string; id: string }): ChildProcess {
  const child = spawn(bin, args, {
    cwd: opts.cwd,
    env: engineEnv(process.env, opts.env, proxy.url),
    windowsHide: true,
    // POSIX: its own process group, so a stop reaches what it started
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (c: Buffer) => appendLog(opts.root, opts.id, c);
  child.stdout?.on('data', log);
  child.stderr?.on('data', log);
  appendLog(opts.root, opts.id, `\n[claude-web] ${new Date().toISOString()} start ${path.basename(bin)} ${args.join(' ')}\n`);
  return child;
}

/** Stop the process and everything it started (taskkill /T on Windows, the process group elsewhere). */
export async function stopTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  const pid = child.pid;
  const exited = new Promise<void>((r) => {
    if (child.exitCode !== null) return r();
    child.once('exit', () => r());
    setTimeout(r, 5_000).unref?.();
  });
  if (process.platform === 'win32') {
    await new Promise<void>((r) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, () => r()));
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
  }
  await exited;
  if (child.exitCode === null && process.platform !== 'win32') {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
  }
}
