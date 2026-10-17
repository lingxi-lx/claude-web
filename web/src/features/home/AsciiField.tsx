import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { RIPPLE_MS, RIPPLE_REACH, bandLevel, makeNoise, rippleLevel } from './ascii-noise';

/**
 * The new-conversation page's backdrop (2026-10-17, after two recordings of the official app): a dense field of tiny,
 * very dim letters and digits in soft diagonal bands that drift, the characters flickering now and then; every click on
 * the page sends out a ripple — a small disc of the theme's accent that opens into a ring and fades. Quieter near the
 * page's words. A canvas behind the page; ~15 fps and only while the page is on screen and the window is visible; one
 * still frame when motion is reduced; off with 设置 → 外观 → 新对话页的动态背景.
 */

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const FPS = 15;
/** the field's brightest (the bands); the ripple goes up to RIPPLE_MAX */
const FIELD_BASE = 0.045;
const FIELD_MAX = 0.16;
const RIPPLE_MAX = 1;
const QUIET_PAD = 12;
const QUIET_RAMP = 60;
const QUIET_FLOOR = 0.35;
const CW = 7, CH = 13;

export function AsciiField() {
  const ref = useRef<HTMLCanvasElement>(null);
  const on = useStore((s) => s.settings['ui.welcomeBackdrop'] !== false);
  const theme = useStore((s) => s.settings['ui.theme']);
  useEffect(() => {
    const canvas = ref.current;
    if (!on || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion === '1';
    const noise = makeNoise(7);
    let cols = 0, rows = 0, dpr = 1;
    let glyphs = new Uint8Array(0);
    let ink = '#888', lit = '#4a9eff', font = '';
    const ripples: { x: number; y: number; at: number }[] = [];
    const readColors = () => {
      const cs = getComputedStyle(canvas);
      ink = cs.getPropertyValue('--ink-3').trim() || cs.getPropertyValue('--fg-2').trim() || ink;
      lit = cs.getPropertyValue('--accent-text').trim() || lit;
      const mono = cs.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace';
      font = `${10 * dpr}px ${mono}`;
    };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      cols = Math.ceil(r.width / CW);
      rows = Math.ceil(r.height / CH);
      glyphs = Uint8Array.from({ length: cols * rows }, () => Math.floor(Math.random() * CHARS.length));
      readColors();
    };
    const draw = (t: number, now: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = font;
      ctx.textBaseline = 'top';
      const r = canvas.getBoundingClientRect();
      while (ripples.length && now - ripples[0].at >= RIPPLE_MS) ripples.shift();
      // the page's words (greeting, input box, hints, the recent list) keep a calmer field behind them
      const col = canvas.parentElement?.querySelector('.home-col')?.getBoundingClientRect();
      const q = col && col.width > 0 ? { l: col.left - r.left - QUIET_PAD, t: col.top - r.top - QUIET_PAD, r: col.right - r.left + QUIET_PAD, b: col.bottom - r.top + QUIET_PAD } : null;
      const calm = (px: number, py: number) => {
        if (!q) return 1;
        const d = Math.max(q.l - px, px - q.r, q.t - py, py - q.b);
        return d >= QUIET_RAMP ? 1 : d <= 0 ? QUIET_FLOOR : QUIET_FLOOR + (1 - QUIET_FLOOR) * (d / QUIET_RAMP);
      };
      const live = ripples.map((p) => ({ x: p.x - r.left, y: p.y - r.top, age: now - p.at }));
      for (let y = 0; y < rows; y++) {
        const py = y * CH + CH / 2;
        for (let x = 0; x < cols; x++) {
          const px = x * CW + CW / 2;
          let ring = 0;
          for (const p of live) {
            const dx = px - p.x, dy = py - p.y;
            if (Math.abs(dx) > RIPPLE_REACH + 50 || Math.abs(dy) > RIPPLE_REACH + 50) continue;
            ring = Math.max(ring, rippleLevel(Math.sqrt(dx * dx + dy * dy), p.age));
          }
          const level = bandLevel(noise, x, y, t);
          const i = y * cols + x;
          if (!reduce && Math.random() < 0.015) glyphs[i] = Math.floor(Math.random() * CHARS.length);
          if (ring > 0.02) {
            ctx.globalAlpha = Math.min(1, ring * RIPPLE_MAX);
            ctx.fillStyle = lit;
          } else {
            const a = (FIELD_BASE + level * FIELD_MAX) * calm(px, py);
            if (a < 0.02) continue;
            ctx.globalAlpha = a;
            ctx.fillStyle = ink;
          }
          ctx.fillText(CHARS[glyphs[i]], x * CW * dpr, y * CH * dpr);
        }
      }
      ctx.globalAlpha = 1;
    };
    resize();
    let raf = 0, last = 0, shown = true;
    const start = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!shown || document.hidden || now - last < 1000 / FPS) return;
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
  }, [on, theme]);
  if (!on) return null;
  return <canvas ref={ref} className="ascii-field" aria-hidden />;
}
