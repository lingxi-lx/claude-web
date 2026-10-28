// 智能路由: the pure selectors behind the routing modes (spec 2026-10-27 §3.2 #14: smart/order/rotate/usage/pace/
// weight/fast). `smart` is the scored ranking in policies.ts; the other six live here. Every selector returns a new
// array, never mutates the input, and breaks ties deterministically by the user's configured order (`index`) and then
// by key — the same group and numbers always produce the same order.
import type { Eligible } from './candidates.js';

/** The six selectors; `smart` stays in policies.ts (it needs scores, rules and the classifier). */
export type SelectorMode = 'order' | 'rotate' | 'usage' | 'pace' | 'weight' | 'fast';
export const SELECTOR_MODES: readonly SelectorMode[] = ['order', 'rotate', 'usage', 'pace', 'weight', 'fast'];

/** The only fields a selector needs, so tests and other callers can use any candidate-like row. */
export interface Selectable {
  key: string;
  /** position in the user's configured list (the last tie-break) */
  index: number;
}

/** A quota window for 重置前用完: how much is left and when it resets. */
export interface PaceWindow {
  /** fraction of the quota still unused, 0–1 */
  remaining: number;
  /** epoch ms when the window resets */
  resetAt?: number;
  /** the window's full length in ms (with `resetAt`, how far through the window we are) */
  windowMs?: number;
}

export interface SelectorInput {
  /** rotate: the cursor the previous request returned (default 0) */
  cursor?: number;
  /** usage (least used): how many requests each candidate has served */
  used?: (key: string) => number;
  /** pace: the quota window of each candidate */
  window?: (key: string) => PaceWindow | undefined;
  /** weight: the relative weight of each candidate */
  weight?: (key: string) => number;
  /** fast: recent time to first byte, ms */
  latencyMs?: (key: string) => number | undefined;
  /** pace: the clock (epoch ms) */
  now?: number;
  /** weight: a deterministic random source; defaults to seededRandom(seed) */
  random?: () => number;
  /** weight: change this per request to vary the weighted order (default 1) */
  seed?: number;
}

const finite = (n: number | undefined, fallback: number): number => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);
const clamp01 = (n: number): number => Math.min(1, Math.max(0, finite(n, 0)));

const keyCmp = (a: Selectable, b: Selectable): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
/** Deterministic tie-break: configured position, then key (keys are unique in a group). */
const tie = (a: Selectable, b: Selectable): number => finite(a.index, Number.MAX_SAFE_INTEGER) - finite(b.index, Number.MAX_SAFE_INTEGER) || keyCmp(a, b);

/** 顺序: the user's configured order (a copy, sorted defensively). */
export function orderCandidates<T extends Selectable>(list: readonly T[]): T[] {
  return [...list].sort(tie);
}

/**
 * 轮流: round-robin from `cursor`. Returns the next cursor so the caller can carry it to the next request; the tie-break
 * inside the list is the configured order, so an empty or malformed cursor cannot make the order random.
 */
export function rotateCandidates<T extends Selectable>(list: readonly T[], cursor = 0): { list: T[]; cursor: number } {
  const sorted = orderCandidates(list);
  if (!sorted.length) return { list: sorted, cursor: 0 };
  const c = Number.isFinite(cursor) ? Math.trunc(cursor) : 0;
  const start = ((c % sorted.length) + sorted.length) % sorted.length;
  return { list: [...sorted.slice(start), ...sorted.slice(0, start)], cursor: (start + 1) % sorted.length };
}

/** 最少使用: the candidate that served the fewest requests goes first; unknown / negative counts count as 0. */
export function leastUsedCandidates<T extends Selectable>(list: readonly T[], used: (key: string) => number): T[] {
  const count = (k: string): number => {
    const n = finite(used(k), 0);
    return n > 0 ? n : 0;
  };
  return [...list].sort((a, b) => count(a.key) - count(b.key) || tie(a, b));
}

/**
 * 重置前用完: how much of a quota would be wasted at the reset. Positive = the window has more quota left than time
 * left, so spending it now beats saving it; negative = it is already behind and can wait. Without reset data the raw
 * remaining share is used, and an unknown window is neutral (0).
 */
export function paceScore(w: PaceWindow | undefined, now: number): number {
  if (!w) return 0;
  const remaining = clamp01(w.remaining);
  if (w.resetAt === undefined || !w.windowMs || w.windowMs <= 0) return remaining;
  const left = clamp01((w.resetAt - finite(now, 0)) / w.windowMs);
  return remaining - left;
}

/** 重置前用完: highest pace score first (most likely to waste quota at reset), then configured order. */
export function paceCandidates<T extends Selectable>(list: readonly T[], window: (key: string) => PaceWindow | undefined, now = Date.now()): T[] {
  const score = (k: string): number => paceScore(window(k), now);
  return [...list].sort((a, b) => score(b.key) - score(a.key) || tie(a, b));
}

/** A small deterministic PRNG (LCG) for 权重 when the caller has no per-request seed. Same seed → same sequence. */
export function seededRandom(seed = 1): () => number {
  let s = (Number.isFinite(seed) ? Math.trunc(seed) : 1) >>> 0;
  if (!s) s = 1;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/**
 * 权重: weighted shuffle (Efraimidis–Spirakis: key = u^(1/w), highest first). Higher weight is more likely to lead but
 * every positive-weight candidate keeps a chance of being first. Non-positive / non-finite weights sort last; equal
 * keys (including the default deterministic source) fall back to configured order.
 */
export function weightCandidates<T extends Selectable>(list: readonly T[], weight: (key: string) => number, random: () => number = seededRandom(1)): T[] {
  const scored = list.map((item) => {
    const w = finite(weight(item.key), 0);
    const u = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, finite(random(), 0.5)));
    return { item, score: w > 0 ? Math.pow(u, 1 / w) : -1 };
  });
  scored.sort((a, b) => b.score - a.score || tie(a.item, b.item));
  return scored.map((x) => x.item);
}

/** 速度优先: lowest recent time to first byte first; candidates without a measurement sort last. */
export function fastCandidates<T extends Selectable>(list: readonly T[], latencyMs: (key: string) => number | undefined): T[] {
  const ms = (k: string): number => {
    const n = latencyMs(k);
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : Number.POSITIVE_INFINITY;
  };
  return [...list].sort((a, b) => ms(a.key) - ms(b.key) || tie(a, b));
}

export interface Selected<T> {
  list: T[];
  /** rotate: carry this to the group's next request */
  cursor?: number;
}

/** One entry point for the router: pick the mode's order and its carried state. */
export function selectCandidates<T extends Selectable>(mode: SelectorMode, list: readonly T[], o: SelectorInput = {}): Selected<T> {
  switch (mode) {
    case 'order':
      return { list: orderCandidates(list) };
    case 'rotate':
      return rotateCandidates(list, o.cursor ?? 0);
    case 'usage':
      return { list: leastUsedCandidates(list, o.used ?? (() => 0)) };
    case 'pace':
      return { list: paceCandidates(list, o.window ?? (() => undefined), o.now ?? Date.now()) };
    case 'weight':
      return { list: weightCandidates(list, o.weight ?? (() => 1), o.random ?? seededRandom(o.seed ?? 1)) };
    case 'fast':
      return { list: fastCandidates(list, o.latencyMs ?? (() => undefined)) };
    default:
      // an unknown mode (old config / a newer UI) falls back to the configured order, never to a random one
      return { list: orderCandidates(list) };
  }
}

/** Narrow a selector to a routed plan's eligible candidates (kept next to the selectors so router.ts stays thin). */
export const selectEligible = (mode: SelectorMode, list: readonly Eligible[], o: SelectorInput = {}): Selected<Eligible> => selectCandidates(mode, list, o);
