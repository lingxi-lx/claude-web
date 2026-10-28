import { describe, expect, it } from 'vitest';
import type { GatewayKey, ShareRules } from '../gateway/types.js';
import { isoWeek } from '../upstreams/keys.js';
import { checkShareKey, shareUsage } from './limits.js';

const key = (share?: ShareRules): Pick<GatewayKey, 'share'> => ({ ...(share ? { share } : {}) });

describe('share key limits', () => {
  it('a share key without rules passes; an ordinary key has no share field', () => {
    expect(checkShareKey(key(), 'anything', {})).toEqual({ ok: true });
    expect(checkShareKey({} as GatewayKey, 'anything')).toEqual({ ok: true });
  });

  it('enforces the model allow-list, including globs, before quotas', () => {
    const k = key({ models: ['claude-*', 'gpt-4.1'], daily: { requests: 1 } });
    expect(checkShareKey(k, 'claude-sonnet-4-5', { todayRequests: 0 })).toEqual({ ok: true });
    expect(checkShareKey(k, 'gpt-4.1', { todayRequests: 0 })).toEqual({ ok: true });
    expect(checkShareKey(k, 'o3', { todayRequests: 999 })).toMatchObject({ ok: false, code: 'model' });
    expect(checkShareKey(k, '', {})).toMatchObject({ ok: false, code: 'model' });
  });

  it('stops at the daily request / token quota', () => {
    const requests = key({ daily: { requests: 2 } });
    expect(checkShareKey(requests, 'm', { todayRequests: 1 }).ok).toBe(true);
    expect(checkShareKey(requests, 'm', { todayRequests: 2 })).toMatchObject({ ok: false, code: 'daily' });
    const tokens = key({ daily: { tokens: 100 } });
    expect(checkShareKey(tokens, 'm', { todayTokens: 99 }).ok).toBe(true);
    expect(checkShareKey(tokens, 'm', { todayTokens: 100 })).toMatchObject({ ok: false, code: 'daily' });
  });

  it('checks the weekly and monthly counters independently', () => {
    const weekly = key({ weekly: { requests: 5, tokens: 500 } });
    expect(checkShareKey(weekly, 'm', { weekRequests: 4, weekTokens: 100 }).ok).toBe(true);
    expect(checkShareKey(weekly, 'm', { weekRequests: 5 })).toMatchObject({ ok: false, code: 'weekly' });
    expect(checkShareKey(weekly, 'm', { weekTokens: 500 })).toMatchObject({ ok: false, code: 'weekly' });

    const monthly = key({ monthly: { tokens: 1000 } });
    expect(checkShareKey(monthly, 'm', { monthTokens: 999 }).ok).toBe(true);
    expect(checkShareKey(monthly, 'm', { monthTokens: 1000 })).toMatchObject({ ok: false, code: 'monthly' });
  });

  it('checks daily, then weekly, then monthly (the first exhausted period wins)', () => {
    const k = key({ daily: { requests: 1 }, weekly: { requests: 1 }, monthly: { requests: 1 } });
    expect(checkShareKey(k, 'm', { todayRequests: 1, weekRequests: 1, monthRequests: 1 })).toMatchObject({ code: 'daily' });
    expect(checkShareKey(k, 'm', { todayRequests: 0, weekRequests: 1, monthRequests: 1 })).toMatchObject({ code: 'weekly' });
    expect(checkShareKey(k, 'm', { todayRequests: 0, weekRequests: 0, monthRequests: 1 })).toMatchObject({ code: 'monthly' });
  });

  it('accepts the nested usage shape too (daily / weekly / monthly)', () => {
    const k = key({ daily: { tokens: 10 } });
    expect(checkShareKey(k, 'm', { daily: { tokens: 9 } } as any)).toEqual({ ok: true });
    expect(checkShareKey(k, 'm', { daily: { tokens: 10 } } as any)).toMatchObject({ ok: false, code: 'daily' });
    const r = key({ daily: { requests: 1 } });
    expect(checkShareKey(r, 'm', { requests: 0 } as any).ok).toBe(true);
    expect(checkShareKey(r, 'm', { requests: 1 } as any)).toMatchObject({ ok: false, code: 'daily' });
  });

  it('builds the counters from stored stats and period, rolling a stale period to zero', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    const week = isoWeek(now);
    const stats = { requests: 3, tokensIn: 10, tokensOut: 5, costUsd: 0, day: '2026-10-27' };
    const period = { week, weekRequests: 7, weekTokens: 70, month: '2026-10', monthRequests: 30, monthTokens: 300 };
    expect(shareUsage({ stats, period }, now)).toEqual({
      todayRequests: 3, todayTokens: 15, weekRequests: 7, weekTokens: 70, monthRequests: 30, monthTokens: 300,
    });
    expect(shareUsage({ stats: { ...stats, day: '2000-01-01' }, period: { ...period, week: '2000-W01', month: '2000-01' } }, now))
      .toEqual({ todayRequests: 0, todayTokens: 0, weekRequests: 0, weekTokens: 0, monthRequests: 0, monthTokens: 0 });
  });
});
