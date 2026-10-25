import { describe, expect, it } from 'vitest';
import os from 'node:os';
import { checkExtraFolders, refusePeerUnc } from './folder-check.js';

const dir = { isDirectory: () => true };

describe('project folder checks (C-S2)', () => {
  it('a non-array folders is refused; undefined is no change', async () => {
    await expect(checkExtraFolders('x', { fromPeer: false })).rejects.toThrow();
    await expect(checkExtraFolders({ 0: 'x' }, { fromPeer: false })).rejects.toThrow();
    await expect(checkExtraFolders(undefined, { fromPeer: false })).resolves.toBeUndefined();
    await expect(checkExtraFolders([os.tmpdir()], { fromPeer: false })).resolves.toBeUndefined();
    await expect(checkExtraFolders(['relative/x'], { fromPeer: false })).rejects.toThrow('relative/x');
  });

  it('a network path from another machine is refused before anything touches it; the user’s own is checked', async () => {
    const touched: string[] = [];
    const stat = async (p: string) => { touched.push(p); return dir; };
    await expect(checkExtraFolders(['\\\\nas\\proj'], { fromPeer: true, stat })).rejects.toThrow();
    expect(touched).toEqual([]);
    expect(() => refusePeerUnc('//nas/proj', true)).toThrow();
    expect(() => refusePeerUnc('//nas/proj', false)).not.toThrow();
    expect(() => refusePeerUnc('C:\\proj', true)).not.toThrow();
    await expect(checkExtraFolders(['//nas/proj'], { fromPeer: false, stat })).resolves.toBeUndefined();
    expect(touched).toEqual(['//nas/proj']);
  });

  it('the stat of a network folder that hangs gives up after the timeout', async () => {
    const stat = () => new Promise<typeof dir>(() => {});
    const t0 = Date.now();
    await expect(checkExtraFolders(['//dead/share'], { fromPeer: false, stat, uncMs: 50 })).rejects.toThrow('dead');
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
