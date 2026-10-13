import { describe, expect, it } from 'vitest';
import { FOLDERS_SHOWN, folderLabels, splitFolders } from './folders';

describe('文件夹: every folder on its own', () => {
  it('the most recent FOLDERS_SHOWN open, the rest under 更早的文件夹', () => {
    const list = Array.from({ length: FOLDERS_SHOWN + 3 }, (_, i) => i);
    const { recent, older } = splitFolders(list);
    expect(recent).toEqual(list.slice(0, FOLDERS_SHOWN));
    expect(older).toEqual(list.slice(FOLDERS_SHOWN));
    expect(splitFolders([1, 2]).older).toEqual([]);
  });
  it('named like the folder; two of the same name (or one like a project) get their parent after it', () => {
    const l = folderLabels(['/work/shop/app', '/work/blog/app', '/home/me/dash', '/home/me/claude-web/sub'], ['dash']);
    expect(l.get('/work/shop/app')).toBe('app · shop');
    expect(l.get('/work/blog/app')).toBe('app · blog');
    expect(l.get('/home/me/dash')).toBe('dash · me');
    expect(l.get('/home/me/claude-web/sub')).toBe('sub');
  });
});
