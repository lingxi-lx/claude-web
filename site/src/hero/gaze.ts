// Guests near the pointer look at it (spec §5): only the drawn facing changes, the sim never sees it.
import type { Facing } from './engine';

/** The same four directions walking uses (sim.ts facingOf): the bigger of du / dv wins. */
export function faceToward(from: { u: number; v: number }, to: { u: number; v: number }): Facing {
  const du = to.u - (from.u + 0.5), dv = to.v - (from.v + 0.5);
  return Math.abs(du) >= Math.abs(dv) ? (du >= 0 ? 'se' : 'nw') : (dv >= 0 ? 'sw' : 'ne');
}

export function nearest<T extends { u: number; v: number }>(list: T[], p: { u: number; v: number }, n: number, maxDist = 8): T[] {
  return list
    .map((x) => ({ x, d: Math.hypot(x.u + 0.5 - p.u, x.v + 0.5 - p.v) }))
    .filter((e) => e.d <= maxDist)
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((e) => e.x);
}
