// The showcase's input, as pure functions (player.ts wires them to the DOM).

/** pixels a press may wander before it is a drag rather than a click (pause) */
export const DRAG_SLOP = 4;

export type KeyMove = { kind: 'go'; index: number } | { kind: 'toggle' } | null;

/** With the section focused: ← → step through the clips (wrapping), 1–9 and 0 pick the first ten, space pauses. */
export function showcaseKey(key: string, index: number, count: number): KeyMove {
  if (key === 'ArrowRight') return { kind: 'go', index: (index + 1) % count };
  if (key === 'ArrowLeft') return { kind: 'go', index: (index - 1 + count) % count };
  if (key === ' ') return { kind: 'toggle' };
  if (/^[0-9]$/.test(key)) {
    const i = key === '0' ? 9 : Number(key) - 1;
    return i < count ? { kind: 'go', index: i } : null;
  }
  return null;
}

/** never the very end: a looping video seeked to its duration jumps back to 0 */
const clamp = (t: number, d: number) => Math.min(Math.max(t, 0), Math.max(0, d - 0.04));

export function timeOnTimeline(x: number, left: number, width: number, duration: number): number {
  return width > 0 ? clamp(((x - left) / width) * duration, duration) : 0;
}

/** dragging across the whole picture moves through the whole clip */
export function timeAfterDrag(start: number, dx: number, width: number, duration: number): number {
  return width > 0 ? clamp(start + (dx / width) * duration, duration) : start;
}

/** the circle from (x, y) — inside the w × h picture or outside it (a theme button below) — that covers it all */
export function revealRadius(x: number, y: number, w: number, h: number): number {
  return Math.hypot(Math.max(Math.abs(x), Math.abs(w - x)), Math.max(Math.abs(y), Math.abs(h - y)));
}
