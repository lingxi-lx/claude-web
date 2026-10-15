import { describe, expect, it } from 'vitest';
import { fmtTok } from '@/util';
import { coldCache, hitRate, usageParts } from './tokens';

describe('cache hit rate', () => {
  it('reads / (uncached + reads + writes); nothing read = 0', () => {
    expect(hitRate({ input: 100, cacheRead: 600, cacheWrite: 300 })).toBeCloseTo(0.6);
    expect(hitRate({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBe(0);
  });
});

describe('the token part of the line under an answer', () => {
  it('all the input (writes included), the output, and the hit rate', () => {
    const parts = usageParts({ input_tokens: 576, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 2_000, output_tokens: 4_000 }, fmtTok);
    expect(parts.map((p) => p.text)).toEqual(['↑33K ↓4.0K', '缓存 92%']);
    expect(parts[1].title).toContain('从缓存读 30K');
    expect(parts[1].title).toContain('写进缓存 2.0K');
    expect(parts[1].title).toContain('没走缓存 576');
  });
  it('an endpoint that reported reads of 0 shows 0 % (it did report the cache)', () => {
    expect(usageParts({ input_tokens: 1200, cache_read_input_tokens: 0, output_tokens: 50 }, fmtTok).map((p) => p.text)).toEqual(['↑1.2K ↓50', '缓存 0%']);
  });
  it('no cache fields at all, or no input: no rate', () => {
    expect(usageParts({ input_tokens: 1200, output_tokens: 50 }, fmtTok).map((p) => p.text)).toEqual(['↑1.2K ↓50']);
    expect(usageParts({ input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }, fmtTok).map((p) => p.text)).toEqual(['↑0 ↓0']);
    expect(usageParts(undefined, fmtTok)).toEqual([]);
  });
});

describe('a cache that went cold during a pause', () => {
  const big = { input_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 211_000, output_tokens: 1600 };
  it('a big turn that read almost nothing after more than the cache lives: says how long it sat', () => {
    expect(coldCache(big, 12 * 60_000)?.text).toBe('隔了 12 分钟，缓存已过期');
    expect(coldCache(big, 125 * 60_000)?.text).toBe('隔了 2 小时 5 分，缓存已过期');
  });
  it('nothing to explain: a short pause, a small turn, a turn that hit, an endpoint that reports no cache', () => {
    expect(coldCache(big, 4 * 60_000)).toBeNull();
    expect(coldCache(big, undefined)).toBeNull();
    expect(coldCache({ ...big, cache_creation_input_tokens: 2000 }, 12 * 60_000)).toBeNull();
    expect(coldCache({ ...big, cache_read_input_tokens: 200_000 }, 12 * 60_000)).toBeNull();
    expect(coldCache({ input_tokens: 211_000, output_tokens: 10 }, 12 * 60_000)).toBeNull();
  });
});
