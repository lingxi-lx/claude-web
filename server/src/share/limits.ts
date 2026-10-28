// Share-key limits (spec §7.8): what one shared gateway key may use and how much.
// `checkShareKey` is pure: the gateway passes the key (with its `share` rules) and the counters it already keeps
// (today / ISO week / month). A model outside the key's allow-list is refused before any upstream is touched;
// daily, weekly and monthly request / token quotas are cumulative and stop at `>=` the limit, like canSpend.
import type { GatewayKey, ShareQuota, ShareRules } from '../gateway/types.js';
import { modelAllowed } from '../upstreams/routing.js';
import { isoWeek } from '../upstreams/keys.js';
import { tr } from '../i18n/index.js';

/** The counters behind a share key's quotas (the same numbers ShareKeyView.usage shows). */
export interface ShareUsage {
  todayRequests?: number;
  todayTokens?: number;
  weekRequests?: number;
  weekTokens?: number;
  monthRequests?: number;
  monthTokens?: number;
}

export type ShareLimitCode = 'model' | 'daily' | 'weekly' | 'monthly';
export type ShareLimitResult = { ok: true } | { ok: false; code: ShareLimitCode; message: string };

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

function counter(usage: ShareUsage, period: 'today' | 'week' | 'month', kind: 'Requests' | 'Tokens'): number {
  const raw = usage as Record<string, unknown>;
  const flat = raw[`${period}${kind}`] ?? raw[`${period === 'today' ? 'daily' : period === 'week' ? 'weekly' : 'monthly'}${kind}`];
  if (flat !== undefined) return n(flat);
  // the brief `{ requests, tokens }` form means today (the most common check)
  if (period === 'today' && raw[kind.toLowerCase()] !== undefined) return n(raw[kind.toLowerCase()]);
  const nestedName = period === 'today' ? 'daily' : period === 'week' ? 'weekly' : 'monthly';
  const nested = raw[nestedName] ?? raw[period];
  if (nested && typeof nested === 'object') return n((nested as Record<string, unknown>)[kind.toLowerCase()]);
  return 0;
}

function over(q: ShareQuota | undefined, requests: number, tokens: number): boolean {
  if (!q) return false;
  return (n(q.requests) > 0 && requests >= n(q.requests)) || (n(q.tokens) > 0 && tokens >= n(q.tokens));
}

/**
 * The one check the gateway runs per request for a share key:
 *  - model scope from `key.share.models` (`*` globs allowed; empty / absent = no extra restriction);
 *  - daily / weekly / monthly quotas from `key.share` and the supplied counters.
 * A key without share rules always passes (ordinary gateway keys are handled by canSpend).
 */
export function checkShareKey(
  key: Pick<GatewayKey, 'share'>,
  modelId: string,
  usage: ShareUsage = {},
): ShareLimitResult {
  const rules: ShareRules | undefined = key?.share;
  if (!rules) return { ok: true };

  const model = String(modelId ?? '').trim();
  if (rules.models?.length && !modelAllowed(model, rules.models)) {
    return { ok: false, code: 'model', message: tr('这个共享密钥不能用模型 {model}', { model: model.slice(0, 120) }) };
  }

  const dayRequests = counter(usage, 'today', 'Requests');
  const dayTokens = counter(usage, 'today', 'Tokens');
  if (over(rules.daily, dayRequests, dayTokens)) {
    return { ok: false, code: 'daily', message: tr('这个共享密钥今天的额度已用完') };
  }
  if (over(rules.weekly, counter(usage, 'week', 'Requests'), counter(usage, 'week', 'Tokens'))) {
    return { ok: false, code: 'weekly', message: tr('这个共享密钥本周的额度已用完') };
  }
  if (over(rules.monthly, counter(usage, 'month', 'Requests'), counter(usage, 'month', 'Tokens'))) {
    return { ok: false, code: 'monthly', message: tr('这个共享密钥本月的额度已用完') };
  }
  return { ok: true };
}

/** The counters to pass to `checkShareKey`, built from a key's stored stats / period (rolls over the week / month). */
export function shareUsage(key: Pick<GatewayKey, 'stats' | 'period'>, now = new Date()): Required<ShareUsage> {
  const day = now.toISOString().slice(0, 10);
  const today = key.stats?.day === day ? key.stats : { requests: 0, tokensIn: 0, tokensOut: 0 };
  const week = isoWeek(now);
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const p = key.period;
  return {
    todayRequests: n(today.requests),
    todayTokens: n(today.tokensIn) + n(today.tokensOut),
    weekRequests: p?.week === week ? n(p.weekRequests) : 0,
    weekTokens: p?.week === week ? n(p.weekTokens) : 0,
    monthRequests: p?.month === month ? n(p.monthRequests) : 0,
    monthTokens: p?.month === month ? n(p.monthTokens) : 0,
  };
}

// ---- retry-after ------------------------------------------------------------------------------------------------
// A 429 for a spent quota used to say "try again after local midnight" whatever ran out: a weekly / monthly quota
// sent the caller back every night for nothing (and the daily one, whose counter is keyed by the UTC date, was
// told local midnight — hours early or late away from UTC). Each period now reports when its counter really
// starts again, and the answer is the latest of the periods that are spent.

export type QuotaPeriod = 'day' | 'week' | 'month';

/**
 * When a period's counters start again after `now`:
 *  - day: the next UTC midnight (key.stats.day is `toISOString().slice(0, 10)`, a UTC date);
 *  - week: the next local Monday 00:00 (isoWeek is local time);
 *  - month: the 1st of next month, local 00:00.
 * Built from calendar fields, so a DST change inside the week / month does not shift it.
 */
export function periodReset(period: QuotaPeriod, now = new Date()): Date {
  if (period === 'day') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysSinceMonday = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday + 7);
}

/** Which of a key's periods are spent right now (group daily budgets, then the share quotas). */
export function spentPeriods(
  key: Pick<GatewayKey, 'stats' | 'period' | 'share'>,
  group: { rateLimit?: { dailyTokens?: number; dailyCostUsd?: number } } | undefined,
  now = new Date(),
): QuotaPeriod[] {
  const out = new Set<QuotaPeriod>();
  const u = shareUsage(key, now);
  const day = now.toISOString().slice(0, 10);
  const cost = key.stats?.day === day ? n(key.stats.costUsd) : 0;
  const lim = group?.rateLimit;
  if (lim?.dailyTokens && u.todayTokens >= lim.dailyTokens) out.add('day');
  if (lim?.dailyCostUsd && cost >= lim.dailyCostUsd) out.add('day');
  const sh = key.share;
  if (sh) {
    if (over(sh.daily, u.todayRequests, u.todayTokens)) out.add('day');
    if (over(sh.weekly, u.weekRequests, u.weekTokens)) out.add('week');
    if (over(sh.monthly, u.monthRequests, u.monthTokens)) out.add('month');
  }
  return [...out];
}

/**
 * The `retry-after` (seconds, at least 1) of a budget / quota refusal: until every spent period has rolled over.
 * Nothing spent (a race with the counter) → until the next daily reset.
 */
export function quotaRetryAfter(
  key: Pick<GatewayKey, 'stats' | 'period' | 'share'>,
  group?: { rateLimit?: { dailyTokens?: number; dailyCostUsd?: number } },
  now = new Date(),
): number {
  const spent = spentPeriods(key, group, now);
  const resets = (spent.length ? spent : (['day'] as QuotaPeriod[])).map((p) => periodReset(p, now).getTime());
  return Math.max(1, Math.ceil((Math.max(...resets) - now.getTime()) / 1000));
}
