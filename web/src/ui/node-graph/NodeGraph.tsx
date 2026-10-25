import './node-graph.css';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Select } from '@/ui/Select';
import { Icon, ICON_NAMES, type IconName } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import { wheelZoom } from '@/ui/wheel-zoom';
import { clsx } from '@/util';
import { tr } from '@/i18n';
import type { NodeGraphProps } from './types';
import type { NgNode } from './schema';
import { badgeView, edgeStyles, pickKey, pulses } from './marks';
import { edgeGeom, labelWidth, layoutNodes, moveBoxes, NG_BODY_PAD, NG_CARD_W, NG_HEAD_H, NG_LIST_HEAD, NG_LIST_ITEM, NG_ROW_H } from './layout';
import { entranceTimes, fitView, motionOn, NG_ZOOM, pct, zoomAt, zoomBy, type View } from './viewport';
import { useReducedMotion } from './motion';
// spec 2026-10-24 D1: the shared node graph — HTML cards (dropdowns, ellipsis, Tab focus) over one SVG layer of edges
// (glow, travelling dots, labels), in one transformed layer. Drag cards, drag the canvas, wheel / − + / fit zoom,
// double-click empty space to reset. Nothing here is saved (spec :409). Reads no store.

const EMPTY: Readonly<Record<string, string>> = {};
type Offsets = Record<string, { dx: number; dy: number }>;
interface Drag { kind: 'card' | 'pan'; id?: string; sx: number; sy: number; bx: number; by: number; moved: boolean; px: number; py: number }

function CardIcon({ n }: { n: NgNode }) {
  if (n.icon && (ICON_NAMES as string[]).includes(n.icon)) return <span className="ng-ic"><Icon name={n.icon as IconName} size={14} /></span>;
  if (n.icon && [...n.icon].length <= 2) return <span className="ng-ic">{n.icon}</span>;
  return <span className="ng-ic">{[...n.title][0]?.toUpperCase() ?? ''}</span>;
}

export function NodeGraph({ graph, ariaLabel, height = 360, cardW = NG_CARD_W, align = 'center', compact, entrance, selected, onSelect, canSelect, picks, onPick, className }: NodeGraphProps) {
  const placed = useMemo(() => layoutNodes(graph.nodes, graph.edges, { cardW, align }), [graph, cardW, align]);
  const [offsets, setOffsets] = useState<Offsets>({});
  const boxes = useMemo(() => moveBoxes(placed.boxes, offsets), [placed, offsets]);
  const styles = useMemo(() => edgeStyles(graph, picks ?? EMPTY), [graph, picks]);
  const badge = useMemo(() => badgeView(graph.badge, styles), [graph.badge, styles]);
  const rowIdx = useMemo(() => new Map(graph.nodes.map((n) => [n.id, new Map(n.rows.map((r, i) => [r.id, i]))])), [graph]);
  const geoms = useMemo(() => graph.edges.flatMap((e) => {
    const a = boxes[e.from], b = boxes[e.to];
    if (!a || !b) return [];
    const ri = e.fromRow ? rowIdx.get(e.from)?.get(e.fromRow) : undefined;
    return [{ e, g: edgeGeom(e.id, a, b, ri ?? null) }];
  }), [graph.edges, boxes, rowIdx]);
  const reduced = useReducedMotion();
  const motion = motionOn(graph.nodes.length, reduced);
  const nodeKey = useMemo(() => graph.nodes.map((n) => n.id).join('\n'), [graph]);

  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [box, setBox] = useState({ w: 0, h: 0 });
  const boxRef = useRef(box);
  boxRef.current = box;
  const touched = useRef(false);
  const fittedKey = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const [panning, setPanning] = useState(false);
  const [playing, setPlaying] = useState(() => !!entrance && motion);
  const times = useMemo(() => entranceTimes(graph.nodes.length, graph.edges.length), [graph.nodes.length, graph.edges.length]);
  const selectable = (id: string) => !!onSelect && (canSelect ? canSelect(id) : true);

  // size: a hidden panel measures 0 — do nothing until it has one
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setBox((b) => (b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height })); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // fit: the first time there is a size, or when the cards change and the user has not zoomed / panned yet.
  // D2 / D3 pass a new graph object every second — nodeKey keeps that from refitting.
  useEffect(() => {
    if (box.w <= 0 || box.h <= 0) return;
    if (fittedKey.current !== null && (fittedKey.current === nodeKey || touched.current)) return;
    fittedKey.current = nodeKey;
    setView(fitView({ w: placed.width, h: placed.height }, box));
  }, [box, nodeKey, placed.width, placed.height]);

  // dragged offsets survive a new graph object, but only for cards that still exist
  useEffect(() => {
    const ids = new Set(nodeKey.split('\n'));
    setOffsets((o) => { const keys = Object.keys(o); if (keys.every((k) => ids.has(k))) return o; const next: Offsets = {}; for (const k of keys) if (ids.has(k)) next[k] = o[k]; return next; });
  }, [nodeKey]);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setPlaying(false), times.total + 50);
    return () => clearTimeout(t);
  }, [playing, times.total]);

  // the wheel: non-passive (React's onWheel is passive), the shared A3 rule — Shift / at the limit → the page scrolls
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      const v = viewRef.current;
      const next = wheelZoom(v.scale, e, NG_ZOOM);
      if (next === null) return;
      e.preventDefault();
      touched.current = true;
      const r = el.getBoundingClientRect();
      setView(zoomAt(v, next, { x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const refit = () => {
    touched.current = false;
    fittedKey.current = nodeKey;
    setOffsets({});
    if (boxRef.current.w > 0 && boxRef.current.h > 0) setView(fitView({ w: placed.width, h: placed.height }, boxRef.current));
  };

  const apply = () => {
    frame.current = 0;
    const d = drag.current;
    if (!d) return;
    const dx = d.px - d.sx, dy = d.py - d.sy;
    if (!d.moved && Math.hypot(dx, dy) <= 4) return;
    if (!d.moved) { d.moved = true; touched.current = true; if (d.kind === 'pan') setPanning(true); }
    if (d.kind === 'card' && d.id) {
      const s = viewRef.current.scale, id = d.id;
      setOffsets((o) => ({ ...o, [id]: { dx: d.bx + dx / s, dy: d.by + dy / s } }));
    } else {
      setView((v) => ({ ...v, x: d.bx + dx, y: d.by + dy }));
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('.select-trigger, button, a, input, select, textarea, .select-popover')) return;
    const card = t.closest<HTMLElement>('.ng-card');
    const id = card?.dataset.node;
    if (id) {
      const o = offsets[id] ?? { dx: 0, dy: 0 };
      drag.current = { kind: 'card', id, sx: e.clientX, sy: e.clientY, bx: o.dx, by: o.dy, moved: false, px: e.clientX, py: e.clientY };
    } else {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, bx: view.x, by: view.y, moved: false, px: e.clientX, py: e.clientY };
    }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.px = e.clientX; d.py = e.clientY;
    if (!frame.current) frame.current = requestAnimationFrame(apply);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
    d.px = e.clientX; d.py = e.clientY;
    apply();
    drag.current = null;
    setPanning(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    // pointerup, not onClick: the end of a drag never selects
    if (!d.moved && d.kind === 'card' && d.id && selectable(d.id)) onSelect!(d.id);
  };
  const onPointerCancel = () => { drag.current = null; setPanning(false); };

  const onViewportKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (imeComposing(e.nativeEvent) || e.target !== e.currentTarget) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); touched.current = true; setView((v) => zoomBy(v, 1, boxRef.current)); }
    else if (e.key === '-') { e.preventDefault(); touched.current = true; setView((v) => zoomBy(v, -1, boxRef.current)); }
    else if (e.key === '0') { e.preventDefault(); refit(); }
  };
  const onCardKey = (id: string) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (imeComposing(e.nativeEvent) || e.target !== e.currentTarget) return;
    if ((e.key === 'Enter' || e.key === ' ') && selectable(id)) { e.preventDefault(); onSelect!(id); }
  };
  const zoomButton = (dir: 1 | -1) => { touched.current = true; setView((v) => zoomBy(v, dir, boxRef.current)); };

  const rootStyle = {
    height,
    backgroundPosition: `${view.x}px ${view.y}px`,
    backgroundSize: `${18 * view.scale}px ${18 * view.scale}px`,
    '--ng-head-h': `${NG_HEAD_H}px`, '--ng-row-h': `${NG_ROW_H}px`, '--ng-body-pad': `${NG_BODY_PAD}px`, '--ng-list-head': `${NG_LIST_HEAD}px`, '--ng-list-item': `${NG_LIST_ITEM}px`,
  } as CSSProperties;

  return (
    <div ref={rootRef} className={clsx('ng', compact && 'compact', className)} data-motion={motion ? 'on' : 'off'} role="group" aria-label={ariaLabel} style={rootStyle}>
      {(graph.title || graph.subtitle) && (
        <div className="ng-head">
          {graph.title && <div className="ng-title">{graph.title}</div>}
          {graph.subtitle && <div className="ng-sub">{graph.subtitle}</div>}
        </div>
      )}
      {badge && <div className="ng-badge" data-tone={badge.tone} role="status" aria-live="polite">{badge.text}</div>}
      <div ref={vpRef} className={clsx('ng-viewport', panning && 'panning')} tabIndex={0} aria-label={tr('节点图')} title={tr('拖动画布平移，滚轮缩放，双击空白恢复布局')}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onKeyDown={onViewportKey}
        onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('.ng-card')) refit(); }}>
        <div className="ng-layer" style={{ width: placed.width, height: placed.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <svg className="ng-edges" width={placed.width} height={placed.height} aria-hidden="true">
            {geoms.map(({ e, g }, i) => {
              const st = styles[e.id] ?? e.style;
              const glow = st === 'strong' || st === 'error';
              const lw = e.label ? labelWidth(e.label) : 0;
              return (
                <g key={e.id} className={clsx('ng-edge', playing && 'ng-in')} data-edge={e.id} data-style={st}
                  style={{ '--len': Math.ceil(g.len), animationDelay: playing ? `${times.edge(i)}ms` : undefined } as CSSProperties}>
                  {glow && <path className="ng-glow" d={g.d} />}
                  <path className="ng-line" d={g.d} />
                  {motion && pulses(e, st) && (
                    <circle className="ng-pulse" r={3.5}>
                      <animateMotion dur={`${Math.max(1.2, g.len / 140).toFixed(2)}s`} repeatCount="indefinite" path={g.d} />
                    </circle>
                  )}
                  {e.label && (
                    <g className="ng-label">
                      <rect x={g.mid.x - lw / 2} y={g.mid.y - 9} width={lw} height={18} rx={9} />
                      <text x={g.mid.x} y={g.mid.y} textAnchor="middle" dy="0.35em">{e.label}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          {graph.nodes.map((n, i) => {
            const b = boxes[n.id];
            if (!b) return null;
            const can = selectable(n.id);
            return (
              <div key={n.id} className={clsx('ng-card', playing && 'ng-in', selected === n.id && 'sel')} data-node={n.id} data-state={n.state}
                tabIndex={0} role={can ? 'button' : 'group'} aria-label={n.title} title={n.tip} onKeyDown={onCardKey(n.id)}
                style={{ left: b.x, top: b.y, width: b.w, height: b.h, '--c': n.accent, animationDelay: playing ? `${times.card(i)}ms` : undefined } as CSSProperties}>
                <div className="ng-card-h">
                  <CardIcon n={n} />
                  <div className="ng-tx">
                    <div className="ng-t">{n.title}</div>
                    {n.subtitle && <div className="ng-s">{n.subtitle}</div>}
                  </div>
                </div>
                {n.rows.length > 0 && (
                  <div className="ng-rows">
                    {n.rows.map((r) => {
                      const key = pickKey(n.id, r.id);
                      return (
                        <div key={r.id} className="ng-row" data-row={r.id}>
                          <span className="k">{r.label}</span>
                          {onPick && r.options.length
                            ? <Select className="ng-sel" value={picks?.[key] ?? r.value} options={r.options.map((o) => ({ value: o.value, label: o.label }))} onValueChange={(v) => onPick(key, String(v))} label={r.label} />
                            : <span className="v">{r.value}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
                {n.list && (
                  <div className="ng-list">
                    <div className="ng-list-h">{n.list.title}</div>
                    {n.list.items.map((it, k) => (
                      <div key={k} className="ng-li"><span>{it.text}</span>{it.tags.map((t, m) => <span key={m} className="ng-tag">{t}</span>)}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="ng-zoom">
        <button type="button" className="ng-zoom-out" aria-label={tr('缩小')} title={tr('缩小')} onClick={() => zoomButton(-1)}><Icon name="minus" size={14} /></button>
        <span className="ng-zoom-pct">{pct(view.scale)}</span>
        <button type="button" className="ng-zoom-in" aria-label={tr('放大')} title={tr('放大')} onClick={() => zoomButton(1)}><Icon name="plus" size={14} /></button>
        <button type="button" className="ng-fit" aria-label={tr('适应窗口')} title={tr('适应窗口')} onClick={refit}><Icon name="frame" size={14} /></button>
      </div>
    </div>
  );
}
