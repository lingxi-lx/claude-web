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

async function addInChunks(cwd: string, files: string[], env: NodeJS.ProcessEnv) {
  for (let i = 0; i < files.length; i += 100) await git(cwd, ['add', '--', ...files.slice(i, i + 100)], { env });
}

/** A commit of the work tree as it is now (staged, unstaged, untracked; ignored files left out), parent HEAD. */
export async function snapshotCommit(cwd: string, message: string): Promise<{ commit: string; base: string }> {
  const base = await git(cwd, ['rev-parse', 'HEAD']);
  const realIndex = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
  const tmp = path.join(os.tmpdir(), `cw-handoff-index-${crypto.randomBytes(6).toString('hex')}`);
  try {
    if (fs.existsSync(realIndex)) fs.copyFileSync(realIndex, tmp);
    const env = { GIT_INDEX_FILE: tmp };
    const stash = await git(cwd, ['stash', 'create', message], { env });
    const tree0 = await git(cwd, ['rev-parse', `${stash || 'HEAD'}^{tree}`]);
    const others = (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'], { env })).split('\0').filter(Boolean);
    let tree = tree0;
    if (others.length) {
      await git(cwd, ['read-tree', tree0], { env });
      await addInChunks(cwd, others, env);
      tree = await git(cwd, ['write-tree'], { env });
    }
    const commit = await git(cwd, [...IDENTITY, 'commit-tree', tree, '-p', base, '-m', message]);
    return { commit, base };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const TAKEN = /rejected|already exists|fetch first|non-fast-forward|stale info/i;

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
  const dir = path.join(wtRoot, branch.slice('cw/handoff-'.length));
  if (fs.existsSync(dir)) return dir;
  await git(repo, ['fetch', url, `+refs/heads/${branch}:refs/heads/${branch}`]);
  await git(repo, ['worktree', 'add', dir, branch]);
  return dir;
}

/** The always-on machine sends its work back: commit everything in its own worktree, push fast-forward only. */
export async function publishHandoff(wtDir: string, url: string, branch: string, message: string): Promise<{ commit: string; changed: boolean }> {
  if (!/^cw\/handoff-[\w-]+$/.test(branch)) throw new Error('bad handoff branch');
  const dirty = await git(wtDir, ['status', '--porcelain']);
  if (dirty.trim()) {
    await git(wtDir, ['add', '-A']);
    await git(wtDir, [...IDENTITY, 'commit', '-q', '-m', message]);
  }
  const commit = await git(wtDir, ['rev-parse', 'HEAD']);
  if (!dirty.trim()) return { commit, changed: false };
  await git(wtDir, ['push', url, `HEAD:refs/heads/${branch}`]);
  return { commit, changed: true };
}
