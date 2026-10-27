// One engine process: spawn hidden, log to a rotating file, stop with its whole process tree.
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { appendFile, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

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

export function startProcess(bin: string, args: string[], opts: { cwd: string; env: Record<string, string>; root: string; id: string }): ChildProcess {
  const child = spawn(bin, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
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
