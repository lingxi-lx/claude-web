import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { tr } from '@/i18n';
import { LetterFlow } from '@/features/home/LetterFlow';
import { useActivePack } from './apply';
import type { FromWorker, ToWorker } from './backdrop-protocol';
import { REQUIRED_COLORS, type ThemePack } from './pack';
import { processOf } from './process';
import { watchdog } from './watchdog';
import { isBuiltin } from './registry';

const reducedMotion = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.dataset.reduceMotion === '1';

/** the active conversation's process, as a word (a primitive: a stable selector result) */
function useLiveProcess(): string {
  return useStore((s) => {
    const o = s.activeId ? s.open[s.activeId] : undefined;
    if (!o || (o.state !== 'running' && o.state !== 'waiting')) return 'idle';
    const c = o.conv;
    if (c.compacting) return 'compact';
    if (o.state === 'waiting') return 'wait';
    const rt = c.runningTool ? c.toolIndex.get(c.runningTool.id) : undefined;
    return rt ? processOf(rt.name, rt.input) : 'think';
  });
}

function readColors(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(REQUIRED_COLORS.map((k) => [k, cs.getPropertyValue(`--${k}`).trim()]));
}

/**
 * A character theme's backdrop (spec 2026-10-22 §2): one canvas, handed to a worker that runs the theme's
 * backdrop.js with the network taken away. Here: size, pointer, what is typed in the box, the conversation's process,
 * pausing off screen / in a hidden window, and the watchdog — a backdrop that throws, crawls or hangs is taken down
 * and the page gets 字流 (welcome) or nothing (behind a conversation).
 */
export function Backdrop({ scene }: { scene: 'welcome' | 'chat' }) {
  const pack = useActivePack();
  const [failed, setFailed] = useState<string | null>(null);
  if (!pack?.backdrop) return null;
  if (failed === pack.id) return scene === 'welcome' ? <LetterFlow /> : null;
  return <BackdropCanvas key={pack.id + scene} pack={pack} scene={scene} onFail={() => setFailed(pack.id)} />;
}

function BackdropCanvas({ pack, scene, onFail }: { pack: ThemePack; scene: 'welcome' | 'chat'; onFail: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const process = useLiveProcess();
  const fail = useRef(onFail);
  fail.current = onFail;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof canvas.transferControlToOffscreen !== 'function') return;
    const w = new Worker(new URL('./backdrop-worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    const send = (m: ToWorker, transfer: Transferable[] = []) => w.postMessage(m, transfer);
    const wd = watchdog(performance.now());
    // motion reduced: watched until the still frame is drawn (`still`), and again around each redraw on a resize
    const reduce = reducedMotion();
    let dead = false;
    const die = (why: string) => {
      if (dead) return;
      dead = true;
      w.terminate();
      console.warn(`[theme ${pack.id}] backdrop stopped: ${why}`);
      useStore.getState().toast(tr('这个主题的背景出了问题，已暂时换回默认'));
      fail.current();
    };
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      if (e.data.type === 'still') { wd.pause(); return; }
      if (wd.feed(e.data.type === 'error' ? { type: 'error' } : e.data, performance.now()) === 'fail') die(e.data.type === 'error' ? e.data.message : 'too slow');
    };
    w.onerror = (e) => die(e.message || 'worker error');
    const beat = setInterval(() => { if (wd.tick(performance.now()) === 'fail') die('no answer'); }, 500);

    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const off = canvas.transferControlToOffscreen();
    send({ type: 'init', canvas: off, source: pack.backdrop!, width: r.width, height: r.height, dpr, colors: readColors(), scene, speed: scene === 'chat' ? pack.chatDim.speed : 1, reduce, trusted: isBuiltin(pack.id), probe: new URL('./', location.href).href }, [off]);

    // where the page's words are, in canvas px: the welcome column (backdrops keep it quiet)
    const words = () => {
      if (scene !== 'welcome') return;
      const b = canvas.getBoundingClientRect();
      const rects = [...(canvas.parentElement?.querySelectorAll('.welcome .home-col > *') ?? [])].map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height)
        .map((r) => ({ x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height }));
      send({ type: 'quiet', rects });
    };
    const ro = new ResizeObserver(() => {
      const b = canvas.getBoundingClientRect();
      if (reduce) wd.resume(performance.now());
      send({ type: 'resize', width: b.width, height: b.height, dpr: Math.min(2, window.devicePixelRatio || 1) });
      words();
    });
    ro.observe(canvas);
    const col = canvas.parentElement?.querySelector('.welcome .home-col');
    if (col) ro.observe(col);
    const wordsTimer = setInterval(words, 1500);
    words();
    // off screen or in a hidden window: no frames, and silence is expected
    let seen = true;
    const sync = () => {
      // motion reduced: nothing runs to pause or resume (the watch follows `still` and resizes)
      if (reduce) return;
      const on = seen && document.visibilityState === 'visible';
      if (on) { wd.resume(performance.now()); send({ type: 'resume' }); } else { wd.pause(); send({ type: 'pause' }); }
    };
    const io = new IntersectionObserver(([en]) => { seen = !!en?.isIntersecting; sync(); });
    io.observe(canvas);
    document.addEventListener('visibilitychange', sync);
    const at = (e: PointerEvent) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const onMove = (e: PointerEvent) => { const p = at(e); send({ type: 'pointer', ...p, down: e.buttons > 0 }); };
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.composer, input, textarea, select, button, a, [contenteditable="true"]')) return;
      send({ type: 'pointer', ...at(e), down: true, click: true });
    };
    const onLeave = () => send({ type: 'pointer', x: null });
    // what is typed in the box: only what was added
    const last = new WeakMap<EventTarget, string>();
    const onInput = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLTextAreaElement) || !t.closest('.composer')) return;
      const prev = last.get(t) ?? '';
      last.set(t, t.value);
      if (t.value.length > prev.length && t.value.startsWith(prev)) send({ type: 'type', text: t.value.slice(prev.length) });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    document.documentElement.addEventListener('pointerleave', onLeave);
    document.addEventListener('input', onInput, true);
    // the theme's colours, read again when the theme's style or the brightness changes
    const mo = new MutationObserver(() => send({ type: 'colors', colors: readColors() }));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-ascii'] });
    return () => {
      dead = true;
      clearInterval(beat);
      clearInterval(wordsTimer);
      ro.disconnect(); io.disconnect(); mo.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('input', onInput, true);
      w.terminate();
      worker.current = null;
    };
  }, [pack, scene]);

  useEffect(() => { worker.current?.postMessage({ type: 'process', process } satisfies ToWorker); }, [process]);

  return (
    <canvas ref={ref} className={scene === 'welcome' ? 'ascii-field ascii-bd' : 'ascii-bd chat-bd'} style={scene === 'chat' ? { opacity: pack.chatDim.opacity } : undefined} aria-hidden />
  );
}
