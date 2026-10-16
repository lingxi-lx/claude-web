// 漏跑 (spec 2026-10-16 pages §2; the official app's missed runs): a run whose time passed while the app was closed or
// the computer asleep. Within seven days it runs once — for the most recent missed time, because the next one is
// computed from now — and the user is told it is a catch-up; anything older is dropped.
export const CATCH_UP_WINDOW = 7 * 24 * 3600_000;
/** Later than this is no longer "on time" (the tick is every 30 s; a busy retry adds a minute). */
const ON_TIME = 3 * 60_000;

export type Missed = 'on-time' | 'catch-up' | 'drop';

export function missedRun(nextRunAt: number | undefined, now: number): Missed {
  if (!nextRunAt || now - nextRunAt <= ON_TIME) return 'on-time';
  return now - nextRunAt <= CATCH_UP_WINDOW ? 'catch-up' : 'drop';
}
