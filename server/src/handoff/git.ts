// 交给常开机器继续 (stage F1): the Git half. A conversation's work — committed or not — goes to the always-on machine as
// a branch `cw/handoff-<id>` on the project's own remote, and comes back (取回) as a new local branch with its diff.
//
// Never touches what the user has: the snapshot is built on a COPY of the index (`GIT_INDEX_FILE`), `git stash create`
// only writes objects (no `refs/stash`), untracked files are added to that copy only, and `commit-tree` makes a commit
// no branch points at. Pushes never force (a taken name gets a new id); 取回 only fetches into a branch that did not
// exist, never merges, never checks out. The always-on machine works in its own bare cache + worktree.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tr } from '../i18n/index.js';
import { isSecretFile } from '../files/secret-name.js';

const IDENTITY = ['-c', 'user.name=Claude Web', '-c', 'user.email=claude-web@localhost'];
const MAX_DIFF = 400 * 1024;

export function git(cwd: string, args: string[], o: { env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', ...o.env },
    }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message).trim();
        reject(Object.assign(new Error(msg || err.message), { stderr: String(stderr ?? '') }));
        return;
      }
      resolve(String(stdout).replace(/\r?\n$/, ''));
    });
  });
}

export const newHandoffId = () => crypto.randomBytes(4).toString('hex');

export async function handoffRemote(cwd: string): Promise<{ ok: true; remote: string; url: string } | { ok: false; reason: string }> {
  try {
    if (!fs.existsSync(cwd)) return { ok: false, reason: tr('项目文件夹不存在') };
    if ((await git(cwd, ['rev-parse', '--is-inside-work-tree']).catch(() => '')) !== 'true') return { ok: false, reason: tr('只有 Git 项目能交接') };
    if (!(await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => ''))) return { ok: false, reason: tr('这个 Git 项目还没有提交') };
    const remotes = (await git(cwd, ['remote'])).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!remotes.length) return { ok: false, reason: tr('这个 Git 项目没有远端（remote），常开机器拿不到代码') };
    const remote = remotes.includes('origin') ? 'origin' : remotes[0];
    const url = await git(cwd, ['remote', 'get-url', remote]);
    return { ok: true, remote, url };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
}

async function inChunks(cwd: string, pre: string[], files: string[], env: NodeJS.ProcessEnv) {
  for (let i = 0; i < files.length; i += 100) await git(cwd, [...pre, '--', ...files.slice(i, i + 100)], { env });
}

export { isSecretFile };

export interface UntrackedInfo { count: number; bytes: number; files: { path: string; size: number }[]; skipped: string[] }
const MAX_LISTED = 200;

/** New files Git does not track and does not ignore: what a hand-off would carry if the user opts in, and what it never carries. */
export async function untrackedFiles(cwd: string): Promise<UntrackedInfo> {
  const all = (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  const out: UntrackedInfo = { count: 0, bytes: 0, files: [], skipped: [] };
  for (const rel of all) {
    if (isSecretFile(rel)) { if (out.skipped.length < MAX_LISTED) out.skipped.push(rel); continue; }
    let size = 0;
    try { size = fs.statSync(path.join(cwd, rel)).size; } catch { /* gone meanwhile */ }
    out.count++; out.bytes += size;
    if (out.files.length < MAX_LISTED) out.files.push({ path: rel, size });
  }
  return out;
}

/**
 * A commit of the work tree as it is now, parent HEAD: staged and unstaged changes to tracked files, files added with
 * `git add -N`, and — only when `includeUntracked` — new untracked files. Ignored files and anything `isSecretFile`
 * names among the new files are left out.
 */
export async function snapshotCommit(cwd: string, message: string, o: { includeUntracked?: boolean } = {}): Promise<{ commit: string; base: string; skipped: string[] }> {
  const base = await git(cwd, ['rev-parse', 'HEAD']);
  const realIndex = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
  const tmp = path.join(os.tmpdir(), `cw-handoff-index-${crypto.randomBytes(6).toString('hex')}`);
  try {
    if (fs.existsSync(realIndex)) fs.copyFileSync(realIndex, tmp);
    const env = { GIT_INDEX_FILE: tmp };
    // `git add -N` entries make `stash create` fail ("not uptodate. Cannot merge"): take them out of the COPY of the
    // index first, and add them back with their content below (the user asked for them to be tracked)
    const ita = (await git(cwd, ['diff', '--name-only', '--diff-filter=A', '-z'], { env })).split('\0').filter(Boolean);
    if (ita.length) await inChunks(cwd, ['rm', '--cached', '-q'], ita, env);
    const stash = await git(cwd, ['stash', 'create', message], { env });
    const tree0 = await git(cwd, ['rev-parse', `${stash || 'HEAD'}^{tree}`]);
    const skipped: string[] = [];
    const keep = (f: string) => { if (isSecretFile(f)) { skipped.push(f); return false; } return true; };
    const intended = ita.filter(keep);
    const itaSet = new Set(ita);
    const others = o.includeUntracked
      ? (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'], { env })).split('\0').filter((f) => f && !itaSet.has(f)).filter(keep)
      : [];
    let tree = tree0;
    if (intended.length || others.length) {
      await git(cwd, ['read-tree', tree0], { env });
      if (intended.length) await inChunks(cwd, ['add', '-f'], intended, env);
      if (others.length) await inChunks(cwd, ['add'], others, env);
      tree = await git(cwd, ['write-tree'], { env });
    }
    const commit = await git(cwd, [...IDENTITY, 'commit-tree', '--no-gpg-sign', tree, '-p', base, '-m', message]);
    return { commit, base, skipped };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** A push refused because the branch name is taken (never "rejected" for other reasons, e.g. a pre-receive hook). */
const TAKEN = /already exists|fetch first|non-fast-forward/i;

/** F3: a hand-off branch the peer never got is removed again (a plain delete, never forced). */
export async function deleteRemoteBranch(cwd: string, remote: string, branch: string): Promise<void> {
  if (!/^cw\/handoff-[\w-]+$/.test(branch)) throw new Error('bad handoff branch');
  await git(cwd, ['push', remote, '--delete', `refs/heads/${branch}`]);
}

/** Push `commit` to a new `cw/handoff-<id>` on `remote`; a name already there gets a new id. Never forced. */
export async function pushHandoff(cwd: string, remote: string, commit: string, makeId: () => string = newHandoffId): Promise<{ id: string; branch: string }> {
  for (let i = 0; i < 5; i++) {
    const id = makeId();
    if (!/^[\w-]{1,40}$/.test(id)) throw new Error('bad handoff id');
    const branch = `cw/handoff-${id}`;
    const have = await git(cwd, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
    if (have.trim()) continue;
    try {
      await git(cwd, ['push', remote, `${commit}:refs/heads/${branch}`]);
      return { id, branch };
    } catch (e: any) {
      if (TAKEN.test(e?.message ?? '')) continue;
      throw e;
    }
  }
  throw new Error(tr('远端上找不到空的交接分支名，请稍后再试'));
}

const refExists = (cwd: string, ref: string) => git(cwd, ['show-ref', '--verify', '--quiet', ref]).then(() => true, () => false);

/** 取回: fetch `branch` into a local branch that did not exist (`<branch>`, `<branch>-2`, …) and show what it changes. */
export async function fetchBack(cwd: string, remote: string, branch: string): Promise<{ local: string; stat: string; diff: string; files: number }> {
  if (!/^cw\/handoff-[\w-]+$/.test(branch)) throw new Error('bad handoff branch');
  let local = branch;
  for (let n = 2; await refExists(cwd, `refs/heads/${local}`); n++) local = `${branch}-${n}`;
  await git(cwd, ['fetch', remote, `refs/heads/${branch}:refs/heads/${local}`]);
  const range = `HEAD...refs/heads/${local}`;
  const stat = await git(cwd, ['diff', '--stat', range]);
  let diff = await git(cwd, ['diff', range]);
  if (diff.length > MAX_DIFF) diff = diff.slice(0, MAX_DIFF) + '\n…';
  const files = (await git(cwd, ['diff', '--name-only', range])).split(/\r?\n/).filter(Boolean).length;
  return { local, stat, diff, files };
}

/** The always-on machine: a bare cache of the remote (per URL) and a worktree of the hand-off branch. */
export async function checkoutHandoff(cacheRoot: string, wtRoot: string, url: string, branch: string): Promise<string> {
  if (!/^cw\/handoff-[\w-]+$/.test(branch)) throw new Error('bad handoff branch');
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.mkdirSync(wtRoot, { recursive: true });
  const repo = path.join(cacheRoot, `${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}.git`);
  if (!fs.existsSync(path.join(repo, 'HEAD'))) await git(cacheRoot, ['init', '--bare', repo]);
  // the URL (with any credentials in it) lives where Git keeps it — the cache's own `origin` — not in our index files
  const had = await git(repo, ['remote', 'get-url', 'origin']).catch(() => '');
  if (!had) await git(repo, ['remote', 'add', 'origin', url]);
  else if (had !== url) await git(repo, ['remote', 'set-url', 'origin', url]);
  const dir = path.join(wtRoot, branch.slice('cw/handoff-'.length));
  if (fs.existsSync(dir)) return dir;
  await git(repo, ['fetch', url, `+refs/heads/${branch}:refs/heads/${branch}`]);
  await git(repo, ['worktree', 'add', dir, branch]);
  return dir;
}

/** A remote URL fit to show or store: `https://user:token@host/x` → `https://host/x` (scp-style `git@host:x` kept). */
export function redactUrl(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    if (!u.username && !u.password) return url;
    u.username = ''; u.password = '';
    return u.toString();
  } catch {
    return url.replace(/\/\/[^/@]*@/, '//');
  }
}

/**
 * The always-on machine sends its work back: commit everything in its own worktree, push fast-forward only. `url` may
 * be a remote name (`origin`, set by checkoutHandoff) or a URL.
 */
export async function publishHandoff(wtDir: string, url: string, branch: string, message: string): Promise<{ commit: string; changed: boolean }> {
  if (!/^cw\/handoff-[\w-]+$/.test(branch)) throw new Error('bad handoff branch');
  const dirty = await git(wtDir, ['status', '--porcelain']);
  if (dirty.trim()) {
    await git(wtDir, ['add', '-A']);
    await git(wtDir, [...IDENTITY, 'commit', '-q', '--no-gpg-sign', '-m', message]);
  }
  const commit = await git(wtDir, ['rev-parse', 'HEAD']);
  if (!dirty.trim()) return { commit, changed: false };
  await git(wtDir, ['push', url, `HEAD:refs/heads/${branch}`]);
  return { commit, changed: true };
}
