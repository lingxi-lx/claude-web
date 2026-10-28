// 智能路由 / 来源健康: quota read off the upstream's headers, 429 cooldowns (retry-after, exhausted window, backoff).
import { describe, expect, it } from 'vitest';
import { QuotaTracker, parseDuration, parseRateLimitHeaders, parseReset, retryAfterMs, sourceKeyOfCandidate, sourceKeyOfTarget } from './quota.js';

const NOW = 1_800_000_000_000;

describe('header parsing', () => {
  it('reads OpenAI durations, RFC 3339 dates, epoch seconds / ms and plain seconds', () => {
    expect(parseDuration('6m0s')).toBe(360_000);
    expect(parseDuration('1h2m3.5s')).toBe(3_723_500);
    expect(parseDuration('20ms')).toBe(20);
    expect(parseDuration('soon')).toBeUndefined();
    expect(parseReset('1s', NOW)).toBe(NOW + 1000);
    expect(parseReset('2026-10-28T12:00:00Z', NOW)).toBe(Date.parse('2026-10-28T12:00:00Z'));
    expect(parseReset(String(NOW / 1000 + 60), NOW)).toBe(NOW + 60_000);
    expect(parseReset(String(NOW + 5000), NOW)).toBe(NOW + 5000);
    expect(parseReset('30', NOW)).toBe(NOW + 30_000);
  });

  it('retry-after: seconds, HTTP date, retry-after-ms wins', () => {
    expect(retryAfterMs({ 'retry-after': '12' }, NOW)).toBe(12_000);
    expect(retryAfterMs({ 'retry-after': new Date(NOW + 7000).toUTCString() }, NOW)).toBe(7000);
    expect(retryAfterMs({ 'retry-after': '12', 'retry-after-ms': '250' }, NOW)).toBe(250);
    expect(retryAfterMs({}, NOW)).toBeUndefined();
  });

  it('collects every window: OpenAI, generic, Anthropic keys and subscription utilization', () => {
    const w = parseRateLimitHeaders({
      'x-ratelimit-limit-requests': '100', 'x-ratelimit-remaining-requests': '25', 'x-ratelimit-reset-requests': '30s',
      'x-ratelimit-limit': '50', 'x-ratelimit-remaining': '40',
      'anthropic-ratelimit-tokens-limit': '1000', 'anthropic-ratelimit-tokens-remaining': '100',
      'anthropic-ratelimit-unified-5h-utilization': '0.8',
    }, NOW);
    expect(w.requests).toMatchObject({ remaining: 25, limit: 100, share: 0.25, resetAt: NOW + 30_000 });
    expect(w.generic.share).toBe(0.8);
    expect(w['anthropic-tokens'].share).toBe(0.1);
    expect(w['unified-5h'].share).toBeCloseTo(0.2);
    expect(parseRateLimitHeaders({ 'content-type': 'application/json' }, NOW)).toEqual({});
  });
});

describe('QuotaTracker', () => {
  it('remaining = the tightest window; a window past its reset counts as refilled', () => {
    const q = new QuotaTracker(() => NOW);
    q.observe('p:a', 200, { 'x-ratelimit-limit-requests': '10', 'x-ratelimit-remaining-requests': '2', 'x-ratelimit-reset-requests': '10s', 'x-ratelimit-limit-tokens': '100', 'x-ratelimit-remaining-tokens': '90' }, NOW);
    expect(q.remaining('p:a', NOW)).toBe(0.2);
    expect(q.tightest('p:a', NOW)).toEqual({ remaining: 0.2, resetAt: NOW + 10_000 });
    expect(q.remaining('p:a', NOW + 11_000)).toBe(0.9);
    expect(q.remaining('p:unknown', NOW)).toBeUndefined();
  });

  it('a 429 with retry-after cools the source for that long; a success clears it', () => {
    const q = new QuotaTracker(() => NOW);
    q.observe('p:a', 429, { 'retry-after': '20' }, NOW);
    expect(q.cooling('p:a', NOW)).toBe(NOW + 20_000);
    expect(q.cooling('p:a', NOW + 20_001)).toBeUndefined();
    expect(q.view('p:a', NOW)).toMatchObject({ streak: 1, last429At: NOW, cooldownUntil: NOW + 20_000, lastStatus: 429 });
    q.observe('p:a', 200, {}, NOW + 21_000);
    expect(q.view('p:a', NOW + 21_000)).toMatchObject({ streak: 0 });
    expect(q.cooling('p:a', NOW + 21_000)).toBeUndefined();
  });

  it('a 429 without retry-after waits for the used-up window, else backs off exponentially', () => {
    const q = new QuotaTracker(() => NOW);
    q.observe('p:w', 429, { 'x-ratelimit-limit-requests': '10', 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '2m0s' }, NOW);
    expect(q.cooling('p:w', NOW)).toBe(NOW + 120_000);
    q.observe('p:b', 429, {}, NOW);
    expect(q.cooling('p:b', NOW)).toBe(NOW + 30_000);
    q.observe('p:b', 429, {}, NOW);
    expect(q.cooling('p:b', NOW)).toBe(NOW + 60_000);
  });

  it('a rejected subscription status cools even on a non-429 answer', () => {
    const q = new QuotaTracker(() => NOW);
    q.observe('a:x', 400, { 'anthropic-ratelimit-unified-status': 'rejected', 'anthropic-ratelimit-unified-reset': String(NOW / 1000 + 3600) }, NOW);
    expect(q.cooling('a:x', NOW)).toBe(NOW + 3_600_000);
    expect(q.remaining('a:x', NOW)).toBe(0);
  });

  it('reset forgets the cooldown, never throws on junk', () => {
    const q = new QuotaTracker(() => NOW);
    q.observe('p:a', 429, { 'retry-after': '60' }, NOW);
    q.reset('p:a');
    expect(q.cooling('p:a', NOW)).toBeUndefined();
    expect(() => q.observe('p:a', 200, { 'x-ratelimit-remaining': 'NaN', 'retry-after': ['x'] } as any, NOW)).not.toThrow();
  });

  it('keys: accounts a:, providers p:, pools none', () => {
    expect(sourceKeyOfTarget({ id: 'x', account: true })).toBe('a:x');
    expect(sourceKeyOfTarget({ id: 'x' })).toBe('p:x');
    expect(sourceKeyOfCandidate({ providerId: 'x' })).toBe('p:x');
    expect(sourceKeyOfCandidate({ accountId: 'y' })).toBe('a:y');
    expect(sourceKeyOfCandidate({ upstreamGroupId: 'z' })).toBeUndefined();
  });
});
