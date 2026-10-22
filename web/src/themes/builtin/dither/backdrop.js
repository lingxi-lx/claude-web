// 抖动 · Dither: a ringed planet, lit from the left, shaded on a low-resolution grid (one cell = one pixel) and then
// reduced to 1-bit the way the old comparison reels do it: THRESHOLD, BAYER 4×4, FLOYD–STEINBERG, BLUE NOISE. The
// algorithm changes every few seconds behind a sweeping edge; a lens under the pointer shows another one. The planet
// turns (its bands and its storm drift by), faster while Claude thinks; a click sends a shock ring through the
// picture; typed characters are rasterised and dithered too, and dissolve as they fade. Canvas 2D in the backdrop
// worker: the grid is written into an ImageData at one pixel per cell and scaled up without smoothing, then a
// pattern lays the gaps of the dot grid over it — no per-cell drawing calls at all.
const ALGO = ['THRESHOLD 50%', 'BAYER 4×4', 'FLOYD–STEINBERG', 'BLUE NOISE'];
const SHORT = ['THR', 'BAY', 'F–S', 'BLU'];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((b) => (b + 0.5) / 16);
const HUD = { idle: 'IDLE', start: 'INKING', think: 'THINKING', read: 'READING', search: 'SEARCHING', edit: 'EDITING', cmd: 'RUNNING', test: 'PROOFING', git: 'GIT', install: 'INSTALLING', web: 'FETCHING', agent: 'SPLITTING', plan: 'PLANNING', tool: 'TOOL', wait: 'HOLD', compact: 'COMPACTING', connect: 'LINKING' };
const CELL = 6;          // CSS px per cell
const HOLD = 9;          // seconds an algorithm stays
const SWEEP = 2.4;       // seconds the edge takes to cross
const FONT = '11px ui-monospace, Consolas, monospace';
const FONT_B = '600 13px ui-monospace, Consolas, monospace';

let cv, ctx, small, sctx, img, u32, tile, pattern;
let W = 0, H = 0, dpr = 1, scene = 'welcome', reduce = false;
let cd = 6, cols = 0, rows = 0, n = 0;
let V, Tn, E, Q, SKY, bits = [], need = [false, false, false, false];
let quietKey = '';
let col = { bg: '#1c1b19', ink: '#efe6d1', acc: '#ff6a3d', dim: '#8d846f', fg2: '#b6ac96' };
let px = { bg: 0, ink: 0, acc: 0, qink: 0, qacc: 0 };
let clk = 9, phase = 0, spin = 0.12; // the reel opens on BAYER 4×4 (index 1)
let rings = [];
let glyphs = [];
let caret = 0;
let BN = null; // 64×64 blue-noise ranks
const BNS = 64;
let hudBlink = 0;
let primed = false;

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const pack = (c) => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
const mix = (a, b, k) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k));

function setColors(c) {
  col = { bg: c.bg || col.bg, ink: c.fg || col.ink, acc: c.accent || col.acc, dim: c['fg-3'] || col.dim, fg2: c['fg-2'] || col.fg2 };
  const g = rgb(col.bg), i = rgb(col.ink), a = rgb(col.acc);
  px = { bg: pack(g), ink: pack(i), acc: pack(a), qink: pack(mix(g, i, 0.17)), qacc: pack(mix(g, a, 0.2)) };
  makeTile();
}

// blue noise by "put the next dot in the biggest void" on a torus — once, about 4096² cheap steps
function blueNoise() {
  const N = BNS, NN = N * N, R = 5, S = 1.7;
  const K = new Float32Array((2 * R + 1) * (2 * R + 1));
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) K[(y + R) * (2 * R + 1) + x + R] = Math.exp(-(x * x + y * y) / (2 * S * S));
  const en = new Float32Array(NN);
  let seed = 7;
  for (let i = 0; i < NN; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; en[i] = (seed / 0x7fffffff) * 1e-4; }
  const rank = new Float32Array(NN);
  const done = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) {
    let best = 0, be = Infinity;
    for (let i = 0; i < NN; i++) if (!done[i] && en[i] < be) { be = en[i]; best = i; }
    done[best] = 1;
    rank[best] = (k + 0.5) / NN;
    const bx = best % N, by = (best / N) | 0;
    for (let y = -R; y <= R; y++) {
      const yy = ((by + y) % N + N) % N;
      for (let x = -R; x <= R; x++) en[yy * N + (((bx + x) % N) + N) % N] += K[(y + R) * (2 * R + 1) + x + R];
    }
  }
  return rank;
}

function makeTile() {
  if (!cd) return;
  // one cell of the grid: ground on the right and bottom edge, see-through elsewhere
  tile = new OffscreenCanvas(cd, cd);
  const t = tile.getContext('2d');
  const gap = Math.max(1, Math.round(dpr));
  t.fillStyle = col.bg;
  t.fillRect(cd - gap, 0, gap, cd);
  t.fillRect(0, cd - gap, cd, gap);
  pattern = ctx ? ctx.createPattern(tile, 'repeat') : null;
}

function layout() {
  cv.width = Math.max(1, Math.round(W * dpr));
  cv.height = Math.max(1, Math.round(H * dpr));
  cd = Math.max(3, Math.round(CELL * dpr));
  cols = Math.ceil(cv.width / cd);
  rows = Math.ceil(cv.height / cd);
  n = cols * rows;
  V = new Float32Array(n);
  Tn = new Float32Array(n);
  E = new Float32Array(n + cols + 2);
  Q = new Uint8Array(n);
  SKY = new Float32Array(n);
  for (let y = 0, i = 0; y < rows; y++) for (let x = 0; x < cols; x++, i++) SKY[i] = sky(x, y);
  bits = [0, 1, 2, 3].map(() => new Uint8Array(n));
  small = new OffscreenCanvas(cols, rows);
  sctx = small.getContext('2d');
  img = sctx.createImageData(cols, rows);
  u32 = new Uint32Array(img.data.buffer);
  quietKey = '';
  makeTile();
}

function setQuiet(quiet) {
  const key = quiet.map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`).join(';');
  if (key === quietKey) return;
  quietKey = key;
  Q.fill(0);
  const pad = 10, k = dpr / cd;
  for (const r of quiet) {
    const x0 = Math.max(0, Math.floor((r.x - pad) * k)), x1 = Math.min(cols - 1, Math.ceil((r.x + r.w + pad) * k));
    const y0 = Math.max(0, Math.floor((r.y - pad) * k)), y1 = Math.min(rows - 1, Math.ceil((r.y + r.h + pad) * k));
    for (let y = y0; y <= y1; y++) Q.fill(1, y * cols + x0, y * cols + x1 + 1);
  }
}

// ---- the picture -------------------------------------------------------------------------------------------------
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// the planet's frame: axis a (tilted toward us so the ring opens), and two vectors across it
const tilt = 0.24, open = 0.42;
const AX = [Math.cos(open) * Math.sin(tilt), -Math.cos(open) * Math.cos(tilt), Math.sin(open)];
const E1 = (() => { const v = [Math.cos(tilt), Math.sin(tilt), 0]; return v; })();
const E2 = [AX[1] * E1[2] - AX[2] * E1[1], AX[2] * E1[0] - AX[0] * E1[2], AX[0] * E1[1] - AX[1] * E1[0]];
const LL = (() => { const v = [-0.6, -0.42, 0.68]; const m = Math.hypot(...v); return v.map((x) => x / m); })();
const LA = LL[0] * AX[0] + LL[1] * AX[1] + LL[2] * AX[2];
const RI = 1.24, RO = 2.27;

// the ring's radial profile and the planet's belts, as lookup tables (no sin per cell)
const RL = 1024;
const RING = new Float32Array(RL + 1);
for (let k = 0; k <= RL; k++) RING[k] = ringProfile(RI + ((RO - RI) * k) / RL);
const ringDensity = (r) => (r < RI || r > RO ? 0 : RING[((r - RI) * (RL / (RO - RI))) | 0]);
const BL = 1024;
const BELT = new Float32Array(BL + 1);
for (let k = 0; k <= BL; k++) {
  const sl = -1.2 + (2.4 * k) / BL;
  BELT[k] = 0.74 + 0.2 * Math.sin(sl * 13 + 0.5 * Math.sin(sl * 5)) + 0.08 * Math.sin(sl * 31);
}
const belt = (sl) => BELT[Math.max(0, Math.min(BL, ((sl + 1.2) * (BL / 2.4)) | 0))];

function ringProfile(r) {
  let d;
  if (r < 1.52) d = 0.22 + 0.1 * Math.sin(r * 40);          // C ring, faint
  else if (r < 1.95) d = 0.9 + 0.08 * Math.sin(r * 70);      // B ring, dense
  else if (r < 2.03) d = 0.06;                               // Cassini division
  else if (r < 2.2 || r > 2.23) d = 0.66 + 0.08 * Math.sin(r * 90); // A ring, Encke gap at 2.2
  else d = 0.08;
  return d;
}

function sky(x, y) {
  const h = hash(x, y);
  if (h < 0.0012) return 0.55 + 0.35 * hash(y, x); // a few stars
  const k = y / rows;
  return 0.003 + 0.009 * k * k;
}

// The planet's geometry does not change while it turns — only the longitude does. So the per-cell work that is
// static (which cells, the light on them, the ring's shadow, where the ring crosses) is done once per layout, into a
// flat list; a frame only adds the turning belts, the storm and the ring's spokes.
let geo = null;
function buildGeo(pcx, pcy, R) {
  const key = `${pcx.toFixed(2)},${pcy.toFixed(2)},${R.toFixed(2)},${cols},${rows}`;
  if (geo && geo.key === key) return geo;
  const bx = 2.32 * R;
  const x0 = Math.max(0, Math.floor(pcx - bx)), x1 = Math.min(cols - 1, Math.ceil(pcx + bx));
  const y0 = Math.max(0, Math.floor(pcy - bx)), y1 = Math.min(rows - 1, Math.ceil(pcy + bx));
  const iR = 1 / R;
  const cap = (x1 - x0 + 1) * (y1 - y0 + 1);
  const g = {
    key, len: 0, idx: new Int32Array(cap), kind: new Uint8Array(cap), sl: new Float32Array(cap), lon: new Float32Array(cap),
    lit: new Float32Array(cap), dens: new Float32Array(cap), ring: new Float32Array(cap), rl: new Float32Array(cap),
  };
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - pcy) * iR;
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - pcx) * iR;
      const r2 = dx * dx + dy * dy;
      if (r2 > RO * RO) continue;
      // where the line of sight crosses the ring plane
      const tr = -(dx * AX[0] + dy * AX[1]) / AX[2];
      const pr = Math.sqrt(r2 + tr * tr);
      const dens = ringDensity(pr);
      if (r2 >= 1 && dens <= 0) continue;
      const k = g.len++;
      g.idx[k] = y * cols + x;
      if (dens > 0) {
        // the planet's shadow on the ring
        const pl = dx * LL[0] + dy * LL[1] + tr * LL[2];
        const shadow = pl < 0 && pr * pr - pl * pl < 1;
        g.dens[k] = dens;
        g.ring[k] = shadow ? 0.04 : 0.72;
        g.rl[k] = Math.atan2(dx * E2[0] + dy * E2[1] + tr * E2[2], dx * E1[0] + dy * E1[1] + tr * E1[2]) * 7 + pr * 3;
      }
      if (r2 < 1) {
        const z = Math.sqrt(1 - r2);
        const nl = dx * LL[0] + dy * LL[1] + z * LL[2];
        let lit = nl > 0 ? nl * (1.25 - 0.25 * nl) : 0;
        const sl = dx * AX[0] + dy * AX[1] + z * AX[2];
        // the ring's shadow on the planet
        const sr = -sl / LA;
        if (sr > 0) {
          const qx = dx + sr * LL[0], qy = dy + sr * LL[1], qz = z + sr * LL[2];
          const dq = ringDensity(Math.sqrt(qx * qx + qy * qy + qz * qz));
          if (dq) lit *= 1 - 0.8 * dq;
        }
        g.lit[k] = (0.07 + lit) * (0.6 + 0.4 * z);
        g.sl[k] = sl;
        g.lon[k] = Math.atan2(dx * E2[0] + dy * E2[1] + z * E2[2], dx * E1[0] + dy * E1[1] + z * E1[2]);
        g.kind[k] = dens > 0 && tr > z ? 2 : 1; // 2: the ring passes in front
      } else g.kind[k] = 0;
    }
  }
  geo = g;
  return g;
}

// shade the planet, its ring and its moons into V (and a tint into Tn)
function paintPlanet(pcx, pcy, R, moons) {
  const g = buildGeo(pcx, pcy, R);
  const iR = 1 / R;
  const spotLon = 1.2, TAU = 6.2832;
  const sp = phase * 0.6;
  for (let k = 0; k < g.len; k++) {
    const i = g.idx[k], kind = g.kind[k], dens = g.dens[k];
    const ringV = dens > 0 ? Math.min(1, g.ring[k] * (1 + 0.12 * Math.sin(g.rl[k] - sp))) : 0;
    if (kind === 0) { V[i] = V[i] * (1 - dens) + ringV * dens; continue; }
    // latitude and longitude on the turning planet; the belts' edges wave with longitude
    const sl = g.sl[k];
    const lon = g.lon[k] + phase;
    let band = belt(sl + 0.022 * Math.sin(lon * 3 + sl * 9));
    // the storm, a bright oval in the southern belt
    let dl = lon - spotLon; dl -= Math.round(dl / TAU) * TAU;
    const sa = dl * 2.4, sb = (sl + 0.36) * 9, sd = sa * sa + sb * sb;
    if (sd < 1) band += 0.3 * (1 - sd);
    let v = band * g.lit[k] * 1.3;
    if (kind === 2) v = v * (1 - dens * 0.85) + ringV * dens; // the ring in front
    V[i] = v;
  }
  // moons: little lit spheres on an orbit tilted like the ring
  for (const m of moons) {
    const ox = Math.cos(m.a) * m.o, oz = Math.sin(m.a) * m.o;
    const mx = pcx + (ox * E1[0] + oz * E2[0]) * R, my = pcy + (ox * E1[1] + oz * E2[1]) * R;
    const mz = ox * E1[2] + oz * E2[2];
    const mr = m.r * R;
    const behind = mz < 0;
    for (let y = Math.max(0, Math.floor(my - mr)); y <= Math.min(rows - 1, Math.ceil(my + mr)); y++) {
      for (let x = Math.max(0, Math.floor(mx - mr)); x <= Math.min(cols - 1, Math.ceil(mx + mr)); x++) {
        const dx = (x + 0.5 - mx) / mr, dy = (y + 0.5 - my) / mr, r2 = dx * dx + dy * dy;
        if (r2 >= 1) continue;
        if (behind) {
          const px_ = (x + 0.5 - pcx) * iR, py_ = (y + 0.5 - pcy) * iR;
          if (px_ * px_ + py_ * py_ < 1) continue;
        }
        const z = Math.sqrt(1 - r2);
        const nl = dx * LL[0] + dy * LL[1] + z * LL[2];
        V[y * cols + x] = (0.03 + Math.max(0, nl)) * 0.95;
        Tn[y * cols + x] = m.tint;
      }
    }
  }
}

// ---- the four ways to 1 bit --------------------------------------------------------------------------------------
function dither(a) {
  const out = bits[a];
  if (a === 0) { for (let i = 0; i < n; i++) out[i] = V[i] > 0.5 ? 1 : 0; return; }
  if (a === 1) {
    for (let y = 0, i = 0; y < rows; y++) { const row = (y & 3) * 4; for (let x = 0; x < cols; x++, i++) out[i] = V[i] > BAYER[row + (x & 3)] ? 1 : 0; }
    return;
  }
  if (a === 3) {
    for (let y = 0, i = 0; y < rows; y++) { const row = (y & (BNS - 1)) * BNS; for (let x = 0; x < cols; x++, i++) out[i] = V[i] > BN[row + (x & (BNS - 1))] ? 1 : 0; }
    return;
  }
  // Floyd–Steinberg, serpentine, on a scratch copy
  E.set(V);
  for (let y = 0; y < rows; y++) {
    const ltr = (y & 1) === 0;
    const last = y === rows - 1;
    for (let k = 0; k < cols; k++) {
      const x = ltr ? k : cols - 1 - k;
      const i = y * cols + x;
      const o = E[i];
      const b = o > 0.5 ? 1 : 0;
      out[i] = b;
      const e = o - b;
      if (e === 0) continue;
      const f = ltr ? 1 : -1;
      const xf = x + f, xb = x - f;
      if (xf >= 0 && xf < cols) E[i + f] += e * 0.4375;
      if (!last) {
        const j = i + cols;
        if (xb >= 0 && xb < cols) E[j - f] += e * 0.1875;
        E[j] += e * 0.3125;
        if (xf >= 0 && xf < cols) E[j + f] += e * 0.0625;
      }
    }
  }
}

// rasterise one typed character at cell resolution (a small canvas, read back once)
function rasterise(ch, G) {
  const c = new OffscreenCanvas(G, G);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, G, G);
  g.fillStyle = '#fff';
  g.font = `600 ${G - 2}px ui-monospace, Consolas, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, G / 2, G / 2 + 1);
  const d = g.getImageData(0, 0, G, G).data;
  const m = new Float32Array(G * G);
  for (let i = 0; i < G * G; i++) m[i] = (d[i * 4] || 0) / 255;
  return m;
}

function label(text, x, y, color, font) {
  ctx.font = font || FONT;
  const wdt = ctx.measureText(text).width;
  ctx.fillStyle = col.bg;
  ctx.fillRect(x - 4, y - 3, wdt + 8, (font === FONT_B ? 13 : 11) + 6);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  return wdt;
}

export default {
  init(a) {
    cv = a.canvas; ctx = cv.getContext('2d', { alpha: false });
    W = a.width; H = a.height; dpr = a.dpr || 1; scene = a.scene; reduce = !!a.reduce;
    BN = blueNoise();
    layout();
    setColors(a.colors || {});
    prime();
  },
  resize(r) { W = r.width; H = r.height; dpr = r.dpr || 1; layout(); prime(); },
  theme(t) { setColors(t.colors || {}); },
  data() {},
  event(e) {
    if (!cols) return;
    if (e.type === 'click') rings.push({ x: (e.x * dpr) / cd, y: (e.y * dpr) / cd, t: 0 });
    if (e.type === 'type' && e.text && scene === 'welcome') {
      // big dithered letters in the open sky left of the planet, under the labels
      const G = 15;
      const x0 = Math.round((24 * dpr) / cd), y0 = Math.round((112 * dpr) / cd);
      const room = (W * dpr) / cd * 0.69 - 2.3 * Math.min(((W * dpr) / cd) * 0.12, ((H * dpr) / cd) * 0.2) - x0;
      const per = Math.max(2, Math.floor(room / (G - 3)));
      for (const ch of [...e.text].slice(0, 8)) {
        if (ch === ' ') { caret++; continue; }
        if (/\s/.test(ch)) continue;
        const slot = caret++ % per;
        glyphs.push({ m: rasterise(ch, G), G, x: x0 + slot * (G - 3), y: y0, age: 0 });
      }
      if (glyphs.length > 24) glyphs.splice(0, glyphs.length - 24);
    }
  },
  frame(f) { render(f); },
};

// reduced motion gets one frame; render it once ahead (with nothing on the page) so the loops are warm when it counts
function prime() {
  primed = false;
  if (!reduce) return;
  render({ t: 0, dt: 0, mouse: null, process: 'idle', quiet: [] });
  primed = true;
}

function render(f) {
    if (!cols) return;
    const dt = Math.min(0.1, f.dt || 0);
    clk += dt;
    const proc = f.process || 'idle';
    const chat = scene === 'chat';
    setQuiet(f.quiet || []);
    const target = proc === 'think' || proc === 'start' ? 0.85 : proc === 'wait' ? 0.02 : proc === 'idle' ? 0.12 : 0.3;
    spin += (target - spin) * Math.min(1, dt * 2);
    phase += spin * dt;
    hudBlink += dt;

    // which algorithm, and the sweeping edge to the next one
    const cyc = clk / HOLD;
    const A = Math.floor(cyc) % 4;
    const B = (A + 1) % 4;
    const into = (clk % HOLD) - (HOLD - SWEEP);
    const p = into > 0 ? into / SWEEP : -1;
    const span = cols + rows * 0.5;
    const edge = p >= 0 ? -6 + p * (span + 12) : -1e9;

    // the lens
    const m = f.mouse && !chat && !reduce ? f.mouse : null;
    const LR = 11;
    const mcx = m ? (m.x * dpr) / cd : 0, mcy = m ? (m.y * dpr) / cd : 0;
    const LA_ = (A + 2) % 4;
    const LR2 = LR * LR, LR2o = (LR + 1) * (LR + 1);

    const wcell = (W * dpr) / cd, hcell = (H * dpr) / cd;
    let pcx, pcy, R;
    if (chat) { R = Math.min(wcell * 0.13, hcell * 0.2); pcx = wcell - R * 1.1; pcy = hcell - R * 0.75; }
    else { R = Math.min(wcell * 0.12, hcell * 0.2); pcx = wcell * 0.69; pcy = hcell * 0.28; }

    // ---- shade (a reduced-motion still keeps the grids it primed; only the page's words change)
    if (!(reduce && primed)) {
    V.set(SKY);
    Tn.fill(0);
    const moons = [{ a: clk * 0.15 + 2.2, o: 3.1, r: 0.12, tint: 0 }];
    if (proc === 'agent') for (let k = 0; k < 4; k++) moons.push({ a: clk * 0.9 + k * 1.571, o: 2.55, r: 0.085, tint: 1 });
    paintPlanet(pcx, pcy, R, moons);

    // a test strip: the same ramp, under whichever algorithm owns that corner
    if (!chat) {
      const sx = Math.round(24 * dpr / cd), sy = Math.round(78 * dpr / cd), sw = Math.round(170 * dpr / cd), sh = 3;
      for (let y = sy; y < sy + sh && y < rows; y++) for (let x = sx; x < sx + sw && x < cols; x++) V[y * cols + x] = 1 - (x - sx + 0.5) / sw;
    }

    // shock rings: a bright annulus that runs out from the click
    for (const g of rings) {
      g.t += dt;
      const r = g.t * 34, w = 2.2, amp = Math.max(0, 1 - g.t / 1.5) * 0.9;
      const ro = r + 3 * w, ri = Math.max(0, r - 3 * w);
      for (let y = Math.max(0, Math.floor(g.y - ro)); y <= Math.min(rows - 1, Math.ceil(g.y + ro)); y++) {
        const dy = y + 0.5 - g.y;
        const xo = Math.sqrt(Math.max(0, ro * ro - dy * dy)), xi = Math.sqrt(Math.max(0, ri * ri - dy * dy));
        for (const [a0, a1] of [[g.x - xo, g.x - xi], [g.x + xi, g.x + xo]]) {
          for (let x = Math.max(0, Math.floor(a0)); x <= Math.min(cols - 1, Math.ceil(a1)); x++) {
            const ex = x + 0.5 - g.x, d = Math.sqrt(ex * ex + dy * dy) - r;
            const k = amp * Math.exp(-(d * d) / (w * w));
            if (k < 0.04) continue;
            const i = y * cols + x;
            V[i] = Math.min(1.2, V[i] + k);
            if (k > 0.3) Tn[i] = 1;
          }
        }
      }
    }
    rings = rings.filter((g) => g.t < 1.5);

    // typed glyphs: fade, rise a little; the dither eats them as they go
    for (const g of glyphs) {
      g.age += dt;
      const k = g.age < 0.25 ? g.age / 0.25 : Math.max(0, 1 - (g.age - 0.25) / 3.2);
      const gy = Math.round(g.y + g.age * 1.6);
      for (let y = 0; y < g.G; y++) {
        const yy = gy + y;
        if (yy < 0 || yy >= rows) continue;
        for (let x = 0; x < g.G; x++) {
          const xx = g.x + x;
          if (xx < 0 || xx >= cols) continue;
          const v = g.m[y * g.G + x] * k;
          if (v < 0.03) continue;
          const i = yy * cols + xx;
          if (v > V[i]) V[i] = v;
          Tn[i] = 1;
        }
      }
    }
    glyphs = glyphs.filter((g) => g.age < 3.5);

    // ---- which grids are needed this frame
    need[0] = need[1] = need[2] = need[3] = false;
    if (reduce && !chat) need[0] = need[1] = need[2] = need[3] = true;
    else { need[A] = true; if (p >= 0) need[B] = true; if (m) need[LA_] = true; }
    for (let a = 0; a < 4; a++) if (need[a]) dither(a);
    }

    // ---- compose
    const qcx = Math.floor(pcx), qcy = Math.floor(pcy);
    const cInk = px.ink, cAcc = px.acc, cQi = px.qink, cQa = px.qacc, cBg = px.bg;
    // one span of a row from one grid: ink, or the accent where something typed / a shock lit it; faint behind words
    const span_ = (src, i0, i1) => {
      for (let i = i0; i < i1; i++) u32[i] = src[i] ? (Tn[i] > 0.5 ? (Q[i] ? cQa : cAcc) : Q[i] ? cQi : cInk) : cBg;
    };
    if (reduce && !chat) {
      // the still: the planet quartered, one algorithm per quarter
      const cx = Math.max(0, Math.min(cols, qcx));
      for (let y = 0; y < rows; y++) {
        const row = y * cols, top = y < qcy ? 0 : 2;
        span_(bits[top], row, row + cx);
        span_(bits[top + 1], row + cx, row + cols);
      }
    } else {
      const bA = bits[A], bB = bits[B];
      for (let y = 0; y < rows; y++) {
        const row = y * cols;
        // left of the sweeping edge the next algorithm has already taken over
        const xs = p >= 0 ? Math.max(0, Math.min(cols, Math.ceil(edge - y * 0.5))) : 0;
        if (xs) span_(bB, row, row + xs);
        span_(bA, row + xs, row + cols);
        if (p >= 0) {
          // the edge itself, and a ▓▒░ fade behind it
          const e = edge - y * 0.5;
          for (let x = Math.max(0, Math.floor(e - 4)); x <= Math.min(cols - 1, Math.ceil(e + 1)); x++) {
            const d = e - x;
            if (d <= -1 || d >= 4) continue;
            const b = BAYER[(y & 3) * 4 + (x & 3)];
            if (d < 1 || (d < 2 && b < 0.75) || (d < 3 && b < 0.5) || b < 0.25) u32[row + x] = Q[row + x] ? cQa : cAcc;
          }
        }
      }
      if (m) {
        // the lens: another algorithm inside, a dotted rim
        const bL = bits[LA_];
        for (let y = Math.max(0, Math.floor(mcy - LR - 1)); y <= Math.min(rows - 1, Math.ceil(mcy + LR + 1)); y++) {
          const ey = y + 0.5 - mcy;
          for (let x = Math.max(0, Math.floor(mcx - LR - 1)); x <= Math.min(cols - 1, Math.ceil(mcx + LR + 1)); x++) {
            const ex = x + 0.5 - mcx, dd = ex * ex + ey * ey;
            const i = y * cols + x;
            if (dd < LR2) span_(bL, i, i + 1);
            else if (dd < LR2o && (((Math.atan2(ey, ex) + clk * 0.4) * 3.82) & 1) === 0) u32[i] = Q[i] ? cQa : cAcc; // a dashed rim, turning slowly
          }
        }
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, cols * cd, rows * cd);
    if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'top';

    if (chat) return;
    // ---- the labels
    if (reduce) {
      const lx = (qcx * cd) / dpr, ly = (qcy * cd) / dpr;
      label('THRESHOLD', lx - 96, ly - R * cd / dpr - 26, col.fg2);
      label('BAYER 4×4', lx + 16, ly - R * cd / dpr - 26, col.fg2);
      label('FLOYD–STEINBERG', lx - 130, ly + R * cd / dpr + 14, col.fg2);
      label('BLUE NOISE', lx + 16, ly + R * cd / dpr + 14, col.fg2);
    } else {
      label(`DITHER  ${String(A + 1).padStart(2, '0')}/04`, 24, 24, col.dim);
      const name = p >= 0 ? `${ALGO[A]} → ${ALGO[B]}` : ALGO[A];
      label(name, 24, 44, col.ink, FONT_B);
      ctx.font = FONT;
      let lx = 24;
      for (let k = 0; k < 4; k++) {
        const s = (k === A ? '▪' : '·') + SHORT[k];
        lx += label(s, lx, 64, k === A ? col.acc : col.dim) + 12;
      }
      if (m) {
        const t = `◯ ${ALGO[LA_]}`, rr = (LR * cd) / dpr;
        ctx.font = FONT;
        const tw = ctx.measureText(t).width;
        const lx2 = m.x + rr + 8 + tw < W - 8 ? m.x + rr + 8 : m.x - rr - 8 - tw;
        label(t, lx2, m.y - rr, col.acc);
      }
      if (p >= 0) {
        // the edge's own tag, where it crosses the top of the screen
        const ex = (edge * cd) / dpr;
        if (ex > 0 && ex < W - 160) label(`▓▒░ ${SHORT[B]}`, ex + 6, 100, col.acc);
      }
    }
    const word = HUD[proc] || 'IDLE';
    const busy = proc !== 'idle';
    const on = busy && Math.floor(hudBlink * 2) % 2 === 0;
    const hud = `${proc === 'wait' ? '░' : on ? '█' : '▒'} ${word}`;
    ctx.font = FONT;
    const hw = ctx.measureText(hud).width;
    label(hud, W - hw - 28, 24, busy ? col.acc : col.dim);
}
