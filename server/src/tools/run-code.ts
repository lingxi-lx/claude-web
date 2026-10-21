// Run a code block the user asked to run, here, as the user. Not an agent tool: only a window on this machine may
// ask (the hub checks), and the UI confirms first. Output and time are capped; the process tree is killed on timeout.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tr } from '../i18n/index.js';

export interface CodeRunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  timedOut: boolean;
}

export interface CodeRunOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutput?: number;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_OUTPUT = 64 * 1024;

interface Runner { cmd: string; args(code: string): string[] }

const BASHES = new Set(['bash', 'sh', 'zsh', 'shell']);
const POWERSHELL = new Set(['powershell', 'ps1', 'pwsh']);
const PYTHON = new Set(['python', 'python3', 'py']);
const NODE = new Set(['javascript', 'js', 'node']);

export function runnerFor(lang: string): Runner | null {
  const l = lang.trim().toLowerCase();
  if (BASHES.has(l)) {
    // on Windows `shell` means cmd; `bash` means the bash on PATH (Git Bash), and failing to find it is reported
    if (process.platform === 'win32' && (l === 'shell' || l === 'cmd')) return { cmd: 'cmd.exe', args: (c) => ['/d', '/s', '/c', c] };
    return { cmd: l === 'bash' ? 'bash' : process.platform === 'win32' ? 'bash' : 'sh', args: (c) => ['-lc', c] };
  }
  if (l === 'cmd' || l === 'bat') return { cmd: 'cmd.exe', args: (c) => ['/d', '/s', '/c', c] };
  if (POWERSHELL.has(l)) return { cmd: process.platform === 'win32' ? 'powershell.exe' : 'pwsh', args: (c) => ['-NoProfile', '-NonInteractive', '-Command', c] };
  if (PYTHON.has(l)) return { cmd: process.platform === 'win32' ? 'python' : 'python3', args: (c) => ['-c', c] };
  if (NODE.has(l)) return { cmd: process.execPath, args: (c) => ['-e', c] };
  return null;
}

export function executableLanguages(): string[] {
  return [...BASHES, ...POWERSHELL, 'cmd', 'bat', ...PYTHON, ...NODE];
}

function killTree(child: ReturnType<typeof spawn>): void {
  if (process.platform === 'win32' && child.pid) {
    const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    k.on('error', () => { try { child.kill(); } catch { /* gone */ } });
    return;
  }
  try { child.kill('SIGKILL'); } catch { /* gone */ }
}

export async function runCode(lang: string, code: string, opts: CodeRunOptions = {}): Promise<CodeRunResult> {
  const runner = runnerFor(lang);
  if (!runner) throw new Error(tr('这种语言的代码还不能直接运行'));
  const cwd = opts.cwd && path.isAbsolute(opts.cwd) && fs.existsSync(opts.cwd) && fs.statSync(opts.cwd).isDirectory()
    ? opts.cwd
    : process.cwd();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxOutput = opts.maxOutput ?? DEFAULT_MAX_OUTPUT;
  const started = Date.now();
  return new Promise<CodeRunResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(runner.cmd, runner.args(code), { cwd, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e: any) {
      reject(new Error(tr('找不到运行 {lang} 的程序：{message}', { lang, message: e?.message ?? String(e) })));
      return;
    }
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const take = (which: 'out' | 'err', chunk: Buffer) => {
      const room = maxOutput - (stdout.length + stderr.length);
      const text = chunk.toString('utf8');
      if (text.length > room) {
        truncated = true;
        if (which === 'out') stdout += text.slice(0, Math.max(0, room));
        else stderr += text.slice(0, Math.max(0, room));
        killTree(child);
        return;
      }
      if (which === 'out') stdout += text;
      else stderr += text;
    };
    child.stdout?.on('data', (c: Buffer) => take('out', c));
    child.stderr?.on('data', (c: Buffer) => take('err', c));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    timer.unref?.();
    child.on('error', (e: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(e?.code === 'ENOENT'
        ? tr('找不到运行 {lang} 的程序（{cmd}）', { lang, cmd: runner.cmd })
        : tr('运行失败：{message}', { message: e?.message ?? String(e) })));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut && !truncated, code, stdout, stderr, durationMs: Date.now() - started, truncated, timedOut });
    });
  });
}
