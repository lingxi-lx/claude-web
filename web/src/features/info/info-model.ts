// 信息栏 (spec 2026-10-16 recording-ux §1; the official app's right column): what the cards are, in what order, which are
// folded (meta.json `ui.infoCards`), and the context breakdown grouped for the 上下文 card. Pure.

export const INFO_CARDS = ['env', 'context', 'connectors', 'changes', 'background'] as const;
export type InfoCard = (typeof INFO_CARDS)[number];
export interface InfoLayout { order: InfoCard[]; collapsed: InfoCard[] }

const isCard = (x: unknown): x is InfoCard => typeof x === 'string' && (INFO_CARDS as readonly string[]).includes(x);

/** The stored layout, repaired: unknown ids dropped, duplicates removed, cards added since appended. */
export function normInfoLayout(v: unknown): InfoLayout {
  const o = (v && typeof v === 'object' ? v : {}) as { order?: unknown; collapsed?: unknown };
  const order = [...new Set((Array.isArray(o.order) ? o.order : []).filter(isCard))];
  for (const c of INFO_CARDS) if (!order.includes(c)) order.push(c);
  // folded by default: the context breakdown is long (the official app opens it on a click)
  const collapsed = Array.isArray(o.collapsed) ? [...new Set(o.collapsed.filter(isCard))] : ['context' as InfoCard];
  return { order, collapsed };
}

/** `card` moved to where `before` is (null: to the end). */
export function moveCard(l: InfoLayout, card: InfoCard, before: InfoCard | null): InfoLayout {
  if (card === before) return l;
  const rest = l.order.filter((c) => c !== card);
  const at = before ? rest.indexOf(before) : rest.length;
  rest.splice(at < 0 ? rest.length : at, 0, card);
  return { ...l, order: rest };
}

/** One step up (-1) or down (+1): the keyboard's Alt+↑ / Alt+↓ on a card's title. */
export function nudgeCard(l: InfoLayout, card: InfoCard, dir: -1 | 1): InfoLayout {
  const i = l.order.indexOf(card);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= l.order.length) return l;
  const order = [...l.order];
  [order[i], order[j]] = [order[j], order[i]];
  return { ...l, order };
}

export function toggleCard(l: InfoLayout, card: InfoCard): InfoLayout {
  return { ...l, collapsed: l.collapsed.includes(card) ? l.collapsed.filter((c) => c !== card) : [...l.collapsed, card] };
}

// ---------- the 上下文 card ----------

export interface CtxCategory { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred'; color?: string }
export interface CtxBreakdown {
  percentage: number;
  total: number;
  max: number;
  used: (CtxCategory & { pct: number; swatch: number })[];
  buffer: (CtxCategory & { pct: number })[];
  free: (CtxCategory & { pct: number })[];
  deferred: CtxCategory[];
  mcpTools: { name: string; server: string; tokens: number }[];
  memoryFiles: { path: string; tokens: number }[];
  agents: { name: string; tokens: number }[];
}

/** getContextUsage's answer (`detail: 'full'`) → rows for the card. `swatch` is a palette index (the CLI's colour
 *  names are its terminal theme's, not ours). Classified on `kind`, never on the English name. */
export function contextBreakdown(u: any): CtxBreakdown | null {
  if (!u || !Array.isArray(u.categories)) return null;
  const max = Number(u.rawMaxTokens ?? u.maxTokens ?? 0) || 0;
  const total = Number(u.totalTokens ?? 0) || 0;
  const pct = (t: number) => (max ? (t / max) * 100 : 0);
  const cats: CtxCategory[] = u.categories
    .filter((c: any) => c && typeof c.name === 'string' && Number.isFinite(c.tokens))
    .map((c: any) => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind ?? (c.isDeferred ? 'deferred' : 'used') }));
  let swatch = 0;
  return {
    percentage: Number.isFinite(u.percentage) ? u.percentage : Math.round(pct(total)),
    total,
    max,
    used: cats.filter((c) => c.kind === 'used').map((c) => ({ ...c, pct: pct(c.tokens), swatch: swatch++ % 8 })),
    buffer: cats.filter((c) => c.kind === 'buffer').map((c) => ({ ...c, pct: pct(c.tokens) })),
    free: cats.filter((c) => c.kind === 'free').map((c) => ({ ...c, pct: pct(c.tokens) })),
    deferred: cats.filter((c) => c.kind === 'deferred'),
    mcpTools: (u.mcpTools ?? []).map((t: any) => ({ name: String(t.name), server: String(t.serverName ?? ''), tokens: Number(t.tokens) || 0 })),
    memoryFiles: (u.memoryFiles ?? []).map((m: any) => ({ path: String(m.path), tokens: Number(m.tokens) || 0 })),
    agents: (u.agents ?? []).map((a: any) => ({ name: String(a.agentType), tokens: Number(a.tokens) || 0 })),
  };
}

/** 19.6k / 1.2M / 300 */
export function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/** 连接器: how many need a hand (failed or waiting for a login) and the rows to list. */
export function connectorSummary(servers: { name: string; status?: string }[] | undefined): { broken: number; rows: { name: string; status: string }[] } {
  const rows = (servers ?? []).filter((s) => s && s.name).map((s) => ({ name: s.name, status: s.status ?? 'pending' }));
  return { broken: rows.filter((r) => r.status === 'failed' || r.status === 'needs-auth').length, rows };
}
