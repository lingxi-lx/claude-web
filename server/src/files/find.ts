// @ file completion (spec 2026-10-16 chat-input §4): the files of a project, and the ones a few typed letters mean.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'target', '__pycache__', '.venv', 'venv']);
const MAX = 20_000;
const TTL = 10_000;
const cache = new Map<string, { at: number; files: Promise<string[]> }>();

/** Paths relative to `root`, `/`-separated: git's view in a repository (.gitignore respected), else a walk. */
export function listProjectFiles(root: string): Promise<string[]> {
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < TTL) return hit.files;
  const files = fromGit(root).catch(() => walk(root));
  cache.set(root, { at: Date.now(), files });
  files.catch(() => cache.delete(root));
  return files;
}

async function fromGit(root: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const seen = new Set<string>();
  for (const f of stdout.split('\0')) if (f && seen.size < MAX) seen.add(f);
  return [...seen];
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [''];
  while (queue.length && out.length < MAX) {
    const rel = queue.shift()!;
    const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) queue.push(p); } else if (e.isFile()) out.push(p);
      if (out.length >= MAX) break;
    }
  }
  return out;
}

function subsequence(hay: string, q: string): boolean {
  let i = 0;
  for (const c of hay) if (c === q[i] && ++i === q.length) return true;
  return q.length === 0;
}

/** Best first: a name starting with the query, a name containing it, a path containing it, its letters in order. */
export function rankFiles(files: string[], query: string, limit = 30): string[] {
  const q = query.toLowerCase();
  const scored: { f: string; s: number }[] = [];
  for (const f of files) {
    const lower = f.toLowerCase();
    const name = lower.slice(lower.lastIndexOf('/') + 1);
    const s = !q ? 4 : name.startsWith(q) ? 0 : name.includes(q) ? 1 : lower.includes(q) ? 2 : subsequence(name, q) ? 3 : subsequence(lower, q) ? 3.5 : -1;
    if (s >= 0) scored.push({ f, s });
  }
  scored.sort((a, b) => a.s - b.s || a.f.length - b.f.length || a.f.localeCompare(b.f));
  return scored.slice(0, limit).map((x) => x.f);
}
