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
  it('two silent seconds fail it, unless paused', () => {
    const a = watchdog(0);
    expect(a.tick(1900)).toBe('ok');
    expect(a.tick(2100)).toBe('fail');
    const b = watchdog(0);
    b.pause();
    expect(b.tick(10_000)).toBe('ok');
    b.resume(10_000);
    expect(b.tick(11_900)).toBe('ok');
    expect(b.tick(12_100)).toBe('fail');
  });
  it('once failed, stays failed', () => {
    const a = watchdog(0);
    a.feed({ type: 'error' }, 1);
    expect(a.feed({ type: 'stats', avgMs: 1 }, 2)).toBe('fail');
  });
});
