// 网吧's floor plan (spec docs/superpowers/specs/2026-10-13-cafe-design.md §1): a pure function of the conversation's
// background. The room is COLS tiles along u (to the bottom right) and grows along v (to the bottom left) with the rows
// of seats:
//
//   u  0– 5  service band: the toilet in the back corner, the snack corner along the left wall, the power-bank
//            cabinet, the front desk with the admin behind it, the door at the front
//   u  7–24  rows of seats: a row is 6 desks along u at one v; the desk at v, its chair at v + 1, an aisle after
//   u 26–33  the VIP room behind glass at the back (the background commands' machines), the smoking balcony in front
//
// v 0–2 is the aisle along the back wall (the neon sign, the big screen, the window). Rows start at v = 3 and take 4
// tiles each; after the last one, 4 tiles of front aisle. At least 18 deep, so the service band fits.
import type { BgAgent, BgSession, BgTask } from '@shared';
import type { Facing } from '@characters';
import { tr } from '@/i18n';

export const COLS = 34;
export const SEATS_PER_ROW = 6;
export const MAX_ROWS = 8;
export const MIN_ROWS = 2;
/** A task that ended is kept on the plan this long: its guests walk to the desk, pay and leave. */
export const KEEP_ENDED_MS = 2 * 60_000;
const FIRST_ROW = 3, ROW_STEP = 4, SEAT_U0 = 7, SEAT_STEP = 3, MIN_DEPTH = 18;

export type Use = 'eat' | 'drink' | 'smoke' | 'toilet' | 'power' | 'chat' | 'stand';
export interface Spot { u: number; v: number; facing: Facing; use: Use }
export interface Seat {
  /** `<taskId>/<agent key>` of whoever sits here; undefined: free. */
  key?: string;
  taskId?: string;
  /** 1… across the room. */
  no: number;
  row: number;
  /** The desk's tile (the left one of two); the chair is (u, v + 1). */
  u: number;
  v: number;
  chair: { u: number; v: number };
}
export interface Machine { taskId: string; u: number; v: number }
export interface RowLabel { text: string; u: number; v: number }
export interface Furniture { kind: string; u: number; v: number; w?: number; d?: number }

export interface CafeMap {
  cols: number;
  rows: number;
  /** cols × rows, row by row (index v * cols + u): 1 = a guest can stand there. */
  walk: Uint8Array;
  seats: Seat[];
  spots: Spot[];
  machines: Machine[];
  rowLabels: RowLabel[];
  furniture: Furniture[];
  door: { u: number; v: number };
  /** Where a guest stands to check in / pay. */
  counter: { u: number; v: number };
  /** Behind the counter. */
  admin: { u: number; v: number };
  /** Where the guests who found no seat wait, in order. */
  queue: { u: number; v: number }[];
  /** Guests beyond the last seat. */
  overflow: number;
  full: boolean;
  /** The glass walls (VIP: u 26–33 × v 0–7; the balcony: u 26 from `smoke.v0`, with a door). */
  /** What hangs on the back-right wall, as u ranges: the big screen, the window. */
  wall: { screen: [number, number]; window: [number, number] };
  vip: { u0: number; u1: number; v0: number; v1: number };
  smoke: { u0: number; u1: number; v0: number; v1: number; doorV: number };
}

export const guestKey = (taskId: string, agentKey: string) => `${taskId}/${agentKey}`;

/** Whether a task is on the plan now: running, or ended a little while ago. */
export function present(t: BgTask, now: number): boolean {
  return t.status === 'running' || (t.endedAt ?? 0) > now - KEEP_ENDED_MS;
}

interface Member { a: BgAgent; taskId: string }
interface Group { label: string; agents: Member[] }

/** Who sits together: a workflow's agents by phase (no phase: the workflow's own row), then the single sub-agents. */
function groups(tasks: BgTask[]): Group[] {
  const out: Group[] = [];
  const singles: Group = { label: tr('子代理'), agents: [] };
  for (const t of tasks) {
    if (t.kind === 'workflow') {
      const byPhase = new Map<number, Member[]>();
      for (const a of t.agents) {
        const p = a.phase ?? 0;
        if (!byPhase.has(p)) byPhase.set(p, []);
        byPhase.get(p)!.push({ a, taskId: t.id });
      }
      for (const [p, list] of [...byPhase].sort((a, b) => a[0] - b[0])) {
        const title = t.phases?.find((x) => x.index === p)?.title ?? list[0].a.phaseTitle;
        out.push({ label: title ? `${t.name ?? t.description} · ${title}` : (t.name ?? t.description), agents: list });
      }
    } else if (t.kind === 'agent' || t.kind === 'other') {
      for (const a of t.agents) singles.agents.push({ a, taskId: t.id });
    }
  }
  if (singles.agents.length) out.push(singles);
  return out;
}

export function buildMap(s: BgSession | undefined, now: number): CafeMap {
  const tasks = (s?.tasks ?? []).filter((t) => present(t, now)).sort((a, b) => a.startedAt - b.startedAt);
  const gs = groups(tasks);
  // rows: every group starts a row; a group bigger than a row takes more
  const plan: { group: Group; agents: Member[] }[] = [];
  for (const g of gs) for (let i = 0; i < g.agents.length; i += SEATS_PER_ROW) plan.push({ group: g, agents: g.agents.slice(i, i + SEATS_PER_ROW) });
  const nRows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, plan.length));
  const depth = Math.max(MIN_DEPTH, FIRST_ROW + nRows * ROW_STEP + 4);
  const cols = COLS;
  const walk = new Uint8Array(cols * depth).fill(1);
  const block = (u: number, v: number, w = 1, d = 1) => {
    for (let y = v; y < v + d; y++) for (let x = u; x < u + w; x++) if (x >= 0 && y >= 0 && x < cols && y < depth) walk[y * cols + x] = 0;
  };
  const furniture: Furniture[] = [];
  const spots: Spot[] = [];

  // the toilet in the back corner: a closed room, its door at (3, 1)
  block(0, 0, 3, 3);
  furniture.push({ kind: 'toilet', u: 0, v: 0, w: 3, d: 3 });
  spots.push({ u: 3, v: 1, facing: 'nw', use: 'toilet' });
  // the snack corner along the left wall
  block(0, 4, 1, 2); furniture.push({ kind: 'fridge', u: 0, v: 4, w: 1, d: 2 });
  block(0, 6, 1, 2); furniture.push({ kind: 'noodles', u: 0, v: 6, w: 1, d: 2 });
  block(2, 6, 1, 1); furniture.push({ kind: 'table', u: 2, v: 6 });
  spots.push({ u: 1, v: 4, facing: 'sw', use: 'drink' }, { u: 3, v: 6, facing: 'nw', use: 'eat' }, { u: 2, v: 7, facing: 'ne', use: 'eat' }, { u: 1, v: 6, facing: 'sw', use: 'eat' });
  // front: the power-bank cabinet, the desk, the door
  const front = depth - 1;
  const powerV = front - 8;
  block(0, powerV, 1, 2); furniture.push({ kind: 'power', u: 0, v: powerV, w: 1, d: 2 });
  spots.push({ u: 1, v: powerV, facing: 'sw', use: 'power' });
  const deskV = front - 5;
  block(1, deskV, 2, 3); furniture.push({ kind: 'counter', u: 1, v: deskV, w: 2, d: 3 });
  const admin = { u: 0, v: deskV + 1 };
  const counter = { u: 3, v: deskV + 1 };
  const door = { u: 2, v: front };
  const queue = [{ u: 4, v: front - 1 }, { u: 5, v: front - 1 }, { u: 6, v: front - 1 }, { u: 4, v: front }, { u: 5, v: front }, { u: 6, v: front }];
  // the back wall's aisle: guests stop to look at the big screen / out of the window
  spots.push({ u: 11, v: 1, facing: 'ne', use: 'stand' }, { u: 20, v: 1, facing: 'ne', use: 'stand' });

  // seats
  const seats: Seat[] = [];
  const rowLabels: RowLabel[] = [];
  let no = 1;
  let overflow = 0;
  for (let r = 0; r < nRows; r++) {
    const p = plan[r];
    const v = FIRST_ROW + r * ROW_STEP;
    if (p) rowLabels.push({ text: p.group.label, u: SEAT_U0 - 1, v });
    for (let k = 0; k < SEATS_PER_ROW; k++) {
      const u = SEAT_U0 + k * SEAT_STEP;
      const m = p?.agents[k];
      block(u, v, 2, 1);
      seats.push({ ...(m ? { key: guestKey(m.taskId, m.a.key), taskId: m.taskId } : {}), no: no++, row: r, u, v, chair: { u, v: v + 1 } });
    }
    // a pair of chat spots in the aisle after the row
    spots.push({ u: SEAT_U0 + 7, v: v + 2, facing: 'se', use: 'chat' }, { u: SEAT_U0 + 8, v: v + 2, facing: 'sw', use: 'chat' });
  }
  for (const p of plan.slice(nRows)) overflow += p.agents.length;

  // the VIP room (no one walks in) and its machines; the smoking balcony with a glass wall and a door
  const vip = { u0: 26, u1: 33, v0: 0, v1: 7 };
  block(vip.u0, vip.v0, vip.u1 - vip.u0 + 1, vip.v1 - vip.v0 + 1);
  const machines: Machine[] = tasks.filter((t) => t.kind === 'shell').slice(0, 8).map((t, i) => ({ taskId: t.id, u: 27 + (i % 4) * 2, v: i < 4 ? 2 : 5 }));
  const smoke = { u0: 27, u1: 33, v0: front - 6, v1: front, doorV: front - 3 };
  for (let v = smoke.v0; v <= smoke.v1; v++) if (v !== smoke.doorV) block(26, v);
  spots.push({ u: 29, v: front - 3, facing: 'sw', use: 'smoke' }, { u: 31, v: front - 4, facing: 'sw', use: 'smoke' }, { u: 30, v: front - 1, facing: 'ne', use: 'smoke' });
  furniture.push({ kind: 'fan', u: 32, v: smoke.v0 });

  return { cols, rows: depth, walk, seats, spots, machines, rowLabels, furniture, door, counter, admin, queue, overflow, full: overflow > 0, vip, smoke, wall: { screen: [9, 15], window: [17, 24] } };
}

export const walkable = (m: CafeMap, u: number, v: number) => u >= 0 && v >= 0 && u < m.cols && v < m.rows && m.walk[v * m.cols + u] === 1;

/** The seat of a guest, if it has one. */
export const seatOf = (m: CafeMap, key: string) => m.seats.find((s) => s.key === key);
