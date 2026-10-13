// A* over the cafe floor, four directions (a guest walks along the tiles' edges, which reads right in isometric).
import { walkable, type CafeMap } from './map';

export type Tile = [number, number];

/**
 * The tiles from `from` to `to`, both included; null when `to` cannot be reached. The start may be a blocked tile
 * (someone standing on a desk after the plan changed): it walks off it. A blocked goal is unreachable.
 */
export function findPath(m: CafeMap, from: Tile, to: Tile): Tile[] | null {
  const [fu, fv] = [Math.round(from[0]), Math.round(from[1])];
  const [tu, tv] = to;
  if (!walkable(m, tu, tv)) return null;
  if (fu === tu && fv === tv) return [[tu, tv]];
  const W = m.cols, N = m.cols * m.rows;
  const idx = (u: number, v: number) => v * W + u;
  const g = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  // a small binary heap of [f, index]
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = (): number => {
    const top = heap[0][1];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let s = k;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === k) break;
        [heap[s], heap[k]] = [heap[k], heap[s]];
        k = s;
      }
    }
    return top;
  };
  const h = (u: number, v: number) => Math.abs(u - tu) + Math.abs(v - tv);
  const start = idx(Math.max(0, Math.min(W - 1, fu)), Math.max(0, Math.min(m.rows - 1, fv)));
  g[start] = 0;
  push(h(start % W, Math.floor(start / W)), start);
  const goal = idx(tu, tv);
  while (heap.length) {
    const cur = pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cu = cur % W, cv = Math.floor(cur / W);
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nu = cu + du, nv = cv + dv;
      if (!walkable(m, nu, nv)) continue;
      const n = idx(nu, nv);
      const ng = g[cur] + 1;
      if (ng < g[n]) { g[n] = ng; came[n] = cur; push(ng + h(nu, nv), n); }
    }
  }
  if (g[goal] === Infinity) return null;
  const out: Tile[] = [];
  for (let i = goal; i !== -1; i = came[i]) out.push([i % W, Math.floor(i / W)]);
  return out.reverse();
}
