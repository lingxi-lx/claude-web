import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { cellLevel, makeNoise } from './ascii-noise';

/**
 * The new-conversation page's backdrop (2026-10-17, after a recording of the official app): a field of dim letters and
 * digits that slow clouds of noise bring up and fade out, the characters flickering, the area under the pointer lit in
 * the theme's accent. A canvas behind the page; drawn at ~15 fps and only while the page is on screen and the window
 * is visible; one still frame when motion is reduced; off with 设置 → 外观 → 新对话页的动态背景.
 */

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const FPS = 15;
const QUIET_PAD = 16;
const QUIET_RAMP = 72;
const QUIET_FLOOR = 0.06;

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
    let cols = 0, rows = 0, cw = 8, ch = 15, dpr = 1;
    let glyphs = new Uint8Array(0);
    let ink = '#888', lit = '#4a9eff', font = '';
    const pointer = { x: -1e4, y: -1e4 };
    const readColors = () => {
      const cs = getComputedStyle(canvas);
      ink = cs.getPropertyValue('--fg-2').trim() || ink;
      lit = cs.getPropertyValue('--accent-text').trim() || lit;
      const mono = cs.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace';
      font = `${11 * dpr}px ${mono}`;
    };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      cw = 8; ch = 15;
      cols = Math.ceil(r.width / cw);
      rows = Math.ceil(r.height / ch);
      glyphs = Uint8Array.from({ length: cols * rows }, () => Math.floor(Math.random() * CHARS.length));
      readColors();
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = font;
      ctx.textBaseline = 'top';
      const r = canvas.getBoundingClientRect();
      const px = (pointer.x - r.left) / cw, py = (pointer.y - r.top) / ch;
      // the page's words (greeting, input box, hints, the recent list) sit on a near-empty field: letters fade out
      // over QUIET_RAMP px towards that column and stay a trace inside it
      const col = canvas.parentElement?.querySelector('.home-col')?.getBoundingClientRect();
      const q = col && col.width > 0 ? { l: col.left - r.left - QUIET_PAD, t: col.top - r.top - QUIET_PAD, r: col.right - r.left + QUIET_PAD, b: col.bottom - r.top + QUIET_PAD } : null;
      const calm = (x: number, y: number) => {
        if (!q) return 1;
        const cx = x * cw + cw / 2, cy = y * ch + ch / 2;
        const d = Math.max(q.l - cx, cx - q.r, q.t - cy, cy - q.b);
        return d >= QUIET_RAMP ? 1 : d <= 0 ? QUIET_FLOOR : QUIET_FLOOR + (1 - QUIET_FLOOR) * (d / QUIET_RAMP);
      };
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const level = cellLevel(noise, x, y, t);
          const dx = (x - px) / 14, dy = (y - py) / 7;
          const near = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
          if (level <= 0 && near <= 0.35) continue;
          const i = y * cols + x;
          if (!reduce && Math.random() < 0.02) glyphs[i] = Math.floor(Math.random() * CHARS.length);
          const a = Math.min(1, level * 0.3 + near * near * 0.6) * calm(x, y);
          if (a < 0.03) continue;
          ctx.globalAlpha = a;
          ctx.fillStyle = near > 0.2 ? lit : ink;
          ctx.fillText(CHARS[glyphs[i]], x * cw * dpr, y * ch * dpr);
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
      draw((now - start) / 1000);
    };
    if (reduce) draw(0); else raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => { resize(); if (reduce) draw(0); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { shown = e.isIntersecting; });
    io.observe(canvas);
    const move = (e: PointerEvent) => { pointer.x = e.clientX; pointer.y = e.clientY; };
    const leave = () => { pointer.x = -1e4; pointer.y = -1e4; };
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', leave);
    };
  }, [on, theme]);
  if (!on) return null;
  return <canvas ref={ref} className="ascii-field" aria-hidden />;
}
