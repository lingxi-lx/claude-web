import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { RIPPLE_MS, RIPPLE_REACH, bandLevel, makeNoise, rippleLevel } from './ascii-noise';

/**
 * The new-conversation page's backdrop (2026-10-17, after two recordings of the official app): a dense field of tiny,
 * very dim letters and digits in soft diagonal bands that drift, the characters flickering now and then; every click on
 * the page sends out a ripple — a small disc of the theme's accent that opens into a ring and fades. Quieter near the
 * page's words. 8 fps (20 while a ripple runs) and only while the page is on screen and the window is visible; one still frame when motion is
 * reduced; 设置 → 外观 → 新对话页的动态背景 → 字场 (the default is 字流, LetterFlow.tsx).
 *
 * Cheap per frame (drawing ten thousand letters one by one each frame took most of the main thread, 2026-10-17
 * review): the letters live on an offscreen layer where only the flickering few are redrawn; each frame that layer is
 * copied and masked by a one-pixel-per-cell brightness image; only the cells a ripple lights are drawn as text.
 */

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** frames a second: the drift alone needs few; a ripple is drawn smoothly */
const FPS_IDLE = 8;
const FPS_RIPPLE = 20;
/** a cell's brightness: FIELD_BASE everywhere, up to FIELD_BASE + FIELD_MAX in a band; a ripple up to RIPPLE_MAX */
const FIELD_BASE = 0.045;
const FIELD_MAX = 0.16;
const RIPPLE_MAX = 1;
const FLICKER = 0.008;
/** the brightness is worked out for every MASK x MASK cells (the bands are wide; the noise was most of a frame) */
const MASK = 2;
const QUIET_PAD = 12;
const QUIET_RAMP = 60;
const QUIET_FLOOR = 0.35;
const CW = 7, CH = 13;

export function AsciiField() {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useStore((s) => s.settings['ui.theme']);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const layer = document.createElement('canvas');
    const lctx = layer.getContext('2d');
    const mask = document.createElement('canvas');
    const mctx = mask.getContext('2d');
    if (!ctx || !lctx || !mctx) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion === '1';
    const noise = makeNoise(7);
    let cols = 0, rows = 0, dpr = 1;
    let glyphs = new Uint8Array(0);
    let shade: ImageData | null = null;
    let ink = '#888', lit = '#4a9eff', font = '';
    const ripples: { x: number; y: number; at: number }[] = [];
    const readColors = () => {
      const cs = getComputedStyle(canvas);
      ink = cs.getPropertyValue('--ink-3').trim() || cs.getPropertyValue('--fg-2').trim() || ink;
      lit = cs.getPropertyValue('--accent-text').trim() || lit;
      const mono = cs.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace';
      font = `${10 * dpr}px ${mono}`;
    };
    const glyph = (c: CanvasRenderingContext2D, i: number) => c.fillText(CHARS[glyphs[i]], (i % cols) * CW * dpr, Math.floor(i / cols) * CH * dpr);
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = layer.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = layer.height = Math.max(1, Math.round(r.height * dpr));
      cols = Math.ceil(r.width / CW);
      rows = Math.ceil(r.height / CH);
      mask.width = Math.max(1, Math.ceil(cols / MASK));
      mask.height = Math.max(1, Math.ceil(rows / MASK));
      shade = mctx.createImageData(mask.width, mask.height);
      glyphs = Uint8Array.from({ length: cols * rows }, () => Math.floor(Math.random() * CHARS.length));
      readColors();
      // every letter once, fully opaque: the mask decides how much of it shows
      lctx.clearRect(0, 0, layer.width, layer.height);
      lctx.font = font;
      lctx.textBaseline = 'top';
      lctx.fillStyle = ink;
      for (let i = 0; i < glyphs.length; i++) glyph(lctx, i);
    };
    const draw = (t: number, now: number) => {
      if (!shade) return;
      const r = canvas.getBoundingClientRect();
      // a few letters change: cleared and redrawn on the layer only
      if (!reduce) {
        lctx.font = font;
        lctx.textBaseline = 'top';
        lctx.fillStyle = ink;
        const n = Math.ceil(glyphs.length * FLICKER);
        for (let k = 0; k < n; k++) {
          const i = Math.floor(Math.random() * glyphs.length);
          glyphs[i] = Math.floor(Math.random() * CHARS.length);
          lctx.clearRect((i % cols) * CW * dpr, Math.floor(i / cols) * CH * dpr, CW * dpr, CH * dpr);
          glyph(lctx, i);
        }
      }
      // the brightness of every cell, one pixel each
      const col = canvas.parentElement?.querySelector('.home-col')?.getBoundingClientRect();
      const q = col && col.width > 0 ? { l: col.left - r.left - QUIET_PAD, t: col.top - r.top - QUIET_PAD, r: col.right - r.left + QUIET_PAD, b: col.bottom - r.top + QUIET_PAD } : null;
      const px = shade.data;
      for (let my = 0; my < mask.height; my++) {
        const y = my * MASK + (MASK - 1) / 2, cy = y * CH + CH / 2;
        for (let mx = 0; mx < mask.width; mx++) {
          const x = mx * MASK + (MASK - 1) / 2, cx = x * CW + CW / 2;
          let a = FIELD_BASE + bandLevel(noise, x, y, t) * FIELD_MAX;
          if (q) {
            const d = Math.max(q.l - cx, cx - q.r, q.t - cy, cy - q.b);
            if (d < QUIET_RAMP) a *= d <= 0 ? QUIET_FLOOR : QUIET_FLOOR + (1 - QUIET_FLOOR) * (d / QUIET_RAMP);
          }
          px[(my * mask.width + mx) * 4 + 3] = Math.round(Math.min(1, a) * 255);
        }
      }
      mctx.putImageData(shade, 0, 0);
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(layer, 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mask, 0, 0, mask.width * MASK * CW * dpr, mask.height * MASK * CH * dpr);
      ctx.globalCompositeOperation = 'source-over';
      // the ripples: only the cells they light, as text in the accent
      while (ripples.length && now - ripples[0].at >= RIPPLE_MS) ripples.shift();
      if (ripples.length) {
        ctx.font = font;
        ctx.textBaseline = 'top';
        ctx.fillStyle = lit;
        const live = ripples.map((p) => ({ x: p.x - r.left, y: p.y - r.top, age: now - p.at }));
        const reach = RIPPLE_REACH + 60;
        for (const p of live) {
          const x0 = Math.max(0, Math.floor((p.x - reach) / CW)), x1 = Math.min(cols - 1, Math.ceil((p.x + reach) / CW));
          const y0 = Math.max(0, Math.floor((p.y - reach) / CH)), y1 = Math.min(rows - 1, Math.ceil((p.y + reach) / CH));
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const dx = x * CW + CW / 2 - p.x, dy = y * CH + CH / 2 - p.y;
              // the strongest ripple at this cell decides: skip the cell when a later one is brighter there
              const ring = rippleLevel(Math.sqrt(dx * dx + dy * dy), p.age);
              if (ring <= 0.02) continue;
              let best = ring;
              for (const o of live) {
                if (o === p) continue;
                const ex = x * CW + CW / 2 - o.x, ey = y * CH + CH / 2 - o.y;
                best = Math.max(best, rippleLevel(Math.sqrt(ex * ex + ey * ey), o.age));
              }
              if (best > ring) continue;
              ctx.clearRect(x * CW * dpr, y * CH * dpr, CW * dpr, CH * dpr);
              ctx.globalAlpha = Math.min(1, ring * RIPPLE_MAX);
              glyph(ctx, y * cols + x);
            }
          }
        }
        ctx.globalAlpha = 1;
      }
    };
    resize();
    let raf = 0, last = 0, shown = true;
    const start = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!shown || document.hidden || now - last < 1000 / (ripples.length ? FPS_RIPPLE : FPS_IDLE)) return;
      last = now;
      draw((now - start) / 1000, now);
    };
    if (reduce) draw(0, performance.now()); else raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => { resize(); if (reduce) draw(0, performance.now()); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { shown = e.isIntersecting; });
    io.observe(canvas);
    // a click anywhere on the page (the canvas itself takes no pointer events): a ripple from where it was
    const tile = canvas.parentElement;
    const down = (e: PointerEvent) => {
      if (reduce || e.button !== 0) return;
      ripples.push({ x: e.clientX, y: e.clientY, at: performance.now() });
      if (ripples.length > 6) ripples.shift();
    };
    tile?.addEventListener('pointerdown', down, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      tile?.removeEventListener('pointerdown', down);
    };
  }, [theme]);
  return <canvas ref={ref} className="ascii-field" aria-hidden />;
}
