// 网吧's people (spec docs/superpowers/specs/2026-10-13-cafe-design.md §2): one actor per guest (a sub-agent) and the
// admin (the main conversation). A pure step function — the world in, a new world out — fed the conversation's
// background snapshot and the time; its randomness comes from a seeded generator kept in the world, so a test replays
// a run exactly.
//
// A guest: arrives at the door → walks to the counter → checks in → walks to its seat → works while its agent works;
// with nothing to do it picks something (noodles, a drink, a game at its seat, the toilet, a smoke, a power bank, a
// chat, a look at the big screen) for 5–20 s and comes back the moment there is work → when it is done it walks to the
// counter, pays (a receipt), and leaves through the door. A guest whose agent vanished from the snapshot (a reconnect)
// waits where it is; after 30 s it is gone, without paying.
import type { BgAgent, BgSession, BgTask } from '@shared';
import type { Facing, Pose } from '@characters';
import { buildMap, guestKey, type CafeMap, type Spot, type Use } from './map';
import { findPath, type Tile } from './path';
import { estimateUsd, fee } from './money';

export type Doing =
  | 'toDesk' | 'checkin' | 'toSeat' | 'work' | 'game' | 'toActivity' | 'activity' | 'bsod'
  | 'toCheckout' | 'checkout' | 'leave' | 'wait' | 'patrol' | 'home';
export type Screen = 'off' | 'code' | 'game' | 'bsod';

export interface Receipt {
  key: string;
  name: string;
  seat: number;
  ms: number;
  fee: number;
  tokens?: number;
  usd?: number;
  kind: 'ok' | 'failed' | 'stopped';
  at: number;
}

export interface Actor {
  key: string;
  taskId: string;
  agentKey: string;
  name: string;
  color: number;
  type?: string;
  u: number;
  v: number;
  facing: Facing;
  pose: Pose;
  doing: Doing;
  path: Tile[];
  /** When a timed thing (check-in, an activity, paying, the blue screen) ends. */
  until: number;
  activity?: Use | 'game';
  /** In the toilet: not drawn. */
  hidden?: boolean;
  bubble?: { text: string; until: number };
  screen: Screen;
  seat?: number;
  /** The agent's last summary seen: a new one is a bubble. */
  said?: string;
  missingSince?: number;
  /** Set when it decided to leave: how. */
  leaving?: Receipt['kind'];
}

export interface World {
  t: number;
  born: number;
  rng: number;
  map: CafeMap;
  mapOf?: BgSession;
  mapAt: number;
  actors: Actor[];
  admin: Actor;
  receipts: Receipt[];
  shout?: { text: string; until: number };
  nextShout: number;
  nextPatrol: number;
  /** Times the till went ding (the renderer plays the coin and, with 声音 on, the sound). */
  dings: number[];
}

export interface StepOpts {
  rate: number;
  mainBusy: boolean;
  reduced: boolean;
}

/** Tiles a second. */
export const SPEED = 4;
export const WORK_FRESH_MS = 20_000;
export const MISSING_MS = 30_000;
export const CHECKIN_MS = 1500;
export const PAY_MS = 2000;
export const BSOD_MS = 2000;
export const MAX_RECEIPTS = 50;
const BUBBLE_MS = 3000;

/** mulberry32: the next state and a number in [0, 1). */
function rand(w: World): number {
  let t = (w.rng = (w.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (w: World, a: number, b: number) => a + rand(w) * (b - a);
const pick = <T,>(w: World, list: T[]): T => list[Math.floor(rand(w) * list.length)];

export function createWorld(seed: number, now: number): World {
  const map = buildMap(undefined, now);
  return {
    t: now, born: now, rng: seed | 0, map, mapAt: now, actors: [], receipts: [], dings: [],
    admin: { key: 'admin', taskId: '', agentKey: '', name: '网管', color: 0, u: map.admin.u, v: map.admin.v, facing: 'se', pose: 'stand', doing: 'home', path: [], until: 0, screen: 'off' },
    nextShout: now + 20_000, nextPatrol: now + 25_000,
  };
}

const SHOUTS = ['欢迎光临', '谁的泡面没扔', '充电宝记得还', '包间还有空位', '小声点，有人在写代码'];

const terminal = (a: BgAgent) => a.state === 'done' || a.state === 'failed' || a.state === 'stopped';

/** Why a guest goes to pay now, or null: it failed / was stopped; a single sub-agent is done; its workflow ended. */
function leaveKind(t: BgTask, a: BgAgent): Receipt['kind'] | null {
  if (a.state === 'failed') return 'failed';
  if (a.state === 'stopped') return 'stopped';
  if (t.status !== 'running') return t.status === 'failed' ? 'failed' : t.status === 'stopped' ? 'stopped' : 'ok';
  if (t.kind !== 'workflow' && a.state === 'done') return 'ok';
  return null;
}

/** It has something to do right now: its agent runs and has moved lately. */
function working(a: BgAgent, now: number): boolean {
  if (a.state !== 'running') return false;
  const last = Math.max(a.beats.at(-1) ?? 0, a.startedAt ?? 0);
  return now - last < WORK_FRESH_MS;
}

const facingOf = (du: number, dv: number): Facing => (du > 0 ? 'se' : du < 0 ? 'nw' : dv > 0 ? 'sw' : 'ne');

function goTo(w: World, x: Actor, to: Tile, doing: Doing, reduced: boolean) {
  const p = findPath(w.map, [Math.round(x.u), Math.round(x.v)], to);
  x.doing = doing;
  if (!p || reduced) { x.u = to[0]; x.v = to[1]; x.path = []; return; }
  x.path = p.slice(1);
}

/** Walk along the path for dt ms. True when it has arrived. */
function walk(x: Actor, dt: number): boolean {
  let left = (dt / 1000) * SPEED;
  while (left > 0 && x.path.length) {
    const [tu, tv] = x.path[0];
    const du = tu - x.u, dv = tv - x.v;
    const d = Math.abs(du) + Math.abs(dv);
    if (d > 0) x.facing = facingOf(Math.sign(Math.round(du * 1000)), Math.sign(Math.round(dv * 1000)));
    if (d <= left) { x.u = tu; x.v = tv; x.path.shift(); left -= d; } else {
      x.u += (du / d) * left;
      x.v += (dv / d) * left;
      left = 0;
    }
  }
  x.pose = x.path.length ? 'walk' : 'stand';
  return !x.path.length;
}

function freeSpot(w: World, use: Use, me: Actor): Spot | undefined {
  const taken = new Set(w.actors.filter((a) => a !== me && (a.doing === 'activity' || a.doing === 'toActivity')).map((a) => `${a.path.at(-1)?.join(',') ?? `${Math.round(a.u)},${Math.round(a.v)}`}`));
  const list = w.map.spots.filter((s) => s.use === use && !taken.has(`${s.u},${s.v}`));
  return list.length ? pick(w, list) : undefined;
}

const ACTIVITIES: (Use | 'game')[] = ['eat', 'drink', 'game', 'game', 'toilet', 'smoke', 'power', 'chat', 'stand'];

function seatTile(w: World, x: Actor): Tile | undefined {
  const s = w.map.seats.find((y) => y.key === x.key);
  if (!s) return undefined;
  x.seat = s.no;
  return [s.chair.u, s.chair.v];
}

function backToSeat(w: World, x: Actor, reduced: boolean) {
  x.hidden = false;
  x.activity = undefined;
  const t = seatTile(w, x);
  if (t) goTo(w, x, t, 'toSeat', reduced); else x.doing = 'wait';
}

function sitDown(x: Actor, pose: Pose, screen: Screen) {
  x.pose = pose;
  x.screen = screen;
  x.facing = 'ne';
}

function receipt(x: Actor, t: BgTask | undefined, a: BgAgent | undefined, now: number, rate: number): Receipt {
  const started = a?.startedAt ?? t?.startedAt ?? now;
  const ms = Math.max(0, (a?.endedAt ?? t?.endedAt ?? now) - started);
  return { key: x.key, name: x.name, seat: x.seat ?? 0, ms, fee: fee(ms, rate), ...(a?.tokens ? { tokens: a.tokens } : {}), usd: estimateUsd(a?.tokens, a?.model), kind: x.leaving ?? 'ok', at: now };
}

/** Everyone in the snapshot who is on the plan: key → their task and agent. */
function guests(s: BgSession | undefined, m: CafeMap): Map<string, { t: BgTask; a: BgAgent }> {
  const out = new Map<string, { t: BgTask; a: BgAgent }>();
  if (!s) return out;
  const seated = new Set(m.seats.map((x) => x.key).filter(Boolean));
  for (const t of s.tasks) for (const a of t.agents) {
    const k = guestKey(t.id, a.key);
    if (seated.has(k)) out.set(k, { t, a });
  }
  return out;
}

export function step(prev: World, snap: BgSession | undefined, now: number, o: StepOpts): World {
  const w: World = { ...prev, actors: prev.actors.map((a) => ({ ...a, path: [...a.path] })), admin: { ...prev.admin, path: [...prev.admin.path] }, receipts: prev.receipts, dings: prev.dings.filter((d) => now - d < 3000) };
  const dt = Math.max(0, Math.min(250, now - prev.t));
  w.t = now;
  if (snap !== w.mapOf || now - w.mapAt >= 1000) { w.map = buildMap(snap, now); w.mapOf = snap; w.mapAt = now; }
  const g = guests(snap, w.map);
  const byKey = new Map(w.actors.map((a) => [a.key, a]));

  // newcomers: through the door — or, for what was already going on when the cafe was opened, straight at the seat
  for (const [k, { t, a }] of g) {
    // already on its way out when first seen (it came and went before the cafe was looking): never drawn. One that is
    // done while its workflow runs is still in the cafe, waiting for the others
    if (byKey.has(k) || leaveKind(t, a)) continue;
    const seat = w.map.seats.find((s) => s.key === k)!;
    const early = (a.startedAt ?? t.startedAt) < w.born - 2000;
    const x: Actor = {
      key: k, taskId: t.id, agentKey: a.key, name: a.label, color: a.color, ...(a.agentType ? { type: a.agentType } : {}),
      u: early ? seat.chair.u : w.map.door.u, v: early ? seat.chair.v : w.map.door.v, facing: 'ne', pose: 'stand',
      doing: early ? 'toSeat' : 'toDesk', path: [], until: 0, screen: 'off', seat: seat.no, said: a.lastSummary,
    };
    if (!early) goTo(w, x, [w.map.counter.u, w.map.counter.v], 'toDesk', o.reduced);
    w.actors.push(x);
    byKey.set(k, x);
  }

  for (const x of w.actors) {
    const info = g.get(x.key);
    if (!info) {
      if (x.doing === 'leave' || x.doing === 'checkout' || x.doing === 'toCheckout') { /* on its way out: carry on */ } else {
        x.missingSince ??= now;
        if (x.doing !== 'wait') { x.doing = 'wait'; x.path = []; }
        continue;
      }
    } else x.missingSince = undefined;
    const t = info?.t, a = info?.a;
    if (a && a.lastSummary && a.lastSummary !== x.said) {
      x.said = a.lastSummary;
      if (x.doing === 'work') x.bubble = { text: a.lastSummary, until: now + BUBBLE_MS };
    }
    if (x.bubble && x.bubble.until <= now) x.bubble = undefined;
    // time to go?
    const lk = t && a ? leaveKind(t, a) : null;
    if (lk && !x.leaving) {
      x.leaving = lk;
      x.hidden = false;
      const atSeat = x.doing === 'work' || x.doing === 'game';
      if (lk === 'failed' && atSeat) { x.doing = 'bsod'; x.screen = 'bsod'; x.until = now + BSOD_MS; x.path = []; } else {
        x.screen = 'off';
        goTo(w, x, [w.map.counter.u, w.map.counter.v], 'toCheckout', o.reduced);
      }
    }
    const busy = !!a && working(a, now);
    switch (x.doing) {
      case 'toDesk':
        if (walk(x, dt)) {
          x.doing = 'checkin';
          x.until = now + CHECKIN_MS;
          x.facing = 'nw';
          w.admin.bubble = { text: `欢迎光临，${String(x.seat ?? 0).padStart(2, '0')} 号机`, until: now + BUBBLE_MS };
        }
        break;
      case 'checkin':
        if (now >= x.until) backToSeat(w, x, o.reduced);
        break;
      case 'toSeat':
        if (walk(x, dt)) {
          if (busy) { x.doing = 'work'; sitDown(x, 'type', 'code'); } else startIdle(w, x, now, o);
        }
        break;
      case 'work':
        sitDown(x, 'type', 'code');
        if (!busy) startIdle(w, x, now, o);
        break;
      case 'game':
        sitDown(x, 'game', 'game');
        if (busy) { x.doing = 'work'; sitDown(x, 'type', 'code'); } else if (now >= x.until) startIdle(w, x, now, o);
        break;
      case 'toActivity':
        if (busy) { backToSeat(w, x, o.reduced); break; }
        if (walk(x, dt)) {
          x.doing = 'activity';
          const spot = w.map.spots.find((s) => s.u === Math.round(x.u) && s.v === Math.round(x.v));
          if (spot) x.facing = spot.facing;
          x.pose = x.activity === 'eat' || x.activity === 'drink' ? 'eat' : 'stand';
          x.hidden = x.activity === 'toilet';
        }
        break;
      case 'activity':
        if (x.activity === 'eat' || x.activity === 'drink') x.pose = 'eat';
        if (busy || now >= x.until) backToSeat(w, x, o.reduced);
        break;
      case 'bsod':
        if (now >= x.until) { x.screen = 'off'; goTo(w, x, [w.map.counter.u, w.map.counter.v], 'toCheckout', o.reduced); }
        break;
      case 'toCheckout':
        if (walk(x, dt)) {
          x.doing = 'checkout';
          x.facing = 'nw';
          x.until = now + PAY_MS;
          const r = receipt(x, t, a, now, o.rate);
          w.receipts = [r, ...w.receipts].slice(0, MAX_RECEIPTS);
          w.dings = [...w.dings, now];
          x.bubble = undefined;
          if (x.leaving === 'stopped') w.admin.bubble = { text: `${String(x.seat ?? 0).padStart(2, '0')} 号机被叫下机`, until: now + BUBBLE_MS };
        }
        break;
      case 'checkout':
        if (now >= x.until) goTo(w, x, [w.map.door.u, w.map.door.v], 'leave', o.reduced);
        break;
      case 'leave':
        walk(x, dt);
        break;
      case 'wait':
        x.pose = 'stand';
        if (info) backToSeat(w, x, o.reduced);
        break;
    }
    // a seat that moved (the plan changed): go to the new one
    if ((x.doing === 'work' || x.doing === 'game') && info) {
      const tile = seatTile(w, x);
      if (tile && (Math.round(x.u) !== tile[0] || Math.round(x.v) !== tile[1])) goTo(w, x, tile, 'toSeat', o.reduced);
    }
  }
  // gone: out of the door, or missing too long
  w.actors = w.actors.filter((x) => !(x.doing === 'leave' && !x.path.length) && !(x.missingSince !== undefined && now - x.missingSince > MISSING_MS));

  stepAdmin(w, dt, now, o);
  if (w.shout && w.shout.until <= now) w.shout = undefined;
  if (now >= w.nextShout) {
    const seated = w.actors.filter((x) => x.doing === 'work' || x.doing === 'game');
    const lines = seated.length ? [...SHOUTS, `${String(pick(w, seated).seat ?? 1).padStart(2, '0')} 号机还有 5 分钟`] : SHOUTS;
    w.shout = { text: pick(w, lines), until: now + 4000 };
    w.nextShout = now + between(w, 60_000, 120_000);
  }
  return w;
}

function startIdle(w: World, x: Actor, now: number, o: StepOpts) {
  const what = pick(w, ACTIVITIES);
  const dur = between(w, 5000, 20_000);
  x.activity = what;
  x.until = now + dur;
  if (what === 'game') { x.doing = 'game'; sitDown(x, 'game', 'game'); return; }
  const spot = freeSpot(w, what, x);
  if (!spot) { x.doing = 'game'; x.activity = 'game'; sitDown(x, 'game', 'game'); return; }
  x.screen = 'off';
  goTo(w, x, [spot.u, spot.v], 'toActivity', o.reduced);
  // the time it takes to get there does not count against the activity
  x.until = now + dur + (x.path.length / SPEED) * 1000;
}

function stepAdmin(w: World, dt: number, now: number, o: StepOpts) {
  const ad = w.admin;
  if (ad.bubble && ad.bubble.until <= now) ad.bubble = undefined;
  const home: Tile = [w.map.admin.u, w.map.admin.v];
  const atCounter = w.actors.some((x) => x.doing === 'checkin' || x.doing === 'checkout' || x.doing === 'toDesk' || x.doing === 'toCheckout');
  if (ad.doing === 'patrol') {
    if (atCounter) { goTo(w, ad, home, 'home', o.reduced); return; }
    if (walk(ad, dt)) {
      if (!ad.until) ad.until = now + 3000;
      else if (now >= ad.until) { ad.until = 0; goTo(w, ad, home, 'home', o.reduced); }
    }
    return;
  }
  if (ad.path.length) { walk(ad, dt); return; }
  ad.u = home[0]; ad.v = home[1];
  ad.facing = 'se';
  ad.pose = o.mainBusy ? 'type' : 'stand';
  if (!o.mainBusy && !atCounter && now >= w.nextPatrol) {
    w.nextPatrol = now + between(w, 20_000, 40_000);
    const s = pick(w, w.map.seats);
    goTo(w, ad, [s.chair.u, s.chair.v + 1], 'patrol', o.reduced);
    ad.until = 0;
  }
}
