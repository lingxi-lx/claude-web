// 智能路由 + 来源健康: what is left of each source's / account's quota, read off the upstream's own answers
// (x-ratelimit-*, anthropic-ratelimit-*, retry-after) and its 429s. A 429 puts the source in a cooldown (retry-after
// when the upstream says, else the exhausted window's reset, else an exponential backoff); the router leaves a cooling
// source out and ranks the rest by the share of quota they still have. In memory only — a restart learns again from
// the next answers (spec §8: no temporary state synced). Ideas from CLIProxyAPI's quota cooldown (MIT).
import type http from 'node:http';

/** One quota window as the upstream reported it. `share` = remaining / limit (or 1 − utilization), 0–1. */
export interface QuotaWindowState {
  remaining?: number;
  limit?: number;
  share?: number;
  /** epoch ms when the window refills */
  resetAt?: number;
}

export interface QuotaState {
  key: string;
  /** requests / tokens / input-tokens / output-tokens / unified / unified-5h / unified-7d / generic */
  windows: Record<string, QuotaWindowState>;
  /** no request goes here before this (epoch ms) */
  cooldownUntil?: number;
  /** 429s in a row (resets on a success) */
  streak: number;
  last429At?: number;
  lastStatus?: number;
  updatedAt: number;
}

/** What the UI / the status sees for one source. */
export interface QuotaView {
  key: string;
  /** smallest known share left, 0–1 (absent = the upstream never said) */
  remaining?: number;
  /** when the tightest window refills */
  resetAt?: number;
  cooldownUntil?: number;
  streak: number;
  last429At?: number;
  lastStatus?: number;
  updatedAt: number;
}

const MAX_KEYS = 500;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;
const COOLDOWN_MAX_MS = 24 * 3600_000;
/** a window without a reset time stops counting after this long */
const STALE_MS = 60 * 60_000;

type Headers = http.IncomingHttpHeaders | Record<string, string | string[] | undefined> | undefined;

const header = (h: Headers, name: string): string | undefined => {
  if (!h) return undefined;
  const v = (h as Record<string, unknown>)[name] ?? (h as Record<string, unknown>)[name.toLowerCase()];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : typeof s === 'number' ? String(s) : undefined;
};

const num = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** OpenAI's "6m0s" / "1h2m3.5s" / "20ms" / "1s" → ms; undefined when it is not that shape. */
export function parseDuration(v: string): number | undefined {
  const s = v.trim().toLowerCase();
  if (!/^(\d+(\.\d+)?(ms|h|m|s))+$/.test(s)) return undefined;
  let ms = 0;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    const n = Number(m[1]);
    ms += m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : n * 3_600_000;
  }
  return Math.round(ms);
}

/**
 * A reset value in whatever form the upstream uses → epoch ms: a duration (OpenAI), an RFC 3339 date (Anthropic),
 * epoch ms / epoch seconds (OpenRouter, Anthropic unified), or seconds from now.
 */
export function parseReset(v: string | undefined, now: number): number | undefined {
  if (!v) return undefined;
  const d = parseDuration(v);
  if (d !== undefined) return now + d;
  const n = num(v);
  if (n !== undefined) {
    if (n > 1e12) return Math.round(n);
    if (n > 1e9) return Math.round(n * 1000);
    if (n >= 0) return now + Math.round(n * 1000);
    return undefined;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

/** `retry-after-ms`, then `retry-after` (seconds or an HTTP date) → ms to wait; undefined when absent. */
export function retryAfterMs(h: Headers, now: number): number | undefined {
  const ms = num(header(h, 'retry-after-ms'));
  if (ms !== undefined && ms >= 0) return Math.round(ms);
  const v = header(h, 'retry-after');
  if (!v) return undefined;
  const s = num(v);
  if (s !== undefined) return s >= 0 ? Math.round(s * 1000) : undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : undefined;
}

const mkWindow = (remaining: number | undefined, limit: number | undefined, resetAt: number | undefined): QuotaWindowState | undefined => {
  if (remaining === undefined && limit === undefined && resetAt === undefined) return undefined;
  const share = remaining !== undefined && limit !== undefined && limit > 0 ? Math.min(1, Math.max(0, remaining / limit)) : undefined;
  return { ...(remaining !== undefined ? { remaining } : {}), ...(limit !== undefined ? { limit } : {}), ...(share !== undefined ? { share } : {}), ...(resetAt !== undefined ? { resetAt } : {}) };
};

/** Every quota window the answer's headers describe (empty when there are none). */
export function parseRateLimitHeaders(h: Headers, now: number): Record<string, QuotaWindowState> {
  const out: Record<string, QuotaWindowState> = {};
  const put = (name: string, w: QuotaWindowState | undefined) => { if (w) out[name] = w; };
  // OpenAI-compatible (and most relays copying it)
  for (const k of ['requests', 'tokens'] as const) {
    put(k, mkWindow(num(header(h, `x-ratelimit-remaining-${k}`)), num(header(h, `x-ratelimit-limit-${k}`)), parseReset(header(h, `x-ratelimit-reset-${k}`), now)));
  }
  // OpenRouter / generic: one window
  put('generic', mkWindow(num(header(h, 'x-ratelimit-remaining')), num(header(h, 'x-ratelimit-limit')), parseReset(header(h, 'x-ratelimit-reset'), now)));
  // Anthropic API keys
  for (const k of ['requests', 'tokens', 'input-tokens', 'output-tokens'] as const) {
    const w = mkWindow(num(header(h, `anthropic-ratelimit-${k}-remaining`)), num(header(h, `anthropic-ratelimit-${k}-limit`)), parseReset(header(h, `anthropic-ratelimit-${k}-reset`), now));
    if (w) put(k === 'requests' || k === 'tokens' ? `anthropic-${k}` : k, w);
  }
  // Anthropic subscription logins: utilization 0–1 per window
  for (const k of ['5h', '7d', '7d_opus', '7d_sonnet'] as const) {
    const u = num(header(h, `anthropic-ratelimit-unified-${k}-utilization`));
    const reset = parseReset(header(h, `anthropic-ratelimit-unified-${k}-reset`), now);
    if (u !== undefined) out[`unified-${k}`] = { share: Math.min(1, Math.max(0, 1 - u)), ...(reset !== undefined ? { resetAt: reset } : {}) };
  }
  const status = header(h, 'anthropic-ratelimit-unified-status');
  if (status) {
    const reset = parseReset(header(h, 'anthropic-ratelimit-unified-reset'), now);
    out.unified = { share: status === 'rejected' ? 0 : status === 'allowed_warning' ? 0.1 : 1, ...(reset !== undefined ? { resetAt: reset } : {}) };
  }
  return out;
}

const backoff = (streak: number) => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, streak - 1));

export class QuotaTracker {
  private map = new Map<string, QuotaState>();

  constructor(private readonly clock: () => number = Date.now) {}

  /** One upstream answer for `key` (`p:<providerId>` / `a:<accountId>`). Never throws. */
  observe(key: string, status: number, headers: Headers, now = this.clock()) {
    if (!key) return;
    try {
      const prev = this.map.get(key);
      const s: QuotaState = prev ?? { key, windows: {}, streak: 0, updatedAt: now };
      const windows = parseRateLimitHeaders(headers, now);
      for (const [name, w] of Object.entries(windows)) s.windows[name] = w;
      s.lastStatus = status;
      s.updatedAt = now;
      const rejected = header(headers, 'anthropic-ratelimit-unified-status') === 'rejected';
      if (status === 429 || rejected) {
        s.streak++;
        s.last429At = now;
        // the upstream's own word first, then the reset of a window it says is used up, then a backoff
        const exhausted = Object.values(windows).filter((w) => (w.share === 0 || w.remaining === 0) && w.resetAt && w.resetAt > now).map((w) => w.resetAt! - now);
        const wait = retryAfterMs(headers, now) ?? (exhausted.length ? Math.max(...exhausted) : undefined) ?? backoff(s.streak);
        s.cooldownUntil = now + Math.min(COOLDOWN_MAX_MS, Math.max(1000, wait));
      } else if (status >= 200 && status < 300) {
        s.streak = 0;
        delete s.cooldownUntil;
      }
      this.map.delete(key);
      this.map.set(key, s);
      while (this.map.size > MAX_KEYS) this.map.delete(this.map.keys().next().value!);
    } catch { /* bookkeeping must never break a request */ }
  }

  /** The smallest share left across the windows still in force; a window past its reset counts as refilled. */
  remaining(key: string | undefined, now = this.clock()): number | undefined {
    const s = key ? this.map.get(key) : undefined;
    if (!s) return undefined;
    let min: number | undefined;
    for (const w of Object.values(s.windows)) {
      let share = w.share;
      if (share === undefined) continue;
      if (w.resetAt !== undefined && w.resetAt <= now) share = 1;
      else if (w.resetAt === undefined && now - s.updatedAt > STALE_MS) continue;
      min = min === undefined ? share : Math.min(min, share);
    }
    return min;
  }

  /** The tightest window (for 重置前用完 pacing): its share and when it refills. */
  tightest(key: string | undefined, now = this.clock()): { remaining: number; resetAt?: number } | undefined {
    const s = key ? this.map.get(key) : undefined;
    if (!s) return undefined;
    let best: { remaining: number; resetAt?: number } | undefined;
    for (const w of Object.values(s.windows)) {
      if (w.share === undefined || (w.resetAt !== undefined && w.resetAt <= now)) continue;
      if (w.resetAt === undefined && now - s.updatedAt > STALE_MS) continue;
      if (!best || w.share < best.remaining) best = { remaining: w.share, ...(w.resetAt !== undefined ? { resetAt: w.resetAt } : {}) };
    }
    return best;
  }

  /** epoch ms the cooldown ends, or undefined when the source may be used now */
  cooling(key: string | undefined, now = this.clock()): number | undefined {
    const s = key ? this.map.get(key) : undefined;
    return s?.cooldownUntil && s.cooldownUntil > now ? s.cooldownUntil : undefined;
  }

  view(key: string, now = this.clock()): QuotaView | undefined {
    const s = this.map.get(key);
    if (!s) return undefined;
    const remaining = this.remaining(key, now);
    const tight = this.tightest(key, now);
    const cooldownUntil = this.cooling(key, now);
    return {
      key, streak: s.streak, updatedAt: s.updatedAt,
      ...(remaining !== undefined ? { remaining: Math.round(remaining * 1000) / 1000 } : {}),
      ...(tight?.resetAt !== undefined ? { resetAt: tight.resetAt } : {}),
      ...(cooldownUntil ? { cooldownUntil } : {}),
      ...(s.last429At ? { last429At: s.last429At } : {}),
      ...(s.lastStatus !== undefined ? { lastStatus: s.lastStatus } : {}),
    };
  }

  views(now = this.clock()): QuotaView[] {
    return [...this.map.keys()].map((k) => this.view(k, now)!).filter(Boolean);
  }

  /** A user's 「重置」: forget the cooldown and the streak (the windows stay: they are the upstream's own numbers). */
  reset(key: string) {
    const s = this.map.get(key);
    if (s) { s.streak = 0; delete s.cooldownUntil; }
  }

  clear() { this.map.clear(); }
}

/** The process-wide tracker the gateway feeds and the router / source health read. */
export const quotaTracker = new QuotaTracker();

/** The quota key of a gateway target: an account resolved from the account store, else its provider profile. */
export const sourceKeyOfTarget = (t: { id: string; account?: boolean }): string => (t.account ? `a:${t.id}` : `p:${t.id}`);

/** The quota key of a routing candidate (pools have none: their accounts are tracked one by one). */
export const sourceKeyOfCandidate = (c: { providerId?: string; accountId?: string; upstreamGroupId?: string }): string | undefined =>
  c.accountId ? `a:${c.accountId}` : c.upstreamGroupId ? undefined : c.providerId ? `p:${c.providerId}` : undefined;

/** The gateway's one hook: every upstream answer (status + headers) of every attempt. Never throws. */
export function observeUpstream(t: { id: string; account?: boolean }, status: number, headers: Headers) {
  try { quotaTracker.observe(sourceKeyOfTarget(t), status, headers); } catch { /* never */ }
}
