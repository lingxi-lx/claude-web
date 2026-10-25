import { describe, expect, it } from 'vitest';
import { AutoLeases, LEASE_MS } from './auto-lease';

describe('AutoLeases (fix E-I3)', () => {
  it('one window per conversation: a second window is refused while the first renews', () => {
    const l = new AutoLeases();
    expect(l.claim('s1', 'winA', 1000)).toBe(true);
    expect(l.claim('s1', 'winB', 1001)).toBe(false);
    expect(l.claim('s1', 'winA', 1000 + LEASE_MS - 1)).toBe(true); // renewed
    expect(l.claim('s1', 'winB', 1000 + LEASE_MS + 10)).toBe(false);
    expect(l.claim('s2', 'winB', 1001)).toBe(true); // another conversation is its own
  });
  it('runs out when not renewed, and the holder can let go', () => {
    const l = new AutoLeases();
    l.claim('s1', 'winA', 0);
    expect(l.claim('s1', 'winB', LEASE_MS + 1)).toBe(true);
    l.release('s1', 'winA'); // not the holder any more: no effect
    expect(l.claim('s1', 'winA', LEASE_MS + 2)).toBe(false);
    l.release('s1', 'winB');
    expect(l.claim('s1', 'winA', LEASE_MS + 3)).toBe(true);
  });
  it('no session id or holder: never granted', () => {
    expect(new AutoLeases().claim('', 'w')).toBe(false);
    expect(new AutoLeases().claim('s', '')).toBe(false);
  });
});
