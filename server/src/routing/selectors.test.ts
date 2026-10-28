// 智能路由: the six pure selectors (order/rotate/usage/pace/weight/fast) — ordering, carried state and deterministic
// tie-breaks. No gateway, no clock, no network.
import { describe, expect, it } from 'vitest';
import {
  fastCandidates,
  leastUsedCandidates,
  orderCandidates,
  paceCandidates,
  paceScore,
  rotateCandidates,
  seededRandom,
  selectCandidates,
  weightCandidates,
  type PaceWindow,
  type Selectable,
} from './selectors.js';

interface Row extends Selectable {
  name: string;
}
const row = (key: string, index: number): Row => ({ key, index, name: key.toUpperCase() });
const keys = (list: readonly Selectable[]): string[] => list.map((x) => x.key);

describe('order (顺序)', () => {
  it('sorts by the configured index, then by key, without mutating the input', () => {
    const input = [row('b', 1), row('z', 0), row('a', 0)];
    expect(keys(orderCandidates(input))).toEqual(['a', 'z', 'b']);
    expect(keys(input)).toEqual(['b', 'z', 'a']);
  });

  it('is stable for equal indexes and repeated calls', () => {
    const input = [row('c', 0), row('a', 0), row('b', 0)];
    expect(keys(orderCandidates(input))).toEqual(['a', 'b', 'c']);
    expect(keys(orderCandidates(input))).toEqual(keys(orderCandidates(input)));
  });
});

describe('rotate (轮流)', () => {
  const input = [row('c', 2), row('a', 0), row('b', 1)];

  it('starts at the cursor and returns the next cursor', () => {
    expect(rotateCandidates(input, 0)).toEqual({ list: [input[1], input[2], input[0]], cursor: 1 });
    expect(rotateCandidates(input, 1)).toEqual({ list: [input[2], input[0], input[1]], cursor: 2 });
    expect(rotateCandidates(input, 2)).toEqual({ list: [input[0], input[1], input[2]], cursor: 0 });
  });

  it('wraps large / negative cursors and treats a broken cursor as 0', () => {
    expect(rotateCandidates(input, 4).list.map((x) => x.key)).toEqual(['b', 'c', 'a']);
    expect(rotateCandidates(input, -1).list.map((x) => x.key)).toEqual(['c', 'a', 'b']);
    expect(rotateCandidates(input, Number.NaN).list.map((x) => x.key)).toEqual(['a', 'b', 'c']);
  });

  it('an empty list has no cursor', () => {
    expect(rotateCandidates([], 7)).toEqual({ list: [], cursor: 0 });
  });
});

describe('usage (最少使用)', () => {
  const input = [row('a', 0), row('b', 1), row('c', 2)];

  it('fewest requests first, configured order on a tie', () => {
    const counts: Record<string, number> = { a: 2, b: 0, c: 2 };
    expect(keys(leastUsedCandidates(input, (k) => counts[k]))).toEqual(['b', 'a', 'c']);
  });

  it('unknown / negative / non-finite counts count as 0', () => {
    const counts: Record<string, number> = { a: -5, b: Number.NaN, c: 1 };
    expect(keys(leastUsedCandidates(input, (k) => counts[k]))).toEqual(['a', 'b', 'c']);
  });
});

describe('pace (重置前用完)', () => {
  const window = (w?: PaceWindow) => () => w;

  it('scores by quota left minus time left in the window', () => {
    expect(paceScore(undefined, 0)).toBe(0);
    expect(paceScore({ remaining: 0.8 }, 0)).toBe(0.8);
    expect(paceScore({ remaining: 0.5, resetAt: 20, windowMs: 100 }, 0)).toBeCloseTo(0.3);
    expect(paceScore({ remaining: 0.5, resetAt: -10, windowMs: 100 }, 0)).toBeCloseTo(0.5);
    expect(paceScore({ remaining: 2, resetAt: 0, windowMs: 100 }, 0)).toBe(1);
  });

  it('the window most likely to waste quota goes first, tie by configured order', () => {
    const input = [row('a', 0), row('b', 1), row('c', 2)];
    const windows: Record<string, PaceWindow | undefined> = {
      a: { remaining: 0.9, resetAt: 90, windowMs: 100 }, // 0.9 - 0.9 = 0
      b: { remaining: 0.3, resetAt: 10, windowMs: 100 }, // 0.3 - 0.1 = 0.2
      c: { remaining: 0.5, resetAt: 50, windowMs: 100 }, // 0.5 - 0.5 = 0
    };
    expect(keys(paceCandidates(input, (k) => windows[k], 0))).toEqual(['b', 'a', 'c']);
  });

  it('an unknown window is neutral and keeps the configured order', () => {
    const input = [row('b', 1), row('a', 0)];
    expect(keys(paceCandidates(input, () => undefined, 0))).toEqual(['a', 'b']);
  });
});

describe('weight (权重)', () => {
  const input = [row('a', 0), row('b', 1), row('c', 2)];

  it('a higher weight is more likely to lead; zero weights go last in configured order', () => {
    const weights: Record<string, number> = { a: 1, b: 3, c: 0 };
    expect(keys(weightCandidates(input, (k) => weights[k], () => 0.5))).toEqual(['b', 'a', 'c']);
  });

  it('follows the injected random source deterministically', () => {
    const seq = [0.9, 0.1, 0.5];
    let i = 0;
    expect(keys(weightCandidates(input, () => 1, () => seq[i++]))).toEqual(['a', 'c', 'b']);
    i = 0;
    expect(keys(weightCandidates(input, () => 1, () => seq[i++]))).toEqual(['a', 'c', 'b']);
  });

  it('the default random source is seeded: repeated calls give the same order', () => {
    const run = () => keys(weightCandidates(input, (k) => (k === 'a' ? 2 : 1)));
    expect(run()).toEqual(run());
  });

  it('seededRandom is reproducible and seed-dependent', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const c = seededRandom(8);
    const seq7 = [a(), a(), a()];
    expect(seq7).toEqual([b(), b(), b()]);
    expect([c(), c(), c()]).not.toEqual(seq7);
  });
});

describe('fast (速度优先)', () => {
  it('lowest recent first-byte first; unknown latencies last; tie by configured order', () => {
    const input = [row('a', 0), row('b', 1), row('c', 2), row('d', 3)];
    const ms: Record<string, number | undefined> = { a: 500, b: 100, c: undefined, d: 100 };
    expect(keys(fastCandidates(input, (k) => ms[k]))).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('selectCandidates', () => {
  const input = [row('b', 1), row('a', 0)];

  it('dispatches every mode and carries the rotate cursor', () => {
    expect(keys(selectCandidates('order', input).list)).toEqual(['a', 'b']);
    expect(selectCandidates('rotate', input).cursor).toBe(1);
    expect(keys(selectCandidates('usage', input, { used: (k) => (k === 'b' ? 0 : 3) }).list)).toEqual(['b', 'a']);
    expect(keys(selectCandidates('pace', input, { now: 0, window: () => ({ remaining: 1 }) }).list)).toEqual(['a', 'b']);
    expect(keys(selectCandidates('weight', input, { weight: () => 1, random: () => 0.5 }).list)).toEqual(['a', 'b']);
    expect(keys(selectCandidates('fast', input, { latencyMs: (k) => (k === 'a' ? 9 : 1) }).list)).toEqual(['b', 'a']);
  });
});
