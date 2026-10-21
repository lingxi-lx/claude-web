/// <reference lib="webworker" />
// The backdrop worker (spec 2026-10-22 §2): owns the canvas (OffscreenCanvas from <Backdrop>), runs the theme's
// backdrop code with the network taken away, paces frames, and reports how long they take (themes/watchdog.ts).
import { cspHolds, loadBackdrop, lockdown, type BackdropModule } from './sandbox';
import type { ToWorker } from './backdrop-protocol';

const post = (m: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
let mod: BackdropModule | null = null;
let fps = 30, speed = 1, scene = 'welcome', process = 'idle', running = false, reduce = false;
let mouse: { x: number; y: number; down: boolean } | null = null;
let quiet: { x: number; y: number; w: number; h: number }[] = [];
let t = 0, lastAt = 0, lastDraw = 0, spent = 0, frames = 0, statAt = 0;

const raf: (f: () => void) => void = typeof (self as any).requestAnimationFrame === 'function'
  ? (f) => (self as any).requestAnimationFrame(f)
  : (f) => setTimeout(f, 1000 / 60);

function guard(f: () => void) {
  try { f(); } catch (e: any) { running = false; post({ type: 'error', message: String(e?.stack ?? e?.message ?? e) }); }
}

function loop() {
  if (!running) return;
  const now = performance.now();
  if (now - lastDraw >= 1000 / fps - 1) {
    const dt = Math.min(0.1, (now - lastAt) / 1000) * speed;
    lastAt = now; lastDraw = now; t += dt;
    const a = performance.now();
    guard(() => mod!.frame({ t, dt, mouse, process, scene, speed, quiet }));
    spent += performance.now() - a; frames++;
  }
  if (now - statAt >= 1000) {
    post({ type: 'stats', avgMs: frames ? spent / frames : 0 });
    spent = 0; frames = 0; statAt = now;
  }
  if (running) raf(loop);
}

function start() {
  if (running || !mod || reduce) return;
  running = true;
  lastAt = lastDraw = statAt = performance.now();
  raf(loop);
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'init': {
      scene = m.scene; speed = m.speed; fps = m.scene === 'chat' ? 15 : 30; reduce = m.reduce;
      const realFetch = (self as any).fetch?.bind(self) as typeof fetch | undefined;
      lockdown(self);
      // a theme that is not built in runs only where the worker's CSP really cuts the network
      const ready = m.trusted || !realFetch ? Promise.resolve(true) : cspHolds(realFetch, `${m.probe}?cw-csp-probe=${Date.now()}`);
      void ready.then((ok) => {
        if (!ok) { post({ type: 'error', message: 'no network sandbox here (the backdrop worker came without its CSP); a theme that is not built in does not run' }); return; }
        guard(() => {
          mod = loadBackdrop(m.source);
          mod.init?.({ canvas: m.canvas, width: m.width, height: m.height, dpr: m.dpr, colors: m.colors, scene: m.scene, reduce: m.reduce });
          // motion reduced: one still frame, then the host stops expecting word from us
          if (reduce) { mod.frame({ t: 0, dt: 0, mouse: null, process, scene, speed, quiet }); post({ type: 'still' }); }
        });
        if (!mod) return;
        post({ type: 'stats', avgMs: 0 });
        start();
      });
      break;
    }
    case 'resize':
      guard(() => mod?.resize?.({ width: m.width, height: m.height, dpr: m.dpr }));
      if (reduce && mod) { guard(() => mod?.frame({ t, dt: 0, mouse: null, process, scene, speed, quiet })); post({ type: 'still' }); }
      break;
    case 'pointer': mouse = m.x === null ? null : { x: m.x, y: m.y!, down: !!m.down }; if (m.click) guard(() => mod?.event?.({ type: 'click', x: m.x!, y: m.y! })); break;
    case 'type': guard(() => mod?.event?.({ type: 'type', text: m.text })); break;
    case 'process': process = m.process; break;
    case 'colors': guard(() => mod?.theme?.({ colors: m.colors })); break;
    case 'data': guard(() => mod?.data?.(m.data)); break;
    case 'quiet': quiet = m.rects; break;
    case 'pause': running = false; break;
    case 'resume': start(); break;
  }
};
