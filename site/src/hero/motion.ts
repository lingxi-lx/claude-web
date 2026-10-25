// Parallax (spec §4.2): each layer moves factor × 12 native px with the pointer, eased.
export const LAYER_FACTORS = [0.4, 0.7, 1.0, 0.55] as const;
export const MAX_SHIFT = 12;

const clamp1 = (n: number) => Math.max(-1, Math.min(1, n));

export function pointerNorm(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  return {
    x: clamp1(((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1),
    y: clamp1(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
  };
}

export function parallaxOffset(p: { x: number; y: number }, factor: number, max = MAX_SHIFT): { x: number; y: number } {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { x: r(clamp1(p.x) * factor * max), y: r(clamp1(p.y) * factor * max) };
}

/** Exponential smoothing: the same feel at any frame rate, never past the target. */
export function approach(cur: number, target: number, dtMs: number, tauMs = 140): number {
  if (cur === target) return cur;
  return cur + (target - cur) * (1 - Math.exp(-Math.max(0, dtMs) / tauMs));
}
