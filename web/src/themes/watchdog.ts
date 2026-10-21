// Whether a theme's backdrop is still fit to run (spec 2026-10-22 §6): it threw, two seconds in a row at more than
// 50 ms a frame, or no word from the worker for two seconds (stuck in a loop) — then it is taken down.

export const SLOW_MS = 50;
/** the worker reports every second; the host checks every half second, so a hang goes in about 2.5 s */
export const SILENT_MS = 2000;

export interface Watchdog {
  feed(e: { type: 'stats'; avgMs: number } | { type: 'error' }, now: number): 'ok' | 'fail';
  tick(now: number): 'ok' | 'fail';
  /** paused: silence is expected */
  pause(): void;
  resume(now: number): void;
}

export function watchdog(start: number): Watchdog {
  let last = start, slow = 0, paused = false, failed = false;
  const fail = () => { failed = true; return 'fail' as const; };
  return {
    feed(e, now) {
      if (failed) return 'fail';
      last = now;
      if (e.type === 'error') return fail();
      slow = e.avgMs > SLOW_MS ? slow + 1 : 0;
      return slow >= 2 ? fail() : 'ok';
    },
    tick(now) {
      if (failed) return 'fail';
      return !paused && now - last > SILENT_MS ? fail() : 'ok';
    },
    pause() { paused = true; },
    resume(now) { paused = false; last = now; },
  };
}
