import { useEffect, useRef } from 'react';
import { makeNoise } from './ascii-noise';
import { ambient, moteAlpha, moteCount, splash, step, typed, type Mote } from './letter-flow';

/**
 * 字流 (letter-flow.ts): letters drifting like ink in slow water, a short trail behind each, the pointer parting
 * them, a click splashing accent letters, and what is typed in the box floating out of it to join the stream.
 * 30 fps while the page is on screen and the window visible; one still frame when motion is reduced.
 * Cheap: a few hundred letters a frame, and one fill that lets the trails fade.
 */

const FPS = 30;
/** the field's ink at its strongest; quieter behind the page's words */
const INK = 0.36;
const QUIET_PAD = 10;
const QUIET_RAMP = 70;
const QUIET_FLOOR = 0.3;
/** how much of the previous frame each frame takes away (the trail's length) */
const TRAIL_FADE = 0.24;

export function LetterFlow() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion === '1';
    const noise = makeNoise(11);
    const rand = Math.random;
    let w = 0, h = 0, dpr = 1;
    let motes: Mote[] = [];
    let ink = '#888', lit = '#d97757', mono = 'ui-monospace, monospace';
    let pointer: { x: number; y: number } | null = null;
    const readColors = () => {
      const cs = getComputedStyle(canvas);
      ink = cs.getPropertyValue('--ink-3').trim() || cs.getPropertyValue('--fg-2').trim() || ink;
      lit = cs.getPropertyValue('--accent-text').trim() || lit;
      mono = cs.getPropertyValue('--font-mono').trim() || mono;
    };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const want = moteCount(w, h);
      const ambientNow = motes.filter((m) => !m.guest);
      motes = [...ambientNow.slice(0, want), ...Array.from({ length: Math.max(0, want - ambientNow.length) }, () => ambient(w, h, rand)), ...motes.filter((m) => m.guest)];
      readColors();
    };
    const calmAt = (() => {
      let q: { l: number; t: number; r: number; b: number } | null = null;
      return {
        update() {
          const r = canvas.getBoundingClientRect();
          const col = canvas.parentElement?.querySelector('.home-col')?.getBoundingClientRect();
          q = col && col.width > 0 ? { l: col.left - r.left - QUIET_PAD, t: col.top - r.top - QUIET_PAD, r: col.right - r.left + QUIET_PAD, b: col.bottom - r.top + QUIET_PAD } : null;
        },
        at(x: number, y: number) {
          if (!q) return 1;
          const d = Math.max(q.l - x, x - q.r, q.t - y, y - q.b);
          return d >= QUIET_RAMP ? 1 : d <= 0 ? QUIET_FLOOR : QUIET_FLOOR + (1 - QUIET_FLOOR) * (d / QUIET_RAMP);
        },
      };
    })();
    const draw = (trail: boolean) => {
      if (trail) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(0,0,0,${TRAIL_FADE})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      } else ctx.clearRect(0, 0, w, h);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      calmAt.update();
      let font = '';
      for (const m of motes) {
        const a = moteAlpha(m);
        if (a <= 0.01) continue;
        const f = `${Math.round(m.size)}px ${mono}`;
        if (f !== font) { ctx.font = f; font = f; }
        if (m.accent > 0.04) {
          // typed / splashed: the accent, over the page's words too (it comes out of them)
          ctx.globalAlpha = a * (0.25 + 0.75 * m.accent);
          ctx.fillStyle = lit;
        } else {
          ctx.globalAlpha = a * INK * calmAt.at(m.x, m.y);
          if (ctx.globalAlpha < 0.015) continue;
          ctx.fillStyle = ink;
        }
        ctx.fillText(m.ch, m.x, m.y);
      }
      ctx.globalAlpha = 1;
    };
    resize();
    let raf = 0, last = 0, shown = true;
    const start = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!shown || document.hidden || now - last < 1000 / FPS - 2) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / FPS;
      last = now;
      motes = step(motes, { dt, t: (now - start) / 1000, w, h, noise, pointer, rand, flicker: 0.25 });
      draw(true);
    };
    if (reduce) draw(false); else raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => { resize(); if (reduce) draw(false); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { shown = e.isIntersecting; });
    io.observe(canvas);

    const tile = canvas.parentElement;
    const local = (x: number, y: number) => { const r = canvas.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };
    const move = (e: PointerEvent) => { pointer = local(e.clientX, e.clientY); };
    const leave = () => { pointer = null; };
    const down = (e: PointerEvent) => {
      if (reduce || e.button !== 0) return;
      motes.push(...splash(local(e.clientX, e.clientY), rand));
    };
    // what is typed in the box: from where the caret is (the text before it, measured in the box's own font)
    const measure = document.createElement('canvas').getContext('2d');
    const caret = (ta: HTMLTextAreaElement) => {
      const r = ta.getBoundingClientRect();
      const cs = getComputedStyle(ta);
      const before = ta.value.slice(0, ta.selectionStart ?? ta.value.length);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      let x = r.left + parseFloat(cs.paddingLeft || '0');
      if (measure) { measure.font = cs.font; x += measure.measureText(line).width; }
      const lines = before.split('\n').length - 1;
      const lh = parseFloat(cs.lineHeight) || 20;
      const y = r.top + parseFloat(cs.paddingTop || '0') + Math.min(lines * lh - ta.scrollTop, r.height - lh) + lh / 2;
      return local(Math.min(x, r.right - 12), y);
    };
    const emit = (target: EventTarget | null, text: string | null | undefined) => {
      if (reduce || !text || !(target instanceof HTMLTextAreaElement) || !target.closest('.composer')) return;
      motes.push(...typed(text, caret(target), rand));
      // never more than a page's worth of guests
      const guests = motes.filter((m) => m.guest);
      if (guests.length > 160) { const drop = new Set(guests.slice(0, guests.length - 160)); motes = motes.filter((m) => !drop.has(m)); }
    };
    const onInput = (e: Event) => { const ie = e as InputEvent; if (ie.inputType === 'insertText' && !ie.isComposing) emit(e.target, ie.data); };
    // an input method (Chinese, Japanese…): what it commits, once
    const onCompose = (e: CompositionEvent) => emit(e.target, e.data);
    tile?.addEventListener('pointermove', move, { passive: true });
    tile?.addEventListener('pointerleave', leave);
    tile?.addEventListener('pointerdown', down, { passive: true });
    tile?.addEventListener('input', onInput);
    tile?.addEventListener('compositionend', onCompose);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      tile?.removeEventListener('pointermove', move);
      tile?.removeEventListener('pointerleave', leave);
      tile?.removeEventListener('pointerdown', down);
      tile?.removeEventListener('input', onInput);
      tile?.removeEventListener('compositionend', onCompose);
    };
  }, []);
  return <canvas ref={ref} className="ascii-field letter-flow" aria-hidden />;
}
