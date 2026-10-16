import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { copyWorktreeIncludes, resolveWorktreeDir, worktreeIncludes } from './worktree-include.js';

const tmp: string[] = [];
afterAll(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); });
const repo = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-wti-'));
  tmp.push(dir);
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true });
  return dir;
};

describe('worktree location setting', () => {
  const home = path.resolve(os.tmpdir(), 'home-x');
  it('~ is the home folder; an absolute path is used as is', () => {
    expect(resolveWorktreeDir('~', home)).toBe(home);
    expect(resolveWorktreeDir('~/wts', home)).toBe(path.join(home, 'wts'));
    expect(resolveWorktreeDir(' ' + path.join(home, 'a') + ' ', home)).toBe(path.join(home, 'a'));
  });
  it('relative, ~user, or a network path: refused, saying what to fill in', () => {
    for (const w of ['wts', './wts', '../up', '~other/wts', '\\\\host\\share', '//host/share']) expect(() => resolveWorktreeDir(w, home)).toThrow(/完整路径/);
  });
});

describe('.worktreeinclude', () => {
  it('copies what is listed AND ignored by git — never a tracked or merely untracked file', async () => {
    const root = repo({
      '.gitignore': '.env\n*.local.json\nnode_modules/\n',
      '.worktreeinclude': '.env\nconfig/*.local.json\n',
      '.env': 'SECRET=1',
      'config/app.local.json': '{}',
      'other.local.json': '{}', // ignored but not listed
      'notes.txt': 'untracked, not ignored',
      'node_modules/x/i.js': '', // ignored, not listed
    });
    expect((await worktreeIncludes(root)).sort()).toEqual(['.env', 'config/app.local.json']);
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-wti-dest-'));
    tmp.push(dest);
    expect((await copyWorktreeIncludes(root, dest)).sort()).toEqual(['.env', 'config/app.local.json']);
    expect(fs.readFileSync(path.join(dest, '.env'), 'utf8')).toBe('SECRET=1');
    expect(fs.existsSync(path.join(dest, 'other.local.json'))).toBe(false);
  });
  it('no .worktreeinclude: nothing', async () => {
    const root = repo({ '.gitignore': '.env\n', '.env': 'x' });
    expect(await worktreeIncludes(root)).toEqual([]);
  });
});
