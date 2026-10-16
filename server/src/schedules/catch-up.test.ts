import { describe, expect, it } from 'vitest';
import { CATCH_UP_WINDOW, missedRun } from './catch-up.js';

describe('missed scheduled runs', () => {
  const now = Date.UTC(2026, 9, 16, 9);
  it('on time: due now, a tick or a busy retry late, or never scheduled', () => {
    expect(missedRun(now, now)).toBe('on-time');
    expect(missedRun(now - 90_000, now)).toBe('on-time');
    expect(missedRun(undefined, now)).toBe('on-time');
  });
  it('missed within seven days: one catch-up run', () => {
    expect(missedRun(now - 3600_000, now)).toBe('catch-up');
    expect(missedRun(now - 6 * 24 * 3600_000, now)).toBe('catch-up');
    expect(missedRun(now - CATCH_UP_WINDOW, now)).toBe('catch-up');
  });
  it('older: dropped', () => {
    expect(missedRun(now - CATCH_UP_WINDOW - 1, now)).toBe('drop');
  });
});
