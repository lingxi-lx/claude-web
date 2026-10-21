import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ net: {} }));
const { MacSelfUpdate } = await import('./mac-update');

describe('what a swap left, across starts', () => {
  it('a failed version stays failed on every later start (not fetched again to be refused again); a successful swap forgets it', () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-macupd-'));
    const dir = path.join(userData, 'update');
    const leave = (text: string) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'result'), text); };

    leave('fail 0.3.0 mv: rename a to b: Operation not permitted\n');
    const first = new MacSelfUpdate(dir);
    expect(first.takeResult()).toEqual({ ok: false, version: '0.3.0', error: 'mv: rename a to b: Operation not permitted' });
    expect(fs.existsSync(dir)).toBe(false);
    expect(first.failed()).toEqual({ version: '0.3.0', error: 'mv: rename a to b: Operation not permitted' });

    for (let start = 2; start <= 3; start++) {
      const u = new MacSelfUpdate(dir);
      expect(u.takeResult()).toBeNull();
      expect(u.failed()?.version).toBe('0.3.0');
    }

    leave('ok 0.3.1\n');
    const after = new MacSelfUpdate(dir);
    expect(after.takeResult()).toEqual({ ok: true, version: '0.3.1' });
    expect(after.failed()).toBeNull();
    fs.rmSync(userData, { recursive: true, force: true });
  });
});
