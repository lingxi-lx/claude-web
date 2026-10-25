// spec D1: zoom (wheel / − + / fit), the entrance timetable, and when not to animate (reduced motion, >150 cards).
export interface View { scale: number; x: number; y: number }
export interface Size { w: number; h: number }
export const NG_ZOOM = { min: 0.25, max: 2.5, step: 1.2 } as const;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function fitView(content: Size, box: Size, o: { max?: number; pad?: number } = {}): View {
  const max = o.max ?? 1.25, pad = o.pad ?? 16;
  if (content.w <= 0 || content.h <= 0 || box.w <= 0 || box.h <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = clamp(Math.min((box.w - 2 * pad) / content.w, (box.h - 2 * pad) / content.h), NG_ZOOM.min, max);
  return { scale, x: (box.w - content.w * scale) / 2, y: (box.h - content.h * scale) / 2 };
}
export function zoomAt(v: View, scale: number, p: { x: number; y: number }): View {
  const s = clamp(scale, NG_ZOOM.min, NG_ZOOM.max), k = s / v.scale;
  return { scale: s, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k };
}
export const zoomBy = (v: View, dir: 1 | -1, box: Size): View => zoomAt(v, dir > 0 ? v.scale * NG_ZOOM.step : v.scale / NG_ZOOM.step, { x: box.w / 2, y: box.h / 2 });
export const pct = (scale: number) => `${Math.round(scale * 100)}%`;

export const NG_ANIMATE_MAX = 150;
export const motionOn = (count: number, reduced: boolean) => !reduced && count <= NG_ANIMATE_MAX;
export const NG_CARD_STAGGER = 90, NG_CARD_IN = 320, NG_EDGE_STAGGER = 40, NG_EDGE_IN = 420;
export function entranceTimes(cards: number, edges: number) {
  const card = (i: number) => Math.min(i * NG_CARD_STAGGER, 1500);
  const edgesAt = cards ? card(cards - 1) + Math.round(NG_CARD_IN * 0.6) : 0;
  const edge = (i: number) => edgesAt + Math.min(i * NG_EDGE_STAGGER, 800);
  const total = edges ? edge(edges - 1) + NG_EDGE_IN : cards ? card(cards - 1) + NG_CARD_IN : 0;
  return { card, edge, total };
}
