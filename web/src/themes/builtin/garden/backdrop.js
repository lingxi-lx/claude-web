// 花园 · Garden: a night garden along the bottom of the page, drawn in characters — one plant per project (the host's
// `data`): taller and more branched the more it is used, in bloom if it was used today, glowing and swaying while a
// conversation in it runs. Before any data, a default bed of seven. Fireflies wander and follow the pointer; plants
// lean away from it; a click scatters pollen; typed characters fall as seeds and sprout. A wind passes while Claude
// works, pollen rises while it thinks, and the garden holds still while it waits for you. Canvas 2D in the worker.
const GLYPHS = ['|', '/', '\\', '~', '❦', '♣', '*', '✿', '❀', '@', '.', ',', "'", '"', '`', ':', '·', 'ı', '•', ';'];
const GI = {};
GLYPHS.forEach((g, i) => { GI[g] = i; });
// colour rows of the sprite sheet
const STEM = 0, LEAF = 1, SOIL = 2, GRASS = 3, INK = 4, GOLD = 5, FG = 6, FLOWER = 7; // FLOWER..FLOWER+9 = agent-1..10
const BLOOMS = [0, 1, 2, 3, 4, 5, 7, 8]; // agent-n used for flowers (not the greens)
const DEFAULT = [
  { size: 0.5, recent: true, live: false }, { size: 0.85, recent: false, live: false }, { size: 0.35, recent: true, live: false },
  { size: 1, recent: true, live: true }, { size: 0.6, recent: false, live: false }, { size: 0.28, recent: true, live: false },
  { size: 0.72, recent: true, live: false },
];

let cv, ctx, w = 0, h = 0, dpr = 1, scene = 'welcome', reduce = false;
let pal = {};
let sheet = null, S = 16; // sprite sheet and its cell (device px)
let glowGold = null, glowLeaf = null;
let base = null; // bg, sky, stars, soil and labels: drawn once per layout / data / quiet change
let CELL = 14, CW = 9.4, CH = 14, gy = 0;
let projects = null;
let plants = [];
let flies = [], motes = [], seeds = [], leavesAir = [], twinkles = [];
let quiet = [], quietKey = '';
let wind = 0, lift = 0, hush = 0, clock = 0;
const charCache = new Map();
const PAD = 10;

// ---- small helpers ----
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const x = rgb(a), y = rgb(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}
const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
const inQuiet = (x, y) => {
  for (const r of quiet) if (x > r.x - PAD && x < r.x + r.w + PAD && y > r.y - PAD && y < r.y + r.h + PAD) return true;
  return false;
};

function setColors(c) {
  pal = {
    bg: c.bg || '#17120d', fg: c.fg || '#f0e7d6', ink: c['fg-3'] || '#918571', ink2: c['fg-2'] || '#bcb09b',
    accent: c.accent || '#86bd5e', leaf: c['accent-text'] || '#a3d47c', gold: c.yellow || '#ecc75e',
    flowers: Array.from({ length: 10 }, (_, i) => c[`agent-${i + 1}`] || '#f291b2'),
  };
}

function font(px) { return `${px}px ui-monospace, "Cascadia Mono", Consolas, monospace`; }

function buildSheet() {
  S = Math.ceil(CELL * dpr * 1.25);
  const rows = [
    mix(pal.accent, pal.bg, 0.12), pal.leaf, mix(pal.ink, pal.bg, 0.45), mix(pal.accent, pal.bg, 0.35), pal.ink, pal.gold, pal.fg,
    ...pal.flowers,
  ];
  sheet = new OffscreenCanvas(S * GLYPHS.length, S * rows.length);
  const g = sheet.getContext('2d');
  g.font = font(Math.round(CELL * dpr));
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  rows.forEach((col, r) => {
    g.fillStyle = col;
    GLYPHS.forEach((ch, i) => g.fillText(ch, i * S + S / 2, r * S + S / 2));
  });
  const glow = (col) => {
    const n = 64, c = new OffscreenCanvas(n, n), x = c.getContext('2d');
    const gr = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, rgba(col, 0.9)); gr.addColorStop(0.25, rgba(col, 0.35)); gr.addColorStop(1, rgba(col, 0));
    x.fillStyle = gr; x.fillRect(0, 0, n, n);
    return c;
  };
  glowGold = glow(pal.gold);
  glowLeaf = glow(pal.leaf);
  charCache.clear();
}

let curA = 1;
function alpha(a) { if (a !== curA) { ctx.globalAlpha = a; curA = a; } }
// one glyph centred at (x, y); behind the page's words at a fifth of its strength
function glyph(ch, row, x, y, a = 1) {
  const i = GI[ch];
  if (i === undefined) return;
  alpha(inQuiet(x, y) ? a * 0.18 : a);
  const s = CELL * 1.25;
  ctx.drawImage(sheet, i * S, row * S, S, S, x - s / 2, y - s / 2, s, s);
}
// a typed character (anything): rendered once, kept
function charSprite(ch) {
  let c = charCache.get(ch);
  if (c) return c;
  if (charCache.size > 200) charCache.clear();
  c = new OffscreenCanvas(S * 2, S);
  const g = c.getContext('2d');
  g.font = font(Math.round(CELL * dpr));
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = pal.fg;
  g.fillText(ch, S, S / 2);
  charCache.set(ch, c);
  return c;
}

// ---- the plants ----
function grow(p, maxRows) {
  const R = rng(p.seed);
  const H = Math.max(2, Math.round(2 + p.size * (maxRows - 2) * (0.85 + R() * 0.15)));
  const cells = [];
  const stem = [];
  let x = 0;
  for (let y = 1; y <= H; y++) {
    let nx = x;
    if (y > 1 && y < H && R() < 0.28) nx = x + (x > 0 ? -1 : x < 0 ? 1 : R() < 0.5 ? -1 : 1);
    cells.push({ x: nx, y, g: nx > x ? '/' : nx < x ? '\\' : '|', c: STEM });
    x = nx; stem.push(x);
  }
  for (let y = 2; y < H; y++) {
    if (R() < 0.22 + p.size * 0.2) {
      const s = R() < 0.5 ? -1 : 1;
      cells.push({ x: stem[y - 1] + s, y, g: R() < 0.7 ? '~' : R() < 0.5 ? '❦' : '♣', c: LEAF });
    }
  }
  const nb = p.size < 0.2 ? 0 : 1 + Math.floor(p.size * 1.6 + p.size * 2.2 * R());
  for (let b = 0; b < nb && H > 3; b++) {
    const yb = 2 + Math.floor(R() * (H - 3));
    const dir = R() < 0.5 ? -1 : 1;
    const L = 1 + Math.floor(R() * (1 + p.size * 3));
    const bx = stem[yb - 1];
    for (let k = 1; k <= L; k++) cells.push({ x: bx + dir * k, y: yb + k, g: dir > 0 ? '/' : '\\', c: STEM });
    const tx = bx + dir * (L + 1), ty = yb + L + 1;
    if (p.recent) cells.push({ x: tx, y: ty, g: R() < 0.5 ? '✿' : '❀', c: FLOWER + p.hue, bloom: true });
    else cells.push({ x: tx, y: ty, g: R() < 0.6 ? '♣' : '*', c: R() < 0.6 ? LEAF : FLOWER + p.hue, a: 0.7 });
  }
  const top = stem[H - 1];
  if (p.recent) {
    cells.push({ x: top, y: H + 1, g: p.size > 0.55 ? '@' : '✿', c: FLOWER + p.hue, bloom: true });
    if (p.size > 0.55) {
      cells.push({ x: top - 1, y: H + 1, g: '*', c: FLOWER + p.hue, bloom: true });
      cells.push({ x: top + 1, y: H + 1, g: '*', c: FLOWER + p.hue, bloom: true });
      cells.push({ x: top, y: H + 2, g: '*', c: FLOWER + p.hue, bloom: true });
    }
  } else cells.push({ x: top, y: H + 1, g: '*', c: FLOWER + p.hue, a: 0.55 });
  p.cells = cells;
  p.H = H + 2;
}

function plant() {
  let list = projects && projects.length ? projects : DEFAULT;
  // only a few projects: small wild plants (no names) fill the bed out to about seven
  if (list !== DEFAULT && list.length < 7) list = [...list, ...DEFAULT.slice(0, 7 - list.length).map((d) => ({ ...d, size: d.size * 0.4, live: false }))];
  const chat = scene === 'chat';
  const old = new Map(plants.map((p) => [p.key, p]));
  plants = list.slice(0, chat ? 14 : 24).map((d, i) => {
    const key = d.name ? `n:${d.name}` : `d:${i}`;
    const seed = hash(key);
    const prev = old.get(key);
    const p = {
      key, name: d.name || '', seed, size: Math.max(0, Math.min(1, +d.size || 0)), recent: !!d.recent, live: !!d.live,
      hue: BLOOMS[seed % BLOOMS.length], phase: (seed % 1000) / 159, x: prev ? prev.x : w / 2, lean: 0, push: 0, kick: 0, kv: 0,
    };
    return p;
  });
  place(); // positions, then grows each to the room it has
}

// big plants where the page has room above them (outside the welcome column), small ones under it
function freeAt(x) {
  let free = gy;
  for (const r of quiet) if (x > r.x - 24 && x < r.x + r.w + 24 && r.y < gy) free = Math.min(free, Math.max(0, gy - (r.y + r.h) - 8));
  return free;
}
function place() {
  const n = plants.length;
  if (!n) return;
  const margin = Math.min(40, w * 0.04);
  const maxRows = scene === 'chat' ? 5 : Math.max(6, Math.min(19, Math.floor((h * 0.46) / CH)));
  const byPlant = plants.map((p, i) => i).sort((a, b) => plants[b].size - plants[a].size || a - b);
  if (!quiet.length) {
    // nothing on the page to keep clear: an even bed, big and small mixed
    const order = plants.map((p, i) => i).sort((a, b) => (plants[a].seed % 97) - (plants[b].seed % 97));
    order.forEach((pi, k) => { plants[pi].x = margin + ((w - margin * 2) * (k + 0.5)) / n + (rng(pi + 3)() - 0.5) * Math.min(20, (w / n) * 0.25); });
  } else {
    // the biggest plants take the spots with the most room above them (beside the welcome column), spaced apart;
    // the rest go under the column
    const R = rng(n * 131 + 7);
    const cand = [];
    for (let x = margin; x <= w - margin; x += 6) cand.push({ x, free: freeAt(x), j: R() * 30 });
    const taken = [];
    let gap = Math.max(36, Math.min(64, (w - margin * 2) / (n + 1)));
    for (const pi of byPlant) {
      let best = null;
      for (let tries = 0; tries < 3 && !best; tries++) {
        for (const c of cand) {
          if (taken.some((x) => Math.abs(x - c.x) < gap)) continue;
          if (!best || c.free + c.j > best.free + best.j) best = c;
        }
        if (!best) gap *= 0.6;
      }
      plants[pi].x = best ? best.x : margin + R() * (w - margin * 2);
      taken.push(plants[pi].x);
    }
  }
  // a plant under the page's words stays low
  for (const p of plants) {
    const free = quiet.length ? freeAt(p.x) : gy;
    const rows = free >= gy * 0.9 ? maxRows : Math.max(2, Math.min(maxRows, Math.floor(free / CH) - 2));
    grow(p, rows);
  }
}

// ---- the still layer: ground colour, sky, soil, labels ----
function buildBase() {
  base = new OffscreenCanvas(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
  const b = base.getContext('2d');
  b.setTransform(dpr, 0, 0, dpr, 0, 0);
  b.fillStyle = pal.bg;
  b.fillRect(0, 0, w, h);
  // a warm haze rising off the soil
  const haze = b.createLinearGradient(0, gy - (scene === 'chat' ? 60 : h * 0.4), 0, h);
  haze.addColorStop(0, rgba(pal.bg, 0));
  haze.addColorStop(0.75, mix(pal.bg, pal.accent, 0.06));
  haze.addColorStop(1, mix(pal.bg, pal.ink, 0.12));
  b.fillStyle = haze;
  b.fillRect(0, 0, w, h);
  const R = rng(97);
  const put = (ch, row, x, y, a) => {
    const i = GI[ch];
    b.globalAlpha = inQuiet(x, y) ? a * 0.18 : a;
    const s = CELL * 1.25;
    b.drawImage(sheet, i * S, row * S, S, S, x - s / 2, y - s / 2, s, s);
  };
  if (scene !== 'chat') {
    // the night sky: still stars, denser up high
    const n = Math.round((w * h) / 9000);
    for (let i = 0; i < n; i++) {
      const y = Math.pow(R(), 1.6) * (gy - h * 0.25);
      put(R() < 0.85 ? '·' : '.', FG, R() * w, y, 0.08 + R() * 0.22);
    }
    // a crescent moon in the top corner, in characters, with a faint halo
    const mx = w - Math.min(150, w * 0.12), my = Math.min(110, h * 0.14), MRp = CH * 4.2;
    const halo = b.createRadialGradient(mx, my, 0, mx, my, MRp * 3);
    halo.addColorStop(0, rgba(pal.fg, inQuiet(mx, my) ? 0.01 : 0.07));
    halo.addColorStop(1, rgba(pal.fg, 0));
    b.globalAlpha = 1;
    b.fillStyle = halo;
    b.fillRect(mx - MRp * 3, my - MRp * 3, MRp * 6, MRp * 6);
    // the lit part: inside the moon's disc, outside a second disc set up and to the left
    const sx = CW * 0.8, sy = CH * 0.62;
    const ox = -MRp * 0.42, oy = -MRp * 0.3, cr = MRp * 0.92;
    for (let py = -MRp; py <= MRp; py += sy) {
      for (let px = -MRp; px <= MRp; px += sx) {
        const d = Math.hypot(px, py), dc = Math.hypot(px - ox, py - oy);
        if (d > MRp || dc < cr) continue;
        const depth = Math.min(MRp - d, dc - cr) / MRp;
        const ch = depth > 0.13 ? '@' : depth > 0.07 ? '*' : depth > 0.03 ? ':' : '.';
        put(ch, FG, mx + px, my + py, 0.5 + Math.min(0.4, depth * 3));
      }
    }
  }
  // soil: two rows of crumbs under the grass
  const soilRows = scene === 'chat' ? 1 : 2;
  for (let r = 1; r <= soilRows; r++) {
    for (let x = CW / 2; x < w; x += CW) {
      const v = R();
      if (v < 0.35) continue;
      put(v < 0.6 ? '.' : v < 0.85 ? ':' : ',', SOIL, x + (R() - 0.5) * 3, gy + r * CH * 0.95, 0.5 + R() * 0.4);
    }
  }
  // each plant's name: a tiny label at its base, never under the page's words
  if (scene !== 'chat' && projects && projects.length) {
    b.globalAlpha = 1;
    b.font = font(9);
    b.textAlign = 'center';
    b.textBaseline = 'middle';
    const room = Math.max(30, (w / Math.max(1, plants.length)) * 0.9);
    for (const p of plants) {
      if (!p.name) continue;
      let s = p.name;
      while (s.length > 3 && b.measureText(s).width > room) s = s.slice(0, -1);
      if (s !== p.name) s = s.slice(0, -1) + '…';
      const y = gy + CH * 1.45;
      const tw = b.measureText(s).width;
      if (inQuiet(p.x - tw / 2, y) || inQuiet(p.x + tw / 2, y) || inQuiet(p.x, y)) continue;
      b.fillStyle = pal.bg;
      b.globalAlpha = 0.85;
      b.fillRect(p.x - tw / 2 - 3, y - 6, tw + 6, 12);
      b.globalAlpha = p.live ? 0.95 : 0.7;
      b.fillStyle = p.live ? pal.leaf : pal.ink;
      b.fillText(s, p.x, y + 0.5);
    }
  }
  b.globalAlpha = 1;
  twinkles = [];
  if (scene !== 'chat') for (let i = 0; i < 14; i++) twinkles.push({ x: R() * w, y: Math.pow(R(), 1.4) * (gy - h * 0.3), p: R() * 7 });
}

function layout() {
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  curA = 1; ctx.globalAlpha = 1;
  CELL = scene === 'chat' ? 12 : 14;
  CW = CELL * 0.68;
  CH = CELL * 1.02;
  gy = h - (scene === 'chat' ? 1.6 : 2.6) * CH;
  buildSheet();
  plant();
  buildBase();
  const n = scene === 'chat' ? 5 : 14;
  if (flies.length < n) for (let i = flies.length; i < n; i++) flies.push(newFly());
  for (const f of flies) { f.x = Math.min(f.x, w); f.y = Math.min(f.y, gy); }
}

function newFly() {
  const R = Math.random;
  return { x: R() * w, y: gy - 20 - R() * Math.min(h * 0.45, 320), vx: 0, vy: 0, p: R() * 10, follow: R() < 0.65, life: 1 };
}

function windAt(x, t) {
  // a gust that rolls left to right, plus a breath of air that never quite stops
  const gust = wind * (0.55 + 0.45 * Math.sin(t * 1.6 - x / 170)) * 1.5;
  const air = (1 - hush) * 0.22 * Math.sin(t * 0.7 + x / 260);
  return gust + air;
}

export default {
  init(a) {
    cv = a.canvas; ctx = cv.getContext('2d', { alpha: false });
    w = a.width; h = a.height; dpr = a.dpr; scene = a.scene; reduce = !!a.reduce;
    setColors(a.colors || {});
    layout();
  },
  resize(r) { w = r.width; h = r.height; dpr = r.dpr; layout(); },
  theme(t) { setColors(t.colors || {}); buildSheet(); buildBase(); },
  data(d) {
    projects = d && Array.isArray(d.projects) ? d.projects.filter((p) => p && typeof p === 'object') : null;
    if (cv) { plant(); buildBase(); }
  },
  event(e) {
    if (e.type === 'click') {
      // a puff of pollen, and the plants near it shiver
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 110;
        motes.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 1.4 + Math.random(), age: 0, g: Math.random() < 0.7 ? '·' : '*', c: Math.random() < 0.5 ? GOLD : FLOWER + BLOOMS[(Math.random() * BLOOMS.length) | 0], fall: 28 });
      }
      for (const p of plants) {
        const d = Math.abs(p.x - e.x);
        if (d < 160 && e.y > gy - p.H * CH - 60) p.kv += (p.x > e.x ? 1 : -1) * (1 - d / 160) * 9;
      }
    }
    if (e.type === 'type' && e.text) {
      // the typed characters fall as seeds, from under the box you type in
      const box = quiet.length > 1 ? [...quiet].sort((a, b) => a.y - b.y)[1] : null;
      for (const ch of [...e.text].slice(0, 8)) {
        if (!ch.trim()) continue;
        const x = box ? box.x + 20 + Math.random() * Math.max(10, box.w - 40) : w * (0.2 + Math.random() * 0.6);
        const y = box ? box.y + box.h : gy - h * 0.35;
        seeds.push({ ch, x, y, vx: (Math.random() - 0.5) * 30, vy: 10 + Math.random() * 30, age: 0, landed: -1 });
      }
      if (seeds.length > 40) seeds.splice(0, seeds.length - 40);
    }
  },
  frame(f) {
    if (f.scene && f.scene !== scene) { scene = f.scene; layout(); }
    const q = f.quiet || [];
    const key = q.map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`).join(';');
    if (key !== quietKey) { quiet = q; quietKey = key; place(); buildBase(); }
    const t = f.t, dt = Math.min(0.1, f.dt || 0);
    clock = t;
    const proc = f.process || 'idle';
    const waiting = proc === 'wait';
    const thinking = proc === 'think' || proc === 'start';
    const busy = proc !== 'idle' && !waiting;
    const ease = (v, to, k) => v + (to - v) * Math.min(1, dt * k);
    wind = reduce ? 0.25 : ease(wind, busy ? 1 : 0, 0.8);
    lift = ease(lift, thinking ? 1 : 0, 1.2);
    hush = ease(hush, waiting ? 1 : 0, 1.5);
    const chat = scene === 'chat';

    curA = 1; ctx.globalAlpha = 1;
    ctx.drawImage(base, 0, 0, w, h);

    // stars that twinkle
    for (const s of twinkles) {
      const v = 0.5 + 0.5 * Math.sin(t * 1.3 + s.p * 3);
      glyph(v > 0.8 ? '*' : '·', FG, s.x, s.y, 0.12 + v * 0.35 * (1 - hush * 0.5));
    }

    // grass: a row of blades that lean with the wind
    const m = f.mouse;
    for (let x = CW / 2, i = 0; x < w; x += CW * 0.9, i++) {
      const hsh = (i * 2654435761) >>> 0;
      const ch = [',', "'", '"', '`', 'ı', ',', ';', "'"][hsh % 8];
      let lean = windAt(x, t) * 2.2;
      if (m && Math.abs(m.y - gy) < 60) { const d = x - m.x; if (Math.abs(d) < 50) lean += Math.sign(d) * (1 - Math.abs(d) / 50) * 3; }
      glyph(ch, (hsh >> 8) % 11 === 0 ? FLOWER + BLOOMS[(hsh >> 4) % BLOOMS.length] : GRASS, x + lean, gy + ((hsh >> 3) % 3) - 1, 0.85);
    }

    // the plants
    const near = m && m.y > gy - h * 0.6;
    for (const p of plants) {
      let target = windAt(p.x, t) * (0.6 + p.size * 0.6) + Math.sin(t * (p.live ? 1.6 : 0.6) + p.phase) * (p.live ? 0.55 : 0.18) * (1 - hush * 0.8);
      if (near) {
        const d = p.x - m.x, top = gy - p.H * CH;
        if (Math.abs(d) < 150 && m.y > top - 80) target += Math.sign(d || 1) * (1 - Math.abs(d) / 150) * 2.2;
      }
      p.lean = reduce ? target : ease(p.lean, target, 3);
      // a click's shiver: a damped spring
      p.kv += (-p.kick * 22 - p.kv * 3.2) * dt;
      p.kick += p.kv * dt;
      const L = (p.lean + p.kick) * CW;
      const glow = p.live ? 0.55 + 0.45 * Math.sin(t * 2.4 + p.phase) : 0;
      if (p.live && !chat) {
        // a soft light around the plant that is running now
        ctx.globalCompositeOperation = 'lighter';
        for (const c of p.cells) {
          if (!c.bloom) continue;
          const k = Math.pow(c.y / p.H, 1.5);
          const x = p.x + c.x * CW + L * k, y = gy - c.y * CH;
          alpha((inQuiet(x, y) ? 0.05 : 0.22) * glow);
          ctx.drawImage(glowGold, x - CELL * 1.6, y - CELL * 1.6, CELL * 3.2, CELL * 3.2);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      for (const c of p.cells) {
        const k = Math.pow(c.y / p.H, 1.5);
        glyph(c.g, c.c, p.x + c.x * CW + L * k, gy - c.y * CH + Math.abs(L) * k * 0.08, (c.a || 1) * (c.bloom && p.live ? 0.8 + 0.2 * glow : 1));
      }
    }

    // seeds: the typed characters fall, land, become a sprout, and fade
    for (const s of seeds) {
      s.age += dt;
      if (s.landed < 0) {
        s.vy += 140 * dt;
        s.x += (s.vx + windAt(s.x, t) * 40) * dt;
        s.y += s.vy * dt;
        if (s.y >= gy - CH * 0.6) { s.y = gy - CH * 0.6; s.landed = s.age; }
        const sp = charSprite(s.ch);
        alpha(inQuiet(s.x, s.y) ? 0.18 : 0.9);
        ctx.drawImage(sp, s.x - CELL, s.y - CELL / 2, CELL * 2, CELL);
      } else {
        const a = s.age - s.landed;
        const fade = a < 4 ? 1 : Math.max(0, 1 - (a - 4) / 2.5);
        if (a < 0.5) { alpha(1 - a * 2); ctx.drawImage(charSprite(s.ch), s.x - CELL, s.y - CELL / 2, CELL * 2, CELL); }
        const stage = Math.min(3, Math.floor(a / 0.45));
        const lean = windAt(s.x, t) * 0.8;
        if (stage === 0) glyph('.', LEAF, s.x, gy - CH * 0.4, fade);
        else {
          glyph(stage === 1 ? ',' : '|', STEM, s.x, gy - CH * 0.7, fade);
          if (stage >= 2) glyph('~', LEAF, s.x + CW * 0.7 + lean * 3, gy - CH * 1.1, fade);
          if (stage >= 3) glyph(s.ch.charCodeAt(0) % 3 ? '♣' : '*', s.ch.charCodeAt(0) % 3 ? LEAF : GOLD, s.x + lean * 4, gy - CH * 1.6, fade);
        }
      }
    }
    seeds = seeds.filter((s) => s.landed < 0 || s.age - s.landed < 6.5);

    if (!reduce) {
      // pollen rising off the blooms while Claude thinks
      if (lift > 0.1 && Math.random() < lift * (chat ? 0.15 : 0.6)) {
        const p = plants[(Math.random() * plants.length) | 0];
        if (p) {
          const c = p.cells[(Math.random() * p.cells.length) | 0];
          motes.push({ x: p.x + c.x * CW, y: gy - c.y * CH, vx: (Math.random() - 0.5) * 12, vy: -18 - Math.random() * 26, life: 3 + Math.random() * 2, age: 0, g: '·', c: Math.random() < 0.6 ? GOLD : FLOWER + p.hue, fall: 0 });
        }
      }
      // leaves riding the wind
      if (wind > 0.35 && leavesAir.length < (chat ? 4 : 16) && Math.random() < wind * 0.08) {
        leavesAir.push({ x: -10, y: gy - 10 - Math.random() * Math.min(h * 0.5, 360), v: 70 + Math.random() * 80, p: Math.random() * 6, g: Math.random() < 0.6 ? '~' : Math.random() < 0.5 ? '❦' : '.' });
      }
    }
    for (const l of leavesAir) {
      l.x += l.v * (0.4 + wind) * dt;
      l.y += Math.sin(t * 3 + l.p) * 22 * dt + 4 * dt;
      glyph(l.g, LEAF, l.x, l.y, 0.75);
    }
    leavesAir = leavesAir.filter((l) => l.x < w + 20);
    for (const o of motes) {
      o.age += dt;
      o.vy += o.fall * dt;
      o.vx *= 1 - dt * 1.2; o.vy *= o.fall ? 1 - dt * 1.2 : 1;
      o.x += (o.vx + Math.sin(t * 2 + o.age * 3) * 6) * dt;
      o.y += o.vy * dt;
      glyph(o.g, o.c, o.x, o.y, Math.max(0, 1 - o.age / o.life) * 0.9);
    }
    motes = motes.filter((o) => o.age < o.life);
    if (motes.length > 260) motes.splice(0, motes.length - 260);

    // fireflies: wander over the garden, follow the pointer, more of them while Claude thinks, dim while it waits
    const want = (chat ? 4 : 12) + Math.round(lift * (chat ? 3 : 16));
    while (flies.length < want) flies.push(newFly());
    if (flies.length > want) for (const fl of flies.slice(want)) fl.life = Math.min(fl.life, 0.99);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < flies.length; i++) {
      const fl = flies[i];
      if (fl.life < 1) fl.life -= dt * 0.6;
      const pace = 1 - hush * 0.75;
      if (!reduce) {
        let ax = (Math.random() - 0.5) * 90, ay = (Math.random() - 0.5) * 70 - lift * 26;
        if (m && fl.follow) {
          const tx = m.x + Math.cos(fl.p + t * 0.9) * 46, ty = m.y + Math.sin(fl.p * 1.3 + t * 1.1) * 34;
          ax += (tx - fl.x) * 1.6; ay += (ty - fl.y) * 1.6;
        } else {
          const top = gy - Math.min(h * (chat ? 0.12 : 0.55), 420);
          if (fl.y < top) ay += 40; if (fl.y > gy - 12) ay -= 60;
        }
        fl.vx = (fl.vx + ax * dt) * (1 - dt * 1.4);
        fl.vy = (fl.vy + ay * dt) * (1 - dt * 1.4);
        fl.x += fl.vx * dt * pace; fl.y += fl.vy * dt * pace;
        if (fl.x < -20) fl.x = w + 10; if (fl.x > w + 20) fl.x = -10;
        if (fl.y < -20 && lift > 0.3) { Object.assign(fl, newFly(), { y: gy - 10 }); }
      }
      const blink = Math.max(0, Math.sin(t * (1.4 + (i % 5) * 0.23) + fl.p));
      const a = (0.25 + 0.75 * blink) * (1 - hush * 0.6) * Math.max(0, Math.min(1, fl.life));
      const q = inQuiet(fl.x, fl.y) ? 0.2 : 1;
      alpha(a * 0.5 * q);
      const r = CELL * (1.4 + blink * 0.8);
      ctx.drawImage(glowGold, fl.x - r, fl.y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < flies.length; i++) {
      const fl = flies[i];
      const blink = Math.max(0, Math.sin(t * (1.4 + (i % 5) * 0.23) + fl.p));
      glyph('•', GOLD, fl.x, fl.y, (0.35 + 0.65 * blink) * (1 - hush * 0.6) * Math.max(0, Math.min(1, fl.life)));
    }
    flies = flies.filter((fl) => fl.life > 0);
    alpha(1);
  },
};
