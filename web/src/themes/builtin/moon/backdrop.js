// 月光字雨 · Moonfall: a crescent moon of glowing dots hangs high in a night-blue sky; from its light, kanji and kana
// (月 光 夜 風 雨 静 夢 星 あ の か …) drift down slowly and settle into a soft drift along the bottom, which melts away
// grain by grain. The falling characters part around the pointer; a click scatters them and kicks up the drift. What
// you type rises from the page toward the moon and brightens it. While Claude thinks the moon runs through its phases;
// while it waits for you a cloud drifts over the moon and the snow of words slows. A verse of 静夜思 writes itself in a
// vertical column at the left. Canvas 2D in the backdrop worker; every glyph is a pre-rendered sprite.
const FONT = 'ui-monospace, Consolas, monospace';
const CHARS = [...'月光夜風雨静夢星雪花空影音宵霧露夕水白雲波鏡涼あのかさくらゆきよつみほしはなそしずゆめ'];
const VERSE = ['床前明月光', '疑是地上霜', '挙頭望明月', '低頭思故郷'];
const TAU = Math.PI * 2;
const PH0 = 1.08; // the resting phase: a young crescent, lit on the right
const PAD = 10;

let cv, ctx, w = 0, h = 0, dpr = 1, scene = 'welcome', reduce = false;
let col = { sky: '#080c1b', bg: '#0c1124', line: '#2a3560', fg: '#e9edf8', fg2: '#a2acca', dim: '#7a85a8', ac: '#a8c6ff' };
let ground = null, glowSp = null, cloudSp = null, moonCv = null, moonKey = '';
const sprites = new Map();
let parts = [];
let pile = [], PC = 15, pcols = 0, prows = 4;
let rings = [];
let twinkles = [];
let moon = { x: 0, y: 0, R: 80 };
let phase = PH0, cloudOff = -5, pulse = 0, clock = 0;
let spawnAcc = 0, meltAcc = 0, liftAcc = 0, dripAcc = 0;
let quiet = [];

// ---- colour helpers ----
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
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const mk = (a, b) => new OffscreenCanvas(Math.max(1, Math.ceil(a)), Math.max(1, Math.ceil(b)));
const inQuiet = (x, y) => {
  for (let i = 0; i < quiet.length; i++) {
    const r = quiet[i];
    if (x > r.x - PAD && x < r.x + r.w + PAD && y > r.y - PAD && y < r.y + r.h + PAD) return true;
  }
  return false;
};

// a glyph drawn once, with a soft glow, at device resolution; drawn later with drawImage
function sprite(ch, size, color) {
  const key = ch + '|' + size + '|' + color;
  let s = sprites.get(key);
  if (s) return s;
  if (sprites.size > 600) sprites.clear();
  const S = Math.ceil(size * 2);
  const c = mk(S * dpr, S * dpr);
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  x.font = `${size}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.shadowColor = rgba(color, 0.75);
  x.shadowBlur = size * 0.45;
  x.fillStyle = color;
  x.fillText(ch, S / 2, S / 2);
  x.shadowBlur = 0;
  x.fillText(ch, S / 2, S / 2);
  s = { c, S };
  sprites.set(key, s);
  return s;
}
function put(ch, size, color, x, y, a) {
  if (a <= 0.01) return;
  const s = sprite(ch, size, color);
  ctx.globalAlpha = quiet.length && inQuiet(x, y) ? a * 0.18 : a;
  ctx.drawImage(s.c, x - s.S / 2, y - s.S / 2, s.S, s.S);
}

// ---- the static pieces: sky, glow, cloud ----
function buildGround() {
  ground = mk(w * dpr, h * dpr);
  const x = ground.getContext('2d');
  x.scale(dpr, dpr);
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, col.sky);
  g.addColorStop(0.6, col.bg);
  g.addColorStop(1, mix(col.bg, col.line, 0.6));
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  // a faint band of the milky way, diagonal
  const n = Math.round((w * h) / (scene === 'chat' ? 9000 : 5200));
  x.fillStyle = col.fg;
  for (let i = 0; i < n; i++) {
    const band = Math.random() < 0.45;
    let sx = Math.random() * w, sy = Math.random() * h * 0.8;
    if (band) { const u = Math.random(); sx = u * w; sy = h * 0.05 + u * h * 0.45 + gauss() * h * 0.08; }
    x.globalAlpha = 0.08 + Math.random() * (band ? 0.25 : 0.4);
    x.beginPath();
    x.arc(sx, sy, 0.35 + Math.random() * 0.8, 0, TAU);
    x.fill();
  }
  x.globalAlpha = 1;
  twinkles = [];
  const tn = scene === 'chat' ? 8 : 22;
  for (let i = 0; i < tn; i++) twinkles.push({ x: Math.random() * w, y: Math.random() * h * 0.6, ph: Math.random() * TAU, sp: 0.6 + Math.random() * 1.4, s: Math.random() < 0.3 ? 11 : 8 });
}

function buildGlow() {
  const S = 256;
  glowSp = mk(S, S);
  const x = glowSp.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, rgba(col.ac, 0.5));
  g.addColorStop(0.18, rgba(col.ac, 0.22));
  g.addColorStop(0.45, rgba(col.ac, 0.06));
  g.addColorStop(1, rgba(col.ac, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
}

// the cloud, in moon radii around its middle: wide, flat-bottomed, tall enough to hide the whole moon
const BLOBS = [[-1.55, 0.3, 0.95, 0.62], [-0.55, -0.25, 1.15, 0.95], [0.6, -0.1, 1.2, 0.92], [1.7, 0.28, 0.9, 0.6], [0, 0.5, 2.3, 0.5]];
const CW = 6.4, CH = 3.2;
function buildCloud() {
  const R = moon.R, W = R * CW, H = R * CH;
  cloudSp = mk(W * dpr, H * dpr);
  const x = cloudSp.getContext('2d');
  x.scale(dpr, dpr);
  const cx = W / 2, cy = H / 2;
  const path = () => {
    x.beginPath();
    for (const [bx, by, rx, ry] of BLOBS) { x.moveTo(cx + bx * R + rx * R, cy + by * R); x.ellipse(cx + bx * R, cy + by * R, rx * R, ry * R, 0, 0, TAU); }
  };
  // a soft body, its edge blurred into the sky
  const body = mix(col.sky, col.line, 0.32);
  path();
  x.fillStyle = body;
  x.shadowColor = body;
  x.shadowBlur = R * 0.35;
  x.globalAlpha = 0.97;
  x.fill();
  x.shadowBlur = 0;
  x.save();
  path();
  x.clip();
  // moonlit from behind: a silver top edge fading down, and a fine dot texture like the moon's
  const g = x.createLinearGradient(0, cy - R * 1.2, 0, cy + R * 0.4);
  g.addColorStop(0, rgba(col.fg, 0.2));
  g.addColorStop(1, rgba(col.fg, 0));
  x.globalAlpha = 1;
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.fillStyle = col.fg2;
  const s = Math.max(4, R / 10);
  for (let yy = 0; yy < H; yy += s) for (let xx = ((yy / s) & 1) * s / 2; xx < W; xx += s) {
    x.globalAlpha = 0.05 + 0.16 * (1 - yy / H);
    x.beginPath(); x.arc(xx, yy, 0.75, 0, TAU); x.fill();
  }
  x.restore();
}

// the moon as halftone dots: each dot's size is the light falling on that part of the sphere
function renderMoon() {
  const R = moon.R;
  const key = Math.round(phase * 60) + '|' + R + '|' + col.fg;
  if (key === moonKey && moonCv) return;
  moonKey = key;
  const S = R * 2 + 10;
  if (!moonCv || moonCv.width !== Math.ceil(S * dpr)) moonCv = mk(S * dpr, S * dpr);
  const x = moonCv.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, S, S);
  const c = S / 2, g = Math.max(4.2, R / 10.5);
  const sp = Math.sin(phase), cp = Math.cos(phase);
  x.fillStyle = col.fg;
  let row = 0;
  for (let gy = -R; gy <= R; gy += g * 0.87, row++) {
    for (let gx = -R + (row & 1 ? g / 2 : 0); gx <= R; gx += g) {
      const nx = gx / R, ny = gy / R, rr = nx * nx + ny * ny;
      if (rr > 1) continue;
      const z = Math.sqrt(1 - rr);
      const b = nx * sp - z * cp;
      const lit = clamp((b + 0.04) / 0.3, 0, 1);
      const lim = 0.72 + 0.28 * z;
      const r = g * 0.5 * (0.14 + 0.86 * lit * lim);
      x.globalAlpha = 0.1 + 0.9 * lit;
      x.beginPath();
      x.arc(c + gx, c + gy, r, 0, TAU);
      x.fill();
    }
  }
  // the old moon in the new moon's arms: a faint rim around the dark part
  x.globalAlpha = 0.14;
  x.strokeStyle = col.fg;
  x.lineWidth = 1;
  x.beginPath(); x.arc(c, c, R + 1, 0, TAU); x.stroke();
  x.globalAlpha = 1;
}

// ---- layout ----
function layout() {
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const chat = scene === 'chat';
  if (chat) moon = { R: 30, x: w - 64, y: 60 };
  else {
    const R = Math.round(clamp(Math.min(w, h) * 0.105, 46, 104));
    moon = { R, x: Math.round(w * 0.78), y: Math.round(Math.max(R + 34, h * 0.2)) };
  }
  sprites.clear();
  moonKey = '';
  buildGround();
  buildGlow();
  buildCloud();
  // the drift along the bottom, already there: low dunes
  PC = chat ? 14 : 15;
  prows = chat ? 1 : 4;
  pcols = Math.max(1, Math.ceil(w / PC));
  pile = [];
  const p1 = Math.random() * TAU, p2 = Math.random() * TAU;
  for (let c = 0; c < pcols; c++) {
    const dune = 0.5 + 0.3 * Math.sin(c * 0.13 + p1) + 0.2 * Math.sin(c * 0.37 + p2);
    const n = Math.round(clamp(dune, 0, 1) * (prows - 1) + Math.random() * 0.8);
    const st = [];
    for (let r = 0; r < n; r++) st.push({ ch: CHARS[(Math.random() * CHARS.length) | 0], a: 0.3 + Math.random() * 0.3 });
    pile.push(st);
  }
  // the air already has words in it
  parts = [];
  const seed = chat ? 26 : 90;
  for (let i = 0; i < seed; i++) spawn(true);
}

function spawn(seed) {
  const chat = scene === 'chat';
  const d = Math.random();
  const size = d < 0.5 ? 12 : d < 0.82 ? 16 : d < 0.95 ? 20 : 26;
  const near = Math.random() < (chat ? 0.35 : 0.6);
  let x = near ? moon.x + gauss() * w * 0.24 : Math.random() * w;
  x = clamp(x, 4, w - 4);
  let y = seed ? Math.random() * h * 0.92 : near ? moon.y + moon.R * (0.4 + Math.random() * 1.4) : -24;
  const vb = (9 + size * 1.05) * (0.8 + Math.random() * 0.4);
  parts.push({
    kind: 0, x, y, vx: 0, vy: vb, vb, size,
    ch: CHARS[(Math.random() * CHARS.length) | 0],
    color: Math.random() < 0.1 ? col.ac : col.fg,
    a: 0.3 + (size / 26) * 0.55,
    age: seed ? 9 : 0, ph: Math.random() * TAU,
  });
}

// a character rising to the moon along a curve
function rise(ch, sx, sy, color) {
  const tx = moon.x + gauss() * moon.R * 0.3, ty = moon.y + gauss() * moon.R * 0.3;
  parts.push({
    kind: 1, ch, color, size: 18, sx, sy, tx, ty,
    cx: (sx + tx) / 2 + gauss() * w * 0.12, cy: Math.min(sy, ty) + (sy - ty) * 0.2,
    u: 0, dur: 3.2 + Math.random() * 1.6, x: sx, y: sy, a: 1,
  });
}
function bez(p, u) {
  const v = 1 - u;
  return [v * v * p.sx + 2 * v * u * p.cx + u * u * p.tx, v * v * p.sy + 2 * v * u * p.cy + u * u * p.ty];
}

function drawPile() {
  const base = h - 6;
  for (let c = 0; c < pcols; c++) {
    const st = pile[c];
    for (let r = 0; r < st.length; r++) {
      const g = st[r];
      put(g.ch, 13, col.fg, c * PC + PC / 2, base - (r + 0.5) * PC, g.a * (0.55 + 0.45 * (r + 1) / prows));
    }
  }
}

export default {
  init(a) {
    cv = a.canvas; ctx = cv.getContext('2d', { alpha: false });
    w = a.width; h = a.height; dpr = a.dpr || 1; scene = a.scene || 'welcome'; reduce = !!a.reduce;
    setColors(a.colors || {});
    layout();
  },
  resize(r) { w = r.width; h = r.height; dpr = r.dpr || 1; layout(); },
  theme(t) { setColors(t.colors || {}); sprites.clear(); moonKey = ''; if (cv) { buildGround(); buildGlow(); buildCloud(); } },
  event(e) {
    if (e.type === 'click') {
      rings.push({ x: e.x, y: e.y, t: 0 });
      // scatter the air around the click
      for (const p of parts) {
        if (p.kind) continue;
        const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
        if (d > 280) continue;
        const f = 420 * (1 - d / 280);
        p.vx += (dx / d) * f; p.vy += (dy / d) * f - 60;
      }
      // and kick the drift up into it
      const c0 = Math.floor((e.x - 160) / PC), c1 = Math.ceil((e.x + 160) / PC);
      for (let c = Math.max(0, c0); c < Math.min(pcols, c1); c++) {
        const st = pile[c];
        const near = 1 - Math.abs(c * PC - e.x) / 160;
        let k = Math.round(st.length * near * (e.y > h - 220 ? 1 : 0.5));
        while (k-- > 0 && st.length && parts.length < 320) {
          const g = st.pop();
          const x = c * PC + PC / 2, y = h - 6 - (st.length + 0.5) * PC;
          const dx = x - e.x || 1;
          parts.push({ kind: 0, x, y, vx: Math.sign(dx) * (40 + Math.random() * 160), vy: -(120 + Math.random() * 220), vb: 18 + Math.random() * 14, size: 13, ch: g.ch, color: col.fg, a: 0.75, age: 9, ph: Math.random() * TAU });
        }
      }
    }
    if (e.type === 'type' && e.text) {
      const chars = [...e.text].filter((c) => c.trim()).slice(0, 14);
      const n = chars.length;
      chars.forEach((ch, i) => rise(ch, w * 0.5 + (i - n / 2) * 16 + gauss() * 30, h * 0.6 + gauss() * 14, col.ac));
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
    const pace = waiting ? 0.3 : thinking ? 1.35 : proc === 'compact' ? 1.5 : busy ? 1.15 : 1;
    const chat = scene === 'chat';

    // the moon's phase: round and round while thinking, then on to the resting crescent
    if (thinking) phase += dt * 1.5;
    else {
      const d = (((PH0 - phase) % TAU) + TAU) % TAU;
      if (d > 0.015) phase += Math.min(d, dt * 1.8);
    }
    phase %= TAU;
    // the cloud: drifts in over the moon while waiting, drifts on past it afterwards
    if (waiting) cloudOff += (0 - cloudOff) * Math.min(1, dt * 0.8);
    else if (cloudOff > -4.9) { cloudOff += dt * 0.9; if (cloudOff > 5) cloudOff = -5; }
    const cover = clamp(1 - Math.abs(cloudOff) / 1.7, 0, 1);
    pulse = Math.max(0, pulse - dt * 0.6);

    // sky
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(ground, 0, 0, w, h);
    for (const s of twinkles) {
      const a = 0.12 + 0.55 * Math.max(0, Math.sin(clock * s.sp + s.ph));
      put(s.s > 9 ? '✦' : '·', s.s, col.fg, s.x, s.y, a);
    }

    // the moon and its light
    const mq = quiet.length && inQuiet(moon.x, moon.y) ? 0.2 : 1;
    const breathe = thinking ? 0.85 + 0.3 * Math.sin(clock * 3.2) : 0.8;
    const G = moon.R * 7;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp((breathe + pulse) * (1 - 0.75 * cover) * mq, 0, 1);
    // the glow leans toward the lit side (a crescent glows from its edge, a full moon from its middle)
    const gx = moon.x + moon.R * 0.5 * Math.sin(phase);
    ctx.drawImage(glowSp, gx - G / 2, moon.y - G / 2, G, G);
    ctx.globalCompositeOperation = 'source-over';
    renderMoon();
    const S = moon.R * 2 + 10;
    ctx.globalAlpha = mq;
    ctx.drawImage(moonCv, moon.x - S / 2, moon.y - S / 2, S, S);
    if (cloudOff > -4.9) {
      const cw = moon.R * CW, ch = moon.R * CH;
      ctx.globalAlpha = mq * clamp(1.25 - Math.abs(cloudOff) / 4, 0, 1);
      ctx.drawImage(cloudSp, moon.x + cloudOff * moon.R - cw / 2, moon.y - moon.R * 0.05 - ch / 2, cw, ch);
    }

    // the verse at the left, writing itself top to bottom, right column first
    if (!chat && w > 760) {
      const shown = reduce ? 99 : Math.floor((clock - 1) / 0.32);
      let k = 0;
      for (let i = 0; i < VERSE.length; i++) {
        const line = [...VERSE[i]];
        for (let j = 0; j < line.length; j++, k++) {
          if (k >= shown) break;
          const fresh = clamp((shown - k) / 3, 0, 1);
          put(line[j], 15, col.fg, 112 - i * 24, h * 0.36 + j * 22, 0.12 + 0.2 * fresh);
        }
      }
      // now and then a character slips out of the verse and falls with the rest
      dripAcc += dt;
      if (shown > 4 && dripAcc > 2.8 && !reduce) {
        dripAcc = 0;
        const kk = (Math.random() * Math.min(shown, 20)) | 0, i = (kk / 5) | 0, j = kk % 5;
        parts.push({ kind: 0, x: 112 - i * 24, y: h * 0.36 + j * 22, vx: 0, vy: 6, vb: 22, size: 15, ch: [...VERSE[i]][j], color: col.ac, a: 0.8, age: 0, ph: Math.random() * TAU });
      }
    }

    // spawn, from the moonlight
    const cap = chat ? 70 : 230;
    spawnAcc += dt * (chat ? 1.4 : 5.2) * pace;
    while (spawnAcc >= 1) { spawnAcc -= 1; if (parts.length < cap) spawn(false); }
    // reading: words lift off the drift and float up to the moon
    if (proc === 'read' && !reduce) {
      liftAcc += dt;
      if (liftAcc > 0.35) {
        liftAcc = 0;
        const c = (Math.random() * pcols) | 0;
        if (pile[c] && pile[c].length) rise(pile[c].pop().ch, c * PC + PC / 2, h - 6 - (pile[c].length + 0.5) * PC, col.fg);
      }
    }
    // the drift melts slowly so it never fills
    meltAcc += dt * (busy ? 2.2 : 1.6);
    while (meltAcc > 0.5) {
      meltAcc -= 0.5;
      const c = (Math.random() * pcols) | 0;
      if (pile[c] && pile[c].length) pile[c].shift();
    }

    // the falling words
    const m = f.mouse;
    const RR = chat ? 80 : 130;
    const base = h - 6;
    let n = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      let keep = true;
      if (p.kind === 1) {
        // rising toward the moon, with a short trail, fading into its light
        p.u += dt / p.dur;
        if (p.u >= 1) { keep = false; pulse = Math.min(0.6, pulse + 0.08); }
        else {
          const e = Math.pow(p.u, 1.5);
          const fade = p.u < 0.1 ? p.u / 0.1 : 1 - Math.pow(p.u, 4);
          for (let k = 3; k >= 0; k--) {
            const [x, y] = bez(p, Math.max(0, e - k * 0.025));
            put(p.ch, k ? 14 : p.size, p.color, x, y, fade * (k ? 0.18 / k : 1));
          }
        }
      } else {
        p.age += dt;
        // parting around the pointer
        if (m) {
          const dx = p.x - m.x, dy = p.y - m.y, d2 = dx * dx + dy * dy;
          if (d2 < RR * RR) {
            const d = Math.sqrt(d2) || 1, k = (1 - d / RR);
            p.vx += (dx / d) * k * k * 1100 * dt;
            p.vy += (dy / d) * k * k * 380 * dt;
          }
        }
        p.vx *= Math.exp(-dt * 1.6);
        p.vy += (p.vb * pace - p.vy) * Math.min(1, dt * 1.3);
        p.x += (p.vx + Math.sin(clock * 0.7 + p.ph) * 7) * dt;
        p.y += p.vy * dt;
        if (Math.random() < 0.004) p.ch = CHARS[(Math.random() * CHARS.length) | 0];
        if (p.x < -30 || p.x > w + 30) keep = false;
        // landing on the drift
        const c = clamp(Math.floor(p.x / PC), 0, pcols - 1);
        const top = base - (pile[c].length + 0.5) * PC;
        if (keep && p.vy > 0 && p.y >= top) {
          keep = false;
          if (pile[c].length < prows) pile[c].push({ ch: p.ch, a: 0.32 + Math.random() * 0.3 });
        }
        if (keep) {
          const light = 0.78 + 0.4 * Math.exp(-((p.x - moon.x) ** 2 + (p.y - moon.y) ** 2) / (2 * (moon.R * 3.2) ** 2));
          put(p.ch, p.size, p.color, p.x, p.y, Math.min(1, p.a * light) * Math.min(1, p.age / 1.2));
        }
      }
      if (keep) parts[n++] = p;
    }
    parts.length = n;

    drawPile();

    // ripples from clicks, in dots
    for (const g of rings) {
      g.t += dt;
      const r = 8 + g.t * 210, k = Math.max(16, Math.round(r / 7));
      ctx.globalAlpha = Math.max(0, 0.55 * (1 - g.t / 1.1));
      ctx.fillStyle = col.ac;
      ctx.beginPath();
      for (let i = 0; i < k; i++) {
        const an = (i / k) * TAU, x = g.x + Math.cos(an) * r, y = g.y + Math.sin(an) * r * 0.85;
        ctx.moveTo(x + 1.3, y); ctx.arc(x, y, 1.3, 0, TAU);
      }
      ctx.fill();
    }
    rings = rings.filter((g) => g.t < 1.1);

    // the pointer carries a little moonlight of its own
    if (m && !chat) {
      const P = 130;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.1;
      ctx.drawImage(glowSp, m.x - P / 2, m.y - P / 2, P, P);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  },
};

function setColors(c) {
  col = {
    sky: c['bg-1'] || col.sky, bg: c.bg || col.bg, line: c['line-1'] || col.line, fg: c.fg || col.fg,
    fg2: c['fg-2'] || col.fg2, dim: c['fg-3'] || col.dim, ac: c.accent || col.ac,
  };
}
