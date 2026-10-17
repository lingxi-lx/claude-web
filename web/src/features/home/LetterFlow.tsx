import { useEffect, useRef } from 'react';
import { makeNoise } from './ascii-noise';
import { LETTERS, ambient, moteAlpha, moteCount, splash, step, typed, type Mote } from './letter-flow';

/**
 * 字流 (letter-flow.ts): letters drifting like ink in slow water, a short trail behind each, the pointer parting
 * them, a click splashing accent letters, and what is typed in the box floating out of it to join the stream.
 * 20 fps while the page is on screen and the window visible; one still frame when motion is reduced.
 * Cheap: the field's letters are stamped from a sheet drawn once (no text layout per frame); only the few accent
 * letters (typed, splashed — any script) are drawn as text; one fill a frame lets the trails fade.
 */

const FPS = 20;
/** the field's ink at its strongest; quieter behind the page's words */
const INK = 0.36;
const QUIET_PAD = 10;
const QUIET_RAMP = 70;
const QUIET_FLOOR = 0.3;
/**
 * The trail: each frame first lays the page's own background colour over the last one at this strength. Not a fade
 * to transparent (destination-out): that never reaches zero in 8-bit alpha — a haze of alpha 2/255 covered the
 * whole page after a minute (2026-10-17 review). Towards an opaque colour, what is left is within a level of it.
 * (Drawing each letter again behind itself instead cost six times the drawing.)
 */
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
    // the field's letters, drawn once in the ink colour at 10px: one cell per letter
    const sheet = document.createElement('canvas');
    const sctx = sheet.getContext('2d');
    const CELL = 14;
    const cellOf = new Map<string, number>();
    const drawSheet = () => {
      if (!sctx) return;
      sheet.width = LETTERS.length * CELL * dpr;
      sheet.height = CELL * dpr;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, LETTERS.length * CELL, CELL);
      sctx.font = `10px ${mono}`;
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      sctx.fillStyle = ink;
      [...LETTERS].forEach((c, i) => { cellOf.set(c, i); sctx.fillText(c, i * CELL + CELL / 2, CELL / 2); });
    };
    let pointer: { x: number; y: number } | null = null;
    const readColors = () => {
      const cs = getComputedStyle(canvas);
      ink = cs.getPropertyValue('--ink-3').trim() || cs.getPropertyValue('--fg-2').trim() || ink;
      lit = cs.getPropertyValue('--accent-text').trim() || lit;
      mono = cs.getPropertyValue('--font-mono').trim() || mono;
      drawSheet();
    };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fresh = true;
      const want = moteCount(w, h);
      const ambientNow = motes.filter((m) => !m.guest);
      motes = [...ambientNow.slice(0, want), ...Array.from({ length: Math.max(0, want - ambientNow.length) }, () => ambient(w, h, rand)), ...motes.filter((m) => m.guest)];
      readColors();
    };
    const calmAt = (() => {
      let q: { l: number; t: number; r: number; b: number } | null = null;
      let at = -1e9;
      return {
        // where the page's words are, looked at twice a second (a layout read every frame forced a layout while typing)
        update(now: number) {
          if (now - at < 500) return;
          at = now;
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
    // the colour under the canvas: the first ancestor with a background (the pane's), looked at again now and then
    let bg = '', bgAt = 0;
    const background = (now: number) => {
      if (bg && now - bgAt < 1000) return bg;
      bgAt = now;
      for (let e: HTMLElement | null = canvas.parentElement; e; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor;
        if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) { bg = c; return bg; }
      }
      bg = 'rgb(0,0,0)';
      return bg;
    };
    let fresh = true;
    const draw = (trail: boolean) => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = trail && !fresh ? TRAIL_FADE : 1;
      ctx.fillStyle = background(performance.now());
      ctx.fillRect(0, 0, w, h);
      fresh = false;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      calmAt.update(performance.now());
      let font = '';
      const sw = CELL * dpr;
      for (const m of motes) {
        const a = moteAlpha(m);
        if (a <= 0.01) continue;
        const cell = cellOf.get(m.ch);
        if (m.accent > 0.04 || cell === undefined || sctx === null) {
          // typed / splashed (any script): the accent, as text
          const f = `${Math.round(m.size)}px ${mono}`;
          if (f !== font) { ctx.font = f; font = f; }
          const ta = a * (m.accent > 0.04 ? 0.25 + 0.75 * m.accent : INK);
          ctx.fillStyle = m.accent > 0.04 ? lit : ink;
          ctx.globalAlpha = ta;
          ctx.fillText(m.ch, m.x, m.y);
          continue;
        }
        const fa = a * INK * calmAt.at(m.x, m.y);
        if (fa < 0.015) continue;
        const sx = cell * sw;
        ctx.globalAlpha = fa;
        ctx.drawImage(sheet, sx, 0, sw, sw, m.x - CELL / 2, m.y - CELL / 2, CELL, CELL);
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
    // what is typed in the box: from where the caret is — a hidden copy of the box (same width, font, padding and
    // wrapping) with the text before the caret and a marker after it; the marker is where the caret is
    // (a very long text would be laid out again on every key: past this many characters before the caret, the letters
    // come from the top of the box instead)
    const MIRROR_MAX = 4000;
    const caret = (ta: HTMLTextAreaElement) => {
      const r = ta.getBoundingClientRect();
      const upto = ta.selectionStart ?? ta.value.length;
      if (upto > MIRROR_MAX) return local(r.left + r.width / 2, r.top + 10);
      const cs = getComputedStyle(ta);
      const mirror = document.createElement('div');
      for (const p of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize', 'textIndent'] as const) (mirror.style as any)[p] = (cs as any)[p];
      Object.assign(mirror.style, { position: 'fixed', left: '0', top: '0', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: cs.wordBreak, borderStyle: 'solid' });
      mirror.textContent = ta.value.slice(0, upto);
      const mark = document.createElement('span');
      mark.textContent = '\u200b';
      mirror.appendChild(mark);
      document.body.appendChild(mirror);
      const x = r.left + mark.offsetLeft;
      const lh = mark.offsetHeight || parseFloat(cs.lineHeight) || 20;
      const y = r.top + mark.offsetTop - ta.scrollTop + lh / 2;
      mirror.remove();
      // a caret scrolled out of the box: from the box's nearest edge
      return local(Math.min(Math.max(x, r.left + 8), r.right - 12), Math.min(Math.max(y, r.top + lh / 2), r.bottom - lh / 2));
    };
    const emit = (target: EventTarget | null, text: string | null | undefined) => {
      if (reduce || !text || !(target instanceof HTMLTextAreaElement) || !target.closest('.composer')) return;
      // measured after the key's own frame is painted: the caret lookup is a layout, and the typed text shows first
      requestAnimationFrame(() => setTimeout(() => spawnAt(target, text), 0));
    };
    const spawnAt = (target: HTMLTextAreaElement, text: string) => {
      if (!target.isConnected) return;
      motes.push(...typed(text, caret(target), rand));
      // never more than a page's worth of guests
      const guests = motes.filter((m) => m.guest);
      if (guests.length > 160) { const drop = new Set(guests.slice(0, guests.length - 160)); motes = motes.filter((m) => !drop.has(m)); }
    };
    // a typed character (an input method's composing text comes as insertCompositionText, its result below)
    const onInput = (e: Event) => { const ie = e as InputEvent; if (ie.inputType === 'insertText') emit(e.target, ie.data); };
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
