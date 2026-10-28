// 智能路由: ranking the candidates that passed the hard filter (§7.2 step 3), per strategy.
import type { Eligible } from './candidates.js';
import type { RoutingNeeds, RoutingPolicy, RoutingRule } from './types.js';

export interface CandidateNumbers {
  /** recent success rate 0–1, undefined = no data */
  success?: number;
  /** typical time to first byte, ms */
  latencyMs?: number;
  /** share of the source's quota still left, 0–1 (from its rate-limit headers; undefined = it never said) */
  remaining?: number;
}

type Weights = { free: number; success: number; speed: number; cap: number; prio: number; quota: number };
// `quota`: the share of quota a source still has — free sources run out first, so it weighs most under 免费优先
const WEIGHTS: Record<Exclude<RoutingPolicy, 'custom'>, Weights> = {
  auto: { free: 0.2, success: 0.25, speed: 0.15, cap: 0.2, prio: 0.2, quota: 0.15 },
  free: { free: 0, success: 0.3, speed: 0.2, cap: 0.2, prio: 0.3, quota: 0.25 },
  performance: { free: 0, success: 0.35, speed: 0.4, cap: 0.15, prio: 0.1, quota: 0.1 },
  capability: { free: 0.1, success: 0.2, speed: 0, cap: 0.55, prio: 0.15, quota: 0.05 },
};
/** an unknown quota scores like a source with most of it left (not full: a known-full one is a safer bet) */
const UNKNOWN_QUOTA = 0.7;

/** A rough 0–1 for what the model can do: window, thinking, pictures, and its tier by name. */
export function capabilityScore(e: Eligible): number {
  const id = e.c.model.toLowerCase();
  const ctx = e.caps.context ? Math.min(1, Math.log2(e.caps.context / 32_000 + 1) / Math.log2(32)) : 0.4;
  const tier = /opus|gpt-5(?!.*mini)|gemini-[\d.]+-pro|argon|o3\b|grok-4(?!.*fast)|k2-thinking|deepseek-(v4|r)/.test(id) ? 1
    : /sonnet|fable|gpt-4\.1|qwen3?-coder-plus|glm-[5-9]|kimi|deepseek|grok/.test(id) ? 0.75
      : /haiku|flash-lite|mini|nano|small|lite/.test(id) ? 0.35 : /flash/.test(id) ? 0.55 : 0.5;
  return 0.5 * tier + 0.25 * ctx + 0.15 * (e.caps.thinking ? 1 : 0.3) + 0.1 * (e.caps.images === false ? 0 : 1);
}

export function scoreOf(policy: RoutingPolicy, e: Eligible, n: CandidateNumbers, total: number): number {
  const w = WEIGHTS[policy === 'custom' ? 'auto' : policy];
  const free = e.cost === 'free' ? 1 : e.cost === 'subscription' ? 0.6 : 0;
  const success = n.success ?? 0.8;
  const speed = n.latencyMs === undefined ? 0.5 : 1 / (1 + n.latencyMs / 3000);
  const prio = total <= 1 ? 1 : 1 - e.index / total;
  const quota = n.remaining === undefined || !Number.isFinite(n.remaining) ? UNKNOWN_QUOTA : Math.min(1, Math.max(0, n.remaining));
  return w.free * free + w.success * success + w.speed * speed + w.cap * capabilityScore(e) + w.prio * prio + w.quota * quota;
}

/** Whether a custom rule applies to this request. `text` = the latest user words. */
export function ruleMatches(r: RoutingRule, needs: RoutingNeeds, text: string): boolean {
  const w = r.when;
  if (w.needsTools !== undefined && w.needsTools !== needs.tools) return false;
  if (w.needsImages !== undefined && w.needsImages !== needs.images) return false;
  if (w.longContext !== undefined && w.longContext !== needs.tokens > 100_000) return false;
  if (w.keywords?.length) {
    const t = text.toLowerCase();
    if (!w.keywords.some((k) => k.trim() && t.includes(k.trim().toLowerCase()))) return false;
  }
  return true;
}

/**
 * Hook for a classifier that reads the user's natural-language rule (`ruleText`) — none ships now: the structured
 * conditions decide. A future one returns candidate keys to put first, or null to leave the order alone.
 */
export type ClassifyHook = (o: { ruleText: string; text: string; needs: RoutingNeeds; candidates: string[] }) => string[] | null;
let classifyHook: ClassifyHook | null = null;
export function setClassifyHook(h: ClassifyHook | null) { classifyHook = h; }

export interface Ranked { list: (Eligible & { score: number })[]; rule?: string }

export function rank(o: { policy: RoutingPolicy; eligible: Eligible[]; numbers: (key: string) => CandidateNumbers; total: number; needs: RoutingNeeds; text: string; rules?: RoutingRule[]; ruleText?: string }): Ranked {
  const list = o.eligible.map((e) => ({ ...e, score: Math.round(scoreOf(o.policy, e, o.numbers(e.key), o.total) * 1000) / 1000 }));
  list.sort((a, b) => b.score - a.score || a.index - b.index);
  if (o.policy !== 'custom') return { list };
  let prefer: string[] | null = null;
  let rule: string | undefined;
  for (const r of o.rules ?? []) if (ruleMatches(r, o.needs, o.text)) { prefer = r.prefer; rule = r.id; break; }
  if (!prefer && o.ruleText?.trim() && classifyHook) prefer = classifyHook({ ruleText: o.ruleText, text: o.text, needs: o.needs, candidates: list.map((x) => x.key) });
  if (!prefer?.length) return { list };
  const pos = (k: string) => { const i = prefer!.indexOf(k); return i < 0 ? Infinity : i; };
  return { list: [...list].sort((a, b) => pos(a.key) - pos(b.key) || b.score - a.score), rule };
}
