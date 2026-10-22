// 地铁站 · Metro (the showcase's "describe a new theme" fixture, made from Phosphor): signal-green character rain. Each column drops a bright head and leaves a trail that cools through
// the ramp @%#*+=-:. while the screen's afterglow fades it; the pointer is a magnet that makes the cells under it
// flicker; a click sends a ring out; what is typed appears on a prompt line and then falls with the rain. The HUD in
// the corner names what Claude is doing. Runs in the backdrop worker: Canvas 2D on an OffscreenCanvas, no network.
const RAMP = '@%#*+=-:.';
const CELL = 14;
const HUD = { idle: 'IDLE', start: 'DIAL', think: 'THINK', read: 'READ', search: 'SCAN', edit: 'WRITE', cmd: 'EXEC', test: 'TEST', git: 'GIT', install: 'PKG', web: 'NET', agent: 'FORK', plan: 'PLAN', tool: 'TOOL', wait: 'AWAIT', compact: 'ZIP', connect: 'DIAL' };

let cv, ctx, w = 0, h = 0, dpr = 1, cols = 0, rows = 0, scene = 'welcome';
let col = { bg: '#060a07', fg: '#c8ffd4', dim: '#4f9a62', hot: '#39ff6a', warn: '#ffd85a' };
let drops = [];
let rings = [];
let typed = '';
let typedAt = -10;
let falling = [];
let clock = 0;
let quiet = [];
const PAD = 8;
const calm = (x, y) => quiet.some((r) => x * CELL + CELL > r.x - PAD && x * CELL < r.x + r.w + PAD && y * CELL + CELL > r.y - PAD && y * CELL < r.y + r.h + PAD);

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };

function setColors(c) {
  col = { bg: c.bg || col.bg, fg: c.fg || col.fg, dim: c['fg-3'] || col.dim, hot: c.accent || col.hot, warn: c.yellow || col.warn };
}

function newDrop(x) {
  return { x, y: -Math.random() * rows * 0.8, v: 6 + Math.random() * 14, len: 6 + ((Math.random() * 14) | 0), last: -1 };
}

function layout() {
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cols = Math.ceil(w / CELL);
  rows = Math.ceil(h / CELL);
  const density = scene === 'chat' ? 0.4 : 0.85;
  drops = [];
  for (let x = 0; x < cols; x++) if (Math.random() < density) drops.push(newDrop(x));
  ctx.fillStyle = col.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.font = `${CELL - 2}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textBaseline = 'top';
}

// behind the page's words a cell is drawn at a fifth of its strength
function cell(x, y, ch, color) {
  ctx.fillStyle = col.bg;
  ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
  if (ch === ' ') return;
  const q = quiet.length && calm(x, y);
  if (q) ctx.globalAlpha = 0.2;
  ctx.fillStyle = color;
  ctx.fillText(ch, x * CELL + 2, y * CELL + 1);
  if (q) ctx.globalAlpha = 1;
}

export default {
  init(a) {
    cv = a.canvas; ctx = cv.getContext('2d', { alpha: false });
    w = a.width; h = a.height; dpr = a.dpr; scene = a.scene;
    setColors(a.colors);
    layout();
  },
  resize(r) { w = r.width; h = r.height; dpr = r.dpr; layout(); },
  theme(t) { setColors(t.colors); },
  event(e) {
    if (e.type === 'click') rings.push({ x: e.x, y: e.y, t: 0 });
    if (e.type === 'type' && e.text) {
      typed = (typed + e.text).slice(-48);
      typedAt = clock;
      // every typed character also drops from a random column, in the accent
      for (const ch of e.text.slice(0, 6)) falling.push({ x: (Math.random() * cols) | 0, y: 0, v: 10 + Math.random() * 8, ch, last: -1 });
    }
  },
  frame(f) {
    clock = f.t;
    quiet = f.quiet || [];
    const dt = f.dt;
    const busy = f.process && f.process !== 'idle';
    const pace = f.process === 'wait' ? 0.25 : f.process === 'think' || f.process === 'compact' ? 1.7 : busy ? 1.25 : 1;

    // afterglow: the whole screen cools a little toward the background each frame
    ctx.fillStyle = rgba(col.bg, scene === 'chat' ? 0.06 : 0.075);
    ctx.fillRect(0, 0, w, h);

    for (const d of drops) {
      d.y += d.v * pace * dt;
      const head = Math.floor(d.y);
      if (head !== d.last) {
        d.last = head;
        // the head, bright; the cells behind it redrawn a step down the ramp
        for (let k = 0; k < 5; k++) {
          const yy = head - k;
          if (yy < 0 || yy >= rows) continue;
          const ch = RAMP[Math.min(RAMP.length - 1, k * 2 + ((Math.random() * 2) | 0))];
          cell(d.x, yy, ch, k === 0 ? col.fg : rgba(col.hot, 0.85 - k * 0.14));
        }
      }
      if (head - d.len > rows) Object.assign(d, newDrop(d.x));
    }

    // typed letters falling in the accent
    for (const p of falling) {
      p.y += p.v * dt;
      const y = Math.floor(p.y);
      if (y !== p.last && y < rows) { p.last = y; cell(p.x, y, p.ch, col.hot); }
    }
    falling = falling.filter((p) => p.y < rows + 1);

    // the pointer: cells near it flicker in the accent
    if (f.mouse) {
      const mx = f.mouse.x / CELL, my = f.mouse.y / CELL;
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 5;
        const x = Math.round(mx + Math.cos(a) * r), y = Math.round(my + Math.sin(a) * r * 0.8);
        if (x >= 0 && y >= 0 && x < cols && y < rows) cell(x, y, RAMP[(Math.random() * 4) | 0], col.hot);
      }
    }

    // click rings
    for (const g of rings) {
      g.t += f.dt;
      const r = g.t * 26;
      const steps = Math.max(12, Math.round(r * 1.2));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(g.x / CELL + Math.cos(a) * r), y = Math.round(g.y / CELL + Math.sin(a) * r * 0.8);
        if (x >= 0 && y >= 0 && x < cols && y < rows) cell(x, y, g.t < 0.4 ? '*' : '+', rgba(col.hot, Math.max(0, 1 - g.t)));
      }
    }
    rings = rings.filter((g) => g.t < 1);

    if (scene !== 'welcome') return;
    // the HUD: what is happening, top right
    const word = HUD[f.process] || 'IDLE';
    const blink = Math.floor(f.t * 2) % 2 === 0;
    const hud = `SYS ${busy && blink ? '●' : '○'} ${word}`;
    ctx.fillStyle = col.bg;
    ctx.fillRect(w - 170, 10, 160, CELL + 4);
    ctx.fillStyle = f.process === 'wait' ? col.warn : busy ? col.hot : col.dim;
    ctx.fillText(hud.padStart(14), w - 168, 12);
    // the prompt: what was typed, a few seconds, with the cursor
    const line = 3;
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, h - line * CELL - 6, Math.min(w, 60 * 9), CELL + 4);
    if (f.t - typedAt < 6 && typed) {
      ctx.fillStyle = col.hot;
      ctx.fillText(`> ${typed}${blink ? '█' : ' '}`, 16, h - line * CELL - 4);
    }
  },
};
