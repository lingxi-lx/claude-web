import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { tr } from '@/i18n';
import { LetterFlow } from '@/features/home/LetterFlow';
import { useActivePack } from './apply';
import type { FromWorker, ToWorker } from './backdrop-protocol';
import { REQUIRED_COLORS, type ThemePack } from '@themes';
import { processOf } from '@themes';
import { watchdog } from './watchdog';
import { backdropWorker, sandboxReady } from './worker-url';
import { backdropData } from './backdrop-data';
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

/**
 * A theme's backdrop in a card of 设置 → 外观 (the one under the pointer): the theme's own colours (it is not the one
 * on the page), the pointer only inside the card, no page words to keep quiet, and no toast when it fails — the card
 * just goes still.
 */
export function BackdropPreview({ pack, onFail }: { pack: ThemePack; onFail?: () => void }) {
  if (!pack.backdrop) return null;
  return <BackdropCanvas pack={pack} scene="preview" onFail={onFail ?? (() => {})} />;
}

function BackdropCanvas({ pack, scene, onFail }: { pack: ThemePack; scene: 'welcome' | 'chat' | 'preview'; onFail: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const process = useLiveProcess();
  const fail = useRef(onFail);
  fail.current = onFail;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof canvas.transferControlToOffscreen !== 'function') return;
    const w = backdropWorker();
    worker.current = w;
    const send = (m: ToWorker, transfer: Transferable[] = []) => w.postMessage(m, transfer);
    const wd = watchdog(performance.now());
    // motion reduced: watched until the still frame is drawn (`still`), and again around each redraw on a resize
    const reduce = reducedMotion();
    const preview = scene === 'preview';
    const colorsNow = () => (preview ? { ...pack.colors } : readColors());
    let dead = false;
    const die = (why: string) => {
      if (dead) return;
      dead = true;
      w.terminate();
      console.warn(`[theme ${pack.id}] backdrop stopped: ${why}`);
      if (!preview) useStore.getState().toast(tr('这个主题的背景出了问题，已暂时换回默认'));
      fail.current();
    };
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      if (e.data.type === 'still') { wd.pause(); return; }
      if (e.data.type === 'snapshot' || e.data.type === 'hello') return;
      if (wd.feed(e.data.type === 'error' ? { type: 'error' } : e.data, performance.now()) === 'fail') die(e.data.type === 'error' ? e.data.message : 'too slow');
    };
    w.onerror = (e) => die(e.message || 'worker error');
    const beat = setInterval(() => { if (wd.tick(performance.now()) === 'fail') die('no answer'); }, 500);

    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const off = canvas.transferControlToOffscreen();
    const trusted = isBuiltin(pack.id);
    // a theme that is not built in: once the page has seen the worker's CSP (one request, the first time)
    wd.pause();
    void (trusted ? Promise.resolve(true) : sandboxReady(w)).then((sandboxed) => {
      if (dead) return;
      wd.resume(performance.now());
      send({ type: 'init', canvas: off, source: pack.backdrop!, width: r.width, height: r.height, dpr, colors: colorsNow(), scene: preview ? 'welcome' : scene, speed: scene === 'chat' ? pack.chatDim.speed : 1, reduce, trusted, sandboxed }, [off]);
    });

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
    const inside = (p: { x: number; y: number }) => { const b = canvas.getBoundingClientRect(); return p.x >= 0 && p.y >= 0 && p.x <= b.width && p.y <= b.height; };
    const onMove = (e: PointerEvent) => {
      const p = at(e);
      if (preview && !inside(p)) { send({ type: 'pointer', x: null }); return; }
      send({ type: 'pointer', ...p, down: e.buttons > 0 });
    };
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.composer, input, textarea, select, button, a, [contenteditable="true"]')) return;
      if (preview) return;
      send({ type: 'pointer', ...at(e), down: true, click: true });
    };
    const onLeave = () => send({ type: 'pointer', x: null });
    // what is typed in the box: only what was added
    const last = new WeakMap<EventTarget, string>();
    const onInput = (e: Event) => {
      const t = e.target;
      if (preview || !(t instanceof HTMLTextAreaElement) || !t.closest('.composer')) return;
      const prev = last.get(t) ?? '';
      last.set(t, t.value);
      if (t.value.length > prev.length && t.value.startsWith(prev)) send({ type: 'type', text: t.value.slice(prev.length) });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    document.documentElement.addEventListener('pointerleave', onLeave);
    document.addEventListener('input', onInput, true);
    // the theme's colours, read again when the theme's style or the brightness changes
    const mo = new MutationObserver(() => { if (!preview) send({ type: 'colors', colors: readColors() }); });
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
  // the user's projects (花园 grows them), sent again when the list changes; a minute's tick keeps 「recent」 true
  const sessions = useStore((s) => s.sessions);
  const [minute, setMinute] = useState(0);
  useEffect(() => { const t = setInterval(() => setMinute((m) => m + 1), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => { worker.current?.postMessage({ type: 'data', data: backdropData(sessions, Date.now()) } satisfies ToWorker); }, [sessions, minute]);

  return (
    <canvas ref={ref} className={scene === 'welcome' ? 'ascii-field ascii-bd' : scene === 'chat' ? 'ascii-bd chat-bd' : 'ascii-bd preview-bd'} style={scene === 'chat' ? { opacity: pack.chatDim.opacity } : undefined} aria-hidden />
  );
}
