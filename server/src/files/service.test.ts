import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilesService, appleScriptEscape, isUncPath } from './service.js';

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
