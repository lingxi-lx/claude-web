import { describe, expect, it } from 'vitest';
import { watchdog } from './watchdog';

describe('watchdog', () => {
  it('an error fails it', () => expect(watchdog(0).feed({ type: 'error' }, 10)).toBe('fail'));
  it('two slow seconds in a row fail it; slow, fast, slow does not', () => {
    const a = watchdog(0);
    expect(a.feed({ type: 'stats', avgMs: 60 }, 1000)).toBe('ok');
    expect(a.feed({ type: 'stats', avgMs: 60 }, 2000)).toBe('fail');
    const b = watchdog(0);
    b.feed({ type: 'stats', avgMs: 60 }, 1000);
    b.feed({ type: 'stats', avgMs: 20 }, 2000);
    expect(b.feed({ type: 'stats', avgMs: 60 }, 3000)).toBe('ok');
  });
  // the host checks every half second
  const ticks = (d: ReturnType<typeof watchdog>, from: number, to: number) => { let r = 'ok'; for (let t = from; t <= to && r === 'ok'; t += 500) r = d.tick(t); return r; };
  it('two silent seconds fail it, unless paused', () => {
    const a = watchdog(0);
    expect(ticks(a, 500, 2000)).toBe('ok');
    expect(a.tick(2500)).toBe('fail');
    const b = watchdog(0);
    b.pause();
    expect(ticks(b, 500, 10_000)).toBe('ok');
    b.resume(10_000);
    expect(ticks(b, 10_500, 12_000)).toBe('ok');
    expect(b.tick(12_500)).toBe('fail');
  });
  it('a frozen page is not a silent worker: a late check starts the count again (2026-10-22 review: 2.6 s main-thread stall)', () => {
    const a = watchdog(0);
    a.tick(500);
    // the page froze from 500 to 3100; the worker's stats are queued behind it
    expect(a.tick(3100)).toBe('ok');
    expect(a.feed({ type: 'stats', avgMs: 5 }, 3101)).toBe('ok');
    // …and a worker that really hangs is still caught after
    expect(ticks(a, 3600, 5100)).toBe('ok');
    expect(a.tick(5600)).toBe('fail');
  });
  it('once failed, stays failed', () => {
    const a = watchdog(0);
    a.feed({ type: 'error' }, 1);
    expect(a.feed({ type: 'stats', avgMs: 1 }, 2)).toBe('fail');
  });
});
