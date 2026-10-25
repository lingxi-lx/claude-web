import { tr } from '@/i18n';
import { dict, own, type EdgeStyle, type NgBadge, type NgEdge, type NodeGraphData } from './schema';
// spec D4: a dropdown option's `marks` restyle edges while it is picked; the badge counts edges in one style.

export type Picks = Readonly<Record<string, string>>;
export const pickKey = (nodeId: string, rowId: string) => `${nodeId}/${rowId}`;

export function initialPicks(g: NodeGraphData): Record<string, string> {
  const out = dict<string>();
  for (const n of g.nodes) for (const r of n.rows) if (r.options.length) out[pickKey(n.id, r.id)] = r.value;
  return out;
}

export function edgeStyles(g: NodeGraphData, picks: Picks): Record<string, EdgeStyle> {
  const out = dict<EdgeStyle>();
  for (const e of g.edges) out[e.id] = e.style;
  for (const n of g.nodes) for (const r of n.rows) {
    const v = own(picks, pickKey(n.id, r.id)) ?? r.value;
    const o = r.options.find((x) => x.value === v);
    if (o) for (const [id, s] of Object.entries(o.marks)) if (Object.hasOwn(out, id)) out[id] = s;
  }
  return out;
}

export const pulses = (e: NgEdge, style: EdgeStyle): boolean => e.pulse ?? (style === 'strong' || style === 'error');

/** `tone` follows the counted style (review D-minor): error edges red, strong ones the accent, others plain; none → ok (✓) */
export interface BadgeView { text: string; tone: 'error' | 'strong' | 'ok' | 'plain' }

export function badgeView(b: NgBadge | undefined, styles: Readonly<Record<string, EdgeStyle>>): BadgeView | null {
  if (!b) return null;
  if (b.kind === 'text') return { text: b.text, tone: 'plain' };
  const n = Object.values(styles).filter((s) => s === b.count).length;
  return n ? { text: b.text.replace(/\{n\}/g, String(n)), tone: b.count === 'error' ? 'error' : b.count === 'strong' ? 'strong' : 'plain' } : { text: b.okText, tone: 'ok' };
}

export function changeSentence(g: NodeGraphData, from: Picks, to: Picks): string {
  const parts: string[] = [];
  for (const n of g.nodes) for (const r of n.rows) {
    const k = pickKey(n.id, r.id);
    const a = own(from, k) ?? r.value, b = own(to, k) ?? r.value;
    if (a === b) continue;
    const label = (v: string) => r.options.find((o) => o.value === v)?.label ?? v;
    parts.push(tr('「{node}」的 {label} 从 {from} 改成了 {to}', { node: n.title, label: r.label, from: label(a), to: label(b) }));
  }
  return parts.length ? tr('我在图里把{changes}。', { changes: parts.join(tr('；')) }) : '';
}
