import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ProjectFiles, PROJECT_FILE_MAX } from './project-files.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-pf-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('ProjectFiles', () => {
  it('writes, lists, removes under <dataDir>/projects/<id>/', async () => {
    const pf = new ProjectFiles(dir);
    expect(await pf.list('w1')).toEqual([]);
    expect(pf.hasFiles('w1')).toBe(false);
    await pf.write('w1', 'notes.md', Buffer.from('# hi'));
    await pf.write('w1', 'data.csv', Readable.from([Buffer.from('a,b\n1,2\n')]));
    expect(fs.readFileSync(path.join(dir, 'projects', 'w1', 'notes.md'), 'utf8')).toBe('# hi');
    expect((await pf.list('w1')).map((f) => [f.name, f.size])).toEqual([['data.csv', 8], ['notes.md', 4]]);
    expect(pf.hasFiles('w1')).toBe(true);
    await pf.remove('w1', 'notes.md');
    expect((await pf.list('w1')).map((f) => f.name)).toEqual(['data.csv']);
  });

  it('refuses bad names and ids, and files over the limit (nothing left behind)', async () => {
    const pf = new ProjectFiles(dir);
    await expect(pf.write('w1', '../x', Buffer.from('x'))).rejects.toThrow();
    await expect(pf.write('w1', 'a/b', Buffer.from('x'))).rejects.toThrow();
    await expect(pf.write('../w', 'a', Buffer.from('x'))).rejects.toThrow();
    await expect(pf.remove('w1', '..')).rejects.toThrow();
    await expect(pf.write('w1', 'big.bin', Buffer.alloc(PROJECT_FILE_MAX + 1))).rejects.toThrow();
    expect(await pf.list('w1')).toEqual([]);
  });
});
