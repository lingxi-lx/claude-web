import type { NgEdge, NgNode } from './schema';
// spec D1: columns from the edges (orchestra's topological layering, moved here), variable-height cards, bezier edges.

export interface LayerIn { id: string; dependsOn: string[] }

/** Layer = one more than the deepest dependency; nodes on a cycle (unsaved drafts) go to a trailing column. */
export function layers<T extends LayerIn>(nodes: T[]): T[][] {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const onPath = new Set<string>();
  const cyclic = new Set<string>();
  const d = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (onPath.has(id)) { cyclic.add(id); return 0; }
    onPath.add(id);
    let v = 0;
    for (const p of by.get(id)?.dependsOn ?? []) if (by.has(p)) v = Math.max(v, d(p) + 1);
    onPath.delete(id);
    depth.set(id, v);
    return v;
  };
  for (const n of nodes) d(n.id);
  const out: T[][] = [];
  const tail: T[] = [];
  for (const n of nodes) { if (cyclic.has(n.id)) tail.push(n); else (out[depth.get(n.id)!] ??= []).push(n); }
  const res = out.filter(Boolean);
  if (tail.length) res.push(tail);
  return res;
}

export const NG_CARD_W = 220, NG_HEAD_H = 52, NG_ROW_H = 30, NG_BODY_PAD = 8, NG_LIST_HEAD = 26, NG_LIST_ITEM = 22, NG_GAP_X = 80, NG_GAP_Y = 28, NG_PAD = 40;
export interface Box { x: number; y: number; w: number; h: number }

export function cardSize(n: NgNode, w = NG_CARD_W): { w: number; h: number } {
  let h = NG_HEAD_H;
  if (n.rows.length) h += n.rows.length * NG_ROW_H + NG_BODY_PAD;
  if (n.list) h += NG_LIST_HEAD + n.list.items.length * NG_LIST_ITEM + NG_BODY_PAD;
  return { w, h };
}
export const rowAnchor = (i: number) => NG_HEAD_H + NG_BODY_PAD / 2 + i * NG_ROW_H + NG_ROW_H / 2;

export interface LayoutOpts { cardW?: number; gapX?: number; gapY?: number; pad?: number; align?: 'center' | 'top' }
export interface Placed { boxes: Record<string, Box>; width: number; height: number; cols: string[][] }

export function layoutNodes(nodes: NgNode[], edges: NgEdge[], o: LayoutOpts = {}): Placed {
  if (!nodes.length) return { boxes: {}, width: 0, height: 0, cols: [] };
  const cardW = o.cardW ?? NG_CARD_W, gapX = o.gapX ?? NG_GAP_X, gapY = o.gapY ?? NG_GAP_Y, pad = o.pad ?? NG_PAD;
  const deps = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) if (e.from !== e.to && deps.has(e.from) && deps.has(e.to)) deps.get(e.to)!.push(e.from);
  const cols = layers(nodes.map((n) => ({ id: n.id, dependsOn: deps.get(n.id)! })));
  const size = new Map(nodes.map((n) => [n.id, cardSize(n, cardW)]));
  const colH = cols.map((c) => c.reduce((h, n) => h + size.get(n.id)!.h, 0) + Math.max(0, c.length - 1) * gapY);
  const tallest = Math.max(...colH);
  const boxes: Record<string, Box> = {};
  cols.forEach((c, ci) => {
    let y = pad + (o.align === 'top' ? 0 : (tallest - colH[ci]) / 2);
    for (const n of c) { const s = size.get(n.id)!; boxes[n.id] = { x: pad + ci * (cardW + gapX), y, ...s }; y += s.h + gapY; }
  });
  for (const n of nodes) if (typeof n.x === 'number' && typeof n.y === 'number') boxes[n.id] = { ...boxes[n.id], x: n.x, y: n.y };
  const all = Object.values(boxes);
  return { boxes, width: Math.max(...all.map((b) => b.x + b.w)) + pad, height: Math.max(...all.map((b) => b.y + b.h)) + pad, cols: cols.map((c) => c.map((n) => n.id)) };
}

export function moveBoxes(boxes: Record<string, Box>, offsets: Readonly<Record<string, { dx: number; dy: number }>>): Record<string, Box> {
  const out: Record<string, Box> = {};
  for (const [id, b] of Object.entries(boxes)) { const d = offsets[id]; out[id] = d ? { ...b, x: b.x + d.dx, y: b.y + d.dy } : b; }
  return out;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
export interface EdgeGeom { id: string; d: string; mid: { x: number; y: number }; len: number }

export function edgeGeom(id: string, a: Box, b: Box, row: number | null): EdgeGeom {
  const x1 = a.x + a.w, y1 = a.y + (row === null ? Math.min(a.h, NG_HEAD_H) / 2 : rowAnchor(row));
  const x2 = b.x, y2 = b.y + Math.min(b.h, NG_HEAD_H) / 2;
  // backwards edges (a cycle in a draft, a dragged card) bow out instead of cutting through the cards
  const dx = x2 > x1 ? Math.max(30, (x2 - x1) / 2) : 80;
  const p = [x1, y1, x1 + dx, y1, x2 - dx, y2, x2, y2];
  const at = (t: number) => { const u = 1 - t; const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return { x: k[0] * p[0] + k[1] * p[2] + k[2] * p[4] + k[3] * p[6], y: k[0] * p[1] + k[1] * p[3] + k[2] * p[5] + k[3] * p[7] }; };
  let len = 0, prev = at(0);
  for (let i = 1; i <= 16; i++) { const q = at(i / 16); len += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
  const m = at(0.5);
  return { id, d: `M${r1(p[0])},${r1(p[1])} C${r1(p[2])},${r1(p[3])} ${r1(p[4])},${r1(p[5])} ${r1(p[6])},${r1(p[7])}`, mid: { x: r1(m.x), y: r1(m.y) }, len };
}

export function labelWidth(text: string, fs = 11): number {
  let w = 0;
  for (const ch of text) w += /[\u2E80-\uFFFF]/.test(ch) ? fs : fs * 0.6;
  return Math.round(w + 12);
}
