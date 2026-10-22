// 克莱因锦鲤 · Klein Koi: a pond of Klein blue. Two koi drawn as dot matrices — one white with gold patches, one gold
// with a white head — swim with undulating bodies, fluttering pectoral fins and a forked tail, under drifting lily
// pads; the water is a field of characters (· - ~ ≈) moved by slow swells and by ripples. The fish follow the pointer
// loosely and come to a click as if fed; typed characters float on the water with a ring around each. While Claude
// thinks a koi circles; while it waits for you the water stills; while it edits a koi swims across and leaves a line of
// text behind it; when a run ends a koi leaps and a ✓ rises from the splash. A gold seal in the corner names the step.
// Runs in the backdrop worker: Canvas 2D on an OffscreenCanvas, glyphs and dots blitted from a pre-drawn sheet.
const WG = 18; // water cell, CSS px
const FP = 6; // fish dot pitch, CSS px
const FL = 5; // fish dot sizes
const TAU = Math.PI * 2;
const SEAL = { idle: '静', start: '启', think: '思', read: '读', search: '寻', edit: '书', cmd: '令', test: '验', git: '记', install: '装', web: '网', agent: '分', plan: '谋', tool: '器', wait: '候', compact: '缩', connect: '连' };
const TRAIL = 'def swim(pond): return calm  ·  the koi writes as it goes  ·  ';

let cv, ctx, w = 0, h = 0, dpr = 1, scene = 'welcome', reduce = false;
let C = { bg: '#002fa7', bg1: '#00217a', fg: '#ffffff', fg3: '#93a9e4', gold: '#f2c14e', goldText: '#ffd36b', green: '#8ff0bd', pink: '#ffb2d0' };
let sheet = null, SW = WG, SF = FP;
let wcols = 0, wrows = 0, wcalm = new Uint8Array(0), quietKey = '';
let colA = new Float32Array(0), colB = new Float32Array(0), colC = new Float32Array(0), colD = new Float32Array(0);
let rowA = new Float32Array(0), rowB = new Float32Array(0), rowC = new Float32Array(0), rowD = new Float32Array(0);
let colE = new Float32Array(0), colF = new Float32Array(0), rowE = new Float32Array(0), rowF = new Float32Array(0);
let quiet = [];
let ground = null;
let fish = [];
let pads = [];
let ripples = [];
let floaters = [];
let trail = [], trailI = 0, trailAt = null, trailDir = 0;
let feed = null; // { x, y, until }
let clock = 0, prevBusy = false, leapT = -1, ticks = [];
let still = 1; // 1 = the water moves freely, toward 0.2 while waiting

// ---- colour ----
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// returns #rrggbb, so a mix can be mixed again
const mix = (a, b, t) => { const p = rgb(a), q = rgb(b); return '#' + [0, 1, 2].map((i) => Math.round(p[i] + (q[i] - p[i]) * t).toString(16).padStart(2, '0')).join(''); };

function setColors(c) {
  C = {
    bg: c.bg || C.bg, bg1: c['bg-1'] || C.bg1, fg: c.fg || C.fg, fg3: c['fg-3'] || C.fg3, gold: c.accent || C.gold,
    goldText: c['accent-text'] || C.goldText, green: c.green || C.green, pink: c['agent-3'] || C.pink,
  };
}

// the sheet. Row 0–2: the water glyphs · - ~ ≈ in three strengths. Rows 3…: fish dots, FL sizes each, in these inks:
// 0 white, 1 gold, 2 deep gold, 3 fin (white seen through water), 4 eye, 5 shadow, 6 lily pad, 7 lotus
const WATER = ['·', '-', '~', '≈'];
const INKS = 8;
function buildSheet() {
  SW = Math.max(2, Math.round(WG * dpr));
  SF = Math.max(2, Math.round(FP * dpr));
  sheet = new OffscreenCanvas(Math.max(SW * 4, SF * FL), SW * 3 + SF * INKS);
  const g = sheet.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${Math.round(11 * dpr)}px ui-monospace, Consolas, monospace`;
  const water = [mix(C.bg, C.fg3, 0.7), mix(C.bg, C.fg, 0.58), mix(C.bg, C.fg, 0.88)];
  for (let r = 0; r < 3; r++) {
    g.fillStyle = water[r];
    for (let k = 0; k < 4; k++) g.fillText(WATER[k], k * SW + SW / 2, r * SW + SW / 2);
  }
  const inks = [C.fg, C.gold, mix(C.gold, '#c2410c', 0.45), mix(C.fg, C.bg, 0.35), C.bg1, mix(C.bg1, '#000010', 0.35), mix(C.green, C.bg, 0.58), C.pink];
  for (let i = 0; i < INKS; i++) {
    g.fillStyle = inks[i];
    for (let k = 0; k < FL; k++) {
      g.beginPath();
      g.arc(k * SF + SF / 2, SW * 3 + i * SF + SF / 2, Math.max(0.5, (0.75 + k * 0.42) * dpr), 0, TAU);
      g.fill();
    }
  }
}

function makeFish(kind, len, x, y) {
  const N = 16;
  const seg = len / N;
  const pts = [];
  for (let i = 0; i < N; i++) pts.push({ x: x - i * seg, y });
  return { kind, len, N, seg, pts, a: 0, v: 0, wob: Math.random() * TAU, tx: x, ty: y, scale: 1, lastTail: null };
}

function layout() {
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  wcols = Math.ceil(w / WG) + 1;
  wrows = Math.ceil(h / WG) + 1;
  wcalm = new Uint8Array(wcols * wrows);
  colA = new Float32Array(wcols); colB = new Float32Array(wcols); colC = new Float32Array(wcols); colD = new Float32Array(wcols);
  rowA = new Float32Array(wrows); rowB = new Float32Array(wrows); rowC = new Float32Array(wrows); rowD = new Float32Array(wrows);
  colE = new Float32Array(wcols); colF = new Float32Array(wcols); rowE = new Float32Array(wrows); rowF = new Float32Array(wrows);
  // the row halves of the swells don't move with time: worked out once here
  for (let y = 0; y < wrows; y++) {
    const py = y * WG;
    rowA[y] = Math.sin(py * 0.008); rowB[y] = Math.cos(py * 0.008);
    rowC[y] = Math.sin(py * 0.022); rowD[y] = Math.cos(py * 0.022);
    rowE[y] = Math.sin(y * 0.45); rowF[y] = Math.cos(y * 0.45);
  }
  quietKey = '';
  ground = ctx.createRadialGradient(w * 0.5, h * 0.42, Math.min(w, h) * 0.1, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
  ground.addColorStop(0, mix(C.bg, C.fg, 0.035));
  ground.addColorStop(0.6, C.bg);
  ground.addColorStop(1, mix(C.bg, C.bg1, 0.85));
  buildSheet();
  const chat = scene === 'chat';
  const L = chat ? 110 : Math.max(140, Math.min(240, Math.min(w, h) * 0.27));
  if (!fish.length || fish[0].len !== L) {
    fish = chat ? [makeFish(1, L, w * 0.8, h * 0.7)] : [makeFish(0, L, w * 0.72, h * 0.26), makeFish(1, L * 0.86, w * 0.2, h * 0.7)];
  }
  pads = chat
    ? [{ fx: 0.9, fy: 0.86, r: 30, rot: 0.6, lotus: false }]
    : [{ fx: 0.09, fy: 0.2, r: 40, rot: 0.9, lotus: true }, { fx: 0.15, fy: 0.3, r: 24, rot: 3.1, lotus: false }, { fx: 0.92, fy: 0.78, r: 34, rot: 4.2, lotus: false }, { fx: 0.86, fy: 0.9, r: 20, rot: 2.0, lotus: true }];
  bakePads();
}

function updateCalm() {
  const key = quiet.map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`).join(';');
  if (key === quietKey) return;
  quietKey = key;
  wcalm.fill(0);
  const P = 10;
  for (const r of quiet) {
    const x0 = Math.max(0, Math.floor((r.x - P) / WG)), x1 = Math.min(wcols - 1, Math.floor((r.x + r.w + P) / WG));
    const y0 = Math.max(0, Math.floor((r.y - P) / WG)), y1 = Math.min(wrows - 1, Math.floor((r.y + r.h + P) / WG));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) wcalm[y * wcols + x] = 1;
  }
}
const calmAt = (px, py) => { const x = (px / WG) | 0, y = (py / WG) | 0; return x >= 0 && y >= 0 && x < wcols && y < wrows && wcalm[y * wcols + x] === 1; };

// ---- the water: three slow swells (each sin(ax + by + c) split into a column part and a row part, so a cell costs a
// few multiplications) plus the ripple rings ----
function water(chat) {
  const t = clock;
  const amp = still * (chat ? 0.8 : 1);
  for (let x = 0; x < wcols; x++) {
    const px = x * WG;
    colA[x] = Math.sin(px * 0.017 + t * 0.55); colB[x] = Math.cos(px * 0.017 + t * 0.55);
    colC[x] = Math.sin(px * -0.011 + t * 0.4 + 2); colD[x] = Math.cos(px * -0.011 + t * 0.4 + 2);
    colE[x] = Math.sin(x * 0.9 + t * 1.3); colF[x] = Math.cos(x * 0.9 + t * 1.3);
  }
  const live = ripples.filter((r) => r.t < r.life);
  wA = -1;
  // a row at a time: small functions warm up quickly, which matters for the one frame drawn when motion is reduced
  for (let y = 0; y < wrows; y++) waterRow(y, live, amp, chat);
}

let wA = -1;
function waterRow(y, live, amp, chat) {
  const py = y * WG + WG / 2;
  const ra = rowA[y], rb = rowB[y], rc = rowC[y], rd = rowD[y], re = rowE[y], rf = rowF[y];
  const nl = live.length;
  for (let x = 0; x < wcols; x++) {
    // sin(a + b) = sin a cos b + cos a sin b
    let v = (colA[x] * rb + colB[x] * ra) + 0.75 * (colC[x] * rd + colD[x] * rc);
    v = (v * 0.55 + 0.25 * (colE[x] * rf + colF[x] * re)) * amp;
    for (let k = 0; k < nl; k++) v += ring(live[k], x * WG + WG / 2, py);
    // crests everywhere, the calmer marks only on some cells, so the texture stays open
    let g, s;
    const sp = (x * 7 + y * 13) % 4;
    if (v > 1.15) { g = 3; s = 2; } else if (v > 0.8) { g = 2; s = 1; } else if (v > 0.5) { g = 2; s = 0; } else if (v > 0.15 && sp < 2) { g = 1; s = 0; } else if (v > -0.4 && sp === 0) { g = 0; s = 0; } else continue;
    const q = wcalm[y * wcols + x];
    if ((chat || q) && s === 0) continue;
    const al = q ? 0.16 : (s === 2 ? 0.9 : 0.8);
    if (al !== wA) { ctx.globalAlpha = al; wA = al; }
    ctx.drawImage(sheet, g * SW, s * SW, SW, SW, x * WG, y * WG, WG, WG);
  }
}

function ring(r, px, py) {
  const dx = px - r.x, dy = py - r.y;
  const dd = Math.sqrt(dx * dx + dy * dy) - r.t * r.spd;
  if (dd > 30 || dd < -60) return 0;
  return r.amp * (1 - r.t / r.life) * Math.exp(-(dd * dd) / 220) * Math.cos(dd * 0.28) * 2.2;
}

// ---- fish ----
function steer(f, dt, speed) {
  const head = f.pts[0];
  const want = Math.atan2(f.ty - head.y, f.tx - head.x);
  let d = want - f.a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const turn = 1.9 * dt * Math.max(0.35, speed / 60);
  f.a += Math.max(-turn, Math.min(turn, d));
  const dist = Math.hypot(f.tx - head.x, f.ty - head.y);
  const v = speed * Math.min(1, 0.35 + dist / 120);
  f.v += (v - f.v) * Math.min(1, dt * 1.5);
  f.wob += dt * (2.2 + f.v / 22);
  // the head sways a little with each tail beat
  const sway = Math.sin(f.wob) * 0.22;
  head.x += Math.cos(f.a + sway) * f.v * dt;
  head.y += Math.sin(f.a + sway) * f.v * dt;
  for (let i = 1; i < f.N; i++) {
    const p = f.pts[i], q = f.pts[i - 1];
    const dx = p.x - q.x, dy = p.y - q.y;
    const l = Math.hypot(dx, dy) || 1;
    p.x = q.x + (dx / l) * f.seg;
    p.y = q.y + (dy / l) * f.seg;
  }
}

let fdots = new Float32Array(3 * 6000), nfd = 0;
function dot(x, y, ink, lv) { if (nfd < fdots.length - 3) { fdots[nfd++] = x; fdots[nfd++] = y; fdots[nfd++] = ink * FL + lv; } }

function profile(u) {
  return Math.pow(Math.sin(Math.PI * Math.min(1, 0.24 + u * 0.84)), 0.65) * (1 - 0.5 * u);
}

// body, fins and tail as dots on the FP grid; the spine is sampled between its joints with a travelling wave on top
// a point on the spine, s px from the snout, sampled between the joints, with the travelling wave on top; written
// into a scratch object (no allocation per sample). The fish's snout stays put when it leaps bigger.
const SP = { x: 0, y: 0, tx: 1, ty: 0, u: 0 };
function spineAt(f, s, total) {
  const S = f.scale, pts = f.pts;
  const fi = Math.min(f.N - 1.001, s / f.seg);
  const i = fi | 0, k = fi - i;
  const p = pts[i], q = pts[i + 1];
  let tx = q.x - p.x, ty = q.y - p.y;
  const l = Math.hypot(tx, ty) || 1;
  tx /= l; ty /= l;
  const u = s / total;
  const off = Math.sin(f.wob - u * 5.5) * f.len * 0.05 * u * u;
  const cx = pts[0].x, cy = pts[0].y;
  const bx = cx + (p.x + (q.x - p.x) * k - cx) * S, by = cy + (p.y + (q.y - p.y) * k - cy) * S;
  SP.x = bx - ty * off; SP.y = by + tx * off; SP.tx = tx; SP.ty = ty; SP.u = u;
  return SP;
}

// the scales' colours: kind 0 is white with gold patches and a gold head, kind 1 gold with a white head and a few deep spots
function patOf(kind, u, side) {
  if (kind === 0) return u < 0.1 ? 1 : Math.sin(u * 9 + 1.3) + Math.sin(u * 5.3 + side * 2.1) > 0.75 ? 1 : 0;
  return u < 0.14 ? 0 : Math.sin(u * 13 + side * 1.7) > 0.86 ? 2 : 1;
}

// one slice across the body at a spine point
function slice(f, p, W, step) {
  const half = W * profile(p.u);
  const inv = 1 / (half || 1);
  for (let k = -half; k <= half + 0.01; k += step) {
    const e = Math.abs(k) * inv;
    const lv = e > 0.8 ? 2 : e > 0.45 ? 3 : 4;
    dot(p.x - p.ty * k, p.y + p.tx * k, patOf(f.kind, p.u, (k < 0 ? -1 : 1) * e), lv);
  }
  // the dorsal ridge, a brighter line down the back
  if (p.u > 0.18 && p.u < 0.7) dot(p.x, p.y, f.kind === 0 ? 0 : 1, 4);
}

function ray(x, y, a, from, to, step, ink, lv, tipLv) {
  const c = Math.cos(a), s0 = Math.sin(a);
  for (let s = from; s < to; s += step) dot(x + c * s, y + s0 * s, ink, s > to - FP * 1.2 ? tipLv : lv);
}

// body, fins and tail as dots on the FP grid
function drawFish(f) {
  const W = f.len * 0.1 * f.scale;
  const step = FP * 0.9;
  const total = f.seg * (f.N - 1);

  // the tail: a forked fan behind the last joint, swinging with the beat
  let p = spineAt(f, total, total);
  const ex = p.x, ey = p.y;
  const back = Math.atan2(-p.ty, -p.tx) + Math.sin(f.wob - 5.5) * 0.45;
  const spread = 0.7 + 0.12 * Math.sin(f.wob * 2);
  const T = W * 3.0;
  for (let r = -3; r <= 3; r++) ray(ex, ey, back + (r / 3) * spread, FP, T * (0.62 + 0.38 * Math.abs(r) / 3), step, 3, 3, 2);
  // pectoral fins, fluttering
  p = spineAt(f, total * 0.24, total);
  const hw = W * profile(0.24);
  const flap = 0.35 * Math.sin(f.wob * 1.4);
  for (let side = -1; side <= 1; side += 2) {
    const bx = p.x - p.ty * hw * side, by = p.y + p.tx * hw * side;
    const base = Math.atan2(-p.ty, -p.tx) - side * (1.0 + flap * side);
    for (let r = -1; r <= 1; r++) ray(bx, by, base + r * 0.22 * side, FP * 0.5, W * 1.25, step, 3, 2, 2);
  }
  // the body
  for (let s = 0; s <= total; s += step) slice(f, spineAt(f, s, total), W, step);
  // eyes
  p = spineAt(f, total * 0.05, total);
  const eh = W * profile(0.05) * 0.62;
  for (let side = -1; side <= 1; side += 2) dot(p.x - p.ty * eh * side, p.y + p.tx * eh * side, 4, 2);
}

// a soft shadow on the pond floor under each fish: one path of discs along the spine, filled once
function shadowOf(f, lift) {
  const W = f.len * 0.1 * f.scale;
  const ox = 6 + lift, oy = 9 + lift * 1.5;
  ctx.beginPath();
  for (let i = 0; i < f.N - 1; i += 2) {
    const p = f.pts[i];
    const r = W * profile(i / (f.N - 1)) * 1.05 + 1;
    const x = f.pts[0].x + (p.x - f.pts[0].x) * f.scale + ox, y = f.pts[0].y + (p.y - f.pts[0].y) * f.scale + oy;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
  ctx.globalAlpha = quiet.length && calmAt(f.pts[4].x, f.pts[4].y) ? 0.06 : 0.16;
  ctx.fillStyle = C.bg1;
  ctx.fill();
}

// which dot-grid cells were drawn in this flush: a cell holds the stamp of the flush that last drew it
let stamp = new Int32Array(0), stampCols = 0, flushN = 0;
function flushFish(g = ctx, calmed = true) {
  // the dots, snapped to the dot grid, one per cell: walked from the last pushed (eyes, then body) so those win over fins
  const cols = Math.ceil(Math.max(w, 1) / FP) + 4, rows = Math.ceil(Math.max(h, 1) / FP) + 4;
  if (stamp.length !== cols * rows) { stamp = new Int32Array(cols * rows); stampCols = cols; }
  flushN++;
  let lastA = -1;
  for (let i = nfd - 3; i >= 0; i -= 3) {
    const cx = Math.round(fdots[i] / FP), cy = Math.round(fdots[i + 1] / FP);
    if (cx < -1 || cy < -1 || cx >= cols - 2 || cy >= rows - 2) continue;
    const si = (cy + 1) * stampCols + cx + 1;
    if (stamp[si] === flushN) continue;
    stamp[si] = flushN;
    const gx = cx * FP, gy = cy * FP;
    const c = fdots[i + 2];
    const a = calmed && quiet.length && calmAt(gx, gy) ? 0.18 : 1;
    if (a !== lastA) { g.globalAlpha = a; lastA = a; }
    g.drawImage(sheet, (c % FL) * SF, SW * 3 + ((c / FL) | 0) * SF, SF, SF, gx - FP / 2, gy - FP / 2, FP, FP);
  }
  nfd = 0;
}

// lily pads are drawn once into their own little canvases and then only drift
function bakePads() {
  for (const p of pads) {
    const D = Math.ceil(p.r * 2 + FP * 4);
    p.D = D;
    p.img = new OffscreenCanvas(Math.max(1, Math.round(D * dpr)), Math.max(1, Math.round(D * dpr)));
    const g = p.img.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    padDots(p, D / 2, D / 2);
    flushFish(g, false);
  }
}

function drawPad(p) {
  const cx = p.fx * w + Math.sin(clock * 0.05 + p.rot) * 6, cy = p.fy * h + Math.cos(clock * 0.04 + p.rot) * 4;
  ctx.globalAlpha = quiet.length && calmAt(cx, cy) ? 0.18 : 1;
  ctx.drawImage(p.img, cx - p.D / 2, cy - p.D / 2, p.D, p.D);
}

function padDots(p, cx, cy) {
  const rot = p.rot;
  for (let y = -p.r; y <= p.r; y += FP) {
    for (let x = -p.r; x <= p.r; x += FP) {
      const d = Math.hypot(x, y);
      if (d > p.r) continue;
      let a = Math.atan2(y, x) - rot;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) < 0.28 && d > p.r * 0.15) continue; // the notch
      // veins: brighter along a few spokes
      const vein = Math.abs(Math.sin(a * 4)) < 0.12;
      dot(cx + x, cy + y, 6, d > p.r - FP ? 4 : vein ? 3 : 2);
    }
  }
  if (p.lotus) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + rot;
      for (let s = 2; s < 13; s += FP * 0.7) dot(cx + Math.cos(a) * s - 8, cy + Math.sin(a) * s - 6, 7, s < 8 ? 4 : 3);
    }
    dot(cx - 8, cy - 6, 1, 4);
  }
}

function addRipple(x, y, amp, spd = 70, life = 3.2) { ripples.push({ x, y, t: 0, amp, spd, life }); if (ripples.length > 8) ripples.shift(); }

export default {
  init(a) {
    cv = a.canvas; ctx = cv.getContext('2d', { alpha: false });
    w = a.width; h = a.height; dpr = a.dpr || 1; scene = a.scene; reduce = !!a.reduce;
    setColors(a.colors || {});
    layout();
  },
  resize(r) { w = r.width; h = r.height; dpr = r.dpr || 1; fish = []; layout(); },
  theme(t) { setColors(t.colors || {}); layout(); },
  event(e) {
    if (e.type === 'click') {
      addRipple(e.x, e.y, 1, 85, 3.4);
      feed = { x: e.x, y: e.y, until: clock + 4 };
    }
    if (e.type === 'type' && e.text) {
      for (const ch of [...e.text].slice(0, 8)) {
        if (ch === ' ' || ch === '\n') continue;
        let x = 0, y = 0;
        for (let k = 0; k < 8; k++) {
          x = w * (0.06 + Math.random() * 0.88); y = h * (0.08 + Math.random() * 0.84);
          if (!calmAt(x, y)) break;
        }
        floaters.push({ ch, x, y, t: 0, ph: Math.random() * TAU });
        addRipple(x, y, 0.55, 60, 2.4);
        if (!feed || feed.until < clock + 1) feed = { x, y, until: clock + 2.5 };
      }
      if (floaters.length > 50) floaters = floaters.slice(-50);
    }
  },
  frame(f) {
    const dt = Math.min(0.1, f.dt || 0);
    clock += dt;
    quiet = f.quiet || [];
    updateCalm();
    const proc = f.process || 'idle';
    const busy = proc !== 'idle';
    const chat = scene === 'chat';
    const waiting = proc === 'wait';
    const thinking = proc === 'think' || proc === 'start';
    still += ((waiting ? 0.22 : busy ? 1.15 : 1) - still) * Math.min(1, dt * 0.8);

    // ---- the fish decide where to go ----
    const base = (chat ? 34 : 58) * (waiting ? 0.25 : busy ? 1.3 : 1);
    fish.forEach((fi, n) => {
      const head = fi.pts[0];
      if (chat) {
        // a corner of the pond: a slow loop at the lower right
        const cx = w * 0.82, cy = h * 0.68, R = Math.min(w, h) * (thinking ? 0.12 : 0.16);
        const a = clock * (thinking ? 0.5 : 0.22);
        fi.tx = cx + Math.cos(a) * R * 1.3; fi.ty = cy + Math.sin(a) * R;
      } else if (thinking) {
        // circling, the second fish on the far side of the same circle
        // in the open water above the greeting
        const cx = w * 0.62, cy = Math.max(70, h * 0.13);
        const a = clock * 0.55 + n * Math.PI;
        fi.tx = cx + Math.cos(a) * w * 0.2; fi.ty = cy + Math.sin(a) * Math.max(45, h * 0.075);
      } else if (proc === 'edit' && n === 0) {
        // a pass across the top of the pond, back and forth, writing
        if (fi.pass == null) fi.pass = head.x < w / 2 ? 1 : -1;
        if (fi.pass > 0 && head.x > w * 0.9) fi.pass = -1;
        if (fi.pass < 0 && head.x < w * 0.1) fi.pass = 1;
        fi.tx = fi.pass > 0 ? w * 0.98 : w * 0.02; fi.ty = h * 0.13 + Math.sin(clock * 0.7) * 8;
      } else if (feed && feed.until > clock) {
        fi.tx = feed.x + Math.cos(clock + n * 2) * 26; fi.ty = feed.y + Math.sin(clock + n * 2) * 18;
      } else if (f.mouse && n === 0 && !calmAt(f.mouse.x, f.mouse.y)) {
        // loosely after the pointer: around it, not on it
        fi.tx = f.mouse.x + Math.cos(clock * 0.4) * 70; fi.ty = f.mouse.y + Math.sin(clock * 0.4) * 50;
      } else if (proc === 'agent') {
        fi.tx = w * (n ? 0.15 : 0.85) + Math.cos(clock * 0.3 + n) * w * 0.06; fi.ty = h * (n ? 0.2 : 0.14) + Math.sin(clock * 0.4 + n) * h * 0.05;
      } else {
        // wandering: slow laps round the pond's edge, where the page has no words, the two fish on opposite sides
        const a = clock * 0.09 + n * Math.PI;
        fi.tx = w * (0.5 + 0.44 * Math.cos(a)); fi.ty = h * (0.13 + 0.07 * Math.sin(a)) + h * 0.38 * Math.pow(Math.abs(Math.cos(a)), 10);
      }
      if (proc !== 'edit') fi.pass = null;
      if (!reduce) steer(fi, dt, base * (n ? 0.9 : 1));
    });
    if (feed && feed.until < clock) feed = null;

    // a run that ends: the first koi leaps, and a ✓ rises from the splash
    if (prevBusy && !busy && fish.length) { leapT = 0; }
    prevBusy = busy;
    let lift = 0;
    if (leapT >= 0) {
      leapT += dt;
      const p = Math.min(1, leapT / 1.1);
      fish[0].scale = 1 + 0.32 * Math.sin(Math.PI * p);
      lift = 14 * Math.sin(Math.PI * p);
      if (leapT >= 1.1) {
        const hd = fish[0].pts[0];
        addRipple(hd.x, hd.y, 1.1, 95, 3);
        ticks.push({ x: hd.x, y: hd.y - 10, t: 0 });
        fish[0].scale = 1;
        leapT = -1;
      }
    }

    // ---- paint ----
    ctx.globalAlpha = 1;
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, h);
    for (const r of ripples) r.t += dt;
    ripples = ripples.filter((r) => r.t < r.life);
    water(chat);

    // text left behind by the writing koi
    if (proc === 'edit' && fish.length) {
      const tl = fish[0].pts[fish[0].N - 1];
      if (!trailAt || Math.hypot(tl.x - trailAt.x, tl.y - trailAt.y) > 9) {
        trailAt = { x: tl.x, y: tl.y };
        // swimming left it lays the line from its end, so the words still read left to right
        if (fish[0].pass !== trailDir) { trailDir = fish[0].pass; trailI = 0; }
        const n = trailI++ % TRAIL.length;
        const ch = TRAIL[trailDir < 0 ? TRAIL.length - 1 - n : n];
        if (ch !== ' ') trail.push({ ch, x: tl.x, y: tl.y, t: 0 });
        if (trail.length > 160) trail.shift();
      }
    } else trailAt = null;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (trail.length || floaters.length) {
      ctx.font = '14px ui-monospace, Consolas, monospace';
      for (const p of trail) {
        p.t += dt;
        const a = Math.max(0, Math.min(1, p.t * 3, (9 - p.t) / 3));
        ctx.globalAlpha = a * (calmAt(p.x, p.y) ? 0.18 : 0.85);
        ctx.fillStyle = C.goldText;
        ctx.fillText(p.ch, p.x, p.y);
      }
      trail = trail.filter((p) => p.t < 9);
      for (const p of floaters) {
        p.t += dt;
        p.x += dt * 5 * still;
        const y = p.y + Math.sin(clock * 1.4 + p.ph) * 2 * still;
        const a = Math.max(0, Math.min(1, p.t * 2, (14 - p.t) / 4));
        ctx.globalAlpha = a * (calmAt(p.x, y) ? 0.18 : 0.95);
        ctx.fillStyle = C.fg;
        ctx.fillText(p.ch, p.x, y);
      }
      floaters = floaters.filter((p) => p.t < 14);
    }

    // the fish, under the lily pads
    fish.forEach((fi, n) => shadowOf(fi, n === 0 ? lift : 0));
    for (const fi of fish) drawFish(fi);
    flushFish();
    for (const p of pads) drawPad(p);

    // ticks rising from a leap
    if (ticks.length) {
      ctx.font = '22px ui-monospace, Consolas, monospace';
      for (const k of ticks) {
        k.t += dt;
        ctx.globalAlpha = Math.max(0, Math.min(1, k.t * 4, (2.4 - k.t) / 1));
        ctx.fillStyle = C.goldText;
        ctx.fillText('✓', k.x, k.y - k.t * 22);
      }
      ticks = ticks.filter((k) => k.t < 2.4);
    }

    // the seal, top right: a gold square with the step's character
    if (!chat) {
      const s = 30, x = w - s - 22, y = 18;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, y + 0.5, s, s);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 3.5, y + 3.5, s - 6, s - 6);
      ctx.fillStyle = busy && Math.floor(clock * 2) % 2 && !waiting ? C.fg : C.goldText;
      ctx.font = '16px ui-monospace, Consolas, monospace';
      ctx.fillText(SEAL[proc] || '静', x + s / 2 + 0.5, y + s / 2 + 1.5);
    }
    ctx.globalAlpha = 1;
  },
};
