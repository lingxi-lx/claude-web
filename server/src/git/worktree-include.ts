// .worktreeinclude (spec 2026-10-16 sessions-env §4; Claude Code's own convention): a new worktree is a fresh checkout,
// so files git ignores (.env, local config) are not in it. The ones listed in `<repo>/.worktreeinclude` (gitignore
// syntax) are copied over — only files that are both listed there and ignored by git; tracked files are never copied.
// git does the matching: what it lists as ignored under .gitignore AND under .worktreeinclude as the exclude file.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_FILES = 2000;

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
