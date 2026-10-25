import { describe, expect, it } from 'vitest';
import { displayMediaGrant, oneAtATime, PendingPicks, SourceCache } from './capture';

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

describe('displayMediaGrant (fix E-I4 / E-I5)', () => {
  const src = { id: 'screen:0:0', name: 'Screen 1' };
  const setup = () => {
    const picks = new PendingPicks();
    const sources = new SourceCache<typeof src>();
    sources.set(1, [src, { id: 'window:9:0', name: 'Editor' }]);
    return { picks, sources, guestFrame: (id: number) => (id === 7 ? { frame: 'guest7' } : undefined) };
  };
  it('the source picked in our picker comes from what was listed — no second enumeration', () => {
    const o = setup();
    o.picks.set(1, { kind: 'source', id: 'screen:0:0' });
    expect(displayMediaGrant({ ...o, senderId: 1, fromMainFrame: true })).toEqual({ video: src });
    // taken once
    expect(displayMediaGrant({ ...o, senderId: 1, fromMainFrame: true })).toEqual({});
  });
  it('an iframe of the window cannot take the pick; the top frame still can', () => {
    const o = setup();
    o.picks.set(1, { kind: 'source', id: 'screen:0:0' });
    expect(displayMediaGrant({ ...o, senderId: 1, fromMainFrame: false })).toEqual({});
    expect(displayMediaGrant({ ...o, senderId: 1, fromMainFrame: true })).toEqual({ video: src });
  });
  it('a pick not in this window\'s list, another window, no pick: nothing', () => {
    const o = setup();
    o.picks.set(1, { kind: 'source', id: 'screen:5:0' });
    expect(displayMediaGrant({ ...o, senderId: 1, fromMainFrame: true })).toEqual({});
    o.picks.set(2, { kind: 'source', id: 'screen:0:0' });
    expect(displayMediaGrant({ ...o, senderId: 2, fromMainFrame: true })).toEqual({});
    expect(displayMediaGrant({ ...o, senderId: undefined, fromMainFrame: true })).toEqual({});
  });
  it('a built-in browser tab: its frame; gone: nothing', () => {
    const o = setup();
    o.picks.set(1, { kind: 'guest', webContentsId: 7 });
    expect(displayMediaGrant({ ...o, senderId: 1, fromMainFrame: true })).toEqual({ video: { frame: 'guest7' } });
    o.picks.set(1, { kind: 'guest', webContentsId: 8 });
    expect(displayMediaGrant({ ...o, senderId: 1, fromMainFrame: true })).toEqual({});
  });
  it('SourceCache: per window, replaced by the next listing, dropped with the window', () => {
    const c = new SourceCache<{ id: string }>();
    c.set(1, [{ id: 'a' }]);
    expect(c.has(1, 'a')).toBe(true);
    c.set(1, [{ id: 'b' }]);
    expect(c.has(1, 'a')).toBe(false);
    c.drop(1);
    expect(c.get(1, 'b')).toBeUndefined();
  });
});

describe('oneAtATime (fix E-I4)', () => {
  it('a second enumeration waits for the first; a failure does not block the next', async () => {
    const run = oneAtATime();
    let active = 0;
    let most = 0;
    const job = (fail = false) => run(async () => { active++; most = Math.max(most, active); await new Promise((r) => setTimeout(r, 5)); active--; if (fail) throw new Error('x'); return 1; });
    const r = await Promise.allSettled([job(), job(true), job()]);
    expect(most).toBe(1);
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});
