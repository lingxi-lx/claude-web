// 水墨 · Sumi Ink: distant mountains in ink wash on rice paper — four ridges built from characters, darkest along the
// ridge line and fading down into mist, light far away and dark close by, with moss dots on the near crests and a
// pale cinnabar sun. Mist bands drift across them. The paper is alive underneath: ink sits in a grid of cells that
// slowly bleeds through the fibres (uneven, like real paper) and dries away. The pointer leaves an ink trail that
// spreads; a click drops ink that blooms; what you type is brushed in a vertical column at the right and sinks into the
// paper. While Claude thinks an ink drop falls into still water and spreads in rings; while it waits for you a seal
// hangs in the air, and comes down when you answer. Canvas 2D in the backdrop worker; glyphs are sprites.
const FONT = 'ui-monospace, Consolas, monospace';
const RAMP = '·:;-=+*#%';
const WET = '·:;+=*#%●'; // the wet layer ends in a full round blot rather than @
const TAU = Math.PI * 2;
const PAD = 12;

let cv, ctx, w = 0, h = 0, dpr = 1, scene = 'welcome', reduce = false;
let col = { paper: '#f6f1e7', paper2: '#eee7d9', ink: '#1b1916', grey: '#736c62', fibre: '#cbbfa6', red: '#b8321f' };
let still = null, mistSp = null, sealSp = null, WA = null;
const sprites = new Map();
// the wet layer
let C = 12, gc = 0, gr = 0, ink = null, tmp = null, kf = null, jx = null, jy = null;
let blots = [], ripples = [], brush = [], prints = [];
let last = null, clock = 0, blotAcc = 0, dropAcc = 0;
let seal = { a: 0, stamp: -1, x: 0, y: 0 };
let drop = { x: 0, y: 0 };
let brushCol = 0, brushRow = 0;
let quiet = [];

// ---- helpers ----
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
function mix(a, b, t) {
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mk = (a, b) => new OffscreenCanvas(Math.max(1, Math.ceil(a)), Math.max(1, Math.ceil(b)));
const inQuiet = (x, y) => {
  for (let i = 0; i < quiet.length; i++) {
    const r = quiet[i];
    if (x > r.x - PAD && x < r.x + r.w + PAD && y > r.y - PAD && y < r.y + r.h + PAD) return true;
  }
  return false;
};
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function sprite(ch, size, color, soft) {
  const key = ch + '|' + size + '|' + color + '|' + (soft ? 1 : 0);
  let s = sprites.get(key);
  if (s) return s;
  if (sprites.size > 500) sprites.clear();
  const S = Math.ceil(size * 1.6);
  const c = mk(S * dpr, S * dpr);
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  x.font = `${size}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = color;
  if (soft) { x.shadowColor = rgba(color, 0.55); x.shadowBlur = size * 0.12; }
  x.fillText(ch, S / 2, S / 2);
  s = { c, S };
  sprites.set(key, s);
  return s;
}
// many small glyphs of one size in one canvas: a row per colour, a column per character. Drawing thousands of them
// from a single texture is far cheaper than from a canvas each (the mountains are several thousand glyphs).
function atlas(chars, size, colors) {
  const S = Math.ceil(size * 1.4), list = [...chars];
  const c = mk(S * list.length * dpr, S * colors.length * dpr);
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  x.font = `${size}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  colors.forEach((color, j) => { x.fillStyle = color; list.forEach((ch, i) => x.fillText(ch, i * S + S / 2, j * S + S / 2)); });
  return { c, S, P: S * dpr, idx: new Map(list.map((ch, i) => [ch, i])) };
}
function stamp(target, A, ch, row, x, y, a, k = 1) {
  const i = A.idx.get(ch);
  if (i === undefined || a <= 0.01) return;
  const S = A.S * k;
  target.globalAlpha = a;
  target.drawImage(A.c, i * A.P, row * A.P, A.P, A.P, x - S / 2, y - S / 2, S, S);
}
function put(target, ch, size, color, x, y, a, soft) {
  if (a <= 0.01) return;
  const s = sprite(ch, size, color, soft);
  target.globalAlpha = a;
  target.drawImage(s.c, x - s.S / 2, y - s.S / 2, s.S, s.S);
}

// ---- the still picture: paper, mountains, sun ----
function ridgeFn(r, amp, freq) {
  const ph = [r() * TAU, r() * TAU, r() * TAU, r() * TAU];
  const peaks = [];
  for (let i = 0; i < 3; i++) peaks.push({ x: r(), s: 0.04 + r() * 0.08, a: 0.3 + r() * 0.7 });
  return (x) => {
    const u = x / w;
    let v = 0.5 * Math.sin(u * freq * TAU + ph[0]) + 0.25 * Math.sin(u * freq * 2.3 * TAU + ph[1])
      + 0.13 * Math.sin(u * freq * 5.1 * TAU + ph[2]) + 0.06 * Math.sin(u * freq * 11.7 * TAU + ph[3]);
    for (const p of peaks) v += p.a * Math.exp(-((u - p.x) ** 2) / (2 * p.s * p.s));
    return v * amp;
  };
}

// built a few milliseconds at a time over the first frames (a resize or a colour change must not hold the worker up
// for half a second): the paper first, then the ridges paint in from far to near
function* stillSteps() {
  const cvs = mk(w * dpr, h * dpr);
  const x = cvs.getContext('2d');
  x.scale(dpr, dpr);
  const chat = scene === 'chat';
  const r = rnd(chat ? 7 : 1987);
  // paper: a warm ground, uneven tone, fibres
  x.fillStyle = col.paper;
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {
    const px = r() * w, py = r() * h, pr = 80 + r() * 260;
    const g = x.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0, rgba(r() < 0.5 ? col.paper2 : '#ffffff', 0.35));
    g.addColorStop(1, rgba(col.paper2, 0));
    x.fillStyle = g;
    x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  x.strokeStyle = col.fibre;
  x.lineWidth = 0.6;
  const nf = Math.round((w * h) / 2600);
  for (let i = 0; i < nf; i++) {
    const px = r() * w, py = r() * h, a = r() * TAU, l = 3 + r() * 12;
    x.globalAlpha = 0.12 + r() * 0.2;
    x.beginPath();
    x.moveTo(px, py);
    x.quadraticCurveTo(px + Math.cos(a) * l * 0.5 + (r() - 0.5) * 4, py + Math.sin(a) * l * 0.5 + (r() - 0.5) * 4, px + Math.cos(a) * l, py + Math.sin(a) * l);
    x.stroke();
  }
  x.globalAlpha = 1;
  still = cvs;
  yield;

  // the sun, pale cinnabar, behind the mountains
  if (!chat) {
    const sx = w * 0.72, sy = h * 0.2, R = clamp(Math.min(w, h) * 0.045, 22, 40), g = 4.2;
    x.fillStyle = col.red;
    for (let yy = -R; yy <= R; yy += g) for (let xx = -R; xx <= R; xx += g) {
      const d = Math.hypot(xx, yy) / R;
      if (d > 1) continue;
      x.globalAlpha = 0.5 * (1 - d * 0.4);
      x.beginPath(); x.arc(sx + xx, sy + yy, g * 0.46 * (1 - d * d * 0.5), 0, TAU); x.fill();
    }
    x.globalAlpha = 1;
  }
  yield;

  // the ridges, far to near
  const G = chat ? 12 : 11;
  const layers = chat ? 3 : 4;
  const tones = [];
  for (let li = 0; li < layers; li++) tones.push(mix(col.ink, col.paper, 0.5 - (li / Math.max(1, layers - 1)) * 0.5));
  tones.push(col.ink);
  const MA = atlas(RAMP + '•', G + 1, tones);
  for (let li = 0; li < layers; li++) {
    const k = li / Math.max(1, layers - 1);
    const base = chat ? h * (0.7 + li * 0.08) : h * (0.5 + li * 0.1);
    const amp = (chat ? h * 0.12 : h * 0.2) * (1 - k * 0.45);
    const ridge = ridgeFn(r, amp, 0.8 + li * 0.45);
    const dark = (chat ? 0.4 : 0.38) + k * 0.62;
    const fade = 20 + k * 46;
    // the paper in front of the farther ridges: the mountain's body, washed lighter downward (mist at its foot)
    const pts = [];
    for (let px = 0; px <= w + G; px += G) pts.push([px, base - ridge(px)]);
    x.beginPath();
    x.moveTo(0, h);
    for (const [px, py] of pts) x.lineTo(px, py);
    x.lineTo(w, h);
    x.closePath();
    const g = x.createLinearGradient(0, base - amp, 0, h);
    g.addColorStop(0, mix(col.paper, col.ink, 0.02 + k * 0.03));
    g.addColorStop(1, col.paper);
    x.fillStyle = g;
    x.fill();
    // the wash, in characters: darkest along the crest
    let cc = 0;
    for (const [px, ry] of pts) {
      if (++cc % 20 === 0) yield;
      const gy0 = Math.ceil(ry / G) * G;
      for (let py = gy0; py < h; py += G) {
        const depth = py - ry;
        let v = dark * Math.exp(-depth / fade) * (0.75 + 0.5 * r());
        if (depth < G * 1.2) v += 0.2 * k;
        if (v < 0.05) break;
        const ch = RAMP[clamp(Math.floor(v * RAMP.length), 0, RAMP.length - 1)];
        stamp(x, MA, ch, li, px + (r() - 0.5) * 2, py, clamp(0.3 + v * 0.75, 0, 0.95));
      }
    }
    // moss dots (点苔) on the near crests
    if (k > 0.4) {
      for (let px = r() * 80; px < w; px += 50 + r() * 120) {
        const ry = base - ridge(px);
        const n = 2 + Math.floor(r() * 4);
        for (let j = 0; j < n; j++) stamp(x, MA, '•', layers, px + (r() - 0.5) * 18, ry - 2 - r() * 7, 0.55 + r() * 0.35, 0.8 + r() * 0.5);
      }
    }
    // a band of mist across the ridge's foot
    const my = base + amp * 0.15;
    const mg = x.createLinearGradient(0, my - 30, 0, my + 40);
    mg.addColorStop(0, rgba(col.paper, 0));
    mg.addColorStop(0.5, rgba(col.paper, 0.7));
    mg.addColorStop(1, rgba(col.paper, 0));
    x.globalAlpha = 1;
    x.fillStyle = mg;
    x.fillRect(0, my - 30, w, 70);
  }
  x.globalAlpha = 1;
}

let job = null;
function runJob(budget) {
  const t0 = performance.now();
  while (job) {
    if (job.next().done) job = null;
    else if (performance.now() - t0 > budget) break;
  }
}
// (motion reduced: there is only one frame, so the picture is finished here, before it)
function buildStill() { still = null; job = stillSteps(); runJob(reduce ? 1e9 : 4); }

function buildMist() {
  const W = 512, H = 96;
  mistSp = mk(W, H);
  const x = mistSp.getContext('2d');
  x.setTransform(1, 0, 0, H / W, 0, 0);
  const g = x.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
  g.addColorStop(0, rgba(col.paper, 0.88));
  g.addColorStop(0.55, rgba(col.paper, 0.5));
  g.addColorStop(1, rgba(col.paper, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, W, W);
}

// the seal: a cinnabar square with 墨 cut into it, its edge worn
function buildSeal() {
  const S = 44;
  sealSp = mk(S * dpr, S * dpr);
  const x = sealSp.getContext('2d');
  x.scale(dpr, dpr);
  const r = rnd(42);
  x.fillStyle = col.red;
  x.beginPath();
  x.moveTo(5, 3); x.lineTo(S - 4, 4); x.lineTo(S - 3, S - 5); x.lineTo(4, S - 3); x.closePath();
  x.fill();
  x.strokeStyle = col.paper;
  x.lineWidth = 1.6;
  x.strokeRect(8, 8, S - 16, S - 16);
  x.fillStyle = col.paper;
  x.font = `600 22px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('墨', S / 2, S / 2 + 1);
  for (let i = 0; i < 40; i++) {
    x.globalAlpha = 0.5 + r() * 0.5;
    x.beginPath(); x.arc(r() * S, r() * S, 0.4 + r() * 1.1, 0, TAU); x.fill();
  }
  x.globalAlpha = 1;
}

// ---- the wet layer ----
function layoutGrid() {
  C = scene === 'chat' ? 15 : 12;
  gc = Math.max(3, Math.ceil(w / C));
  gr = Math.max(3, Math.ceil(h / C));
  ink = new Float32Array(gc * gr);
  tmp = new Float32Array(gc * gr);
  kf = new Float32Array(gc * gr);
  jx = new Float32Array(gc * gr);
  jy = new Float32Array(gc * gr);
  // the paper's fibres: ink runs further along some cells than others
  const r = rnd(5);
  for (let i = 0; i < kf.length; i++) { kf[i] = 0.35 + r() * 0.8; jx[i] = (r() - 0.5) * C * 0.45; jy[i] = (r() - 0.5) * C * 0.45; }
}
function add(px, py, amt, rad) {
  const cx = px / C, cy = py / C, R = Math.max(1, rad);
  const x0 = Math.max(1, Math.floor(cx - R)), x1 = Math.min(gc - 2, Math.ceil(cx + R));
  const y0 = Math.max(1, Math.floor(cy - R)), y1 = Math.min(gr - 2, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    if (d2 > R * R) continue;
    const i = y * gc + x;
    ink[i] = Math.min(6, ink[i] + amt * Math.exp(-d2 / (R * R * 0.5)));
  }
}
function diffuse(dt) {
  const k = clamp(dt * 1.1, 0, 0.2), dec = Math.exp(-dt * (scene === 'chat' ? 0.12 : 0.085));
  for (let y = 1; y < gr - 1; y++) {
    let i = y * gc + 1;
    for (let x = 1; x < gc - 1; x++, i++) {
      const a = ink[i];
      const lap = ink[i - 1] + ink[i + 1] + ink[i - gc] + ink[i + gc] - 4 * a;
      const v = (a + k * kf[i] * lap) * dec;
      tmp[i] = v < 0.004 ? 0 : v;
    }
  }
  const t = ink; ink = tmp; tmp = t;
}
function drawInk() {
  for (let y = 1; y < gr - 1; y++) {
    let i = y * gc + 1;
    for (let x = 1; x < gc - 1; x++, i++) {
      const v = ink[i];
      if (v < 0.05) continue;
      const d = Math.min(1, v);
      const ch = WET[Math.min(WET.length - 1, Math.floor(d * WET.length))];
      const px = x * C + C / 2 + jx[i], py = y * C + C / 2 + jy[i];
      const a = (0.2 + d * 0.72) * (quiet.length && inQuiet(px, py) ? 0.18 : 1);
      stamp(ctx, WA, ch, 0, px, py, a);
    }
  }
}

// a blot somewhere in the open paper, bleeding in slowly over a few seconds
function newBlot() {
  for (let k = 0; k < 8; k++) {
    const x = w * (0.06 + Math.random() * 0.88), y = h * (0.08 + Math.random() * 0.5);
    if (inQuiet(x, y)) continue;
    blots.push({ x, y, t: 0, dur: 2 + Math.random() * 2, amt: 0.5 + Math.random() * 0.6 });
    return;
  }
}

function layout() {
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sprites.clear();
  buildStill();
  buildMist();
  sealSp = null;
  layoutGrid();
  WA = atlas(WET, C + 1, [col.ink]);
  const chat = scene === 'chat';
  seal.x = chat ? w - 60 : w * 0.86;
  seal.y = chat ? 70 : h * 0.34;
  drop.x = chat ? w - 120 : w * 0.2;
  drop.y = chat ? 90 : h * 0.24;
  brushCol = 0; brushRow = 0; brush = []; blots = []; ripples = []; prints = [];
  // the paper already holds a couple of old blots, half dry
  const r = rnd(11);
  for (let i = 0; i < (chat ? 1 : 3); i++) add(w * (0.08 + r() * 0.84), h * (0.1 + r() * 0.35), 1.6 + r(), 1.5 + r() * 1.5);
  for (let i = 0; i < 40; i++) diffuse(1 / 15);
}

export default {
  init(a) {
    cv = a.canvas; ctx = cv.getContext('2d', { alpha: false });
    w = a.width; h = a.height; dpr = a.dpr || 1; scene = a.scene || 'welcome'; reduce = !!a.reduce;
    setColors(a.colors || {});
    layout();
  },
  resize(r) { w = r.width; h = r.height; dpr = r.dpr || 1; layout(); },
  theme(t) { setColors(t.colors || {}); sprites.clear(); if (cv) { buildStill(); buildMist(); sealSp = null; WA = atlas(WET, C + 1, [col.ink]); } },
  event(e) {
    if (e.type === 'click') {
      // a full brush touched to wet paper: one heavy drop and a few spatters
      add(e.x, e.y, 6, 2.4);
      for (let i = 0; i < 5; i++) {
        const an = Math.random() * TAU, d = 18 + Math.random() * 46;
        add(e.x + Math.cos(an) * d, e.y + Math.sin(an) * d, 1 + Math.random() * 1.4, 1);
      }
      ripples.push({ x: e.x, y: e.y, t: 0, flat: 0.8 });
    }
    if (e.type === 'type' && e.text) {
      const chars = [...e.text].filter((c) => c.trim()).slice(0, 16);
      const chat = scene === 'chat';
      const step = chat ? 30 : 40, top = chat ? 70 : 80;
      const per = Math.max(3, Math.floor((h * (chat ? 0.5 : 0.42) - top) / step));
      for (const ch of chars) {
        const x = w - (chat ? 40 : 56) - brushCol * step, y = top + brushRow * step;
        brush.push({ ch, x, y, t: 0, inked: false });
        if (++brushRow >= per) { brushRow = 0; brushCol = (brushCol + 1) % 3; }
      }
      if (brush.length > 60) brush.splice(0, brush.length - 60);
    }
  },
  frame(f) {
    const dt = Math.min(0.1, Math.max(0, f.dt || 0));
    clock = f.t || 0;
    quiet = f.quiet || [];
    if (f.scene && f.scene !== scene) { scene = f.scene; layout(); }
    const proc = f.process || 'idle';
    const busy = proc !== 'idle';
    const thinking = proc === 'think' || proc === 'start';
    const waiting = proc === 'wait';
    const chat = scene === 'chat';

    // the paper and its mountains (still being painted in, the first few frames)
    runJob(reduce ? 1e9 : 8);
    ctx.globalAlpha = 1;
    if (still) ctx.drawImage(still, 0, 0, w, h);
    else { ctx.fillStyle = col.paper; ctx.fillRect(0, 0, w, h); }
    // mist bands, drifting
    const drift = waiting ? 0.3 : busy ? 1.8 : 1;
    const bands = chat ? 2 : 3;
    for (let i = 0; i < bands; i++) {
      const bw = w * (0.55 + i * 0.12), bh = chat ? 46 : 64 + i * 10;
      const span = w + bw;
      const off = (clock * (7 + i * 4) * drift * (i % 2 ? -1 : 1) + i * span * 0.37) % span;
      const bx = (off + span) % span - bw;
      const by = chat ? h * (0.74 + i * 0.1) : h * (0.42 + i * 0.12) + Math.sin(clock * 0.1 + i) * 8;
      ctx.globalAlpha = 0.8;
      ctx.drawImage(mistSp, bx, by - bh / 2, bw, bh);
    }
    // behind the page's words the picture washes out to paper
    // (drawn far off-canvas so only the blurred shadow lands: a veil with feathered edges)
    if (quiet.length) {
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = col.paper;
      ctx.shadowColor = col.paper;
      ctx.shadowBlur = 22;
      ctx.shadowOffsetX = 20000;
      for (const q of quiet) ctx.fillRect(q.x - PAD - 20000, q.y - PAD, q.w + PAD * 2, q.h + PAD * 2);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowColor = 'transparent';
    }

    // the wet layer: sources, then the bleed
    if (!reduce) {
      blotAcc += dt;
      if (blotAcc > (chat ? 14 : 7) && blots.length < 3) { blotAcc = Math.random() * 2; newBlot(); }
      for (const b of blots) { b.t += dt; add(b.x, b.y, b.amt * dt * 1.6, 1.3); }
      blots = blots.filter((b) => b.t < b.dur);
      const m = f.mouse;
      if (m && last) {
        const d = Math.hypot(m.x - last.x, m.y - last.y);
        if (d > 1.5) {
          const n = Math.min(40, Math.ceil(d / (C * 0.6)));
          for (let i = 1; i <= n; i++) add(last.x + ((m.x - last.x) * i) / n, last.y + ((m.y - last.y) * i) / n, 0.3, 0.9);
        }
      }
      last = m ? { x: m.x, y: m.y } : null;
      // thinking: a drop falls into still water
      if (thinking) {
        dropAcc += dt;
        if (dropAcc > 1.5) { dropAcc = 0; ripples.push({ x: drop.x, y: drop.y, t: -0.35, flat: 0.34, drop: true }); }
      } else dropAcc = 1.2;
      diffuse(dt);
    }
    drawInk();

    // ripples: the drop's rings on the water, a click's bloom
    for (const g of ripples) {
      g.t += dt;
      if (g.drop && g.t < 0) {
        put(ctx, '●', 11, col.ink, g.x, g.y + g.t * 150, 0.85);
        continue;
      }
      if (g.drop && !g.hit) { g.hit = true; add(g.x, g.y, 4, 1.8); }
      ctx.strokeStyle = col.ink;
      ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const u = g.t - k * 0.35;
        if (u <= 0) continue;
        const rr = 6 + u * (g.drop ? 46 : 70);
        ctx.globalAlpha = Math.max(0, 0.32 * (1 - u / 2.6));
        ctx.beginPath();
        ctx.ellipse(g.x, g.y, rr, rr * g.flat, 0, 0, TAU);
        ctx.stroke();
      }
    }
    ripples = ripples.filter((g) => g.t < 3.4);

    // typed characters, brushed in and sinking into the paper
    for (const b of brush) {
      b.t += dt;
      if (!b.inked && b.t > 0.2) { b.inked = true; add(b.x, b.y, 0.9, 1.3); }
      const a = Math.pow(clamp(1 - b.t / 9, 0, 1), 1.4) * Math.min(1, b.t / 0.25 + 0.2);
      const size = chat ? 22 : 30;
      put(ctx, b.ch, size, col.ink, b.x, b.y, a * 0.92 * (quiet.length && inQuiet(b.x, b.y) ? 0.18 : 1), true);
    }
    brush = brush.filter((b) => b.t < 9);

    // the seal: hanging in the air while waiting, pressed when the wait is over
    if (waiting) { seal.a = Math.min(1, seal.a + dt * 1.5); seal.stamp = -1; }
    else if (seal.a > 0.4 && seal.stamp < 0) seal.stamp = 0;
    else if (seal.stamp < 0) seal.a = Math.max(0, seal.a - dt * 2);
    if (seal.stamp >= 0) {
      seal.stamp += dt;
      if (seal.stamp > 0.3) { prints.push({ x: seal.x, y: seal.y, t: 0 }); seal.stamp = -1; seal.a = 0; }
    }
    if (!sealSp && (seal.a > 0 || prints.length || waiting)) buildSeal();
    for (const p of prints) {
      p.t += dt;
      ctx.globalAlpha = 0.85 * clamp(1 - p.t / 6, 0, 1);
      ctx.drawImage(sealSp, p.x - 22, p.y - 22, 44, 44);
    }
    prints = prints.filter((p) => p.t < 6);
    if (seal.a > 0.01) {
      const lift = seal.stamp >= 0 ? 30 * (1 - seal.stamp / 0.3) : 30 + Math.sin(clock * 2.2) * 6;
      ctx.fillStyle = col.ink;
      ctx.globalAlpha = seal.a * (0.16 - lift * 0.002);
      ctx.beginPath();
      ctx.ellipse(seal.x, seal.y + 22, 22 - lift * 0.15, 5, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = seal.a;
      ctx.drawImage(sealSp, seal.x - 22, seal.y - 22 - lift, 44, 44);
    }
    ctx.globalAlpha = 1;
  },
};

function setColors(c) {
  col = {
    paper: c.bg || col.paper, paper2: c['bg-1'] || col.paper2, ink: c.fg || col.ink, grey: c['fg-3'] || col.grey,
    fibre: c['line-1'] || col.fibre, red: c.accent || col.red,
  };
}
