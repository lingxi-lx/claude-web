// .worktreeinclude (spec 2026-10-16 sessions-env §4; Claude Code's own convention): a new worktree is a fresh checkout,
// so files git ignores (.env, local config) are not in it. The ones listed in `<repo>/.worktreeinclude` (gitignore
// syntax) are copied over — only files that are both listed there and ignored by git; tracked files are never copied.
// git does the matching: what it lists as ignored under .gitignore AND under .worktreeinclude as the exclude file.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tr } from '../i18n/index.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_FILES = 2000;

/**
 * The 「worktree 放在哪」 setting as a folder: `~` is the home folder; anything else must be absolute. A relative one
 * used to be joined as is — git made the worktree inside the repository and the conversation got a cwd relative to
 * the server's own folder.
 */
export function resolveWorktreeDir(where: string, home = os.homedir()): string {
  const w = where.trim();
  const expanded = w === '~' ? home : /^~[\\/]/.test(w) ? path.join(home, w.slice(2)) : w;
  if (!path.isAbsolute(expanded) || /^[\\/]{2}/.test(expanded)) throw new Error(tr('「worktree 放在哪」要填一个本机的完整路径（可以用 ~ 表示用户目录），现在是：{where}', { where: w }));
  return path.resolve(expanded);
}

async function lsIgnored(root: string, exclude: string[]): Promise<Set<string>> {
  const { stdout } = await execFileAsync('git', ['ls-files', '--others', '--ignored', ...exclude, '-z'], { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return new Set(stdout.split('\0').filter(Boolean));
}

/** The relative paths .worktreeinclude would copy from `root` (empty when it has none). */
export async function worktreeIncludes(root: string): Promise<string[]> {
  const file = path.join(root, '.worktreeinclude');
  try { await fs.access(file); } catch { return []; }
  const [ignored, listed] = await Promise.all([lsIgnored(root, ['--exclude-standard']), lsIgnored(root, [`--exclude-from=${file}`])]);
  return [...listed].filter((f) => ignored.has(f)).slice(0, MAX_FILES);
}

/** Copies them into the new worktree `dir`; returns what was copied. A file that fails is skipped, not fatal. */
export async function copyWorktreeIncludes(root: string, dir: string): Promise<string[]> {
  const done: string[] = [];
  for (const rel of await worktreeIncludes(root)) {
    const to = path.join(dir, rel);
    try {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(path.join(root, rel), to);
      done.push(rel);
    } catch (e) {
      console.warn(`[worktree] could not copy ${rel}: ${(e as Error).message}`);
    }
  }
  return done;
}
