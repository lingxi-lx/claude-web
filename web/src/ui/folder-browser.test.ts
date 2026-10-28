import { describe, expect, it } from 'vitest';
import { folderNameOk, joinDir } from './FolderBrowser';

describe('folder browser helpers (issue #12)', () => {
  it('joins a folder and a name with the server separator, once', () => {
    expect(joinDir('/home/u', 'p', '/')).toBe('/home/u/p');
    expect(joinDir('/', 'home', '/')).toBe('/home');
    expect(joinDir('C:\\', 'Users', '\\')).toBe('C:\\Users');
    expect(joinDir('C:\\Users', 'me', '\\')).toBe('C:\\Users\\me');
  });

  it('refuses names a folder cannot have', () => {
    expect(folderNameOk('my project')).toBe(true);
    expect(folderNameOk('项目')).toBe(true);
    for (const bad of ['', '  ', '.', '..', 'a/b', 'a\\b', 'a:b', 'a?b', 'a*b', 'a|b', 'a"b', 'a<b']) expect(folderNameOk(bad)).toBe(false);
    // Windows makes these, then Explorer can neither open nor delete them
    for (const bad of ['CON', 'con', 'nul.txt', 'COM1', 'lpt9', 'Aux.tar.gz', 'trail.', 'v1..']) expect(folderNameOk(bad)).toBe(false);
    for (const ok of ['console', 'CONFIG', 'com10', 'v1.2', '.hidden', 'nullable']) expect(folderNameOk(ok)).toBe(true);
  });
});
