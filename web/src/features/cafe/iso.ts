// 网吧's isometric projection (spec docs/superpowers/specs/2026-10-13-cafe-design.md §1). Floor tiles (u, v): u runs
// towards the bottom right of the screen, v towards the bottom left; the back corner of the room is (0, 0). A tile is
// 16 × 8 px; `h` lifts a point (px) off the floor.

export const TW = 16, TH = 8;

export interface Pt { x: number; y: number }

/** The screen position of floor point (u, v) at height h, relative to the back corner. */
export function toScreen(u: number, v: number, h = 0): Pt {
  return { x: (u - v) * (TW / 2), y: (u + v) * (TH / 2) - h };
}

/** Back to the floor (at height 0): the tile under a screen point is (floor(u), floor(v)). */
export function toFloor(x: number, y: number): { u: number; v: number } {
  return { u: x / TW + y / TH, v: y / TH - x / TW };
}

/** Drawing order: what is further from the viewer (smaller u + v) first. */
export const depth = (u: number, v: number) => u + v;
