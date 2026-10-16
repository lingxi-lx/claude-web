import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listProjectFiles, rankFiles } from './find.js';

const tmp: string[] = [];
const mk = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-find-'));
  tmp.push(dir);
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  return dir;
};
afterAll(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); });

describe('rankFiles', () => {
  const files = ['web/src/features/composer/Composer.tsx', 'web/src/features/composer/composer.css', 'docs/compose-notes.md', 'server/src/index.ts', 'README.md'];
  it('a name that starts with it, then a name that has it, then a path that has it, then letters in order', () => {
    expect(rankFiles(files, 'composer')).toEqual(['web/src/features/composer/composer.css', 'web/src/features/composer/Composer.tsx']);
    expect(rankFiles(files, 'compose')).toEqual(['docs/compose-notes.md', 'web/src/features/composer/composer.css', 'web/src/features/composer/Composer.tsx']);
    expect(rankFiles(files, 'cmpsr')).toEqual(['web/src/features/composer/composer.css', 'web/src/features/composer/Composer.tsx']);
    expect(rankFiles(files, 'src/index')).toEqual(['server/src/index.ts']);
  });
  it('nothing typed yet: the shortest paths', () => {
    expect(rankFiles(files, '', 2)).toEqual(['README.md', 'server/src/index.ts']);
  });
});

describe('listProjectFiles', () => {
  it('a folder that is not a repository: walked, without node_modules / .git / dist', async () => {
    const dir = mk({ 'a.ts': '', 'sub/b.ts': '', 'node_modules/x/i.js': '', 'dist/out.js': '' });
    expect((await listProjectFiles(dir)).sort()).toEqual(['a.ts', 'sub/b.ts']);
  });
  it('a repository: what git tracks or would track (.gitignore respected)', async () => {
    const dir = mk({ 'a.ts': '', 'ignored.log': '', '.gitignore': '*.log\n', 'sub/new.ts': '' });
    execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true });
    execFileSync('git', ['add', 'a.ts'], { cwd: dir, windowsHide: true });
    expect((await listProjectFiles(dir)).sort()).toEqual(['.gitignore', 'a.ts', 'sub/new.ts']);
  });
});
