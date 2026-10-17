// ← → history (nav-history.ts), pure so node tests can import it.

const MAX = 50;

export interface NavState { back: string[]; forward: string[]; cur: string | null }

/** Pure: the history after `next` came to the front (`moving` = it is the one back / forward is opening). */
export function navVisit(n: NavState, next: string | null, moving: boolean): NavState {
  if (!next || next === n.cur) return n;
  if (moving) return { ...n, cur: next };
  return { back: n.cur ? [...n.back.filter((x) => x !== n.cur), n.cur].slice(-MAX) : n.back, forward: [], cur: next };
}

/** Pure: one step back (dir -1) or forward (+1) — skipping conversations that are gone; null when there is none. */
export function navStep(n: NavState, dir: -1 | 1, exists: (id: string) => boolean): { state: NavState; to: string } | null {
  const from = dir < 0 ? [...n.back] : [...n.forward];
  const other = dir < 0 ? [...n.forward] : [...n.back];
  while (from.length) {
    const to = dir < 0 ? from.pop()! : from.shift()!;
    if (!exists(to)) continue;
    if (n.cur) { if (dir < 0) other.unshift(n.cur); else other.push(n.cur); }
    return { state: dir < 0 ? { back: from, forward: other, cur: to } : { back: other, forward: from, cur: to }, to };
  }
  return null;
}
