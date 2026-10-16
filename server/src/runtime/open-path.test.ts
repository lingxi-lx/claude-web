import { describe, expect, it } from 'vitest';
import { openCommands } from './open-path.js';

describe('openCommands', () => {
  it('the file manager: explorer / open / xdg-open', () => {
    // Windows: shown (not started hidden), with backslashes
    expect(openCommands('C:/a b/p', 'explorer', 'win32')).toEqual([{ cmd: 'explorer', args: ['C:\\a b\\p'], show: true }]);
    expect(openCommands('/p', 'explorer', 'darwin')).toEqual([{ cmd: 'open', args: ['/p'] }]);
    expect(openCommands('/p', 'explorer', 'linux')).toEqual([{ cmd: 'xdg-open', args: ['/p'] }]);
    expect(openCommands('/p', undefined, 'darwin')).toEqual([{ cmd: 'open', args: ['/p'] }]);
  });

  it("macOS: the editor's shell command, then its app bundle through `open -a` (the `code` command is optional there)", () => {
    expect(openCommands('/Users/me/proj', 'code', 'darwin')).toEqual([{ cmd: 'code', args: ['/Users/me/proj'] }, { cmd: 'open', args: ['-a', 'Visual Studio Code', '/Users/me/proj'] }]);
    expect(openCommands('/Users/me/proj', 'cursor', 'darwin')).toEqual([{ cmd: 'cursor', args: ['/Users/me/proj'] }, { cmd: 'open', args: ['-a', 'Cursor', '/Users/me/proj'] }]);
  });

  it('show in the file manager: the file selected (Windows /select, verbatim and quoted; macOS open -R), Linux the folder', () => {
    expect(openCommands('C:/a b/p.ts', 'reveal', 'win32')).toEqual([{ cmd: 'explorer', args: ['/select,"C:\\a b\\p.ts"'], show: true, verbatim: true }]);
    expect(openCommands('/x/p.ts', 'reveal', 'darwin')).toEqual([{ cmd: 'open', args: ['-R', '/x/p.ts'] }]);
    expect(openCommands('/x/p.ts', 'reveal', 'linux')).toEqual([{ cmd: 'xdg-open', args: ['/x'] }]);
  });

  it('Zed like the others', () => {
    expect(openCommands('/p', 'zed', 'darwin')).toEqual([{ cmd: 'zed', args: ['/p'] }, { cmd: 'open', args: ['-a', 'Zed', '/p'] }]);
  });

  it('elsewhere only the shell command', () => {
    expect(openCommands('/home/me/proj', 'code', 'linux')).toEqual([{ cmd: 'code', args: ['/home/me/proj'] }]);
  });

  it('Windows editors: code.cmd / cursor.cmd through a (hidden) shell, the path quoted', () => {
    expect(openCommands('C:/my proj', 'code', 'win32')).toEqual([{ cmd: 'code', args: ['"C:\\my proj"'], shell: true }]);
  });
});
