import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import type { NgEdge, NgNode } from './schema';
import { layoutNodes, type LayoutOpts } from './layout';
import { fitHeight, type FitOpts } from './viewport';
// review D4 / D5: a graph in a column (a chat reply, the orchestra panel) is as tall as the column's width lets it be
// drawn — the scale from the width, the height from that scale — so there is no empty band under the cards.

type ColumnFit = Required<Pick<FitOpts, 'min' | 'max' | 'pad' | 'top' | 'bottom'>> & { lo: number; hi: number };

/** the element's width, measured before paint and kept up to date (0 while hidden) */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** the canvas height for the column `ref`, and the `fit` to hand to the node graph (start at the top left below `min`) */
export function useColumnFit(ref: RefObject<HTMLElement | null>, nodes: NgNode[], edges: NgEdge[], o: ColumnFit, layout: LayoutOpts = {}): { height: number; fit: FitOpts } {
  const w = useWidth(ref);
  const { cardW, align } = layout;
  const placed = useMemo(() => layoutNodes(nodes, edges, { cardW, align }), [nodes, edges, cardW, align]);
  const height = w > 0 ? fitHeight({ w: placed.width, h: placed.height }, w, o).height : o.lo;
  const fit = useMemo<FitOpts>(() => ({ min: o.min, max: o.max, pad: o.pad, top: o.top, bottom: o.bottom, start: true }), [o.min, o.max, o.pad, o.top, o.bottom]);
  return { height, fit };
}
