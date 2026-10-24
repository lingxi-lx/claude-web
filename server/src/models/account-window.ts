/**
 * The account's context windows and the compaction point (spec 2026-10-24 A7, a user: new conversations sometimes
 * started on Opus 5.5 at 200K). On the claude.ai login a plain Claude id is 200K and `<id>[1m]` is 1M (both engines);
 * the user picks per family, 1M by default, and the pick is applied to whatever model the conversation asks for.
 * Pure (no node:*): web imports it as `@account-window`.
 */
export type AccountFamily = 'opus' | 'sonnet' | 'fable';
export type AccountWindows = Partial<Record<AccountFamily, 200_000 | 1_000_000>>;

const FAMILIES: AccountFamily[] = ['opus', 'sonnet', 'fable'];
const ONE_M = 1_000_000;
const TWO_K = 200_000;

export function accountFamily(model: string | undefined): AccountFamily | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase().replace(/\[1m\]$/, '');
  return FAMILIES.find((f) => m === f || m.startsWith(`claude-${f}-`));
}

export function familyWindows(raw: unknown): AccountWindows {
  const out: AccountWindows = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const f of FAMILIES) {
    const v = (raw as Record<string, unknown>)[f];
    if (v === TWO_K || v === ONE_M) out[f] = v;
  }
  return out;
}

export function accountModel(model: string | undefined, w: AccountWindows): string | undefined {
  const f = accountFamily(model);
  if (!f || !model) return model;
  const base = model.replace(/\[1m\]$/i, '');
  return (w[f] ?? ONE_M) === ONE_M ? `${base}[1m]` : base;
}

export function accountWindowOf(model: string | undefined, w: AccountWindows): number | undefined {
  if (!model || model === 'default') return undefined;
  const f = accountFamily(model);
  return f ? (w[f] ?? ONE_M) : TWO_K;
}

export function parseTokens(v: string): number | undefined {
  const s = v.trim().replace(/[,_\s]/g, '').toLowerCase();
  if (!/^\d+(\.\d+)?[km]?$/.test(s)) return undefined;
  const n = parseFloat(s);
  const out = s.endsWith('m') ? n * 1_000_000 : s.endsWith('k') || n < 10_000 ? n * 1000 : n;
  return out > 0 ? Math.round(out) : undefined;
}

export function compactAtOk(n: number | undefined, window: number | undefined): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n >= 50_000 && (!window || n <= window);
}

export function effectiveCompact(...caps: (number | undefined)[]): number | undefined {
  const ok = caps.filter((c): c is number => typeof c === 'number' && Number.isFinite(c) && c > 0);
  return ok.length ? Math.min(...ok) : undefined;
}
