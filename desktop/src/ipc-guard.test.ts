import { describe, expect, it } from 'vitest';
import { fromOurWindow, openablePath } from './ipc-guard';

describe('fromOurWindow (S3)', () => {
  const main = { frame: 'main' };
  const sender = (type: string) => ({ getType: () => type, mainFrame: main });
  const ours = new Set<unknown>();
  const win = sender('window');
  ours.add(win);
  const isOurs = (s: unknown) => ours.has(s);

  it('a window of ours asking from its top frame', () => {
    expect(fromOurWindow({ sender: win, senderFrame: main }, isOurs)).toBe(true);
  });
  it('a <webview> guest (fromWebContents would have returned its window) is refused', () => {
    const guest = sender('webview');
    ours.add(guest); // even if the window lookup says yes
    expect(fromOurWindow({ sender: guest, senderFrame: main }, isOurs)).toBe(false);
  });
  it('a subframe of our window, a window not ours, a broken sender are refused', () => {
    expect(fromOurWindow({ sender: win, senderFrame: { frame: 'sub' } }, isOurs)).toBe(false);
    expect(fromOurWindow({ sender: sender('window'), senderFrame: main }, isOurs)).toBe(false);
    expect(fromOurWindow({ sender: { getType: () => { throw new Error('destroyed'); } } }, isOurs)).toBe(false);
  });
});

describe('openablePath (S8)', () => {
  it('local absolute paths', () => {
    expect(openablePath('C:\\Users\\me\\a.txt')).toBe(true);
    expect(openablePath('C:/Users/me/dir')).toBe(true);
    expect(openablePath('\\\\?\\C:\\very\\long.txt')).toBe(true);
    expect(openablePath('/Users/me/a.txt')).toBe(true);
  });
  it('network and device paths are refused (they leak NTLM)', () => {
    for (const p of ['\\\\host\\share\\x', '//host/share/x', '/\\host\\s', '\\\\?\\UNC\\host\\s', '\\\\.\\UNC\\host\\s', '\\??\\UNC\\host\\s', '\\??\\C:\\x', '\\\\.\\pipe\\x', '\\\\.\\C:']) {
      expect(openablePath(p), p).toBe(false);
    }
  });
  it('addresses with a scheme, relative paths and junk are refused', () => {
    for (const p of ['https://a.b/', 'file:///C:/x', 'ms-settings:privacy', 'search-ms:query=x', 'a.txt', '..\\x', '', 'C:x', 42, null, 'C:\\a\0b']) {
      expect(openablePath(p), String(p)).toBe(false);
    }
  });
});
