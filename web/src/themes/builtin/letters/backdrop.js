// 字母乐园 · Letterbox: big, heavy letters with a little physics. They drop in, bounce with squash and stretch, knock
// into each other and pile up in the margins (the welcome column is a solid block they land on and slide off);
// now and then one gets circled or underlined. What you type pops out of the sides of the box you type in and joins
// the piles; a click kicks letters up; the pointer shoves them. While Claude thinks they hop; while it works the word
// for what it is doing drops in; while it waits for you everything freezes and a big ? bounces. Canvas 2D, in the worker.
const WORDS = { start: 'GO', think: 'HMM', read: 'READ', search: 'FIND', edit: 'EDIT', cmd: 'RUN', test: 'TEST', git: 'GIT', install: 'NPM', web: 'WEB', agent: 'AAA', plan: 'PLAN', tool: 'TOOL', compact: 'ZIP', connect: 'LINK' };
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const G = 1500; // gravity, px/s²

let cv, ctx, w = 0, h = 0, dpr = 1, scene = 'welcome', reduce = false;
let pal = {};
let base = null;
const sprites = new Map();
let F0 = 88; // the size letters are drawn at in the sprite (CSS px)
let bodies = [];
let marks = []; // rings and underlines
let pops = []; // click puffs
let quiet = [], blocks = [], quietKey = '';
let clock = 0, lastMark = 0, lastWord = -10, lastProc = 'idle', hopAt = 0;
let queue = []; // letters waiting to drop in: { ch, at, x }
let prevMouse = null;
let qm = { y: 0, vy: 0, s: 0, sv: 0 }; // the waiting "?"
let serial = 0;

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
function setColors(c) {
  pal = { bg: c.bg || '#ededea', ink: c.fg || '#111110', pop: c.accent || '#ff4a1c', paper: c['bg-elev'] || '#fbfbf9', dim: c['fg-3'] || '#64645f', line: c['line-1'] || '#b5b5ae', yellow: c.yellow || '#6d4f00' };
  sprites.clear();
}
const PAD = 8;
const inQuiet = (x, y) => {
  for (const r of quiet) if (x > r.x - PAD && x < r.x + r.w + PAD && y > r.y - PAD && y < r.y + r.h + PAD) return true;
  return false;
};

// a heavy letter, pre-rendered once per character and style: ink, pop (accent with a hard ink shadow), outline
function sprite(ch, style) {
  const key = style + ch;
  let s = sprites.get(key);
  if (s) return s;
  if (sprites.size > 160) sprites.clear();
  const F = F0 * dpr, side = Math.ceil(F * 1.35);
  const c = new OffscreenCanvas(side, side);
  const g = c.getContext('2d');
  g.font = `bold ${Math.round(F)}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const cx = side / 2, cy = side / 2 + F * 0.04, sh = F * 0.06;
  const draw = (x, y, fill, stroke, lw) => {
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.strokeText(ch, x, y); }
    if (fill) { g.fillStyle = fill; g.fillText(ch, x, y); }
  };
  if (style === 'ink') draw(cx, cy, pal.ink, pal.ink, F * 0.09);
  else if (style === 'pop') { draw(cx + sh, cy + sh, pal.ink, pal.ink, F * 0.11); draw(cx, cy, pal.pop, pal.pop, F * 0.09); }
  else { draw(cx + sh, cy + sh, pal.ink, pal.ink, F * 0.14); draw(cx, cy, pal.paper, pal.ink, F * 0.12); g.fillStyle = pal.paper; g.fillText(ch, cx, cy); }
  s = { c, side: side / dpr };
  sprites.set(key, s);
  return s;
}

function buildBase() {
  base = new OffscreenCanvas(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
  const b = base.getContext('2d');
  b.setTransform(dpr, 0, 0, dpr, 0, 0);
  b.fillStyle = pal.bg;
  b.fillRect(0, 0, w, h);
  // a dot grid, like the back of a cutting mat
  const step = scene === 'chat' ? 26 : 22;
  b.fillStyle = rgba(pal.dim, scene === 'chat' ? 0.18 : 0.22);
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) if (!inQuiet(x, y)) b.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
  // the floor: a thick ink line
  b.fillStyle = pal.ink;
  b.fillRect(0, h - 3, w, 3);
}

function floor() { return h - 3; }

function size() {
  if (scene === 'chat') return 30 + Math.random() * 16;
  // in narrow margins the letters are smaller
  return Math.random() < 0.45 ? 78 + Math.random() * 14 : 46 + Math.random() * 12;
}

function body(ch, x, y, vx, vy, opts = {}) {
  const F = opts.F || size();
  const R = Math.random();
  const style = opts.style || (R < 0.66 ? 'ink' : R < 0.86 ? 'pop' : 'out');
  const b = { id: serial++, ch, style, F, r: F * 0.34, x, y, vx, vy, a: (Math.random() - 0.5) * 0.6, av: (Math.random() - 0.5) * 3, s: 0, sv: 0, rest: 0, out: -1 };
  bodies.push(b);
  const cap = scene === 'chat' ? 26 : 44;
  // too many: the oldest shrink away
  let live = bodies.filter((o) => o.out < 0);
  while (live.length > cap) { live[0].out = 0; live = live.slice(1); }
  return b;
}

// the welcome column's words, merged into solid blocks the letters land on
function makeBlocks() {
  const rs = [...quiet].sort((a, b) => a.y - b.y).map((r) => ({ x: r.x - PAD, y: r.y - PAD, w: r.w + PAD * 2, h: r.h + PAD * 2 }));
  const out = [];
  for (const r of rs) {
    const m = out.find((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h + 60);
    if (m) {
      const x0 = Math.min(m.x, r.x), y0 = Math.min(m.y, r.y), x1 = Math.max(m.x + m.w, r.x + r.w), y1 = Math.max(m.y + m.h, r.y + r.h);
      Object.assign(m, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    } else out.push({ ...r });
  }
  blocks = out;
}

// where a new letter can come down: mostly the margins beside the column
function dropX(r) {
  const col = blocks[0];
  if (!col || Math.random() < 0.22) return r + Math.random() * (w - r * 2);
  const left = col.x - r * 2, right = w - (col.x + col.w) - r * 2;
  const side = left <= 0 ? 1 : right <= 0 ? -1 : Math.random() * (left + right) < left ? -1 : 1;
  return side < 0 ? r + Math.random() * Math.max(1, left) : col.x + col.w + r + Math.random() * Math.max(1, right);
}

function seed() {
  bodies = [];
  const n = scene === 'chat' ? 16 : Math.max(16, Math.min(34, Math.round((w * h) / 34000)));
  queue = [];
  for (let i = 0; i < n; i++) queue.push({ ch: ABC[(Math.random() * 26) | 0], at: clock + 0.25 + i * 0.09 });
}

function layout() {
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sprites.clear();
  buildBase();
  for (const b of bodies) { b.x = Math.max(b.r, Math.min(w - b.r, b.x)); b.y = Math.min(b.y, floor() - b.r); }
}

function collideRect(b, r, bounce) {
  const cx = Math.max(r.x, Math.min(b.x, r.x + r.w)), cy = Math.max(r.y, Math.min(b.y, r.y + r.h));
  let dx = b.x - cx, dy = b.y - cy;
  let d = Math.hypot(dx, dy);
  if (d >= b.r) return;
  if (d === 0) {
    // inside (the page moved under it): float out through the nearest edge, a few px a step
    // (never down through a block that reaches the floor: the floor would push it straight back in)
    const L = b.x - r.x, Rr = r.x + r.w - b.x, T = b.y - r.y, B = r.y + r.h > floor() - b.r * 2 ? Infinity : r.y + r.h - b.y;
    const m = Math.min(L, Rr, T, B), k = Math.min(m + 1, 12);
    if (m === T) { b.y -= k; b.vy = Math.min(0, b.vy); } else if (m === L) { b.x -= k; b.vx = Math.min(0, b.vx); } else if (m === Rr) { b.x += k; b.vx = Math.max(0, b.vx); } else { b.y += k; b.vy = Math.max(0, b.vy); }
    return;
  }
  dx /= d; dy /= d;
  b.x += dx * (b.r - d); b.y += dy * (b.r - d);
  const vn = b.vx * dx + b.vy * dy;
  if (vn < 0) {
    if (dy < -0.6 && vn < -260) impact(b, -vn);
    b.vx -= (1 + bounce) * vn * dx; b.vy -= (1 + bounce) * vn * dy;
    // rolling off an edge: a little push sideways and some spin
    if (dy < -0.3 && Math.abs(dx) > 0.15) { b.vx += dx * 40; b.av += dx * 2; }
    b.vx *= 0.96;
  }
}

function impact(b, v) {
  b.sv -= Math.min(9, v / 140);
}

function step(dt, frozen) {
  const fl = floor();
  if (!frozen) {
    for (const b of bodies) {
      if (b.out >= 0) continue;
      b.vy += G * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.a += b.av * dt;
      b.av *= 1 - Math.min(1, dt * 2.2);
    }
  }
  // letters against each other, roughly: circles
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    if (a.out >= 0) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (b.out >= 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r;
      if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, over = rr - d;
      const ma = a.r * a.r, mb = b.r * b.r, ta = mb / (ma + mb), tb = ma / (ma + mb);
      a.x -= nx * over * ta; a.y -= ny * over * ta;
      b.x += nx * over * tb; b.y += ny * over * tb;
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (vn < 0) {
        const j2 = -(1.25) * vn;
        a.vx -= j2 * nx * ta; a.vy -= j2 * ny * ta;
        b.vx += j2 * nx * tb; b.vy += j2 * ny * tb;
        const tang = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
        a.av -= tang * 0.004; b.av += tang * 0.004;
        if (-vn > 300) { impact(a, -vn * 0.6); impact(b, -vn * 0.6); }
      }
    }
  }
  for (const b of bodies) {
    if (b.out >= 0) continue;
    for (const r of blocks) collideRect(b, r, 0.25);
    if (b.y > fl - b.r) {
      b.y = fl - b.r;
      if (b.vy > 0) { if (b.vy > 260) impact(b, b.vy); b.vy = -b.vy * 0.32; if (Math.abs(b.vy) < 40) b.vy = 0; }
      b.vx *= 0.9;
      b.av += (b.vx / b.r) * 0.08 - b.a * 0.4;
    }
    if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.4; }
    if (b.x > w - b.r) { b.x = w - b.r; b.vx = -Math.abs(b.vx) * 0.4; }
    if (b.y < -400) b.y = -400;
    // they settle upright-ish; a tilt stays
    b.av -= Math.sin(b.a * 2) * 3 * dt * (b.rest > 0.3 ? 1 : 0.2);
    b.rest = Math.hypot(b.vx, b.vy) < 30 ? b.rest + dt : 0;
  }
}

// the still picture: stack the letters on a height map instead of simulating them down
function settle() {
  const cell = 4, n = Math.ceil(w / cell) + 1;
  const hm = new Float32Array(n).fill(floor());
  for (const r of blocks) for (let i = Math.max(0, Math.floor(r.x / cell)); i < Math.min(n, Math.ceil((r.x + r.w) / cell)); i++) hm[i] = Math.min(hm[i], r.y);
  for (const b of bodies) {
    if (b.out >= 0) continue;
    b.x = Math.max(b.r, Math.min(w - b.r, b.x));
    const i0 = Math.max(0, Math.floor((b.x - b.r * 0.8) / cell)), i1 = Math.min(n - 1, Math.ceil((b.x + b.r * 0.8) / cell));
    let top = Infinity;
    for (let i = i0; i <= i1; i++) top = Math.min(top, hm[i]);
    b.y = top - b.r;
    for (let i = i0; i <= i1; i++) hm[i] = Math.min(hm[i], b.y - b.r * 0.8);
    b.vx = 0; b.vy = 0; b.s = 0; b.sv = 0; b.av = 0; b.a = (Math.random() - 0.5) * 0.5; b.rest = 1;
  }
}

function spring(b, dt) {
  b.sv += (-b.s * 320 - b.sv * 16) * dt;
  b.s += b.sv * dt;
  b.s = Math.max(-0.45, Math.min(0.45, b.s));
}

function drawBody(b, t) {
  const sp = sprite(b.ch, b.style);
  const k = b.F / F0;
  const D = sp.side * k;
  // squash on landing (s < 0 = flattened), stretch while flying fast
  const fly = Math.min(0.22, Math.abs(b.vy) / 4000);
  const sy = (1 + b.s) * (1 + fly), sx = (1 - b.s * 0.8) / (1 + fly * 0.6);
  const grow = b.out >= 0 ? Math.max(0, 1 - b.out / 0.35) : 1;
  const qa = inQuiet(b.x, b.y) ? 0.18 : 1;
  ctx.globalAlpha = qa;
  ctx.save();
  ctx.translate(b.x, b.y + b.r);
  ctx.rotate(b.a);
  ctx.scale(sx * grow, sy * grow);
  ctx.drawImage(sp.c, -D / 2, -D / 2 - b.r, D, D);
  ctx.restore();
}

function drawMarks(t, dt) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const m of marks) {
    m.t += dt;
    const b = m.b;
    if (b.out >= 0) { m.t = 99; continue; }
    const grow = Math.min(1, m.t / 0.5), fade = m.t > 3.2 ? Math.max(0, 1 - (m.t - 3.2) / 0.5) : 1;
    ctx.globalAlpha = fade * (inQuiet(b.x, b.y) ? 0.18 : 1);
    ctx.strokeStyle = pal.pop;
    ctx.lineWidth = Math.max(3, b.F * 0.06);
    ctx.beginPath();
    if (m.kind === 'ring') {
      // a hand-drawn ring: a little wider than the letter, over-shooting its start
      const rx = b.r * 1.45, ry = b.r * 1.3, a0 = m.a0, span = Math.PI * 2.15 * grow;
      for (let i = 0; i <= 28; i++) {
        const a = a0 + (span * i) / 28, wob = 1 + 0.06 * Math.sin(a * 3 + m.a0);
        const x = b.x + Math.cos(a) * rx * wob, y = b.y + Math.sin(a) * ry * wob;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    } else {
      const y = b.y + b.r * 1.05, x0 = b.x - b.r * 1.1, x1 = x0 + b.r * 2.2 * grow;
      ctx.moveTo(x0, y); ctx.quadraticCurveTo((x0 + x1) / 2, y + 4, x1, y - 2);
    }
    ctx.stroke();
  }
  marks = marks.filter((m) => m.t < 3.7);
}

export default {
  init(a) {
    cv = a.canvas; ctx = cv.getContext('2d', { alpha: false });
    w = a.width; h = a.height; dpr = a.dpr; scene = a.scene; reduce = !!a.reduce;
    setColors(a.colors || {});
    layout();
    seed();
    if (reduce) {
      // one still picture: drop everything at once and let it settle before the frame
      for (const q of queue) body(q.ch, dropX(40), -Math.random() * h, 0, 0);
      queue = [];
    }
  },
  resize(r) { w = r.width; h = r.height; dpr = r.dpr; layout(); },
  theme(t) { setColors(t.colors || {}); buildBase(); },
  event(e) {
    if (e.type === 'click') {
      let hit = false;
      for (const b of bodies) {
        const d = Math.hypot(b.x - e.x, b.y - e.y);
        if (d < 150 && b.out < 0) {
          hit = true;
          const k = 1 - d / 150;
          b.vy -= 500 + 700 * k;
          b.vx += (b.x - e.x >= 0 ? 1 : -1) * (120 + 260 * k);
          b.av += (Math.random() - 0.5) * 16 * k;
        }
      }
      pops.push({ x: e.x, y: e.y, t: 0 });
      if (!hit && !inQuiet(e.x, e.y)) body(ABC[(Math.random() * 26) | 0], e.x, e.y, 0, -200);
    }
    if (e.type === 'type' && e.text) {
      // what you type pops out of the sides of the box you type in
      const box = scene === 'welcome' && quiet.length > 1 ? [...quiet].sort((a, b) => a.y - b.y)[1] : null;
      let side = Math.random() < 0.5 ? -1 : 1;
      for (const raw of [...e.text].slice(0, 10)) {
        if (!raw.trim()) continue;
        const ch = /[a-z]/.test(raw) ? raw.toUpperCase() : raw;
        const F = scene === 'chat' ? 34 : 50 + Math.random() * 16;
        if (box) {
          const r = F * 0.34;
          const x = side < 0 ? box.x - PAD - r - 4 : box.x + box.w + PAD + r + 4;
          body(ch, x, box.y + box.h * 0.4, side * (140 + Math.random() * 200), -(420 + Math.random() * 280), { F, style: Math.random() < 0.4 ? 'pop' : 'ink' });
        } else {
          body(ch, w / 2 + (Math.random() - 0.5) * w * 0.3, h - 90, (Math.random() - 0.5) * 500, -(520 + Math.random() * 300), { F, style: Math.random() < 0.4 ? 'pop' : 'ink' });
        }
        side = -side;
      }
    }
  },
  frame(f) {
    if (f.scene && f.scene !== scene) { scene = f.scene; layout(); seed(); }
    const q = f.quiet || [];
    const key = q.map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`).join(';');
    if (key !== quietKey) { quiet = q; quietKey = key; makeBlocks(); buildBase(); }
    const t = f.t, dt = Math.min(1 / 20, f.dt || 0);
    clock = t;
    const proc = f.process || 'idle';
    const waiting = proc === 'wait';
    const thinking = proc === 'think' || proc === 'start';

    if (reduce) {
      for (const qd of queue) body(qd.ch, dropX(40), -Math.random() * h, 0, 0);
      queue = [];
      settle();
      // one ring for the still picture
      const pick = bodies.find((b) => b.style === 'ink' && !inQuiet(b.x, b.y));
      if (pick) marks = [{ b: pick, kind: 'ring', t: 1, a0: -2 }];
    }

    // letters waiting to drop in
    for (const qd of queue) if (qd.at <= t) { const F = size(); body(qd.ch, qd.x ?? dropX(F * 0.34), -F, (Math.random() - 0.5) * 80, 0, { F }); qd.done = true; }
    queue = queue.filter((qd) => !qd.done);

    // what Claude is doing: its word drops in (not too often)
    if (!reduce && proc !== lastProc) {
      lastProc = proc;
      const word = WORDS[proc];
      if (word && t - lastWord > 2.5) {
        lastWord = t;
        const F = size(), x = dropX(F * 0.34 + word.length * F * 0.25);
        [...word].forEach((ch, i) => queue.push({ ch, at: t + i * 0.12, x: Math.max(20, Math.min(w - 20, x + (i - word.length / 2) * F * 0.62)) }));
      }
    }

    // the pointer shoves the letters it passes
    const m = f.mouse;
    if (m && !waiting && !reduce) {
      const pv = prevMouse ? Math.hypot(m.x - prevMouse.x, m.y - prevMouse.y) / Math.max(dt, 1e-3) : 0;
      for (const b of bodies) {
        const R = b.r + 46, dx = b.x - m.x, dy = b.y - m.y, d = Math.hypot(dx, dy);
        if (d < R && d > 0) {
          const k = (1 - d / R) * (500 + Math.min(1500, pv) * 1.4) * dt * 6;
          b.vx += (dx / d) * k; b.vy += (dy / d) * k - 40 * (1 - d / R);
          b.av += (dx / d) * 0.3;
        }
      }
    }
    prevMouse = m ? { x: m.x, y: m.y } : null;

    // thinking: resting letters hop
    if (thinking && !reduce && t > hopAt) {
      hopAt = t + 0.12 + Math.random() * 0.12;
      const rest = bodies.filter((b) => b.rest > 0.2 && b.out < 0);
      const b = rest[(Math.random() * rest.length) | 0];
      if (b) { b.vy = -(300 + Math.random() * 300); b.sv -= 4; b.av += (Math.random() - 0.5) * 3; }
    }

    if (!reduce) {
      const n = 2, sdt = dt / n;
      for (let i = 0; i < n; i++) step(sdt, waiting);
      for (const b of bodies) { if (!waiting) spring(b, dt); if (b.out >= 0) b.out += dt; }
      bodies = bodies.filter((b) => b.out < 0.35);
      // now and then a resting letter gets circled or underlined
      if (!waiting && t - lastMark > 2.2) {
        const rest = bodies.filter((b) => b.rest > 0.6 && b.out < 0 && !inQuiet(b.x, b.y) && !marks.some((mm) => mm.b === b));
        const b = rest[(Math.random() * rest.length) | 0];
        if (b) { marks.push({ b, kind: Math.random() < 0.6 ? 'ring' : 'under', t: 0, a0: Math.random() * 6 }); lastMark = t; }
      }
    }

    // paint
    ctx.globalAlpha = 1;
    ctx.drawImage(base, 0, 0, w, h);
    for (const p of pops) {
      p.t += dt;
      ctx.globalAlpha = Math.max(0, 1 - p.t / 0.45);
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, r0 = 10 + p.t * 90, r1 = r0 + 10;
        ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0);
        ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
      }
      ctx.stroke();
    }
    pops = pops.filter((p) => p.t < 0.45);
    for (const b of bodies) drawBody(b, t);
    drawMarks(t, reduce ? 0 : dt);

    // waiting for you: everything holds still and a big ? bounces
    if (waiting) {
      const F = scene === 'chat' ? 60 : 110, r = F * 0.34;
      const col = blocks[0];
      const x = col && w - (col.x + col.w) > r * 2 + 16 ? col.x + col.w + (w - col.x - col.w) / 2 : w - r - 30;
      const fl = floor() - r;
      if (!reduce) {
        qm.vy += G * 0.8 * dt; qm.y += qm.vy * dt;
        if (qm.y > 0) { qm.y = 0; qm.vy = -720; qm.sv -= 7; }
        qm.sv += (-qm.s * 320 - qm.sv * 14) * dt; qm.s += qm.sv * dt;
        qm.s = Math.max(-0.4, Math.min(0.4, qm.s));
      }
      const sp = sprite('?', 'pop');
      const D = sp.side * (F / F0);
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(x, fl + qm.y + r);
      ctx.scale(1 - qm.s * 0.8, 1 + qm.s);
      ctx.drawImage(sp.c, -D / 2, -D / 2 - r, D, D);
      ctx.restore();
    } else { qm.y = -200; qm.vy = 0; }
    ctx.globalAlpha = 1;
  },
};
