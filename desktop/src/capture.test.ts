import { describe, expect, it } from 'vitest';
import { PendingPicks } from './capture';

describe('PendingPicks', () => {
  it('one pick per window, taken once, gone after 10 s', () => {
    const p = new PendingPicks();
    p.set(1, { kind: 'source', id: 'screen:0:0' }, 1_000);
    expect(p.take(2, 1_500)).toBeUndefined();
    expect(p.take(1, 1_500)).toEqual({ kind: 'source', id: 'screen:0:0' });
    expect(p.take(1, 1_600)).toBeUndefined();
    p.set(1, { kind: 'guest', webContentsId: 7 }, 1_000);
    expect(p.take(1, 11_001)).toBeUndefined();
  });
});
