import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { normFolders, projectFolders, sameDir } from './workspace-folders.js';

const id = (p: string) => p;
describe('normFolders', () => {
  it('old data (no folders) → []', () => {
    expect(normFolders('C:\\a', undefined, { resolve: id })).toEqual([]);
    expect(normFolders('C:\\a', 'C:\\b', { resolve: id })).toEqual([]);
  });
  it('drops non-strings, the main folder and duplicates (caseless on Windows), keeps order', () => {
    expect(normFolders('C:\\a', ['C:\\B', 3, null, 'c:\\a\\', 'C:\\b', 'D:\\x'], { caseless: true, resolve: id })).toEqual(['C:\\B', 'D:\\x']);
  });
  it('case matters off Windows', () => {
    expect(normFolders('/a', ['/B', '/b'], { caseless: false, resolve: id })).toEqual(['/B', '/b']);
  });
  it('resolves relative paths with the given resolver', () => {
    expect(normFolders('/a', ['x'], { caseless: false, resolve: (p) => path.posix.resolve('/root', p) })).toEqual(['/root/x']);
  });
});

describe('projectFolders', () => {
  const ws = [{ path: 'C:\\proj', folders: ['D:\\lib', 'E:\\docs'] }, { path: 'C:\\other' }];
  it('a conversation in the project folder gets its extra folders', () => {
    expect(projectFolders('c:\\proj\\', ws, true)).toEqual(['D:\\lib', 'E:\\docs']);
  });
  it('a subfolder of the project, an unknown folder, or a project without folders → []', () => {
    expect(projectFolders('C:\\proj\\sub', ws, true)).toEqual([]);
    expect(projectFolders('C:\\nowhere', ws, true)).toEqual([]);
    expect(projectFolders('C:\\other', ws, true)).toEqual([]);
    expect(projectFolders('', ws, true)).toEqual([]);
  });
  it('sameDir ignores separators and a trailing slash', () => {
    expect(sameDir('C:/proj/', 'c:\\proj', true)).toBe(true);
    expect(sameDir('/a', '/A', false)).toBe(false);
  });
});
