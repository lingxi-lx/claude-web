import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { git, snapshotCommit, pushHandoff, fetchBack, handoffRemote, checkoutHandoff, publishHandoff } from './git.js';

let root: string, repo: string, bare: string;
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const hashTree = (dir: string): string => {
  const h = crypto.createHash('sha256');
  const walk = (d: string) => { for (const n of fs.readdirSync(d).sort()) { if (n === '.git') continue; const p = path.join(d, n); const st = fs.lstatSync(p); h.update(path.relative(dir, p)); if (st.isDirectory()) walk(p); else h.update(fs.readFileSync(p)); } };
  walk(dir); return h.digest('hex');
};
/** everything handoff must leave alone, byte for byte */
const state = async () => ({
  index: fs.readFileSync(path.join(repo, '.git', 'index')).toString('hex'),
  head: fs.readFileSync(path.join(repo, '.git', 'HEAD'), 'utf8'),
  branch: await git(repo, ['rev-parse', 'HEAD']),
  tree: hashTree(repo),
  stash: await git(repo, ['stash', 'list']),
  status: await git(repo, ['status', '--porcelain']),
});

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-handoff-'));
  bare = path.join(root, 'remote.git'); repo = path.join(root, 'repo');
  await git(root, ['init', '--bare', '-b', 'main', bare]);
  await git(root, ['init', '-b', 'main', repo]);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'secret.env\n');
  await git(repo, ['add', '.']); await git(repo, [...ID, 'commit', '-m', 'init']);
  await git(repo, ['remote', 'add', 'origin', bare]); await git(repo, ['push', 'origin', 'main']);
  // uncommitted work of every kind
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo staged\n'); await git(repo, ['add', 'a.txt']);
  fs.appendFileSync(path.join(repo, 'a.txt'), 'three unstaged\n');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'untracked\n');
  fs.writeFileSync(path.join(repo, 'secret.env'), 'KEY=1\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('handoff git', { timeout: 30_000 }, () => {
  it('finds the remote, refuses a folder without one', async () => {
    expect(await handoffRemote(repo)).toMatchObject({ ok: true, remote: 'origin' });
    const plain = path.join(root, 'plain'); fs.mkdirSync(plain);
    expect((await handoffRemote(plain)).ok).toBe(false);
    await git(plain, ['init']);
    expect((await handoffRemote(plain)).ok).toBe(false);
  });

  it('snapshots staged + unstaged + untracked work, leaves branch / index / worktree byte-identical', async () => {
    const before = await state();
    const { commit, base } = await snapshotCommit(repo, 'handoff');
    expect(await state()).toEqual(before);
    expect(base).toBe(before.branch);
    expect(await git(repo, ['rev-parse', `${commit}^`])).toBe(base);
    expect(await git(repo, ['show', `${commit}:a.txt`])).toBe('one\ntwo staged\nthree unstaged');
    expect(await git(repo, ['show', `${commit}:new.txt`])).toBe('untracked');
    await expect(git(repo, ['show', `${commit}:secret.env`])).rejects.toThrow(); // ignored files stay out
  });

  it('a clean tree snapshots to HEAD\'s tree', async () => {
    await git(repo, ['stash', '-u']); await git(repo, ['stash', 'drop']);
    const { commit, base } = await snapshotCommit(repo, 'clean');
    expect(await git(repo, ['rev-parse', `${commit}^{tree}`])).toBe(await git(repo, ['rev-parse', `${base}^{tree}`]));
  });

  it('pushes to cw/handoff-<id> without touching the user, a taken name gets a new id, never forced', async () => {
    const { commit } = await snapshotCommit(repo, 'h');
    // someone already has cw/handoff-aaaa on the remote
    await git(repo, ['push', 'origin', 'HEAD:refs/heads/cw/handoff-aaaa']);
    const taken = await git(bare, ['rev-parse', 'refs/heads/cw/handoff-aaaa']);
    const before = await state();
    const ids = ['aaaa', 'bbbb'];
    const r = await pushHandoff(repo, 'origin', commit, () => ids.shift()!);
    expect(r).toEqual({ id: 'bbbb', branch: 'cw/handoff-bbbb' });
    expect(await git(bare, ['rev-parse', 'refs/heads/cw/handoff-bbbb'])).toBe(commit);
    expect(await git(bare, ['rev-parse', 'refs/heads/cw/handoff-aaaa'])).toBe(taken);
    expect(await git(bare, ['rev-parse', 'refs/heads/main'])).toBe(before.branch);
    expect(await state()).toEqual(before);
  });

  it('peer side: checks the branch out in its own worktree, commits and pushes back fast-forward', async () => {
    const { commit } = await snapshotCommit(repo, 'h');
    const { branch } = await pushHandoff(repo, 'origin', commit, () => 'cccc');
    const wt = await checkoutHandoff(path.join(root, 'cache'), path.join(root, 'wts'), bare, branch);
    expect(fs.readFileSync(path.join(wt, 'new.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('untracked\n'); // core.autocrlf may convert
    fs.writeFileSync(path.join(wt, 'done.txt'), 'by the peer\n');
    const back = await publishHandoff(wt, bare, branch, 'work from the peer');
    expect(back.changed).toBe(true);
    expect(await git(bare, ['rev-parse', `refs/heads/${branch}`])).toBe(back.commit);
    expect(await git(bare, ['rev-parse', `${back.commit}^`])).toBe(commit);
    expect((await publishHandoff(wt, bare, branch, 'again')).changed).toBe(false);
  });

  it('取回 fetches into a new local branch, shows the diff, never merges or checks out', async () => {
    const { commit } = await snapshotCommit(repo, 'h');
    const { branch } = await pushHandoff(repo, 'origin', commit, () => 'dddd');
    const before = await state();
    const r = await fetchBack(repo, 'origin', branch);
    expect(r.local).toBe('cw/handoff-dddd');
    expect(await git(repo, ['rev-parse', 'refs/heads/cw/handoff-dddd'])).toBe(commit);
    expect(r.diff).toContain('new.txt');
    expect(r.files).toBeGreaterThan(0);
    expect(await state()).toEqual(before);
    // a second 取回 does not move the first branch: it gets a suffix
    const again = await fetchBack(repo, 'origin', branch);
    expect(again.local).toBe('cw/handoff-dddd-2');
  });
});
