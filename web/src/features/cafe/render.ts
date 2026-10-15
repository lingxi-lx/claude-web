// 网吧's picture (spec §1): the room is drawn on a small canvas at one pixel per pixel (so it stays pixel art), lit
// there, and drawn onto the page canvas scaled up without smoothing; names, seat tags, bubbles and receipts are drawn
// after that at the page's own resolution, so they stay readable at any zoom.
//
// Order: floor → walls (window, big screen, neon) → everything standing, back to front (u + v) → the lighting (the
// whole room multiplied dark, then the light sources added) → the labels.
import { ADMIN, OCTOPUS, type CharacterDef, type Facing } from '@characters';
import { toScreen, TW, TH } from './iso';
import type { CafeMap, Seat } from './map';
import type { Actor, World } from './sim';
import { bakeCharacter } from './bake';
import { fee, usd, yuan } from './money';
import type { BgSession } from '@shared';
import { tr } from '@/i18n';

export const WALL = 56;
const PAD = 10;

export interface View { scale: number; x: number; y: number }
export interface Look {
  now: number;
  /** --agent-1…10 resolved to #rrggbb */
  agentColors: string[];
  chars: Map<string, CharacterDef>;
  /** who is who: guest key / 'admin' → character id */
  who: (x: Actor) => string;
  rate: number;
  session?: BgSession;
  hover?: string;
  /** No moving lights, no flicker. */
  still: boolean;
  /** The main conversation's turn is running (the big screen scrolls). */
  mainBusy: boolean;
  title: string;
}

/** The size of the room picture for a plan. */
export function sceneSize(m: CafeMap): { w: number; h: number; ox: number; oy: number } {
  const w = (m.cols + m.rows) * (TW / 2) + PAD * 2;
  const h = (m.cols + m.rows) * (TH / 2) + WALL + PAD * 2;
  return { w, h, ox: m.rows * (TW / 2) + PAD, oy: WALL + PAD };
}

type Ctx = CanvasRenderingContext2D;

let sceneCan: HTMLCanvasElement | null = null;
function scene(w: number, h: number): Ctx | null {
  if (!sceneCan) sceneCan = document.createElement('canvas');
  if (sceneCan.width !== w || sceneCan.height !== h) { sceneCan.width = w; sceneCan.height = h; }
  return sceneCan.getContext('2d');
}

// ---- shapes in floor coordinates ----

function pt(ox: number, oy: number, u: number, v: number, h = 0): [number, number] {
  const p = toScreen(u, v, h);
  return [ox + p.x, oy + p.y];
}
function poly(c: Ctx, pts: [number, number][], fill: string) {
  c.fillStyle = fill;
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fill();
}
/** A box standing on the floor: its top, its front-left face (along u at v + d) and front-right face (along v at u + w). */
function box(c: Ctx, o: [number, number], u: number, v: number, w: number, d: number, h: number, top: string, left: string, right: string, base = 0) {
  const [ox, oy] = o;
  poly(c, [pt(ox, oy, u, v + d, base), pt(ox, oy, u + w, v + d, base), pt(ox, oy, u + w, v + d, base + h), pt(ox, oy, u, v + d, base + h)], left);
  poly(c, [pt(ox, oy, u + w, v, base), pt(ox, oy, u + w, v + d, base), pt(ox, oy, u + w, v + d, base + h), pt(ox, oy, u + w, v, base + h)], right);
  poly(c, [pt(ox, oy, u, v, base + h), pt(ox, oy, u + w, v, base + h), pt(ox, oy, u + w, v + d, base + h), pt(ox, oy, u, v + d, base + h)], top);
}
/** A flat panel on the back-right wall (v = 0), from u0 to u1, from height h0 to h1. */
function onUWall(c: Ctx, o: [number, number], u0: number, u1: number, h0: number, h1: number, fill: string) {
  const [ox, oy] = o;
  poly(c, [pt(ox, oy, u0, 0, h0), pt(ox, oy, u1, 0, h0), pt(ox, oy, u1, 0, h1), pt(ox, oy, u0, 0, h1)], fill);
}
/** …on the back-left wall (u = 0), from v0 to v1. */
function onVWall(c: Ctx, o: [number, number], v0: number, v1: number, h0: number, h1: number, fill: string) {
  const [ox, oy] = o;
  poly(c, [pt(ox, oy, 0, v0, h0), pt(ox, oy, 0, v1, h0), pt(ox, oy, 0, v1, h1), pt(ox, oy, 0, v0, h1)], fill);
}

// ---- palette (the room is always at night) ----
const P = {
  floorA: '#3a3344', floorB: '#352f3f', carpet: '#3f2f4c', carpetEdge: '#4a3858',
  wallU: '#3e3550', wallV: '#332b43', base: '#221c2b',
  deskTop: '#564a63', deskL: '#362e40', deskR: '#41374d',
  chairTop: '#c0303f', chairL: '#7f1f2a', chairR: '#962533',
  monitor: '#0b0b10',
  counterTop: '#4b4158', counterL: '#2f293a', counterR: '#3a3248',
  metalTop: '#55606e', metalL: '#323a45', metalR: '#3f4956',
  glass: 'rgba(140,200,255,0.10)', glassEdge: 'rgba(160,220,255,0.35)',
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

let floorKey = '';
let floorCan: HTMLCanvasElement | null = null;
/** The floor of a plan as its own canvas: the tiles only change with the plan's size and its rows of seats. */
function floorLayer(m: CafeMap, sz: { w: number; h: number }, o: [number, number]): HTMLCanvasElement {
  const key = `${m.cols}x${m.rows}|${m.seats.map((s) => `${s.u},${s.v}`).join(';')}`;
  if (floorCan && floorKey === key) return floorCan;
  floorCan ??= document.createElement('canvas');
  floorCan.width = sz.w;
  floorCan.height = sz.h;
  floorKey = key;
  const c = floorCan.getContext('2d')!;
  const [ox, oy] = o;
  const rowAt = new Set<string>();
  for (const s of m.seats) for (let v = s.v - 1; v <= s.v + 2; v++) for (let u = s.u - 1; u <= s.u + 2; u++) rowAt.add(`${u},${v}`);
  for (let v = 0; v < m.rows; v++) for (let u = 0; u < m.cols; u++) {
    const inRow = rowAt.has(`${u},${v}`);
    const inVip = u >= m.vip.u0 && v <= m.vip.v1;
    const onDeck = u >= m.smoke.u0 && v >= m.smoke.v0;
    const col = onDeck ? ((u + v) % 2 ? '#4a3a2c' : '#433426') : inVip ? ((u + v) % 2 ? '#22303a' : '#1e2a33') : inRow ? ((u + v) % 2 ? P.carpet : P.carpetEdge) : ((u + v) % 2 ? P.floorA : P.floorB);
    poly(c, [pt(ox, oy, u, v), pt(ox, oy, u + 1, v), pt(ox, oy, u + 1, v + 1), pt(ox, oy, u, v + 1)], col);
  }
  return floorCan;
}

interface Item { d: number; draw: () => void }

export function render(out: Ctx, cw: number, ch: number, w: World, view: View, look: Look) {
  const m = w.map;
  const sz = sceneSize(m);
  const c = scene(sz.w, sz.h);
  if (!c) return;
  const o: [number, number] = [sz.ox, sz.oy];
  const now = look.now;
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#0c0b10';
  c.fillRect(0, 0, sz.w, sz.h);

  // ---- walls ----
  onUWall(c, o, 0, m.cols, 0, WALL, P.wallU);
  onVWall(c, o, 0, m.rows, 0, WALL, P.wallV);
  onUWall(c, o, 0, m.cols, 0, 3, P.base);
  onVWall(c, o, 0, m.rows, 0, 3, P.base);
  // the window: the city at night, a car's lights now and then
  const [wu0, wu1] = m.wall.window, [su0, su1] = m.wall.screen;
  onUWall(c, o, wu0, wu1, 14, 42, '#0a1328');
  for (let i = 0; i < 26; i++) {
    const r = hash(`win${i}`);
    const u = wu0 + 0.3 + ((r % 1000) / 1000) * (wu1 - wu0 - 0.6), h = 16 + ((r >> 10) % 24);
    const on = look.still || ((now / 1000 + (r % 50)) % 9) > 1.5;
    if (on) onUWall(c, o, u, u + 0.12, h, h + 1, (r & 1) ? '#ffd46a' : '#7fd8ff');
  }
  onUWall(c, o, (wu0 + wu1) / 2 - 0.1, (wu0 + wu1) / 2 + 0.1, 14, 42, '#1c1a24');
  if (!look.still) {
    const t = (now / 6000) % 1;
    if (t < 0.35) onUWall(c, o, wu0 + (t / 0.35) * (wu1 - wu0 - 0.6), wu0 + 0.6 + (t / 0.35) * (wu1 - wu0 - 0.6), 17, 18, '#fff3c0');
  }
  // the big screen: the main conversation
  onUWall(c, o, su0, su1, 18, 40, '#0a0d14');
  onUWall(c, o, su0 + 0.3, su1 - 0.3, 20, 38, look.mainBusy ? '#0f3640' : '#14202a');
  if (look.mainBusy) for (let i = 0; i < 5; i++) {
    const len = 1 + ((hash(`bs${i}`) + Math.floor(now / 400)) % 5);
    onUWall(c, o, su0 + 0.8, su0 + 0.8 + len, 34 - i * 3, 35 - i * 3, '#4fe0c0');
  }
  // neon strips and the sign
  const flick = !look.still && ((now / 1000) % 13) > 12.6;
  onUWall(c, o, 1, m.cols - 1, 48, 49.5, flick ? '#5a2048' : '#ff3cbe');
  onVWall(c, o, 1, m.rows - 1, 48, 49.5, '#3cdcff');
  // the sign: lettering lying on the back-right wall (the wall rises 1 px for every 2 along u)
  {
    const [sx, sy] = pt(o[0], o[1], 2.4, 0, 30);
    c.save();
    c.setTransform(1, 0.5, 0, 1, sx, sy);
    c.font = '700 11px "Segoe UI", "Microsoft YaHei UI", sans-serif';
    c.textBaseline = 'alphabetic';
    c.fillStyle = flick ? '#5a2048' : '#ff6ad0';
    c.fillText(tr('CLAUDE 网咖'), 0, 0);
    c.font = '600 6px "Segoe UI", "Microsoft YaHei UI", sans-serif';
    c.fillStyle = '#3cdcff';
    c.fillText(tr('24H · 包夜 · 冷饮 · 泡面'), 1, 9);
    c.restore();
  }
  // posters on the back-left wall
  const posters: [number, string, string][] = [[8, '#7a2a20', '#f1c232'], [11, '#1f3a70', '#7fd8ff'], [14, '#3a1f5a', '#ff6ad0']];
  for (const [v0, bg, fg] of posters) {
    if (v0 + 2 > m.rows - 9) continue;
    onVWall(c, o, v0, v0 + 2, 18, 38, bg);
    onVWall(c, o, v0 + 0.3, v0 + 1.7, 30, 33, fg);
    onVWall(c, o, v0 + 0.3, v0 + 1.2, 22, 24, 'rgba(255,255,255,0.5)');
  }

  // ---- floor (the same for the same plan: drawn once, then copied) ----
  c.drawImage(floorLayer(m, sz, o), 0, 0);

  // the door: a mat with a glowing arrow, the front edge of the room open to the street
  {
    const [ox, oy] = o;
    const d = m.door;
    poly(c, [pt(ox, oy, d.u - 0.5, d.v), pt(ox, oy, d.u + 1.5, d.v), pt(ox, oy, d.u + 1.5, d.v + 1), pt(ox, oy, d.u - 0.5, d.v + 1)], '#1d4a3a');
    poly(c, [pt(ox, oy, d.u + 0.3, d.v + 0.75), pt(ox, oy, d.u + 0.7, d.v + 0.75), pt(ox, oy, d.u + 0.5, d.v + 0.25)], '#4fe08a');
  }

  // ---- what stands, back to front ----
  const items: Item[] = [];
  const add = (d: number, draw: () => void) => items.push({ d, draw });
  for (const f of m.furniture) add(f.u + (f.w ?? 1) + f.v + (f.d ?? 1) - 1, () => drawFurniture(c, o, f, w, now, look));
  for (const s of m.seats) {
    const a = s.key ? w.actors.find((x) => x.key === s.key) : undefined;
    add(s.u + s.v + 1.4, () => drawDesk(c, o, s, a, now, look));
    // the gaming chair: its seat under whoever sits there, its back (on the viewer's side) over them
    add(s.chair.u + s.chair.v + 0.4, () => box(c, o, s.chair.u + 0.25, s.chair.v + 0.2, 0.55, 0.55, 4, P.chairTop, P.chairL, P.chairR));
    add(s.chair.u + s.chair.v + 0.95, () => {
      box(c, o, s.chair.u + 0.25, s.chair.v + 0.72, 0.55, 0.12, 9, '#d8404f', P.chairL, P.chairR, 4);
      box(c, o, s.chair.u + 0.4, s.chair.v + 0.7, 0.25, 0.14, 2, '#f2f2f2', '#d0d0d0', '#e0e0e0', 9.5);
    });
  }
  // the counter's till and the admin's desk lamp are part of the counter (furniture)
  for (const mc of m.machines) {
    const t = look.session?.tasks.find((x) => x.id === mc.taskId);
    add(mc.u + mc.v + 1, () => drawMachine(c, o, mc.u, mc.v, t?.status === 'running', now, look));
  }
  // the overflow queue: the guests who found no seat, standing at the door
  for (let i = 0; i < Math.min(m.overflow, m.queue.length); i++) {
    const q = m.queue[i];
    add(q.u + q.v + 0.5, () => drawCharacter(c, o, look.chars.get('octopus') ?? OCTOPUS, look.agentColors[i % look.agentColors.length], q.u + 0.5, q.v + 0.5, 'nw', 'stand', 0));
  }
  for (const x of w.actors) {
    if (x.hidden) continue;
    add(x.u + x.v + 0.5, () => drawActor(c, o, x, now, look));
  }
  add(w.admin.u + w.admin.v + 0.5, () => drawActor(c, o, w.admin, now, look));
  // the glass of the VIP room and the balcony, in front of what is behind it
  add(m.vip.u0 + m.vip.v1 + 0.9, () => drawGlass(c, o, m));
  items.sort((a, b) => a.d - b.d);
  for (const it of items) it.draw();

  // ---- light ----
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = 'rgb(150,140,188)';
  c.fillRect(0, 0, sz.w, sz.h);
  c.globalCompositeOperation = 'lighter';
  const glow = (u: number, v: number, h: number, r: number, col: string) => {
    const [x, y] = pt(o[0], o[1], u, v, h);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (const s of m.seats) {
    const a = s.key ? w.actors.find((x) => x.key === s.key) : undefined;
    const scr = a?.screen ?? 'off';
    if (scr === 'off') continue;
    glow(s.u + 1, s.v + 0.6, 10, 30, scr === 'game' ? 'rgba(255,110,50,0.42)' : scr === 'bsod' ? 'rgba(60,120,255,0.5)' : 'rgba(60,230,200,0.36)');
  }
  glow(1.5, m.admin.v + 0.5, 30, 44, 'rgba(255,200,120,0.45)'); // the counter's lamp
  glow(0.6, 5, 14, 30, 'rgba(120,220,255,0.45)'); // the fridge
  glow((su0 + su1) / 2, 0, 30, 46, look.mainBusy ? 'rgba(60,220,200,0.30)' : 'rgba(60,140,200,0.18)'); // the big screen
  glow((wu0 + wu1) / 2, 0, 28, 40, 'rgba(90,140,255,0.22)'); // the window
  if (!flick) for (let u = 4; u < m.cols; u += 8) glow(u, 0, 48, 26, 'rgba(255,60,190,0.28)');
  for (let v = 3; v < m.rows; v += 7) glow(0, v, 48, 24, 'rgba(60,220,255,0.24)');
  for (const mc of m.machines) glow(mc.u + 0.5, mc.v + 0.5, 8, 18, 'rgba(80,255,140,0.28)');
  glow(1, m.rows - 8, 8, 14, 'rgba(80,255,140,0.2)'); // the power-bank cabinet
  glow(m.door.u + 0.5, m.door.v + 0.5, 2, 22, 'rgba(80,255,140,0.22)'); // the door mat
  c.globalCompositeOperation = 'source-over';

  // ---- onto the page ----
  out.setTransform(1, 0, 0, 1, 0, 0);
  out.fillStyle = '#08070b';
  out.fillRect(0, 0, cw, ch);
  out.imageSmoothingEnabled = false;
  out.drawImage(sceneCan!, Math.round(view.x), Math.round(view.y), Math.round(sz.w * view.scale), Math.round(sz.h * view.scale));
  labels(out, w, view, sz, look);
}

/** A point of the room picture on the page. */
export function onPage(view: View, sz: { ox: number; oy: number }, u: number, v: number, h = 0): { x: number; y: number } {
  const p = toScreen(u, v, h);
  return { x: view.x + (sz.ox + p.x) * view.scale, y: view.y + (sz.oy + p.y) * view.scale };
}

function drawCharacter(c: Ctx, o: [number, number], def: CharacterDef, tint: string | undefined, u: number, v: number, facing: Facing, pose: Parameters<typeof bakeCharacter>[3], tick: number) {
  const [x, y] = pt(o[0], o[1], u, v);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath();
  c.ellipse(x, y, 6, 2.5, 0, 0, Math.PI * 2);
  c.fill();
  const f = bakeCharacter(def, tint, facing, pose, tick);
  c.drawImage(f as CanvasImageSource, Math.round(x - 13), Math.round(y - 25));
}

function drawActor(c: Ctx, o: [number, number], x: Actor, now: number, look: Look) {
  const id = look.who(x);
  const def = look.chars.get(id) ?? (x.key === 'admin' ? ADMIN : OCTOPUS);
  const tint = x.key === 'admin' ? undefined : look.agentColors[(x.color - 1 + 10) % 10];
  const fps = x.pose === 'walk' ? 8 : x.pose === 'game' ? 7 : x.pose === 'type' ? 5 : 2;
  let tick = look.still ? 0 : Math.floor(now / (1000 / fps));
  let pose = x.pose;
  // a blink now and then while standing
  if (pose === 'stand' && !look.still && (Math.floor(now / 150) + hash(x.key)) % 26 === 0) pose = 'blink';
  if (pose === 'stand') tick = 0;
  // seated: a little higher (on the chair)
  const lift = pose === 'type' || pose === 'game' || pose === 'sit' ? -0.15 : 0;
  drawCharacter(c, o, def, tint, x.u + 0.5 + lift, x.v + 0.5 + lift, x.facing, pose, tick);
}

function drawDesk(c: Ctx, o: [number, number], s: Seat, a: Actor | undefined, now: number, look: Look) {
  box(c, o, s.u, s.v + 0.1, 2, 0.8, 7, P.deskTop, P.deskL, P.deskR);
  // the monitor: a thin box at the back of the desk, its screen facing the chair
  box(c, o, s.u + 0.5, s.v + 0.2, 1, 0.12, 9, '#16161c', P.monitor, '#101016', 7);
  const [ox, oy] = o;
  const scr = a?.screen ?? 'off';
  const face = scr === 'code' ? '#0f3b36' : scr === 'game' ? '#5a2a14' : scr === 'bsod' ? '#1f4fd0' : '#15151c';
  poly(c, [pt(ox, oy, s.u + 0.58, s.v + 0.33, 8), pt(ox, oy, s.u + 1.42, s.v + 0.33, 8), pt(ox, oy, s.u + 1.42, s.v + 0.33, 15), pt(ox, oy, s.u + 0.58, s.v + 0.33, 15)], face);
  if (scr === 'code' && !look.still) {
    for (let i = 0; i < 3; i++) {
      const len = 0.15 + (((hash(`${s.no}${i}`) + Math.floor(now / 300)) % 6) / 10);
      poly(c, [pt(ox, oy, s.u + 0.65, s.v + 0.33, 13 - i * 2), pt(ox, oy, s.u + 0.65 + len, s.v + 0.33, 13 - i * 2), pt(ox, oy, s.u + 0.65 + len, s.v + 0.33, 13.7 - i * 2), pt(ox, oy, s.u + 0.65, s.v + 0.33, 13.7 - i * 2)], '#4fe0c0');
    }
  }
  if (scr === 'game') {
    poly(c, [pt(ox, oy, s.u + 0.58, s.v + 0.33, 8), pt(ox, oy, s.u + 1.42, s.v + 0.33, 8), pt(ox, oy, s.u + 1.42, s.v + 0.33, 10), pt(ox, oy, s.u + 0.58, s.v + 0.33, 10)], '#8a5a2a');
    const blink = look.still || Math.floor(now / 250) % 2 === 0;
    if (blink) { const [x, y] = pt(ox, oy, s.u + 1, s.v + 0.33, 12); c.fillStyle = '#ff4a2a'; c.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2); }
  }
  if (scr === 'bsod') { const [x, y] = pt(ox, oy, s.u + 0.7, s.v + 0.33, 13); c.fillStyle = '#fff'; c.fillRect(Math.round(x), Math.round(y), 3, 1); }
  // the RGB keyboard
  const hue = look.still ? 280 : (now / 12 + s.no * 40) % 360;
  poly(c, [pt(ox, oy, s.u + 0.55, s.v + 0.62, 7.2), pt(ox, oy, s.u + 1.45, s.v + 0.62, 7.2), pt(ox, oy, s.u + 1.45, s.v + 0.78, 7.2), pt(ox, oy, s.u + 0.55, s.v + 0.78, 7.2)], a ? `hsl(${hue},85%,58%)` : '#2a2633');
}

function drawMachine(c: Ctx, o: [number, number], u: number, v: number, on: boolean, now: number, look: Look) {
  box(c, o, u, v, 1, 1, 12, '#2c2836', '#1d1a24', '#24202d');
  const [ox, oy] = o;
  for (let i = 0; i < 3; i++) {
    const lit = on && (look.still || (Math.floor(now / 300) + i) % 3 !== 0);
    const [x, y] = pt(ox, oy, u + 0.3 + i * 0.25, v + 1, 9 - i);
    c.fillStyle = lit ? '#4fe08a' : '#1c3a28';
    c.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
}

function drawGlass(c: Ctx, o: [number, number], m: CafeMap) {
  const [ox, oy] = o;
  const { u0, v1 } = m.vip;
  // the VIP room's front glass (along u at v1 + 1) and side glass (along v at u0)
  poly(c, [pt(ox, oy, u0, v1 + 1), pt(ox, oy, m.cols, v1 + 1), pt(ox, oy, m.cols, v1 + 1, 30), pt(ox, oy, u0, v1 + 1, 30)], P.glass);
  poly(c, [pt(ox, oy, u0, 0), pt(ox, oy, u0, v1 + 1), pt(ox, oy, u0, v1 + 1, 30), pt(ox, oy, u0, 0, 30)], P.glass);
  poly(c, [pt(ox, oy, u0, v1 + 1, 29), pt(ox, oy, m.cols, v1 + 1, 29), pt(ox, oy, m.cols, v1 + 1, 30), pt(ox, oy, u0, v1 + 1, 30)], P.glassEdge);
  // the balcony's glass wall with its door gap
  const s = m.smoke;
  for (const [a, b] of [[s.v0, s.doorV], [s.doorV + 1, s.v1 + 1]]) {
    poly(c, [pt(ox, oy, s.u0 - 0.5, a), pt(ox, oy, s.u0 - 0.5, b), pt(ox, oy, s.u0 - 0.5, b, 26), pt(ox, oy, s.u0 - 0.5, a, 26)], P.glass);
    poly(c, [pt(ox, oy, s.u0 - 0.5, a, 25), pt(ox, oy, s.u0 - 0.5, b, 25), pt(ox, oy, s.u0 - 0.5, b, 26), pt(ox, oy, s.u0 - 0.5, a, 26)], P.glassEdge);
  }
}

function drawFurniture(c: Ctx, o: [number, number], f: CafeMap['furniture'][number], w: World, now: number, look: Look) {
  const [ox, oy] = o;
  const W = f.w ?? 1, D = f.d ?? 1;
  switch (f.kind) {
    case 'toilet': {
      box(c, o, f.u, f.v, W, D, 30, '#3a3346', '#2a2434', '#332c3f');
      const busy = w.actors.some((x) => x.hidden);
      // the door on its +u face, the lamp over it
      poly(c, [pt(ox, oy, f.u + W, f.v + 0.6), pt(ox, oy, f.u + W, f.v + 1.6), pt(ox, oy, f.u + W, f.v + 1.6, 20), pt(ox, oy, f.u + W, f.v + 0.6, 20)], '#6a5a80');
      poly(c, [pt(ox, oy, f.u + W, f.v + 1.35, 9), pt(ox, oy, f.u + W, f.v + 1.45, 9), pt(ox, oy, f.u + W, f.v + 1.45, 11), pt(ox, oy, f.u + W, f.v + 1.35, 11)], '#d8d0e8');
      const [x, y] = pt(ox, oy, f.u + W, f.v + 1.1, 24);
      c.fillStyle = busy ? '#ff4a4a' : '#4fe08a';
      c.fillRect(Math.round(x) - 1, Math.round(y), 2, 2);
      break;
    }
    case 'fridge': {
      box(c, o, f.u, f.v, W, D, 24, '#3c4a58', '#2a3a48', '#35485a');
      poly(c, [pt(ox, oy, f.u + W, f.v + 0.15, 3), pt(ox, oy, f.u + W, f.v + D - 0.15, 3), pt(ox, oy, f.u + W, f.v + D - 0.15, 21), pt(ox, oy, f.u + W, f.v + 0.15, 21)], '#8fe2ff');
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        const [x, y] = pt(ox, oy, f.u + W, f.v + 0.4 + i * 0.4, 6 + j * 5);
        c.fillStyle = ['#e94e3c', '#f1c232', '#3a9be8', '#e8e8e8'][(i + j) % 4];
        c.fillRect(Math.round(x), Math.round(y) - 2, 1, 2);
      }
      break;
    }
    case 'noodles': {
      box(c, o, f.u, f.v, W, D, 18, '#5a3a28', '#3e281b', '#4a3021');
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        const [x, y] = pt(ox, oy, f.u + W, f.v + 0.3 + i * 0.45, 4 + j * 5);
        c.fillStyle = ['#e94e3c', '#f2efe6', '#f1c232'][(i + j) % 3];
        c.fillRect(Math.round(x), Math.round(y) - 2, 2, 2);
      }
      break;
    }
    case 'table':
      box(c, o, f.u + 0.2, f.v + 0.2, 0.6, 0.6, 10, '#6b5a7a', '#4a3f57', '#564969');
      break;
    case 'power': {
      box(c, o, f.u, f.v, W, D, 20, P.metalTop, P.metalL, P.metalR);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        const lit = look.still || (Math.floor(now / 700) + i * 3 + j) % 5 !== 0;
        const [x, y] = pt(ox, oy, f.u + W, f.v + 0.3 + i * 0.45, 5 + j * 5);
        c.fillStyle = lit ? '#4fe08a' : '#24402e';
        c.fillRect(Math.round(x), Math.round(y) - 1, 1, 1);
      }
      break;
    }
    case 'counter': {
      box(c, o, f.u, f.v, W, D, 10, P.counterTop, P.counterL, P.counterR);
      // the till
      box(c, o, f.u + 0.6, f.v + 1.1, 0.7, 0.6, 3, '#1c1a22', '#121016', '#18161d', 10);
      const [x, y] = pt(ox, oy, f.u + 0.95, f.v + 1.4, 13);
      c.fillStyle = '#4fe0c0';
      c.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 1);
      // a coin flying up when the till rings
      for (const d of w.dings) {
        const k = (now - d) / 900;
        if (k < 0 || k > 1) continue;
        const [cx, cy] = pt(ox, oy, f.u + 1, f.v + 1.4, 14 + k * 14);
        c.fillStyle = '#ffd24a';
        c.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 2, 2);
      }
      break;
    }
    case 'fan': {
      const [x, y] = pt(ox, oy, f.u + 0.5, f.v, 20);
      c.fillStyle = '#3a3a44';
      c.fillRect(Math.round(x) - 4, Math.round(y) - 4, 8, 8);
      const a = look.still ? 0 : now / 120;
      c.strokeStyle = '#9aa0aa';
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; i < 3; i++) { const t = a + (i * Math.PI * 2) / 3; c.moveTo(x, y); c.lineTo(x + Math.cos(t) * 3, y + Math.sin(t) * 3); }
      c.stroke();
      // smoke over whoever is smoking
      for (const s of w.actors.filter((g) => g.activity === 'smoke' && g.doing === 'activity')) {
        for (let i = 0; i < 3; i++) {
          const k = ((now / 1600 + i / 3 + (hash(s.key) % 7) / 7) % 1);
          const [sx, sy] = pt(ox, oy, s.u + 0.6, s.v + 0.3, 20 + k * 16);
          c.fillStyle = `rgba(200,200,210,${0.35 * (1 - k)})`;
          c.beginPath();
          c.arc(sx + k * 3, sy, 1.5 + k * 2, 0, Math.PI * 2);
          c.fill();
        }
      }
      break;
    }
  }
}

// ---- labels at the page's resolution ----

function pill(c: Ctx, x: number, y: number, text: string, fg: string, bg: string, size: number) {
  c.font = `600 ${size}px Inter, "Segoe UI", "Microsoft YaHei UI", sans-serif`;
  const tw = c.measureText(text).width;
  const pw = tw + size * 0.9, ph = size * 1.55;
  c.fillStyle = bg;
  c.beginPath();
  c.roundRect(x - pw / 2, y - ph, pw, ph, ph / 2);
  c.fill();
  c.fillStyle = fg;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, x, y - ph / 2 + 0.5);
}

function bubble(c: Ctx, x: number, y: number, text: string, size: number) {
  const t = text.length > 28 ? `${text.slice(0, 27)}…` : text;
  c.font = `500 ${size}px Inter, "Segoe UI", "Microsoft YaHei UI", sans-serif`;
  const tw = c.measureText(t).width;
  const pw = tw + size * 1.2, ph = size * 1.8;
  c.fillStyle = 'rgba(255,253,245,0.95)';
  c.beginPath();
  c.roundRect(x - pw / 2, y - ph - 5, pw, ph, 6);
  c.moveTo(x - 4, y - 5);
  c.lineTo(x, y);
  c.lineTo(x + 4, y - 5);
  c.fill();
  c.fillStyle = '#1b1a22';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(t, x, y - 5 - ph / 2 + 0.5);
}

function labels(c: Ctx, w: World, view: View, sz: { ox: number; oy: number }, look: Look) {
  const s = Math.max(0.6, Math.min(1.6, view.scale / 2.2));
  const size = Math.round(11 * s);
  const m = w.map;
  // row labels
  c.font = `500 ${Math.round(9 * s)}px Inter, "Segoe UI", "Microsoft YaHei UI", sans-serif`;
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(255,255,255,0.42)';
  for (const r of m.rowLabels) { const p = onPage(view, sz, r.u + 0.6, r.v + 0.2, 0); c.fillText(r.text.length > 16 ? `${r.text.slice(0, 15)}…` : r.text, p.x, p.y); }
  // seat tags
  for (const seat of m.seats) {
    const a = seat.key ? w.actors.find((x) => x.key === seat.key) : undefined;
    if (!a) continue;
    const p = onPage(view, sz, seat.u + 1, seat.v + 0.3, 22);
    const t = look.session?.tasks.find((x) => x.id === a.taskId);
    const ag = t?.agents.find((y) => y.key === a.agentKey);
    const ms = Math.max(0, (ag?.endedAt ?? look.now) - (ag?.startedAt ?? t?.startedAt ?? look.now));
    const hot = look.hover === a.key;
    pill(c, p.x, p.y, `${String(seat.no).padStart(2, '0')} · ${yuan(fee(ms, look.rate))}`, hot ? '#1b1a22' : '#ffd46a', hot ? '#ffd46a' : 'rgba(18,14,26,0.82)', Math.round(9 * s));
  }
  // names and bubbles
  const people = [...w.actors.filter((x) => !x.hidden), w.admin];
  for (const x of people) {
    const seated = x.pose === 'type' || x.pose === 'game';
    const p = onPage(view, sz, x.u + 0.5, x.v + 0.5, seated ? 30 : 28);
    const color = x.key === 'admin' ? '#ffffff' : look.agentColors[(x.color - 1 + 10) % 10];
    if (!seated || look.hover === x.key) {
      c.font = `700 ${size}px Inter, "Segoe UI", "Microsoft YaHei UI", sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(10,8,14,0.85)';
      c.strokeText(x.name, p.x, p.y);
      c.fillStyle = color;
      c.fillText(x.name, p.x, p.y);
    }
    if (x.bubble) bubble(c, p.x, p.y - size * 1.4, x.bubble.text, size);
  }
  if (w.shout) {
    const p = onPage(view, sz, w.admin.u + 0.5, w.admin.v + 0.5, 30);
    bubble(c, p.x, p.y - size * (w.admin.bubble ? 4.2 : 1.4), w.shout.text, size);
  }
  // the latest receipt over the counter for a few seconds
  const r = w.receipts[0];
  if (r && look.now - r.at < 5000) {
    const p = onPage(view, sz, m.counter.u + 0.5, m.counter.v + 0.5, 40);
    receiptCard(c, p.x, p.y - 20 * s, r, s);
  }
  // the door's sign
  const d = onPage(view, sz, m.door.u + 2, m.door.v + 1, 0);
  pill(c, d.x, d.y + 22 * s, m.full ? tr('客满 · 还有 {overflow} 位在排队', { overflow: m.overflow }) : tr('空位充足'), m.full ? '#ffffff' : '#0e2a1c', m.full ? '#c23a30' : '#4fe08a', Math.round(10 * s));
}

function receiptCard(c: Ctx, x: number, y: number, r: World['receipts'][number], s: number) {
  const lines = [
    r.kind === 'failed' ? tr('异常下机 · {name}', { name: r.name }) : r.kind === 'stopped' ? tr('被叫下机 · {name}', { name: r.name }) : tr('结账 · {name}', { name: r.name }),
    tr('座位 {padStart}  上机 {ms}:{padStart2}', { padStart: String(r.seat).padStart(2, '0'), ms: Math.floor(r.ms / 60000), padStart2: String(Math.floor(r.ms / 1000) % 60).padStart(2, '0') }),
    tr('网费 {yuan}', { yuan: yuan(r.fee) }),
    `${r.tokens ? `${Math.round(r.tokens / 100) / 10}k token  ` : ''}${usd(r.usd)}`,
  ];
  const size = Math.round(11 * s);
  c.font = `500 ${size}px "JetBrains Mono", Consolas, monospace`;
  const w = Math.max(...lines.map((l) => c.measureText(l).width)) + size * 1.6;
  const h = lines.length * size * 1.45 + size;
  c.fillStyle = '#fffdf5';
  c.fillRect(x - w / 2, y - h, w, h);
  // the zigzag bottom edge of a till roll
  c.beginPath();
  for (let i = 0; i <= 10; i++) c.lineTo(x - w / 2 + (w * i) / 10, y + (i % 2 ? 3 : 0));
  c.lineTo(x + w / 2, y - 1);
  c.lineTo(x - w / 2, y - 1);
  c.fill();
  c.textAlign = 'left';
  c.textBaseline = 'top';
  lines.forEach((l, i) => {
    c.fillStyle = i === 0 && r.kind === 'failed' ? '#c23a30' : '#1b1a22';
    c.fillText(l, x - w / 2 + size * 0.8, y - h + size * 0.5 + i * size * 1.45);
  });
}

/** What is under a page point: a guest, the admin, or a machine. */
export function hitTest(w: World, view: View, x: number, y: number): { kind: 'actor' | 'admin' | 'machine'; key: string } | null {
  const sz = sceneSize(w.map);
  let best: { kind: 'actor' | 'admin' | 'machine'; key: string; d: number } | null = null;
  const consider = (kind: 'actor' | 'admin' | 'machine', key: string, u: number, v: number, h: number) => {
    const p = onPage(view, sz, u, v, h);
    const dx = (x - p.x) / view.scale, dy = (y - p.y) / view.scale;
    if (Math.abs(dx) > 9 || dy < -14 || dy > 12) return;
    const d = u + v;
    if (!best || d > best.d) best = { kind, key, d };
  };
  for (const a of w.actors) if (!a.hidden) consider('actor', a.key, a.u + 0.5, a.v + 0.5, 12);
  consider('admin', 'admin', w.admin.u + 0.5, w.admin.v + 0.5, 12);
  for (const m of w.map.machines) consider('machine', m.taskId, m.u + 0.5, m.v + 0.5, 8);
  const b = best as { kind: 'actor' | 'admin' | 'machine'; key: string } | null;
  return b ? { kind: b.kind, key: b.key } : null;
}

/** The view that shows the whole room centred, at a whole-number scale when it fits (crisp pixels). */
export function fitView(w: World, cw: number, ch: number): View {
  const sz = sceneSize(w.map);
  const raw = Math.min(cw / sz.w, ch / sz.h);
  const scale = raw >= 1 ? Math.floor(raw * 2) / 2 : Math.max(0.25, raw);
  return { scale, x: (cw - sz.w * scale) / 2, y: (ch - sz.h * scale) / 2 };
}
