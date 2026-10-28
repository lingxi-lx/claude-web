import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isoWeek } from '../upstreams/keys';
import type { GatewayKey } from '../gateway/types';
import { periodReset, quotaRetryAfter, spentPeriods } from './limits';

type K = Pick<GatewayKey, 'stats' | 'period' | 'share'>;
const month = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
/** a key whose counters (today UTC / this ISO week / this month) are as given at `now` */
function key(now: Date, o: { day?: number; week?: number; month?: number }, share: GatewayKey['share']): K {
  return {
    stats: { requests: o.day ?? 0, tokensIn: 0, tokensOut: 0, costUsd: 0, day: now.toISOString().slice(0, 10) },
    period: { week: isoWeek(now), weekRequests: o.week ?? 0, weekTokens: 0, month: month(now), monthRequests: o.month ?? 0, monthTokens: 0 },
    share,
  } as K;
}

let prevTz: string | undefined;
beforeEach(() => { prevTz = process.env.TZ; });
afterEach(() => { if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz; });

describe.each(['UTC', 'Asia/Shanghai', 'America/Los_Angeles'])('periodReset in %s', (tz) => {
  beforeEach(() => { process.env.TZ = tz; });

  it('day: the next UTC midnight (the daily counter is keyed by the UTC date)', () => {
    const now = new Date(Date.UTC(2026, 9, 28, 23, 59, 30));
    expect(periodReset('day', now).toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(periodReset('day', new Date(Date.UTC(2026, 9, 29, 0, 0, 0))).toISOString()).toBe('2026-10-30T00:00:00.000Z');
    // the counter's key really changes at that instant
    const r = periodReset('day', now);
    expect(new Date(r.getTime() - 1).toISOString().slice(0, 10)).toBe(now.toISOString().slice(0, 10));
    expect(r.toISOString().slice(0, 10)).not.toBe(now.toISOString().slice(0, 10));
  });

  it('week: next local Monday 00:00, exactly where isoWeek changes', () => {
    for (const now of [new Date(2026, 9, 28, 15), new Date(2026, 9, 26, 0, 0, 0), new Date(2026, 10, 1, 23, 59, 59), new Date(2026, 11, 31, 12), new Date(2027, 0, 3, 23)]) {
      const r = periodReset('week', now);
      expect(r.getDay()).toBe(1);
      expect([r.getHours(), r.getMinutes(), r.getSeconds()]).toEqual([0, 0, 0]);
      expect(r.getTime()).toBeGreaterThan(now.getTime());
      expect(r.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86_400_000 + 3600_000);
      expect(isoWeek(new Date(r.getTime() - 1))).toBe(isoWeek(now));
      expect(isoWeek(r)).not.toBe(isoWeek(now));
    }
  });

  it('month: the 1st of next month, local 00:00 (also across the year)', () => {
    expect(periodReset('month', new Date(2026, 9, 28, 10)).getTime()).toBe(new Date(2026, 10, 1).getTime());
    expect(periodReset('month', new Date(2026, 11, 31, 23, 59)).getTime()).toBe(new Date(2027, 0, 1).getTime());
    const now = new Date(2026, 1, 28, 12);
    const r = periodReset('month', now);
    expect(month(new Date(r.getTime() - 1))).toBe(month(now));
    expect(month(r)).toBe('2026-03');
  });
});

describe('quotaRetryAfter', () => {
  beforeEach(() => { process.env.TZ = 'Asia/Shanghai'; });

  it('a spent weekly quota waits for Monday, not tonight', () => {
    const now = new Date(2026, 9, 28, 15, 0, 0); // Wednesday 15:00 local
    const k = key(now, { week: 100 }, { weekly: { requests: 100 } });
    expect(spentPeriods(k, undefined, now)).toEqual(['week']);
    expect(quotaRetryAfter(k, undefined, now)).toBe((new Date(2026, 10, 2).getTime() - now.getTime()) / 1000);
  });

  it('a spent monthly quota waits for the 1st', () => {
    const now = new Date(2026, 9, 28, 15, 0, 0);
    const k = key(now, { month: 5 }, { monthly: { requests: 5 } });
    expect(quotaRetryAfter(k, undefined, now)).toBe((new Date(2026, 10, 1).getTime() - now.getTime()) / 1000);
  });

  it('daily: until the UTC date changes (08:00 in Shanghai), not local midnight', () => {
    const now = new Date(2026, 9, 28, 15, 0, 0); // 07:00 UTC
    const k = key(now, { day: 10 }, { daily: { requests: 10 } });
    expect(quotaRetryAfter(k, undefined, now)).toBe((Date.UTC(2026, 9, 29) - now.getTime()) / 1000);
    // the group's daily token budget counts the same way
    const g = key(now, {}, undefined);
    g.stats = { ...g.stats, tokensIn: 500 };
    expect(spentPeriods(g, { rateLimit: { dailyTokens: 500 } }, now)).toEqual(['day']);
  });

  it('several spent: the latest reset wins; nothing spent: the daily reset; never below 1 s', () => {
    const now = new Date(2026, 9, 28, 15, 0, 0);
    const both = key(now, { day: 10, month: 5 }, { daily: { requests: 10 }, monthly: { requests: 5 } });
    expect(quotaRetryAfter(both, undefined, now)).toBe((new Date(2026, 10, 1).getTime() - now.getTime()) / 1000);
    expect(quotaRetryAfter(key(now, {}, undefined), undefined, now)).toBe((Date.UTC(2026, 9, 29) - now.getTime()) / 1000);
    const edge = new Date(Date.UTC(2026, 9, 28, 23, 59, 59, 900));
    expect(quotaRetryAfter(key(edge, {}, undefined), undefined, edge)).toBe(1);
  });

  it('last week\'s counters do not count (rolled over)', () => {
    const now = new Date(2026, 9, 28, 15);
    const k = key(now, { week: 100 }, { weekly: { requests: 100 } });
    k.period = { ...k.period!, week: '2026-W01' };
    expect(spentPeriods(k, undefined, now)).toEqual([]);
  });
});
