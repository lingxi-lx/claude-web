// What a theme's backdrop code runs inside (spec 2026-10-22 §6): the worker's own global, with every way out to the
// network taken away first. The code itself is `export default { … }`, no imports.

export interface BackdropModule {
  init?(a: { canvas: OffscreenCanvas; width: number; height: number; dpr: number; colors: Record<string, string>; scene: string; reduce: boolean }): void;
  /** `quiet`: rectangles (canvas px) where the page's words are — keep them calm there */
  frame(f: { t: number; dt: number; mouse: { x: number; y: number; down: boolean } | null; process: string; scene: string; speed: number; quiet: { x: number; y: number; w: number; h: number }[] }): void;
  event?(e: { type: 'pointer' | 'click' | 'type'; x?: number; y?: number; text?: string }): void;
  resize?(r: { width: number; height: number; dpr: number }): void;
  theme?(t: { colors: Record<string, string> }): void;
  data?(d: unknown): void;
}

export const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebTransport', 'navigator', 'FontFace', 'fonts', 'Request', 'Response'] as const;

/**
 * Takes the network names off the scope and off every prototype it inherits from (`WorkerGlobalScope.prototype.fetch`
 * was a way back, 2026-10-22 review). A second line only: the worker's own CSP (server/src/index.ts
 * BACKDROP_WORKER_CSP) is what really has no network, and `workerSandboxed` checks that it is there.
 */
export function lockdown(scope: object) {
  for (let o: any = scope; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const k of BLOCKED) {
      if (!Object.prototype.hasOwnProperty.call(o, k) && o !== scope) continue;
      try { delete o[k]; } catch { /* not deletable */ }
      try { Object.defineProperty(o, k, { value: undefined, configurable: false, writable: false }); } catch { /* frozen already */ }
    }
  }
}

/** The CSP a backdrop worker must come with (server/src/index.ts BACKDROP_WORKER_CSP, web/vite.config.ts in dev). */
export const WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'";

/**
 * Whether the backdrop worker script is served with its no-network CSP (a worker's permissions are its own
 * response's CSP). Asked once, by the page, before a theme that is not built in runs: a request from inside the
 * worker would tell too, but every blocked one is a console error (2026-10-22: ui-smoke counts those).
 */
let sandboxChecked: Promise<boolean> | null = null;
export function workerSandboxed(url: URL): Promise<boolean> {
  sandboxChecked ??= fetch(url, { method: 'GET', cache: 'no-store' })
    .then((r) => (r.headers.get('content-security-policy') ?? '').replace(/\s+/g, ' ').trim() === WORKER_CSP)
    .catch(() => false);
  return sandboxChecked;
}

/** Evaluate a backdrop's source: `export default` becomes `return`; it must give something with a `frame`. */
export function loadBackdrop(source: string): BackdropModule {
  const body = source.replace(/(^|[^\w$.])export\s+default\s+/, '$1return ');
  // eslint-disable-next-line no-new-func
  const mod = new Function(`"use strict";\n${body}`)();
  if (!mod || typeof mod.frame !== 'function') throw new Error('backdrop.js must `export default` an object with a frame() method');
  return mod as BackdropModule;
}
