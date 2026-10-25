import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unionRoots, userWritableRoots } from './codex-roots.js';

describe('codex writable roots (C-S1)', () => {
  it('union keeps order and the first spelling; Windows compares without case and trailing separators', () => {
    expect(unionRoots([['C:\\Mine', 'D:\\Lib'], ['d:\\lib\\', 'E:\\x']], 'win32')).toEqual(['C:\\Mine', 'D:\\Lib', 'E:\\x']);
    expect(unionRoots([['C:/a'], ['c:\\A']], 'win32')).toEqual(['C:/a']);
    // elsewhere case matters
    expect(unionRoots([['/Lib'], ['/lib', '/Lib/']], 'linux')).toEqual(['/Lib', '/lib']);
  });

  it('reads the top-level list, or the active profile’s; no file / broken file is none', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-codex-roots-'));
    try {
      expect(await userWritableRoots({ CODEX_HOME: home })).toEqual([]);
      await fs.writeFile(path.join(home, 'config.toml'), '[sandbox_workspace_write]\nwritable_roots = ["/a", 3, "/b"]\n');
      expect(await userWritableRoots({ CODEX_HOME: home })).toEqual(['/a', '/b']);
      await fs.writeFile(path.join(home, 'config.toml'), 'profile = "w"\n[sandbox_workspace_write]\nwritable_roots = ["/a"]\n[profiles.w.sandbox_workspace_write]\nwritable_roots = ["/p"]\n');
      expect(await userWritableRoots({ CODEX_HOME: home })).toEqual(['/p']);
      await fs.writeFile(path.join(home, 'config.toml'), 'this is = = not toml');
      expect(await userWritableRoots({ CODEX_HOME: home })).toEqual([]);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
