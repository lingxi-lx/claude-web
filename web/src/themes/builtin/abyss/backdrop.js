// 深海点阵 · Abyss: a jellyfish drawn in halftone dots (· • ●, the dot's size is the light) hangs in the dark water. Its
// bell pulses, four frilled arms and a dozen long tentacles trail behind it and lag when it moves; it drifts slowly and
// leans toward the pointer. Marine snow falls through faint shafts of light from far above. While Claude thinks, light
// runs down the tentacles; a search sends sonar rings out from the bell; sub-agents make it bud into three. A click
// pings sonar from the pointer, typed characters sink like plankton, and a small HUD in the corner reports the dive.
// Runs in the backdrop worker: Canvas 2D on an OffscreenCanvas; every dot is a cell of a pre-drawn sprite sheet.
const G = 9; // dot pitch, CSS px
const L = 8; // dot sizes on the sheet
const TAU = Math.PI * 2;
const SIGNAL = {
  idle: 'IDLE', start: 'DESCENT', think: 'BIOLUMINESCE', read: 'SAMPLING', search: 'SONAR', edit: 'TRACE', cmd: 'THRUST',
  test: 'PROBE', git: 'LOG', install: 'BALLAST', web: 'UPLINK', agent: 'BUDDING', plan: 'CHART', tool: 'ARM',
  wait: 'HOLDING', compact: 'PRESSURE', connect: 'TETHER',
};

let cv, ctx, w = 0, h = 0, dpr = 1, scene = 'welcome', reduce = false;
let C = { bg: '#0d0a16', bg1: '#08060f', fg: '#efeaff', fg2: '#b3a9db', fg3: '#857bb0', acc: '#b69cff', text: '#c4b0ff', blue: '#8ecbff', yellow: '#ffd57e', green: '#7debc6' };
let sheet = null, S = G;
let cols = 0, rows = 0, val = new Float32Array(0), tin = new Uint8Array(0), calm = new Uint8Array(0), quietKey = '';
let quiet = [];
let shade = null;
const J = { x: 0, y: 0, vx: 0, vy: 0, ang: 0, phase: 1.2, flinch: 0, glow: 0, placed: false };
let split = 0;
let rings = [];
let snow = [];
let plankton = [];
let clock = 0, lastPing = -10, depth = 4212, prevBusy = false;

// ---- colour ----
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// returns #rrggbb, so a mix can be mixed again
const mix = (a, b, t) => { const p = rgb(a), q = rgb(b); return '#' + [0, 1, 2].map((i) => Math.round(p[i] + (q[i] - p[i]) * t).toString(16).padStart(2, '0')).join(''); };
const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };

function setColors(c) {
  C = {
    bg: c.bg || C.bg, bg1: c['bg-1'] || C.bg1, fg: c.fg || C.fg, fg2: c['fg-2'] || C.fg2, fg3: c['fg-3'] || C.fg3,
    acc: c.accent || C.acc, text: c['accent-text'] || C.text, blue: c.blue || C.blue, yellow: c.yellow || C.yellow, green: c.green || C.green,
  };
}

// the sheet: L dot sizes in three inks — 0 the jellyfish (deep violet → white), 1 bioluminescence (cyan → white),
// 2 marine snow (dim lavender)
function buildSheet() {
  S = Math.max(2, Math.round(G * dpr));
  sheet = new OffscreenCanvas(S * L, S * 3);
  const g = sheet.getContext('2d');
  const inks = [[mix(C.acc, C.bg, 0.2), C.fg], [mix(C.blue, C.bg, 0.3), mix(C.blue, '#ffffff', 0.55)], [mix(C.fg3, C.bg, 0.35), C.fg2]];
  for (let t = 0; t < 3; t++) {
    for (let k = 0; k < L; k++) {
      g.fillStyle = mix(inks[t][0], inks[t][1], k / (L - 1));
      g.beginPath();
      g.arc(k * S + S / 2, t * S + S / 2, Math.max(0.5, (0.55 + k * 0.5) * dpr), 0, TAU);
      g.fill();
    }
  }
}

function layout() {
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cols = Math.ceil(w / G);
  rows = Math.ceil(h / G);
  val = new Float32Array(cols * rows);
  tin = new Uint8Array(cols * rows);
  calm = new Uint8Array(cols * rows);
  lit = new Int32Array(cols * rows);
  nlit = 0;
  shaft = new Float32Array(cols + rows + 2);
  quietKey = '';
  shade = ctx.createLinearGradient(0, 0, 0, h);
  shade.addColorStop(0, mix(C.bg, C.acc, 0.07));
  shade.addColorStop(0.45, C.bg);
  shade.addColorStop(1, C.bg1);
  buildSheet();
  const n = scene === 'chat' ? 34 : 150;
  snow = [];
  for (let i = 0; i < n; i++) snow.push({ x: Math.random() * w, y: Math.random() * h, vy: 4 + Math.random() * 11, ph: Math.random() * TAU, k: (Math.random() * 3) | 0 });
}

function updateCalm() {
  const key = quiet.map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`).join(';');
  if (key === quietKey) return;
  quietKey = key;
  calm.fill(0);
  const P = 10;
  for (const r of quiet) {
    const x0 = Math.max(0, Math.floor((r.x - P) / G)), x1 = Math.min(cols - 1, Math.floor((r.x + r.w + P) / G));
    const y0 = Math.max(0, Math.floor((r.y - P) / G)), y1 = Math.min(rows - 1, Math.floor((r.y + r.h + P) / G));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) calm[y * cols + x] = 1;
  }
}
const calmAt = (px, py) => { const x = (px / G) | 0, y = (py / G) | 0; return x >= 0 && y >= 0 && x < cols && y < rows && calm[y * cols + x] === 1; };

// the cells lit this frame, so the drawing pass visits only those
let lit = new Int32Array(0), nlit = 0;
function put(px, py, v, t) {
  const x = (px / G) | 0, y = (py / G) | 0;
  if (x < 0 || y < 0 || x >= cols || y >= rows) return;
  const i = y * cols + x;
  if (v > val[i]) {
    if (val[i] === 0) lit[nlit++] = i;
    val[i] = v; tin[i] = t;
  }
}
let shaft = new Float32Array(0);

// where the bell's scalloped margin is, for a point across it (nx in −1…1)
const bellCut = (nx, phase, c) => 0.2 + 0.05 * Math.cos(nx * 16 + phase * 0.5) - 0.08 * c;

// one row of the bell, cell by cell: lit from above, a bright rim and scalloped margin, radial canals, four gonad loops
// (a small function of its own: it warms up fast, which matters for the single frame drawn when motion is reduced)
function bellRow(o, gy, x0, x1, Rx, Ry, ca, sa, c) {
  const t = clock;
  const py = gy * G + G / 2 - o.y;
  for (let gx = x0; gx <= x1; gx++) {
    const px = gx * G + G / 2 - o.x;
    const lx = px * ca + py * sa, ly = -px * sa + py * ca;
    const nx = lx / Rx, ny = ly / Ry;
    const d2 = nx * nx + ny * ny;
    if (d2 > 1) continue;
    const cut = bellCut(nx, o.phase, c);
    if (ny > cut) continue;
    const d = Math.sqrt(d2);
    let v = 0.07 + 0.14 * Math.max(0, -ny);
    v += 0.85 * d2 * d2 * d2 * d2;
    if (cut - ny < 0.1) v += 0.42;
    const th = Math.atan2(nx, -ny);
    if (d > 0.25) v += 0.22 * Math.pow(Math.abs(Math.cos(th * 2)), 12);
    const rr = d - 0.42;
    v += 0.62 * Math.exp(-rr * rr * 110) * (0.4 + 0.6 * Math.cos(th * 4 + 0.8));
    v = v * o.bright + 0.04 * Math.sin(gx * 1.7 + gy * 2.3 + t * 2);
    const i = gy * cols + gx;
    if (v > val[i]) {
      if (val[i] === 0) lit[nlit++] = i;
      val[i] = v; tin[i] = o.pulse > 0.3 && d > 0.88 ? 1 : 0;
    }
  }
}

// ---- the jellyfish ----
// o: { x, y, r, ang, phase, bright, pulse (light running down the tentacles, 0–1), lvx (its sideways speed, local) }
function jelly(o) {
  const t = clock;
  const R = o.r;
  const c = 0.5 + 0.5 * Math.sin(o.phase); // 1 = the bell contracted
  const Rx = R * (1 - 0.13 * c), Ry = R * (0.72 + 0.1 * c);
  const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
  const toX = (lx, ly) => o.x + lx * ca - ly * sa;
  const toY = (lx, ly) => o.y + lx * sa + ly * ca;
  const cutAt = (nx) => bellCut(nx, o.phase, c);

  // the bell, cell by cell: lit from above, a bright rim and scalloped margin, four radial canals, four gonad loops
  const ext = R * 1.15;
  const x0 = Math.max(0, Math.floor((o.x - ext) / G)), x1 = Math.min(cols - 1, Math.floor((o.x + ext) / G));
  const y0 = Math.max(0, Math.floor((o.y - ext) / G)), y1 = Math.min(rows - 1, Math.floor((o.y + ext) / G));
  for (let gy = y0; gy <= y1; gy++) bellRow(o, gy, x0, x1, Rx, Ry, ca, sa, c);

  const step = G * 0.72;
  // four frilled oral arms from under the bell
  for (let k = 0; k < 4; k++) {
    const bx = (k - 1.5) * 0.17 * Rx, by = 0.1 * Ry;
    const La = R * 1.75 * o.len;
    for (let s = 0; s < La; s += step) {
      const u = s / La;
      const sway = Math.sin(t * 0.9 - s * 0.035 + k * 1.7) * (3 + s * 0.16) - o.lvx * u * 0.5;
      const half = (1 - u) * R * 0.1 + 1.5;
      const lx = bx + sway, ly = by + s * (0.95 + 0.05 * c);
      const fr = 0.6 + 0.4 * Math.sin(s * 0.25 + t * 2 + k);
      const v = (0.5 - 0.3 * u) * o.bright;
      put(toX(lx, ly), toY(lx, ly), v, 0);
      put(toX(lx - half * fr, ly), toY(lx - half * fr, ly), v * 0.7, 0);
      put(toX(lx + half * fr, ly), toY(lx + half * fr, ly), v * 0.7, 0);
    }
  }

  // the long tentacles from the margin; light runs down them while thinking
  const NT = o.r > 40 ? 9 : 7;
  for (let k = 0; k < NT; k++) {
    const nx = -0.94 + (1.88 * k) / (NT - 1);
    const bx = nx * Rx * 0.97, by = cutAt(nx) * Ry * 0.9 + Ry * Math.max(0, 0.15 - Math.abs(nx) * 0.1);
    const Lt = R * (3.1 + 1.2 * ((k * 0.618) % 1)) * o.len;
    const phi = k * 0.9;
    for (let s = 0, n = 0; s < Lt; s += step, n++) {
      const u = s / Lt;
      const A = Math.pow(u, 1.2) * R * 0.5;
      const lx = bx + A * Math.sin(t * 1.05 - s * 0.028 + phi) - o.lvx * u * 1.2 + nx * s * 0.13;
      const ly = by + s * (0.93 + 0.07 * c);
      let v = (0.56 - 0.32 * u) * o.bright + (n % 6 === 0 ? 0.1 : 0);
      let tint = 0;
      // the running light: a strong train while thinking, a rare glimmer otherwise
      const train = Lt * 1.35;
      const pp = (t * R * (1.2 + 1.6 * o.pulse) + k * 41) % train;
      const g = Math.exp(-((s - pp) * (s - pp)) / (2 * G * G * 2.6));
      const amp = 0.18 + 0.85 * o.pulse;
      if (g * amp > 0.12) { v += g * amp; if (g * amp > 0.3) tint = 1; }
      put(toX(lx, ly), toY(lx, ly), v, tint);
    }
  }
}

function shaftRow(y, fall) {
  const sh = y * 0.42;
  for (let x = y & 1; x < cols; x += 2) { // every other cell, staggered by row: a halftone screen
    const v = shaft[(x + sh) | 0];
    if (v * fall > 0.05) put(x * G, y * G, v * fall, 2);
  }
}

// ---- sonar ----
function ring(g) {
  const r = g.t * g.spd;
  const fade = Math.max(0, 1 - g.t / g.life);
  for (let band = 0; band < 2; band++) {
    const rr = r - band * 16;
    if (rr <= 2) continue;
    const n = Math.max(14, Math.round((TAU * rr) / (G * 0.95)));
    const v = g.str * fade * (band ? 0.45 : 1);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      put(g.x + Math.cos(a) * rr, g.y + Math.sin(a) * rr, v, 1);
    }
  }
}

function drawLit(pass) {
  ctx.globalAlpha = pass ? 0.18 : 1;
  for (let j = 0; j < nlit; j++) {
    const i = lit[j];
    const v = val[i];
    if (v < 0.05 || calm[i] !== pass) continue;
    const lv = Math.min(L - 1, (v * L) | 0);
    const x = i % cols, y = (i / cols) | 0;
    ctx.drawImage(sheet, lv * S, tin[i] * S, S, S, x * G, y * G, G, G);
  }
}

function drawSnow(fall, dt) {
  let la = -1;
  for (const p of snow) {
    p.y += p.vy * fall;
    p.x += Math.sin(clock * 0.5 + p.ph) * 5 * dt;
    if (p.y > h + 6) { p.y = -6; p.x = Math.random() * w; }
    const a = calmAt(p.x, p.y) ? 0.15 : 0.75;
    if (a !== la) { ctx.globalAlpha = a; la = a; }
    ctx.drawImage(sheet, p.k * S, 2 * S, S, S, p.x - G / 2, p.y - G / 2, G, G);
  }
}

// ---- the HUD ----
function hud(proc, busy) {
  const blink = Math.floor(clock * 2) % 2 === 0;
  const word = proc === 'wait' ? 'STANDBY' : proc === 'connect' ? 'RECONNECT' : busy ? 'ACTIVE' : 'OPERATIONAL';
  const dot = busy ? (blink ? '●' : '○') : '●';
  const dm = Math.round(depth);
  const deep = dm >= 1000 ? `${Math.floor(dm / 1000)},${String(dm % 1000).padStart(3, '0')}` : String(dm);
  const x = 18, y = 16;
  ctx.font = '10px ui-monospace, Consolas, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = C.fg3;
  ctx.fillText('SYSTEM', x, y);
  ctx.fillText('DEPTH', x, y + 15);
  ctx.fillText('SIGNAL', x, y + 30);
  ctx.fillStyle = proc === 'wait' ? C.yellow : busy ? C.text : C.green;
  ctx.fillText(`${dot} ${word}`, x + 50, y);
  ctx.fillStyle = C.fg2;
  ctx.fillText(`${deep} m`, x + 50, y + 15);
  ctx.fillStyle = busy ? C.text : C.fg3;
  ctx.fillText(`▸ ${SIGNAL[proc] || 'IDLE'}`, x + 50, y + 30);
  // a depth gauge down the left edge, scrolling as the dive goes on
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = C.fg3;
  const top = 76, bot = h - 30, pitch = 14;
  const off = (depth * 3) % pitch;
  for (let yy = top + pitch - off; yy < bot; yy += pitch) {
    const n = Math.round((depth * 3 + (yy - top)) / pitch);
    const major = n % 5 === 0;
    ctx.fillRect(x, yy, major ? 9 : 4, 1);
    if (major && yy - top > 8) ctx.fillText(String(Math.round(depth + ((yy - top) / pitch) * 2)), x + 13, yy - 5);
  }
  ctx.globalAlpha = 1;
}

export default {
  init(a) {
    cv = a.canvas; ctx = cv.getContext('2d', { alpha: false });
    w = a.width; h = a.height; dpr = a.dpr || 1; scene = a.scene; reduce = !!a.reduce;
    setColors(a.colors || {});
    layout();
  },
  resize(r) { w = r.width; h = r.height; dpr = r.dpr || 1; layout(); J.placed = false; },
  theme(t) { setColors(t.colors || {}); layout(); },
  event(e) {
    if (e.type === 'click') {
      rings.push({ x: e.x, y: e.y, t: 0, spd: 240, life: 2.4, str: 0.85 });
      J.flinch = 1;
    }
    if (e.type === 'type' && e.text) {
      for (const ch of [...e.text].slice(0, 8)) {
        if (ch === ' ' || ch === '\n') continue;
        let x = 0, y = 0;
        for (let k = 0; k < 6; k++) {
          x = w * (0.08 + Math.random() * 0.84); y = 24 + Math.random() * h * 0.18;
          if (!calmAt(x, y)) break;
        }
        plankton.push({ ch, x, y, vy: 9 + Math.random() * 8, ph: Math.random() * TAU, t: 0 });
      }
      if (plankton.length > 60) plankton = plankton.slice(-60);
      J.glow = Math.min(1, J.glow + 0.25);
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
    const thinking = proc === 'think' || proc === 'start';
    const waiting = proc === 'wait';

    // ---- motion ----
    const R = chat ? Math.max(26, Math.min(40, Math.min(w, h) * 0.06)) : Math.max(56, Math.min(96, Math.min(w, h) * 0.11));
    const homeX = chat ? w - R * 2.4 : w - Math.max(R * 1.75, w * 0.1);
    const homeY = chat ? h * 0.36 : R * 1.25 + 16;
    const drift = waiting ? 0.3 : 1;
    let tx = homeX + Math.sin(clock * 0.05) * w * (chat ? 0.02 : 0.05) * drift;
    let ty = homeY + Math.sin(clock * 0.083 + 1) * h * (chat ? 0.03 : 0.05) * drift;
    let aim = Math.sin(clock * 0.2) * 0.12;
    if (f.mouse && !chat) {
      tx += Math.max(-w * 0.06, Math.min(w * 0.06, (f.mouse.x - homeX) * 0.08));
      ty += Math.max(-h * 0.05, Math.min(h * 0.05, (f.mouse.y - homeY) * 0.08));
      aim = Math.max(-0.3, Math.min(0.3, Math.atan2(f.mouse.x - J.x, -(f.mouse.y - J.y)) * 0.35));
    }
    if (!J.placed || reduce) { J.x = tx; J.y = ty; J.placed = true; }
    const pace = waiting ? 0.55 : thinking ? 3.3 : busy ? 2.2 : 1.5;
    const prevX = J.x, prevY = J.y;
    // the bell swims in beats: it moves most while contracting
    const beat = 0.35 + 0.65 * Math.max(0, Math.cos(J.phase));
    const k = Math.min(1, dt * 0.7 * beat);
    J.x += (tx - J.x) * k;
    J.y += (ty - J.y) * k - Math.max(0, Math.cos(J.phase)) * dt * (waiting ? 1 : 5);
    if (dt > 0) { J.vx += ((J.x - prevX) / dt - J.vx) * Math.min(1, dt * 2); J.vy += ((J.y - prevY) / dt - J.vy) * Math.min(1, dt * 2); }
    J.ang += (aim + J.vx * 0.004 - J.ang) * Math.min(1, dt * 1.2);
    J.phase += dt * pace + J.flinch * dt * 6;
    J.flinch = Math.max(0, J.flinch - dt * 1.5);
    J.glow += ((thinking ? 1 : 0) - J.glow) * Math.min(1, dt * 1.5);
    split += ((proc === 'agent' ? 1 : 0) - split) * Math.min(1, dt * 0.8);
    depth += dt * (waiting ? 0 : busy ? 3.2 : 0.35);

    if (proc === 'search' && clock - lastPing > (chat ? 2 : 1.25)) {
      lastPing = clock;
      rings.push({ x: J.x, y: J.y, t: 0, spd: chat ? 120 : 210, life: 2.8, str: 0.7 });
    }
    // when a run ends, one bright all-clear ping from the bell
    if (prevBusy && !busy) rings.push({ x: J.x, y: J.y, t: 0, spd: 300, life: 1.8, str: 1 });
    prevBusy = busy;

    // ---- the ground ----
    ctx.globalAlpha = 1;
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
    // the jellyfish's own glow in the water
    const glowA = (chat ? 0.08 : 0.1) + 0.12 * J.glow + 0.06 * J.flinch;
    const halo = ctx.createRadialGradient(J.x, J.y + R * 0.6, R * 0.2, J.x, J.y + R * 0.6, R * 3.4);
    halo.addColorStop(0, rgba(C.acc, glowA));
    halo.addColorStop(1, rgba(C.acc, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(J.x - R * 3.6, J.y - R * 3, R * 7.2, R * 7.2);

    for (let j = 0; j < nlit; j++) val[lit[j]] = 0;
    nlit = 0;
    // ---- light from far above: faint dotted shafts, slanted (welcome only). A shaft's strength depends only on
    // x + 0.42·y, so it is worked out once per slanted line and looked up per cell ----
    if (!chat) {
      const lim = Math.floor(rows * 0.55);
      const ns = Math.min(shaft.length, cols + Math.ceil(lim * 0.42) + 1);
      for (let s = 0; s < ns; s++) {
        const p = s * G;
        const v = Math.sin(p * 0.012 + clock * 0.12) + 0.6 * Math.sin(p * 0.027 - clock * 0.09 + 1.3);
        shaft[s] = v > 1.05 ? (v - 1.05) * 0.5 : 0;
      }
      for (let y = 0; y < lim; y++) shaftRow(y, (1 - y / lim) * (1 - y / lim));
    }

    // ---- the jellyfish (or three, while sub-agents run) ----
    const lvx = (J.vx * Math.cos(J.ang) + J.vy * Math.sin(J.ang));
    const bright = (waiting ? 0.78 : 1) + 0.1 * J.glow;
    const len = chat ? 0.8 : 1;
    if (split < 0.02) {
      jelly({ x: J.x, y: J.y, r: R, ang: J.ang, phase: J.phase, bright, pulse: J.glow, lvx, len });
    } else {
      const s = split;
      jelly({ x: J.x + s * R * 0.2, y: J.y, r: R * (1 - 0.3 * s), ang: J.ang + 0.1 * s, phase: J.phase, bright, pulse: J.glow, lvx, len });
      jelly({ x: J.x - s * R * 1.8, y: J.y - s * R * 0.12, r: R * (0.2 + 0.42 * s), ang: J.ang - 0.25 * s, phase: J.phase + 1.9, bright, pulse: J.glow, lvx, len: len * 0.8 });
      jelly({ x: J.x - s * R * 3.3, y: J.y + s * R * 0.15, r: R * (0.15 + 0.36 * s), ang: J.ang - 0.35 * s, phase: J.phase + 3.6, bright, pulse: J.glow, lvx, len: len * 0.7 });
    }

    // ---- sonar rings ----
    for (const g of rings) { g.t += dt; ring(g); }
    rings = rings.filter((g) => g.t < g.life);

    // ---- every lit cell, as a dot of its size; behind the page's words at a fifth ----
    drawLit(0);
    drawLit(1);

    // ---- marine snow, off the grid ----
    drawSnow(dt * (waiting ? 0.3 : busy ? 1.4 : 1), dt);

    // ---- typed characters, sinking like plankton ----
    if (plankton.length) {
      ctx.font = '13px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const p of plankton) {
        p.t += dt;
        p.y += p.vy * dt * (waiting ? 0.4 : 1);
        const x = p.x + Math.sin(clock * 0.9 + p.ph) * 7;
        const life = Math.max(0, Math.min(1, p.t * 2, (16 - p.t) / 5));
        const a = life * (calmAt(x, p.y) ? 0.18 : 0.9);
        ctx.globalAlpha = a * 0.35;
        ctx.drawImage(sheet, 5 * S, 1 * S, S, S, x - G / 2, p.y - G / 2, G, G);
        ctx.globalAlpha = a;
        ctx.fillStyle = C.text;
        ctx.fillText(p.ch, x, p.y);
      }
      plankton = plankton.filter((p) => p.t < 16 && p.y < h + 10);
    }

    ctx.globalAlpha = 1;
    if (!chat) hud(proc, busy);
  },
};
