// 后台's office (spec docs/superpowers/specs/2026-10-12-background-office-design.md §3): where every desk, the wall
// screen, the door and the machines go — a pure function of the tasks. Office.tsx only draws what this returns.
//
// The room is isometric (2:1). Floor coordinates: `u` runs along the back-left wall (the screen's) from the back
// corner towards the left corner, `v` along the back-right wall (the door's) from the back corner towards the right
// corner; one unit is 40 × 20 px. Rows of desks run parallel to the screen wall — one row per workflow phase, then one
// 「子代理」 row — each a little further from it; a row's first desk is on the left. The strip along the door wall
// (u < AISLE) is the aisle: the background commands' machines at its back, the door and the queue at its front.
import type { BgTask } from '@shared';

export interface Pt { x: number; y: number }
export interface DeskSpot { key: string; taskId: string; x: number; y: number; row: number; kind: 'agent' | 'shell' }
export interface OfficeRoom {
  /** The floor's corners: the back corner (where the two walls meet), left, right, front. */
  top: Pt; left: Pt; right: Pt; bottom: Pt;
  /** The walls' height, px. */
  wall: number;
  /** Floor tiles: lines parallel to the walls. */
  grid: [Pt, Pt][];
}
export interface OfficeLayout {
  /** The SVG's viewBox: `0 0 width height`. */
  width: number;
  height: number;
  /** The wall screen (the main conversation): its lower-left corner on the screen wall; it is `w` px wide and rises
   *  w/2 over that (it lies on the wall), `h` px tall. */
  screen: { x: number; y: number; w: number; h: number };
  /** The middle of the door's threshold on the door wall. */
  door: Pt;
  /** A row's label: the end of the text (it reads leftwards from here, `text-anchor: end`). */
  rows: { label: string; y: number; x: number }[];
  /** An agent's desk (`x, y` = the desk's left corner, see `seatOf`), or a background command's machine (its base). */
  desks: DeskSpot[];
  /** 「还有 N 个」: where the sign stands, after the last desk of a row that had more agents than desks. */
  overflow: { row: number; more: number; x: number; y: number }[];
  room: OfficeRoom;
}

/** One floor unit on screen. */
export const UX = 40, UY = 20;
/** The aisle along the door wall, in floor units. */
export const AISLE = 3;
/** Between two desks in a line, and between two lines of a row. */
const STEP = 2;
/** Extra depth between two rows. */
const ROW_GAP = 0.7;
/** The first line's distance from the screen wall. */
const FIRST_V = 1.3;
const WALL = 84;
const MIN_SLOTS = 3;
const MIN_DEPTH = 5.5;
/** The screen: 4 units along its wall, mounted this high. */
const SCREEN_UNITS = 4, SCREEN_Z = 28, SCREEN_H = 46;
const MARGIN = { left: 24, right: 28, top: 18, bottom: 34 };
/** Row labels: their font size, and how wide (in clip units: a CJK character is two) they may be. */
export const ROW_FONT = 12, ROW_LABEL_UNITS = 28;
/** Where a character sits, from its desk's left corner (in front of the desk). */
const SEAT = { x: 30, y: 40 };
/** The queue at the door, nearest first: [u, v − the door's v]. */
const QUEUE: [number, number][] = [[0.9, 0], [0.9, -0.9], [0.9, 0.9], [1.8, -0.45], [1.8, 0.45], [1.8, -1.35], [1.8, 1.35], [2.7, 0], [2.7, -0.9]];
export const QUEUE_SPOTS = QUEUE.length;

const cjk = (ch: string) => (ch.codePointAt(0) ?? 0) >= 0x2e80;

/** How wide a text is, px, at `size` (an estimate: a CJK character is a square, Latin about 0.58 em). */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += cjk(ch) ? size : size * 0.58;
  return w;
}

/** `s` cut to `units` of display width (a CJK character is two), with an ellipsis when it was cut. */
export function clip(s: string, units: number): string {
  let w = 0;
  for (const ch of s) w += cjk(ch) ? 2 : 1;
  if (w <= units) return s;
  let out = '';
  w = 0;
  for (const ch of s) {
    const c = cjk(ch) ? 2 : 1;
    if (w + c + 1 > units) break;
    out += ch;
    w += c;
  }
  return out + '…';
}

export interface OfficeRow { label: string; items: { key: string; taskId: string }[] }

/** The rows of desks, in order: each workflow's phases (in phase order; its agents with no phase in a row named after
 *  it), then the sub-agents. Empty phases take no row. */
export function officeRows(tasks: BgTask[]): OfficeRow[] {
  const flows = tasks.filter((t) => t.kind === 'workflow' && t.agents.length);
  const rows: OfficeRow[] = [];
  for (const t of flows) {
    const name = t.name || t.description || '工作流';
    const titles = new Map<number, string>();
    for (const p of t.phases ?? []) titles.set(p.index, p.title);
    for (const a of t.agents) if (a.phase != null && !titles.get(a.phase)) titles.set(a.phase, a.phaseTitle ?? '');
    const named = (title: string) => (flows.length > 1 ? `${name} · ${title}` : title);
    for (const p of [...titles.keys()].sort((a, b) => a - b)) {
      const items = t.agents.filter((a) => a.phase === p).map((a) => ({ key: a.key, taskId: t.id }));
      if (items.length) rows.push({ label: named(titles.get(p) || `阶段 ${p + 1}`), items });
    }
    const loose = t.agents.filter((a) => a.phase == null).map((a) => ({ key: a.key, taskId: t.id }));
    if (loose.length) rows.push({ label: name, items: loose });
  }
  const subs = tasks.filter((t) => t.kind === 'agent').flatMap((t) => t.agents.map((a) => ({ key: a.key, taskId: t.id })));
  if (subs.length) rows.push({ label: '子代理', items: subs });
  return rows;
}

export function layoutOffice(tasks: BgTask[], o: { perRow?: number; maxPerPhase?: number } = {}): OfficeLayout {
  const perRow = Math.max(1, Math.floor(o.perRow ?? 6));
  const maxPerPhase = Math.max(1, Math.floor(o.maxPerPhase ?? 24));

  // rows → lines of desks (floor units first; screen points once the room's size is known)
  const rows = officeRows(tasks).map((r) => {
    const shown = r.items.slice(0, maxPerPhase);
    const lines: (typeof shown)[] = [];
    for (let i = 0; i < shown.length; i += perRow) lines.push(shown.slice(i, i + perRow));
    return { label: r.label, lines, more: r.items.length - shown.length };
  });
  const longest = Math.max(MIN_SLOTS, ...rows.flatMap((r) => r.lines.map((l) => l.length)));
  // a sign after a full last line needs one more slot
  const slots = longest + (rows.some((r) => r.more > 0 && r.lines[r.lines.length - 1].length >= longest) ? 1 : 0);
  const u0 = AISLE + 2 + STEP * (slots - 1); // the first (leftmost) slot's left corner
  const U = u0 + 1.6;

  type Placed = { key: string; taskId: string; u: number; v: number; row: number };
  const placed: Placed[] = [];
  const rowAt: { label: string; v: number }[] = [];
  const signs: { row: number; more: number; u: number; v: number }[] = [];
  let v = FIRST_V, lastLine = 0;
  rows.forEach((r, ri) => {
    rowAt.push({ label: r.label, v });
    r.lines.forEach((line) => {
      line.forEach((it, i) => placed.push({ key: it.key, taskId: it.taskId, u: u0 - STEP * i, v, row: ri }));
      lastLine = v;
      v += STEP;
    });
    if (r.more > 0) signs.push({ row: ri, more: r.more, u: u0 - STEP * r.lines[r.lines.length - 1].length + 0.4, v: lastLine + 1.2 });
    v += ROW_GAP;
  });

  // the machines: two columns at the back of the aisle
  const shells = tasks.filter((t) => t.kind === 'shell');
  const machines = shells.map((t, k) => ({ key: t.id, taskId: t.id, u: 0.95 + (k % 2) * 1.15, v: 0.9 + Math.floor(k / 2) * 1.45 }));
  const lastMachine = machines.length ? machines[machines.length - 1].v : -Infinity;

  const V = Math.max(MIN_DEPTH, rows.length ? lastLine + 2.6 : 0, lastMachine + 3.9);
  const doorV = V - 1.9;

  // the screen: centred over the desks, on the screen wall
  const uc = (AISLE + 1 + u0) / 2;
  const screenU = uc + SCREEN_UNITS / 2;

  // the left margin makes room for the longest row label (they read leftwards from the left end of their row)
  const left = Math.max(MARGIN.left, ...rowAt.map((r) => Math.ceil(textWidth(clip(r.label, ROW_LABEL_UNITS), ROW_FONT) + 6 - UX * (U - u0 - 1.25 + r.v + 0.35))));
  const T = { x: left + UX * U, y: MARGIN.top + WALL };
  const pt = (u: number, w: number): Pt => ({ x: T.x - UX * u + UX * w, y: T.y + UY * u + UY * w });

  const grid: [Pt, Pt][] = [];
  for (let k = STEP; k < U - 0.3; k += STEP) grid.push([pt(k, 0), pt(k, V)]);
  for (let k = STEP; k < V - 0.3; k += STEP) grid.push([pt(0, k), pt(U, k)]);

  const screenAt = pt(screenU, 0);
  return {
    width: Math.ceil(left + UX * (U + V) + MARGIN.right),
    height: Math.ceil(T.y + UY * (U + V) + MARGIN.bottom),
    screen: { x: screenAt.x, y: screenAt.y - SCREEN_Z, w: UX * SCREEN_UNITS, h: SCREEN_H },
    door: pt(0, doorV),
    rows: rowAt.map((r) => ({ label: r.label, ...pt(u0 + 1.25, r.v + 0.35) })),
    desks: [
      ...placed.map((p) => ({ key: p.key, taskId: p.taskId, row: p.row, kind: 'agent' as const, ...pt(p.u, p.v) })),
      ...machines.map((m) => ({ key: m.key, taskId: m.taskId, row: -1, kind: 'shell' as const, ...pt(m.u, m.v) })),
    ],
    overflow: signs.map((s) => ({ row: s.row, more: s.more, ...pt(s.u, s.v) })),
    room: { top: T, left: pt(U, 0), right: pt(0, V), bottom: pt(U, V), wall: WALL, grid },
  };
}

/** Where an agent's character sits at its desk (in front of it); a machine stands on its own spot. */
export function seatOf(d: DeskSpot): Pt {
  return d.kind === 'agent' ? { x: d.x + SEAT.x, y: d.y + SEAT.y } : { x: d.x, y: d.y };
}

/** Where the `i`th queued agent stands, inside the door; past the last spot they share it. */
export function queueSpot(l: OfficeLayout, i: number): Pt {
  const [u, dv] = QUEUE[Math.min(Math.max(0, i), QUEUE.length - 1)];
  return { x: l.door.x - UX * u + UX * dv, y: l.door.y + UY * u + UY * dv };
}

/**
 * A desk monitor's bars: the agent's tool calls (`beats`, ms) in the last `windowMs` before `now`, in `bars` buckets
 * (oldest first), each 0…1. Three calls in a bucket fill it; more scale the rest down.
 */
export function monitorBars(beats: number[], now: number, bars = 6, windowMs = 120_000): number[] {
  const out: number[] = new Array(bars).fill(0);
  const from = now - windowMs, w = windowMs / bars;
  for (const b of beats) if (b > from && b <= now) out[Math.min(bars - 1, Math.floor((b - from) / w))]++;
  const top = Math.max(3, ...out);
  return out.map((n) => n / top);
}

/** A picture point back to floor units (the inverse of the projection; for tests and hit maths). */
export function toFloor(l: OfficeLayout, p: Pt): { u: number; v: number } {
  const a = (p.x - l.room.top.x) / UX, b = (p.y - l.room.top.y) / UY;
  return { u: (b - a) / 2, v: (b + a) / 2 };
}
