// What a theme's backdrop code runs inside (spec 2026-10-22 §6): the worker's own global, with every way out to the
// network taken away first. The code itself is `export default { … }`, no imports.

export interface BackdropModule {
  init?(a: { canvas: OffscreenCanvas; width: number; height: number; dpr: number; colors: Record<string, string>; scene: string; reduce: boolean }): void;
  frame(f: { t: number; dt: number; mouse: { x: number; y: number; down: boolean } | null; process: string; scene: string; speed: number }): void;
  event?(e: { type: 'pointer' | 'click' | 'type'; x?: number; y?: number; text?: string }): void;
  resize?(r: { width: number; height: number; dpr: number }): void;
  theme?(t: { colors: Record<string, string> }): void;
  data?(d: unknown): void;
}

export const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebTransport', 'navigator'] as const;

export function lockdown(scope: Record<string, unknown>) {
  for (const k of BLOCKED) {
    try { delete scope[k]; } catch { /* not deletable */ }
    try { Object.defineProperty(scope, k, { value: undefined, configurable: false, writable: false }); } catch { /* frozen already */ }
  }
}

/** Evaluate a backdrop's source: `export default` becomes `return`; it must give something with a `frame`. */
export function loadBackdrop(source: string): BackdropModule {
  const body = source.replace(/^\s*export\s+default\s+/m, 'return ');
  // eslint-disable-next-line no-new-func
  const mod = new Function(`"use strict";\n${body}`)();
  if (!mod || typeof mod.frame !== 'function') throw new Error('backdrop.js must `export default` an object with a frame() method');
  return mod as BackdropModule;
}
