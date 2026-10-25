import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilesService, appleScriptEscape, isUncPath, uncAllowed, workspaceRoots } from './service.js';

// stage B task 1: a network path makes Windows connect to that machine over SMB and hand it the user's NTLM
// credentials — a path from the page (a link the model wrote, a file tab) must never reach `fs`
describe('network paths', () => {
  afterEach(() => vi.restoreAllMocks());

  it('isUncPath: \\\\host, //host, the extended and device UNC forms', () => {
    expect(isUncPath('\\\\host\\s')).toBe(true);
    expect(isUncPath('//host/s')).toBe(true);
    expect(isUncPath('\\\\?\\UNC\\host\\s')).toBe(true);
    expect(isUncPath('//?/UNC/host/s')).toBe(true);
    expect(isUncPath('\\\\.\\UNC\\host\\s')).toBe(true);
    expect(isUncPath('\\\\?\\GLOBALROOT\\Device\\Mup\\host\\s')).toBe(true);
    expect(isUncPath('\\\\localhost\\C$\\x')).toBe(true);
    // only UNC once the separators are normalized
    expect(isUncPath('/\\host\\s')).toBe(true);
    expect(isUncPath('\\/host/s')).toBe(true);
    expect(isUncPath('\\\\\\host\\s')).toBe(true);
    // a raw volume / device is not a file either
    expect(isUncPath('\\\\.\\C:')).toBe(true);
    expect(isUncPath('\\\\.\\pipe\\x')).toBe(true);
    // stage B fix wave (S8): the NT object prefix `\??\` — Win32 passes such a path through as is
    expect(isUncPath('\\??\\UNC\\host\\s')).toBe(true);
    expect(isUncPath('/??/UNC/host/s')).toBe(true);
    expect(isUncPath('\\??\\GLOBALROOT\\Device\\Mup\\host\\s')).toBe(true);
    expect(isUncPath('\\??\\C:\\a.txt')).toBe(false);
    expect(uncAllowed('\\??\\UNC\\evil\\s\\x', ['\\\\nas\\proj'], true)).toBe(false);
    expect(uncAllowed('\\??\\UNC\\nas\\proj\\x', ['\\\\nas\\proj'], true)).toBe(true);
  });
  it('isUncPath: local paths, including the extended-length local form, are not', () => {
    expect(isUncPath('C:\\a')).toBe(false);
    expect(isUncPath('C:/a/b.txt')).toBe(false);
    expect(isUncPath('/home/a')).toBe(false);
    expect(isUncPath('\\\\?\\C:\\very\\long\\path.txt')).toBe(false);
    expect(isUncPath('rel/a.txt')).toBe(false);
    expect(isUncPath('\\a')).toBe(false);
    expect(isUncPath('')).toBe(false);
  });

  it('every entry point refuses one before touching fs', async () => {
    const touched: string[] = [];
    for (const k of ['stat', 'open', 'readFile', 'writeFile', 'mkdir', 'rename', 'cp', 'readdir', 'rm'] as const) {
      vi.spyOn(fs, k).mockImplementation((async () => { touched.push(k); throw new Error('fs touched'); }) as never);
    }
    const svc = new FilesService();
    const unc = '\\\\host\\s\\a.txt';
    const ok = 'C:\\a.txt';
    const calls: [string, () => Promise<unknown>][] = [
      ['open', () => svc.open(unc)],
      ['stat', () => svc.stat(unc)],
      ['read', () => svc.read(unc)],
      ['write', () => svc.write(unc, 'x')],
      ['write (conflict check)', () => svc.write(unc, 'x', 1)],
      ['mkdir', () => svc.mkdir('//host/s/d')],
      ['create', () => svc.create(unc, 'x')],
      ['rename from', () => svc.rename(unc, ok)],
      ['rename to', () => svc.rename(ok, unc)],
      ['copy from', () => svc.copy(unc, ok)],
      ['copy to', () => svc.copy(ok, '/\\host\\s\\b')],
      ['trash', () => svc.trash([ok, unc])],
      ['watch', () => svc.watch('\\\\?\\UNC\\host\\s')],
      ['diff', () => svc.diff(unc)],
      ['list', () => svc.list('//host/s')],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toThrow('不支持网络路径');
    }
    expect(touched).toEqual([]);
  });

  // fix round 1: a share the user added as a project folder is already trusted — its files open as before
  describe('inside a project folder on a share', () => {
    const fsTouched = () => {
      const touched: string[] = [];
      vi.spyOn(fs, 'stat').mockImplementation((async (p: string) => { touched.push(String(p)); throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }) as never);
      return touched;
    };

    it('uncAllowed: equal to or under a root; case-insensitive where asked; `..` and other shares are not', () => {
      const roots = ['\\\\nas\\proj'];
      expect(uncAllowed('\\\\nas\\proj', roots, true)).toBe(true);
      expect(uncAllowed('\\\\nas\\proj\\a.txt', roots, true)).toBe(true);
      expect(uncAllowed('//nas/proj/sub/a.txt', roots, true)).toBe(true);
      expect(uncAllowed('\\\\?\\UNC\\nas\\proj\\a.txt', roots, true)).toBe(true);
      expect(uncAllowed('\\\\nas\\proj\\.\\sub\\..\\a.txt', roots, true)).toBe(true);
      expect(uncAllowed('\\\\NAS\\Proj\\x', roots, true)).toBe(true);
      expect(uncAllowed('\\\\NAS\\Proj\\x', roots, false)).toBe(false);
      expect(uncAllowed('\\\\nas\\proj2\\x', roots, true)).toBe(false);
      expect(uncAllowed('\\\\nas\\proj\\..\\other\\x', roots, true)).toBe(false);
      expect(uncAllowed('\\\\nas\\proj\\..\\..\\evil\\s\\x', roots, true)).toBe(false);
      expect(uncAllowed('\\\\evil\\s\\x', roots, true)).toBe(false);
      expect(uncAllowed('\\\\nas', roots, true)).toBe(false);
      expect(uncAllowed('\\\\nas\\proj\\x', [], true)).toBe(false);
      // a root has to name a host and a share; a device / volume root trusts nothing
      expect(uncAllowed('\\\\nas\\proj\\x', ['\\\\nas'], true)).toBe(false);
      expect(uncAllowed('\\\\.\\pipe\\x', ['\\\\.\\pipe'], true)).toBe(false);
      expect(uncAllowed('\\\\nas\\proj\\x', ['C:\\proj', '/home/a'], true)).toBe(false);
    });

    // fix round 2: `..` popped through the share and the host — `\\evil\s\..\..\nas\proj\x` read as `nas/proj/x`, but
    // `\\host\share` is a root `..` cannot climb: fs opens `\\evil\s\nas\proj\x` (connects to evil)
    it('uncAllowed: a `..` reaching the share or the host is refused', () => {
      const roots = ['\\\\nas\\proj'];
      expect(uncAllowed('\\\\evil\\s\\..\\..\\nas\\proj\\x', roots, true)).toBe(false);
      expect(uncAllowed('//evil/s/../../nas/proj/x', roots, true)).toBe(false);
      expect(uncAllowed('\\\\?\\UNC\\evil\\s\\..\\..\\nas\\proj\\x', roots, true)).toBe(false);
      expect(uncAllowed('\\\\.\\UNC\\evil\\s\\..\\..\\nas\\proj\\x', roots, true)).toBe(false);
      expect(uncAllowed('\\\\evil\\..\\nas\\proj\\x', roots, true)).toBe(false);
      expect(uncAllowed('\\\\..\\nas\\proj\\x', roots, true)).toBe(false);
      expect(uncAllowed('\\\\nas\\proj\\..\\proj\\x', roots, true)).toBe(false);
      // a root with a `..` into its share trusts nothing either
      expect(uncAllowed('\\\\nas\\proj\\x', ['\\\\evil\\s\\..\\..\\nas\\proj'], true)).toBe(false);
      // what Node itself opens for the attack path: still on evil (the check must not disagree with fs)
      expect(path.win32.toNamespacedPath(path.win32.resolve('\\\\evil\\s\\..\\..\\nas\\proj\\x')).toLowerCase()).toContain('\\evil\\s\\');
      // `..` that stays inside the share is fine
      expect(uncAllowed('\\\\nas\\proj\\sub\\..\\a.txt', roots, true)).toBe(true);
      expect(uncAllowed('\\\\nas\\proj\\a\\b\\..\\..\\c', roots, true)).toBe(true);
    });

    it('workspaceRoots: each path and its extra folders', () => {
      expect(workspaceRoots([
        { path: 'C:\\a' },
        { path: '\\\\nas\\proj', folders: ['\\\\nas\\more', { path: 'D:\\x' }, 3, null] },
      ])).toEqual(['C:\\a', '\\\\nas\\proj', '\\\\nas\\more', 'D:\\x']);
    });

    it('the service opens a file under a trusted share (fs is reached) and still refuses everything else', async () => {
      const touched = fsTouched();
      let roots = ['\\\\nas\\proj'];
      const svc = new FilesService(() => roots);
      await expect(svc.open('\\\\nas\\proj\\a.txt')).rejects.toThrow('ENOENT');
      expect(touched).toEqual(['\\\\nas\\proj\\a.txt']);
      if (process.platform === 'win32') {
        await expect(svc.stat('\\\\NAS\\Proj\\x')).rejects.toThrow('ENOENT');
        expect(touched).toHaveLength(2);
      }
      touched.length = 0;
      for (const p of ['\\\\nas\\proj2\\x', '\\\\nas\\proj\\..\\other\\x', '\\\\evil\\s\\x']) {
        await expect(svc.open(p), p).rejects.toThrow('不支持网络路径');
      }
      // read from the meta store on every call: a project removed is no longer trusted
      roots = [];
      await expect(svc.open('\\\\nas\\proj\\a.txt')).rejects.toThrow('不支持网络路径');
      expect(touched).toEqual([]);
      expect(svc.pathAllowed('C:\\a')).toBe(true);
      expect(new FilesService().pathAllowed('\\\\nas\\proj\\a.txt')).toBe(false);
    });
  });
});

describe('files', () => {
  it('escapes paths for an AppleScript string literal', () => {
    expect(appleScriptEscape('/Users/a/x"y')).toBe('/Users/a/x\\"y');
    // a trailing backslash must not swallow the closing quote
    expect(appleScriptEscape('/tmp/a\\')).toBe('/tmp/a\\\\');
  });

  it('concurrent watch() of one path shares a single watcher', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-files-'));
    const svc = new FilesService();
    try {
      await Promise.all([svc.watch(dir), svc.watch(dir)]);
      const w = (svc as any).watchers.get(dir);
      expect(w.refs).toBe(2);
      expect(w.w.listenerCount('error')).toBeGreaterThan(0);
      await svc.unwatch(dir);
      expect((svc as any).watchers.has(dir)).toBe(true);
      await svc.unwatch(dir);
      expect((svc as any).watchers.has(dir)).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
