// 纸刊 · Gazette: a morning paper's weather box. A sun drawn in characters, its rays turning slowly and leaning
// toward the pointer; a horizon with a ticker tape that carries what you type; a dot-matrix clock in the corner.
// While Claude thinks the rays breathe; a click leaves a ring of ink. Canvas 2D in the backdrop worker.
let cv, ctx, w = 0, h = 0, dpr = 1, scene = 'welcome';
let ink = '#7a6d5c', sun = '#c2491d', paper = '#f3eee3', dark = '#1f1a14';
let quiet = [];
let ticker = 'THE DAILY PROMPT  ·  ALL THE NEWS THAT FITS IN A CONTEXT WINDOW  ·  ';
let typedAt = -10;
let rings = [];
const CELL = 13;
const DIGITS = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'], ':': ['0', '1', '0', '1', '0'],
};

const PAD = 10;
const calm = (x, y) => quiet.some((r) => x > r.x - PAD && x < r.x + r.w + PAD && y > r.y - PAD && y < r.y + r.h + PAD);

function glyph(ch, x, y, color, a) {
  const q = quiet.length && calm(x, y);
  ctx.globalAlpha = q ? a * 0.18 : a;
  ctx.fillStyle = color;
  ctx.fillText(ch, x, y);
}

function size() {
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
}

function colors(c) {
  ink = c['fg-3'] || ink; sun = c.accent || sun; paper = c.bg || paper; dark = c.fg || dark;
}

function clock(t) {
  const d = new Date();
  const s = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const px = 5, gap = 2;
  let x = 28;
  const y = 30;
  for (const ch of s) {
    const g = DIGITS[ch];
    if (!g) continue;
    // the colon blinks with the seconds
    const on = ch !== ':' || Math.floor(t) % 2 === 0;
    for (let r = 0; r < g.length; r++) {
      for (let c = 0; c < g[r].length; c++) {
        if (g[r][c] !== '1' || !on) continue;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = dark;
        ctx.fillRect(x + c * (px + 1), y + r * (px + 1), px, px);
      }
    }
    x += g[0].length * (px + 1) + gap * 3;
  }
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.font = `10px ui-monospace, Consolas, monospace`;
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  ctx.fillText(`${days[d.getDay()]} · ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}  · CLEAR`, 28, y + 44);
  ctx.textAlign = 'center';
}

export default {
  init(a) {
    cv = a.canvas; ctx = cv.getContext('2d', { alpha: false });
    w = a.width; h = a.height; dpr = a.dpr; scene = a.scene;
    colors(a.colors);
    size();
  },
  resize(r) { w = r.width; h = r.height; dpr = r.dpr; size(); },
  theme(t) { colors(t.colors); },
  event(e) {
    if (e.type === 'click') rings.push({ x: e.x, y: e.y, t: 0 });
    if (e.type === 'type' && e.text) {
      ticker = (e.text.toUpperCase() + '  ·  ' + ticker).slice(0, 220);
      typedAt = 0;
    }
  },
  frame(f) {
    quiet = f.quiet || [];
    typedAt += f.dt;
    const t = f.t;
    ctx.globalAlpha = 1;
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);

    const chat = scene === 'chat';
    // a sunrise on the masthead line: the horizon under the clock, the sun half risen on it
    const hy = Math.max(120, Math.min(h * 0.24, 200));
    const cx = w * 0.8;
    const cy = hy - 4;
    const thinking = f.process === 'think' || f.process === 'start';
    const busy = f.process && f.process !== 'idle';
    const breathe = thinking ? 0.55 + 0.45 * Math.sin(t * 4) : 1;

    // the disc: rings of characters, denser to the middle
    ctx.font = `${CELL - 1}px ui-monospace, Consolas, monospace`;
    const R = chat ? 4 : 5;
    for (let gy = -R; gy <= R; gy++) {
      for (let gx = -R * 2; gx <= R * 2; gx++) {
        const d = Math.hypot(gx / 2, gy) / R;
        if (d > 1 || gy > 0) continue;
        const ch = d < 0.35 ? '@' : d < 0.6 ? '#' : d < 0.85 ? '*' : ':';
        glyph(ch, cx + gx * CELL * 0.5, cy + gy * CELL * 0.9, sun, 0.9 - d * 0.4);
      }
    }

    // the rays: dots along lines that turn, bending toward the pointer
    const N = 22;
    const mouse = f.mouse;
    for (let i = 0; i < N; i++) {
      let a = (i / N) * Math.PI * 2 + t * 0.06 * (busy ? 2 : 1);
      if (mouse) {
        const toM = Math.atan2(mouse.y - cy, mouse.x - cx);
        let diff = Math.atan2(Math.sin(toM - a), Math.cos(toM - a));
        const near = Math.max(0, 1 - Math.hypot(mouse.x - cx, mouse.y - cy) / (w * 0.6));
        a += diff * 0.35 * near * Math.exp(-diff * diff * 2);
      }
      // only the rays above the horizon
      if (Math.sin(a) > -0.05) continue;
      const len = (i % 2 ? 9 : 13) * (0.85 + 0.15 * Math.sin(t * 1.3 + i));
      for (let k = R + 2; k < R + 2 + len; k++) {
        const x = cx + Math.cos(a) * k * CELL * 0.9, y = cy + Math.sin(a) * k * CELL * 0.9;
        if (x < 0 || y < 0 || x > w || y > h) break;
        const fade = 1 - (k - R - 2) / len;
        if (k % 2 === 0) glyph('·', x, y, sun, 0.75 * fade * breathe);
      }
    }

    // the horizon, ticks, and the ticker tape running along it
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ink;
    for (let x = 0; x < w; x += CELL * 0.5) glyph(x % (CELL * 10) < CELL * 0.5 ? '┬' : '─', x, hy, ink, 0.45);
    ctx.font = `11px ui-monospace, Consolas, monospace`;
    // the tape scrolls left; what was typed last leads it, in the accent, for a few seconds
    const step = 7.2;
    const offset = t * 26;
    const fresh = typedAt < 3;
    for (let i = 0; i <= Math.ceil(w / step) + 1; i++) {
      const n = Math.floor(i + offset / step);
      const idx = n % ticker.length;
      const x = i * step - (offset % step);
      glyph(ticker[idx], x, hy + 14, fresh && idx < 12 ? sun : dark, 0.7);
    }

    // ink rings from clicks
    ctx.font = `${CELL - 1}px ui-monospace, Consolas, monospace`;
    for (const g of rings) {
      g.t += f.dt;
      const r = 6 + g.t * 120;
      const n = Math.max(10, Math.round(r / 6));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        glyph(i % 2 ? '·' : '∘', g.x + Math.cos(a) * r, g.y + Math.sin(a) * r * 0.8, sun, Math.max(0, 0.9 - g.t));
      }
    }
    rings = rings.filter((g) => g.t < 0.9);

    if (!chat) clock(t);
    ctx.globalAlpha = 1;
  },
};
