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
 * BACKDROP_WORKER_CSP) is what really has no network, and `cspHolds` checks that it is there.
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

/** Whether the worker's CSP stops a request (run before lockdown, with the real fetch): true = no network here. */
export async function cspHolds(fetchFn: typeof fetch, url: string): Promise<boolean> {
  try { await fetchFn(url, { cache: 'no-store' }); return false; } catch { return true; }
}

/** Evaluate a backdrop's source: `export default` becomes `return`; it must give something with a `frame`. */
export function loadBackdrop(source: string): BackdropModule {
  const body = source.replace(/(^|[^\w$.])export\s+default\s+/, '$1return ');
  // eslint-disable-next-line no-new-func
  const mod = new Function(`"use strict";\n${body}`)();
  if (!mod || typeof mod.frame !== 'function') throw new Error('backdrop.js must `export default` an object with a frame() method');
  return mod as BackdropModule;
}
