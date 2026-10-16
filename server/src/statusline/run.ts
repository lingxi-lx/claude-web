// statusLine (phase 6 §3): the line Claude Code draws under its prompt, from a command the user set in
// ~/.claude/settings.json (`statusLine: { type: 'command', command }`). Run the way Claude Code runs it — the
// conversation as JSON on stdin, whatever it prints is the line (ANSI colours and all; the front end draws them).
// Only the user's own settings: a project's .claude/settings.json comes with whatever was cloned, and opening a
// conversation there must not run a command from it.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { killTree } from '../agents/kill-tree.js';

export interface StatusLineConfig { command: string; padding?: number }

export const STATUS_MAX_LINES = 20;
const MAX_OUT = 64 * 1024;

export function parseStatusLine(v: unknown): StatusLineConfig | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.type !== undefined && o.type !== 'command') return null;
  if (typeof o.command !== 'string' || !o.command.trim()) return null;
  return { command: o.command, padding: typeof o.padding === 'number' && o.padding >= 0 ? o.padding : undefined };
}

export async function userStatusLine(claudeDir: string): Promise<StatusLineConfig | null> {
  try {
    return parseStatusLine(JSON.parse(await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf8'))?.statusLine);
  } catch {
    return null;
  }
}

/** At most STATUS_MAX_LINES lines, trailing blank lines and the final newline gone. */
export function clipStatus(out: string): string {
  const lines = out.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(0, STATUS_MAX_LINES).join('\n');
}

/** Windows: Claude Code runs it in Git Bash (scripts written for it are `~/.claude/statusline.sh` and the like). */
function windowsBash(): string | undefined {
  const env = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (env && existsSync(env)) return env;
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
    const p = base && path.join(base, 'Git', 'bin', 'bash.exe');
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

/** The command's output, or null when it failed, printed nothing or took longer than `timeoutMs`. */
export function runStatusLine(cmd: string, input: unknown, cwd: string, timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    const bash = process.platform === 'win32' ? windowsBash() : undefined;
    let child;
    try {
      child = bash
        ? spawn(bash, ['-c', cmd], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
        : spawn(cmd, { cwd, shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    let done = false;
    const finish = (v: string | null) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    // the whole tree: a script stuck in a pipe would otherwise stay behind every refresh
    const timer = setTimeout(() => { void killTree(child); finish(null); }, timeoutMs);
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => { if (out.length < MAX_OUT) out += d; });
    child.on('error', () => finish(null));
    child.on('close', (code) => { const t = clipStatus(out); finish(code === 0 && t ? t : null); });
    child.stdin!.on('error', () => { /* a command that does not read stdin closes it early */ });
    child.stdin!.end(JSON.stringify(input));
  });
}
