// The 上游 page (spec 2026-10-26 §2.1): one dashboard of sources with a filter on the left. No tabs — accounts, tasks,
// mapping and logs live in a source's detail; keys / LAN in the 共享 drawer; audit in the 隐私 drawer.
import type { IconName } from '@/ui/icons';
import type { SourceSummary, UpstreamAccountView } from '@shared';
import { tr } from '@/i18n';

export const GATEWAY_TITLE = tr('上游');

export type SourceFilter = 'all' | 'free' | 'subscription' | 'api' | 'local-engine' | 'attention';
export type GatewayDrawer = 'share' | 'privacy' | 'activity' | 'sync' | 'plugins';

export interface FilterDef { id: SourceFilter; label: string; icon: IconName }

export const FILTERS: FilterDef[] = [
  { id: 'all', label: tr('全部'), icon: 'library' },
  { id: 'free', label: tr('免费'), icon: 'sparkle' },
  { id: 'subscription', label: tr('订阅'), icon: 'user' },
  { id: 'api', label: tr('API 供应商'), icon: 'cloud' },
  { id: 'local-engine', label: tr('本机运行内核'), icon: 'machine' },
  { id: 'attention', label: tr('需要处理'), icon: 'alert' },
];

/** The virtual source for route groups (智能路由): not from channels.status, always listed under 全部. */
export const ROUTING_ID = 'routing';

/** A configured source: an unconfigured family (no account yet) is reached through 添加来源 instead. */
export const isListed = (s: SourceSummary): boolean => s.health !== 'unconfigured' || s.kind === 'provider';

export const isFree = (s: SourceSummary): boolean => s.category === 'free' || s.models.some((m) => m.free);

export function matchesFilter(s: SourceSummary, f: SourceFilter): boolean {
  if (f === 'all') return true;
  if (f === 'free') return isFree(s);
  if (f === 'attention') return s.health === 'attention';
  return s.category === f;
}

export function matchesQuery(s: SourceSummary, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return s.name.toLowerCase().includes(t) || s.models.some((m) => m.id.toLowerCase().includes(t) || m.name.toLowerCase().includes(t));
}

export function filterCounts(list: SourceSummary[]): Record<SourceFilter, number> {
  const out = {} as Record<SourceFilter, number>;
  for (const f of FILTERS) out[f.id] = list.filter((s) => matchesFilter(s, f.id)).length;
  return out;
}

/** The accounts behind a subscription source (by family), or a descriptor source's provider logins. */
export const accountsOf = (s: SourceSummary, accounts: UpstreamAccountView[]): UpstreamAccountView[] =>
  s.upstreamKind ? accounts.filter((a) => a.kind === s.upstreamKind)
    : s.providerId ? accounts.filter((a) => a.providerId === s.providerId)
      : [];

/**
 * The tightest known quota left (in %) over some accounts — undefined when nothing is known (never a made-up number),
 * with that window's reset time when it has one.
 */
export function quotaLeft(accounts: UpstreamAccountView[]): { pct: number; resetAt?: number } | undefined {
  let worst: number | undefined;
  let resetAt: number | undefined;
  for (const a of accounts) {
    if (!a.enabled) continue;
    for (const w of a.quota?.windows ?? []) {
      const used = w.usedPct ?? (w.used !== undefined && w.limit ? Math.round((w.used / w.limit) * 100) : undefined);
      if (used === undefined) continue;
      const left = Math.max(0, Math.min(100, 100 - used));
      if (worst === undefined || left < worst) { worst = left; resetAt = w.resetAt; }
    }
  }
  return worst === undefined ? undefined : { pct: worst, ...(resetAt ? { resetAt } : {}) };
}

export const HEALTH_TEXT: Record<SourceSummary['health'], { l: string; c: string }> = {
  ready: { l: tr('可用'), c: 'ok' },
  attention: { l: tr('需要处理'), c: 'warn' },
  disabled: { l: tr('已停用'), c: '' },
  unconfigured: { l: tr('还没配置'), c: '' },
};

export const CATEGORY_TEXT: Record<SourceSummary['category'], string> = {
  free: tr('免费'),
  subscription: tr('订阅'),
  api: tr('API 供应商'),
  'local-engine': tr('本机运行内核'),
};

/** Audit lines that belong to a source: the member name is the provider's / account's / pool's name. */
export const linesFor = <L extends { member: string }>(lines: L[], names: string[]): L[] => {
  const set = new Set(names);
  return lines.filter((l) => set.has(l.member));
};

/** The models a subscription family's accounts / pools reported (gateway.status poolModels), de-duplicated. */
export function familyModels(accountIds: string[], poolIds: string[], poolModels: Record<string, string[]> | undefined): string[] {
  if (!poolModels) return [];
  const out = new Set<string>();
  for (const id of accountIds) for (const m of poolModels[`a:${id}`] ?? []) out.add(m);
  for (const id of poolIds) for (const m of poolModels[`u:${id}`] ?? []) out.add(m);
  return [...out];
}
