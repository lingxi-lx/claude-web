// 景深球 · Depth Orb: a sphere built from characters as a 3D point cloud on black. Every point is rotated and projected
// each frame; its depth picks the character and its brightness ('.' far … '@' near), and the cloud is drawn three
// times — red, green and blue, additively, each nudged outward or inward from the centre — so the centre is white and
// the rim splits into colour like a cheap lens. A cyan ribbon runs over the surface. Drag turns it, hover tilts it, a
// click sends a ripple through the shell, typed characters go into orbit. Thinking flickers a core inside it; `agent`
// splits it into smaller orbs; `web` lights its latitude and longitude lines; `read`/`search` sweep a focal plane
// through it. Canvas 2D in the backdrop worker; every character is a cell of a sprite sheet made once (no fillText
// per point), and additive blending means no depth sort is needed — far points are simply dimmer and smaller.
const RAMP = '.,:;=+*#%@';
const NB = RAMP.length;
const NSHELL = 2000;
const NCORE = 240;
const NRIB = 260;
const D = 2.9; // camera distance in sphere radii
const FONT = '10px ui-monospace, Consolas, monospace';

const CHAN = ['#ff2050', '#20ff70', '#3070ff']; // the three filters; together they make white
let cv, ctx, sheet, cs = 20, half = 10;
let layer, lctx, tmp, tctx;
let glowRGB = '0,224,255';
let W = 0, H = 0, dpr = 1, scene = 'welcome', reduce = false;
let col = { bg: '#000000', fg: '#ffffff', acc: '#00e0ff', dim: '#80808a' };
// model
const NDUST = 140;
let dust;
let shell, core, coreSeed, grid, gridLine, nGrid = 0, groupOf, scatter;
// projected (reused)
let sx, sy, ss, sb, sq;
// motion
let yaw = 0.6, pitch = -0.25, vyaw = 0, vpitch = 0, tiltX = 0, tiltY = 0, spin = 0.18;
let clk = 0, split = 0, webOn = 0, webClock = 0, think = 0, focus = 0, form = 0, squeeze = 1, ribT = 0;
let lastProc = 'idle', pm = null;
let ripples = [];
let typed = [], orbitA = 0;
const charCache = new Map();
let quietR = [];

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return [255, 255, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// rows of the sheet: 0 white, 1 accent, 2 magenta (agent-2); 3…5 the same, faint (behind page words)
const ROWS = 6;
const FAINT = 3;
function makeSheet(c) {
  col = { bg: c.bg || col.bg, fg: c.fg || col.fg, acc: c.accent || col.acc, dim: c['fg-3'] || col.dim, mag: c['agent-2'] || '#ff3df2' };
  cs = Math.ceil(18 * dpr); half = cs / 2;
  sheet = new OffscreenCanvas(cs * NB, cs * ROWS);
  const g = sheet.getContext('2d');
  g.font = `${Math.round(11 * dpr)}px ui-monospace, Consolas, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const a = rgb(col.acc), m = rgb(col.mag);
  glowRGB = a.join(',');
  const base = [[255, 255, 255], a, m];
  for (let r = 0; r < ROWS; r++) {
    const [R, G, B] = base[r % FAINT];
    const faint = r >= FAINT ? 0.17 : 1;
    for (let b = 0; b < NB; b++) {
      const lv = (0.16 + 0.8 * Math.pow(b / (NB - 1), 1.3)) * faint;
      const fill = `rgb(${Math.round(R * lv)},${Math.round(G * lv)},${Math.round(B * lv)})`;
      g.shadowColor = fill;
      g.shadowBlur = b === NB - 1 && r < FAINT ? 2 * dpr : 0;
      g.fillStyle = fill;
      g.fillText(RAMP[b], b * cs + half, r * cs + half + 0.5);
    }
  }
  charCache.clear();
}

// a typed character, three cells (red, green, blue), made once
function charSprite(ch) {
  let s = charCache.get(ch);
  if (s) return s;
  const z = Math.ceil(30 * dpr);
  const c = new OffscreenCanvas(z * 3, z);
  const g = c.getContext('2d');
  g.font = `600 ${Math.round(20 * dpr)}px ui-monospace, Consolas, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  ['rgb(255,40,40)', 'rgb(40,255,60)', 'rgb(50,80,255)'].forEach((f, i) => { g.fillStyle = f; g.fillText(ch, i * z + z / 2, z / 2 + 1); });
  s = { c, z };
  if (charCache.size > 80) charCache.clear();
  charCache.set(ch, s);
  return s;
}

function build() {
  // the shell: a Fibonacci sphere (even spacing, no poles)
  shell = new Float32Array(NSHELL * 3);
  groupOf = new Uint8Array(NSHELL);
  scatter = new Float32Array(NSHELL * 3);
  const ga = Math.PI * (3 - Math.sqrt(5));
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < NSHELL; i++) {
    const y = 1 - (2 * (i + 0.5)) / NSHELL, r = Math.sqrt(1 - y * y), th = ga * i;
    { // jitter it off the lattice and give the shell some thickness, so it reads as a cloud, not a disco ball
      let px = Math.cos(th) * r + (rnd() - 0.5) * 0.07, py = y + (rnd() - 0.5) * 0.07, pz = Math.sin(th) * r + (rnd() - 0.5) * 0.07;
      const k = (0.9 + 0.1 * Math.sqrt(rnd())) / Math.hypot(px, py, pz);
      shell[i * 3] = px * k; shell[i * 3 + 1] = py * k; shell[i * 3 + 2] = pz * k;
    }
    groupOf[i] = (i * 7 + ((i * 13) >> 3)) & 3;
    // where each point starts before the orb assembles
    const u = rnd() * 2 - 1, t = rnd() * 6.2832, k = 1.25 + rnd() * 0.45, q = Math.sqrt(1 - u * u);
    scatter[i * 3] = Math.cos(t) * q * k; scatter[i * 3 + 1] = u * k; scatter[i * 3 + 2] = Math.sin(t) * q * k;
  }
  // dust: a few far points around it, for parallax
  dust = new Float32Array(NDUST * 3);
  for (let i = 0; i < NDUST; i++) {
    const u = rnd() * 2 - 1, t = rnd() * 6.2832, k = 1.7 + rnd() * 2.2, q = Math.sqrt(1 - u * u);
    dust[i * 3] = Math.cos(t) * q * k * 1.6; dust[i * 3 + 1] = u * k * 0.8; dust[i * 3 + 2] = Math.sin(t) * q * k;
  }
  // the core, a loose ball inside
  core = new Float32Array(NCORE * 3);
  coreSeed = new Float32Array(NCORE);
  for (let i = 0; i < NCORE; i++) {
    let x, y, z;
    do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
    core[i * 3] = x * 0.42; core[i * 3 + 1] = y * 0.42; core[i * 3 + 2] = z * 0.42;
    coreSeed[i] = rnd() * 100;
  }
  // the graticule: five latitudes and eight meridians, just outside the shell
  const pts = [], line = [];
  [-60, -30, 0, 30, 60].forEach((lat, li) => {
    const la = (lat * Math.PI) / 180, n = Math.round(120 * Math.cos(la));
    for (let k = 0; k < n; k++) { const t = (k / n) * 6.2832; pts.push(Math.cos(t) * Math.cos(la), Math.sin(la), Math.sin(t) * Math.cos(la)); line.push(li + (k / n) * 0.999); }
  });
  for (let mI = 0; mI < 8; mI++) {
    const t = (mI / 8) * 6.2832;
    for (let k = 1; k < 56; k++) { const la = -Math.PI / 2 + (k / 56) * Math.PI; pts.push(Math.cos(t) * Math.cos(la), Math.sin(la), Math.sin(t) * Math.cos(la)); line.push(5 + mI + k / 56); }
  }
  grid = new Float32Array(pts.map((v) => v * 1.02));
  gridLine = new Float32Array(line);
  nGrid = line.length;
  const cap = NSHELL + NCORE + nGrid + NRIB;
  sx = new Float32Array(cap); sy = new Float32Array(cap); ss = new Float32Array(cap); sb = new Uint8Array(cap); sq = new Uint8Array(cap);
}

function resizeCanvas() {
  cv.width = Math.max(1, Math.round(W * dpr));
  cv.height = Math.max(1, Math.round(H * dpr));
}

// rotate a model-space point into view space: yaw about Y, then pitch about X
let cyw = 1, syw = 0, cpt = 1, spt = 0;
let vx = 0, vy = 0, vz = 0;
function rot(x, y, z) {
  const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
  vx = x1; vy = y * cpt - z1 * spt; vz = y * spt + z1 * cpt;
}
// … and back (for a click: which point of the shell was under it)
function unrot(x, y, z) {
  const y1 = y * cpt + z * spt, z1 = -y * spt + z * cpt;
  return [x * cyw - z1 * syw, y1, x * syw + z1 * cyw];
}

// ripples as flat numbers for the hot loop: [dx, dy, dz, t] × up to 4
const RIP = new Float32Array(16);
const TET = new Float32Array([1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1]);

// project every shell point (ripples, the split into four, the assembly, the rotation) into sx/sy/ss/sb/sq
function projectShell(step, rr0, pulse, zf, ccx, ccy, Rpx) {
  let nr = 0;
  for (const r of ripples) { if (nr === 4 || !r.d) continue; RIP[nr * 4] = r.d[0]; RIP[nr * 4 + 1] = r.d[1]; RIP[nr * 4 + 2] = r.d[2]; RIP[nr * 4 + 3] = r.t; nr++; }
  const sa = clk * 0.5, ca = Math.cos(sa), sn = Math.sin(sa);
  const sk = 1 - 0.55 * split, so = 0.8 * split * 0.577, doSplit = split > 0.002;
  const fe = form < 1 ? 1 - (1 - form) * (1 - form) * (1 - form) : 1;
  const c1 = cyw, s1 = syw, c2 = cpt, s2 = spt;
  const nq = quietR.length;
  let n = 0;
  for (let i = 0; i < NSHELL; i += step) {
    const i3 = i * 3;
    let x = shell[i3], y = shell[i3 + 1], z = shell[i3 + 2];
    let rr = rr0, boost = 0;
    for (let r = 0; r < nr; r++) {
      const dd = x * RIP[r * 4] + y * RIP[r * 4 + 1] + z * RIP[r * 4 + 2], tt = RIP[r * 4 + 3];
      const w = Math.sqrt(dd < 1 ? 2 - 2 * dd : 0) - tt * 1.5;
      const k = Math.exp(-(w * w) * 50) * (1 - tt / 1.6);
      rr += 0.16 * k; boost += 4 * k;
    }
    x *= rr; y *= rr; z *= rr;
    if (doSplit) {
      const g = groupOf[i] * 3, gx = TET[g] * ca - TET[g + 2] * sn, gz = TET[g] * sn + TET[g + 2] * ca;
      x = x * sk + gx * so; y = y * sk + TET[g + 1] * so; z = z * sk + gz * so;
    }
    if (fe < 1) {
      x = scatter[i3] + (x - scatter[i3]) * fe; y = scatter[i3 + 1] + (y - scatter[i3 + 1]) * fe; z = scatter[i3 + 2] + (z - scatter[i3 + 2]) * fe;
    }
    // yaw, then pitch
    const x1 = x * c1 + z * s1, z1 = -x * s1 + z * c1;
    const px = x1, py = y * c2 - z1 * s2, pz = y * s2 + z1 * c2;
    const s = D / (D - pz);
    const X = ccx + px * s * Rpx, Yp = ccy - py * s * Rpx;
    // depth → character and brightness; a light from the upper left adds a little
    const l = -0.5 * px + 0.45 * py + 0.74 * pz;
    const dz = (pz + 1) * 0.5;
    let t = dz * dz * 0.9 + (l > 0 ? l * 0.18 : 0);
    t = t * pulse * (1 - 0.3 * think - 0.35 * webOn) + boost * 0.1;
    if (zf < 9) { const fz = pz - zf; if (fz < 0.09 && fz > -0.09) t += 0.6 * focus; else t -= 0.25 * focus; }
    let b = (t * NB) | 0;
    b = b < 0 ? 0 : b >= NB ? NB - 1 : b;
    let q = 0;
    for (let k = 0; k < nq; k++) { const r = quietR[k]; if (X > r[0] && X < r[2] && Yp > r[1] && Yp < r[3]) { q = 1; break; } }
    sx[n] = X; sy[n] = Yp; ss[n] = s * (0.4 + 0.13 * (pz + 1)); sb[n] = b; sq[n] = q;
    n++;
  }
  return n;
}

const inQuiet = (x, y) => {
  for (let k = 0; k < quietR.length; k++) { const r = quietR[k]; if (x > r[0] && x < r[2] && y > r[1] && y < r[3]) return 1; }
  return 0;
};

export default {
  init(a) {
    cv = a.canvas; ctx = cv.getContext('2d', { alpha: false });
    W = a.width; H = a.height; dpr = a.dpr || 1; scene = a.scene; reduce = !!a.reduce;
    resizeCanvas();
    build();
    makeSheet(a.colors || {});
    if (reduce) { form = 1; yaw = 0.9; pitch = -0.32; ribT = 0.45; }
  },
  resize(r) { W = r.width; H = r.height; const d = r.dpr || 1; resizeCanvas(); if (d !== dpr) { dpr = d; makeSheet({ bg: col.bg, fg: col.fg, accent: col.acc, 'fg-3': col.dim, 'agent-2': col.mag }); } },
  theme(t) { makeSheet(t.colors || {}); },
  data() {},
  event(e) {
    if (e.type === 'click') ripples.push({ sx: e.x, sy: e.y, d: null, t: 0 });
    if (e.type === 'type' && e.text) {
      for (const ch of [...e.text].slice(0, 12)) {
        if (/\s/.test(ch)) { orbitA -= 0.16; continue; }
        typed.push({ ch, a: orbitA, age: 0 });
        orbitA -= 0.2;
      }
      if (typed.length > 28) typed.splice(0, typed.length - 28);
    }
  },
  frame(f) {
    if (!cv) return;
    const dt = Math.min(0.1, f.dt || 0);
    clk += dt;
    const proc = f.process || 'idle';
    const chat = scene === 'chat';
    if (proc === 'start' && lastProc !== 'start') form = Math.min(form, 0.15);
    lastProc = proc;

    // ---- where and how big
    const cx = chat ? W - Math.min(W, H) * 0.17 : W * 0.7;
    const cy = chat ? H - Math.min(W, H) * 0.2 : H * 0.37;
    const Rpx = (chat ? Math.min(W, H) * 0.2 : Math.min(W * 0.19, H * 0.28)) * dpr;
    const ccx = cx * dpr, ccy = cy * dpr;

    // ---- the page's words
    quietR = (f.quiet || []).map((r) => [(r.x - 14) * dpr, (r.y - 14) * dpr, (r.x + r.w + 14) * dpr, (r.y + r.h + 14) * dpr]);

    // ---- motion: process targets, eased
    const ease = (v, to, k) => v + (to - v) * Math.min(1, dt * k);
    const busy = proc !== 'idle';
    const spinTo = proc === 'wait' ? 0.02 : proc === 'think' ? 0.5 : busy ? 0.32 : 0.16;
    spin = ease(spin, spinTo, 1.5);
    split = ease(split, proc === 'agent' ? 1 : 0, 1.6);
    webOn = ease(webOn, proc === 'web' ? 1 : 0, 2);
    webClock = proc === 'web' ? webClock + dt : 0;
    think = ease(think, proc === 'think' ? 1 : proc === 'start' ? 0.5 : 0, 3);
    focus = ease(focus, proc === 'read' || proc === 'search' ? 1 : 0, 3);
    squeeze = ease(squeeze, proc === 'compact' ? 0.7 : 1, 2);
    form = reduce ? 1 : Math.min(1, form + dt * 0.7);
    ribT += dt * (busy ? 0.24 : 0.13);

    // pointer: drag turns it, hover tilts it
    const m = !chat && !reduce ? f.mouse : null;
    if (m && m.down && pm && pm.down) { vyaw += (m.x - pm.x) * 0.006; vpitch += (m.y - pm.y) * 0.006; }
    pm = m ? { x: m.x, y: m.y, down: m.down } : null;
    vyaw *= Math.pow(0.04, dt); vpitch *= Math.pow(0.04, dt);
    yaw += (spin + vyaw) * dt * (reduce ? 0 : 1);
    pitch = Math.max(-1.2, Math.min(1.2, pitch + vpitch * dt));
    tiltX = ease(tiltX, m ? ((m.x - cx) / W) * 0.9 : 0, 2);
    tiltY = ease(tiltY, m ? ((m.y - cy) / H) * 0.7 : 0, 2);
    const Y = yaw + tiltX, Pt = pitch + tiltY;
    cyw = Math.cos(Y); syw = Math.sin(Y); cpt = Math.cos(Pt); spt = Math.sin(Pt);

    // clicks become ripples that stay on the surface where they landed
    for (const r of ripples) {
      if (!r.d) {
        let x = (r.sx * dpr - ccx) / Rpx, y = -(r.sy * dpr - ccy) / Rpx;
        const q = x * x + y * y;
        let z = 0;
        if (q < 1) z = Math.sqrt(1 - q); else { const k = 1 / Math.sqrt(q); x *= k; y *= k; }
        r.d = unrot(x, y, z);
      }
      r.t += dt;
    }
    ripples = ripples.filter((r) => r.t < 1.6);

    // ---- clear (a little afterglow when moving)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = reduce ? 1 : 0.86;
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';

    const ab = (0.9 + 2.6 * think + (ripples.length ? 1.2 : 0)) * dpr; // the colour split at the rim, in px
    const flick = think > 0.02 ? think * (0.5 + 0.5 * Math.sin(clk * 23) * Math.sin(clk * 7.3)) : 0;
    const pulse = 1 + 0.25 * flick;
    const breathe = proc === 'wait' ? 1 + 0.025 * Math.sin(clk * 1.6) : 1;
    const nDraw = chat ? NSHELL / 2 : NSHELL;
    const step = chat ? 2 : 1;
    const zf = focus > 0.02 ? Math.sin(clk * 1.4) * 0.95 : 9;

    // ---- the shell
    // dust, far and slow (it turns at half the rate: parallax)
    {
      const c1 = Math.cos(Y * 0.5), s1 = Math.sin(Y * 0.5);
      for (let i = 0; i < NDUST; i += step) {
        const x = dust[i * 3], y = dust[i * 3 + 1], z = dust[i * 3 + 2];
        const x1 = x * c1 + z * s1, z1 = -x * s1 + z * c1;
        if (z1 > D - 0.6) continue;
        const s = D / (D - z1);
        const X = ccx + x1 * s * Rpx, Yp = ccy - y * s * Rpx;
        if (X < 0 || Yp < 0 || X > cv.width || Yp > cv.height) continue;
        let b = (((z1 + 4) / 8) * 4) | 0;
        b = b < 0 ? 0 : b > 3 ? 3 : b;
        const sz = cs * s * 0.6, q = inQuiet(X, Yp) * FAINT;
        ctx.drawImage(sheet, b * cs, q * cs, cs, cs, X - sz / 2, Yp - sz / 2, sz, sz);
      }
    }

    const n = projectShell(step, squeeze * breathe, pulse, zf, ccx, ccy, Rpx);
    // draw it once, in white, into a layer around the orb; then put the layer on screen three times through a red,
    // a green and a blue filter, the red one a touch larger and the blue one a touch smaller (a lens's lateral
    // chromatic aberration: no split at the centre, more toward the rim)
    const LS = Math.ceil((4.6 * Rpx) / 64) * 64;
    if (!layer || layer.width !== LS) {
      layer = new OffscreenCanvas(LS, LS); lctx = layer.getContext('2d', { alpha: false });
      tmp = new OffscreenCanvas(LS, LS); tctx = tmp.getContext('2d', { alpha: false });
    }
    const lx0 = ccx - LS / 2, ly0 = ccy - LS / 2;
    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = '#000';
    lctx.fillRect(0, 0, LS, LS);
    lctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < n; k++) {
      const z = cs * ss[k], h = z / 2;
      lctx.drawImage(sheet, sb[k] * cs, sq[k] * FAINT * cs, cs, cs, sx[k] - lx0 - h, sy[k] - ly0 - h, z, z);
    }
    const e = ab / Rpx;
    for (let c = 0; c < 3; c++) {
      tctx.globalCompositeOperation = 'copy';
      tctx.drawImage(layer, 0, 0);
      tctx.globalCompositeOperation = 'multiply';
      tctx.fillStyle = CHAN[c];
      tctx.fillRect(0, 0, LS, LS);
      const k = 1 + (1 - c) * e, z = LS * k;
      ctx.drawImage(tmp, ccx - z / 2, ccy - z / 2, z, z);
    }

    // ---- the core, flickering while Claude thinks
    if (flick > 0.01 || proc === 'start') {
      for (let i = 0; i < NCORE; i += step) {
        const fl = Math.sin(clk * 17 + coreSeed[i]) * Math.sin(clk * 5.1 + coreSeed[i] * 1.7);
        if (fl < 0.2 - think * 0.5) continue;
        rot(core[i * 3] * squeeze, core[i * 3 + 1] * squeeze, core[i * 3 + 2] * squeeze);
        const s = D / (D - vz);
        const X = ccx + vx * s * Rpx, Yp = ccy - vy * s * Rpx;
        let b = ((0.55 + 0.45 * fl) * Math.max(think, 0.4) * NB) | 0;
        b = b < 0 ? 0 : b >= NB ? NB - 1 : b;
        const z = cs * s * (0.9 + 0.5 * fl), q = inQuiet(X, Yp) * FAINT;
        ctx.drawImage(sheet, b * cs, (1 + q) * cs, cs, cs, X - z / 2, Yp - z / 2, z, z);
      }
      // and the light it throws from inside, flickering with it
      const gr = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, Rpx * 0.75);
      const a = Math.max(0, Math.min(0.5, flick * 0.55));
      gr.addColorStop(0, `rgba(${glowRGB},${a.toFixed(3)})`);
      gr.addColorStop(1, `rgba(${glowRGB},0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(ccx - Rpx, ccy - Rpx, Rpx * 2, Rpx * 2);
    }

    // ---- latitude and longitude lines, lit one after another while it reads the web
    if (webOn > 0.02) {
      for (let i = 0; i < nGrid; i += step) {
        const li = gridLine[i], line = li | 0, along = li - line;
        const on = Math.min(1, Math.max(0, webClock * 3 - line * 0.35 - along * 0.6));
        const lvl = webOn * (reduce ? 1 : on);
        if (lvl < 0.05) continue;
        rot(grid[i * 3] * squeeze, grid[i * 3 + 1] * squeeze, grid[i * 3 + 2] * squeeze);
        const s = D / (D - vz);
        const X = ccx + vx * s * Rpx, Yp = ccy - vy * s * Rpx;
        let b = (lvl * (0.5 + 0.25 * (vz + 1)) * NB) | 0;
        b = b < 0 ? 0 : b >= NB ? NB - 1 : b;
        const z = cs * s * 0.85, q = inQuiet(X, Yp) * FAINT;
        ctx.drawImage(sheet, b * cs, (1 + q) * cs, cs, cs, X - z / 2, Yp - z / 2, z, z);
      }
    }

    // ---- the ribbon: a wave around the equator, its head running ahead, its tail fading
    if (split < 0.6) {
      const head = ribT % 1;
      const rp = clk * 0.4;
      for (let i = 0; i < NRIB; i += chat ? 2 : 1) {
        const u = i / NRIB;
        let age = head - u; if (age < 0) age += 1;
        if (age > 0.5) continue;
        const lon = u * 6.2832, lat = 0.55 * Math.sin(3 * lon + rp);
        const rr = 1.05 * squeeze * (1 - split * 0.5);
        rot(Math.cos(lon) * Math.cos(lat) * rr, Math.sin(lat) * rr, Math.sin(lon) * Math.cos(lat) * rr);
        const s = D / (D - vz);
        const X = ccx + vx * s * Rpx, Yp = ccy - vy * s * Rpx;
        let b = (Math.sqrt(1 - age * 2) * (0.5 + 0.25 * (vz + 1)) * NB) | 0;
        b = b < 0 ? 0 : b >= NB ? NB - 1 : b;
        const z = cs * s * (0.75 + 0.2 * vz), q = inQuiet(X, Yp) * FAINT;
        // the head in magenta, the body in the accent
        ctx.drawImage(sheet, b * cs, ((age < 0.03 ? 2 : 1) + q) * cs, cs, cs, X - z / 2, Yp - z / 2, z, z);
      }
    }

    // ---- typed characters on an orbit tilted across the orb
    if (typed.length) {
      const tilt = 0.32;
      for (const g of typed) {
        g.age += dt;
        const a = g.a + clk * 0.55;
        const ox = Math.cos(a) * 1.55, oz = Math.sin(a) * 1.55, oy = Math.sin(a) * 0.35;
        const y2 = oy * Math.cos(tilt) - oz * Math.sin(tilt), z2 = oy * Math.sin(tilt) + oz * Math.cos(tilt);
        const s = D / (D - z2);
        const X = ccx + ox * s * Rpx, Yp = ccy - y2 * s * Rpx;
        const fade = Math.min(1, g.age * 3) * Math.max(0, Math.min(1, (10 - g.age) / 2));
        const behind = z2 < 0 && (ox * ox + y2 * y2) < 1 ? 0.35 : 1;
        const alpha = fade * behind * (0.45 + 0.55 * (z2 + 1.55) / 3.1) * (inQuiet(X, Yp) ? 0.2 : 1);
        if (alpha < 0.02) continue;
        const sp = charSprite(g.ch), z = sp.z * s * 0.9, h = z / 2;
        const off = ab * 1.2;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sp.c, 0, 0, sp.z, sp.z, X - h - off, Yp - h, z, z);
        ctx.drawImage(sp.c, sp.z, 0, sp.z, sp.z, X - h, Yp - h, z, z);
        ctx.drawImage(sp.c, sp.z * 2, 0, sp.z, sp.z, X - h + off, Yp - h, z, z);
      }
      ctx.globalAlpha = 1;
      typed = typed.filter((g) => g.age < 10);
    }

    ctx.globalCompositeOperation = 'source-over';
    // ---- a quiet readout, like the corner of a viewfinder
    if (!chat) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = FONT;
      ctx.textBaseline = 'top';
      ctx.fillStyle = col.dim;
      const deg = (v) => String(Math.round((((v * 180) / Math.PI) % 360 + 360) % 360)).padStart(3, '0');
      ctx.fillText(`ORB  ${nDraw} PTS  θ${deg(Y)}  φ${deg(Pt)}`, 24, 24);
      const word = proc === 'agent' ? 'SPLIT ×4' : proc === 'web' ? 'GRATICULE' : proc === 'think' ? 'CORE ACTIVE' : proc === 'read' || proc === 'search' ? 'FOCUS SWEEP' : proc === 'wait' ? 'HOLD' : busy ? proc.toUpperCase() : 'IDLE';
      ctx.fillStyle = busy ? col.acc : col.dim;
      ctx.fillText(`f/1.4  ${word}`, 24, 38);
    }
  },
};
