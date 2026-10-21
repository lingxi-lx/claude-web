// Whether a theme's backdrop is still fit to run (spec 2026-10-22 §6): it threw, two seconds in a row at more than
// 50 ms a frame, or no word from the worker for two seconds (stuck in a loop) — then it is taken down.

export const SLOW_MS = 50;
/** the worker reports every second; the host checks every half second, so a hang goes in about 2.5 s */
export const SILENT_MS = 2000;
/** the host's own checks are this far apart or more: the page itself was stalled (its messages queued behind it) */
export const HOST_STALL_MS = 1000;

export interface Watchdog {
  feed(e: { type: 'stats'; avgMs: number } | { type: 'error' }, now: number): 'ok' | 'fail';
  tick(now: number): 'ok' | 'fail';
  /** paused: silence is expected */
  pause(): void;
  resume(now: number): void;
}

export function watchdog(start: number): Watchdog {
  let last = start, lastTick = start, slow = 0, paused = false, failed = false;
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
      // a late check means the page was frozen, not the worker: the worker's word is still queued — start counting again
      const stalled = now - lastTick > HOST_STALL_MS;
      lastTick = now;
      if (stalled) { last = now; return 'ok'; }
      return !paused && now - last > SILENT_MS ? fail() : 'ok';
    },
    pause() { paused = true; },
    resume(now) { paused = false; last = now; lastTick = now; },
  };
}
