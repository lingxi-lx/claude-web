// 智能路由 (spec 2026-10-26 unified model sources §7): wire types shared with the web client through protocol.ts.
// A routing group is a gateway group with `routing` set: it reuses the gateway's request path (keys, translation,
// failover bookkeeping, the privacy hook), only the order of who is tried — and how many — comes from here.

/** The built-in strategies; each is a virtual model in the conversation's model menu. */
export type RoutingPolicy = 'auto' | 'free' | 'performance' | 'capability' | 'custom';

/** Model id each strategy is picked under (the engine sends it as the model; the gateway reads the strategy off it). */
export const ROUTING_MODELS: Record<RoutingPolicy, string> = {
  auto: 'smart-auto',
  free: 'smart-free',
  performance: 'smart-performance',
  capability: 'smart-capability',
  custom: 'smart-custom',
};

export const ROUTING_POLICIES: RoutingPolicy[] = ['auto', 'free', 'performance', 'capability', 'custom'];

/** The strategy a requested model names, or undefined (another model: the group's default strategy). */
export function policyOfModel(model: string): RoutingPolicy | undefined {
  const m = model.trim().toLowerCase();
  return ROUTING_POLICIES.find((p) => ROUTING_MODELS[p] === m);
}

/** free = no charge at all; subscription = an account already paid for; paid = billed per call. */
export type CostClass = 'free' | 'subscription' | 'paid';

/** What a candidate model can take. Undefined = unknown (not filtered on, scored as average). */
export interface RoutingCaps {
  tools?: boolean;
  images?: boolean;
  thinking?: boolean;
  /** context window in tokens */
  context?: number;
}

/**
 * One model the router may use: a gateway member reference (provider profile / account / account pool) plus the
 * model on it. The list order is the user's priority.
 */
export interface RoutingCandidate {
  providerId?: string;
  accountId?: string;
  upstreamGroupId?: string;
  model: string;
  /** 允许自动路由使用 — only candidates the user allowed are ever picked */
  allowAuto: boolean;
  /** the user's override of what it costs (else inferred: `:free`, local, sidecar → free; accounts → subscription) */
  cost?: CostClass;
  /** the user's override of what it can do (else from the model lists / names) */
  caps?: RoutingCaps;
  /** USD per million tokens, for the paid budget (Claude models without it use the list price) */
  price?: { input: number; output: number };
  /**
   * A paid candidate with no known price (no `price`, not a Claude model) cannot be counted against the budget, so it
   * is never used under one — unless the user ticks this (its spend then counts as $0).
   */
  allowUnpriced?: boolean;
  /** 权重 mode: relative weight (unset = by the quota it has left; 0 = never picked by weight) */
  weight?: number;
}

/**
 * How the eligible candidates are ordered: `smart` = the strategy's scores (policies.ts); the rest are the plain
 * selectors in selectors.ts (configured order, round-robin, least used, use-before-reset, weighted, fastest).
 */
export type RoutingMode = 'smart' | 'order' | 'rotate' | 'usage' | 'pace' | 'weight' | 'fast';
export const ROUTING_MODES: RoutingMode[] = ['smart', 'order', 'rotate', 'usage', 'pace', 'weight', 'fast'];

/** 意图判断 (spec 2026-10-27 §7.5): one intent the judge model may answer, and the candidates it puts first. */
export interface RoutingIntent {
  /** the intent in the user's words (what the judge model reads) */
  label: string;
  /** candidate keys (`candidateKey`) */
  prefer: string[];
}

/** A structured custom rule: when every given condition holds, the preferred candidates go first (in that order). */
export interface RoutingRule {
  id: string;
  when: { keywords?: string[]; needsTools?: boolean; needsImages?: boolean; longContext?: boolean };
  /** candidate keys (`candidateKey`) */
  prefer: string[];
}

export interface RoutingConfig {
  /** the strategy for a request whose model names none (background / subagent aliases) */
  policy: RoutingPolicy;
  candidates: RoutingCandidate[];
  /** whether a failed request may try the next candidate at all (only before any output and any tool) */
  failover: boolean;
  /** most candidates tried for one request (1–5) */
  maxAttempts: number;
  /** paid candidates may be used (never by 免费优先) — needs a budget too */
  allowPaid: boolean;
  /** USD a day the router may spend on paid candidates; unset / 0 = paid never used */
  budgetUsd?: number;
  /** 自定义: the user's own words (kept; no model reads them yet — `classifyHook` is where one would) */
  ruleText?: string;
  rules?: RoutingRule[];
  /** how eligible candidates are ordered (unset = smart) */
  mode?: RoutingMode;
  /** 意图判断: intents for the judge model (自定义 only; a matching structured rule wins and skips the call) */
  intents?: RoutingIntent[];
  /** the candidate key of the judge model (a provider candidate); unset = no intent call */
  intentJudge?: string;
}

export const DEFAULT_ROUTING: RoutingConfig = { policy: 'auto', candidates: [], failover: true, maxAttempts: 3, allowPaid: false };

export const candidateKey = (c: Pick<RoutingCandidate, 'providerId' | 'accountId' | 'upstreamGroupId' | 'model'>): string =>
  `${c.accountId ? `a:${c.accountId}` : c.upstreamGroupId ? `u:${c.upstreamGroupId}` : `p:${c.providerId ?? ''}`}#${c.model}`;

/** What a request needs (its hard requirements, from the request body). */
export interface RoutingNeeds {
  tools: boolean;
  images: boolean;
  thinking: boolean;
  /** estimated prompt tokens */
  tokens: number;
  /** the request continues a turn whose tool already ran (last message carries a tool result): no switching */
  afterTool: boolean;
}

export interface RoutingCandidateView {
  key: string;
  label: string;
  cost: CostClass;
  caps: RoutingCaps;
  score?: number;
  /** why it was left out of this request */
  excluded?: string;
  /** paid with no known price: the budget cannot see what it spends (see RoutingCandidate.allowUnpriced) */
  unpriced?: boolean;
  /** what the upstream's headers / 429s said about its quota (absent = never said) */
  quota?: RoutingQuotaView;
}

/** A source's quota as seen in its answers: share left 0–1, when the tightest window refills, a 429 cooldown. */
export interface RoutingQuotaView { remaining?: number; resetAt?: number; cooldownUntil?: number; last429At?: number }

export interface RoutingAttempt { key: string; label: string; status: number; outcome: 'done' | 'final' | 'switch' | 'broken' | 'aborted' }

/** A decision's replay step (§8.10 "生成 Decision + Trace"; §6.5 回放: 第 N 轮 · 规则命中 · 判断模型 323ms). */
export type RoutingTraceStage =
  | 'group'
  | 'filter'
  | 'rank'
  | 'rule'
  | 'classifier'
  | 'order'
  | 'affinity'
  | 'attempt'
  | 'finish';

export type RoutingTraceData = Record<string, string | number | boolean>;

export interface RoutingTraceStep {
  /** ms since the decision started (never negative) */
  at: number;
  stage: RoutingTraceStage;
  /** what happened, in the interface language (the caller passes a tr() string) */
  text: string;
  /** small structured details (keys, counts, durations) for the replay UI */
  data?: RoutingTraceData;
}

/** One routing decision: what was considered, what was picked and why, and what happened. */
export interface RoutingDecision {
  id: string;
  ts: number;
  groupId: string;
  sessionId?: string;
  policy: RoutingPolicy;
  needs: RoutingNeeds;
  candidates: RoutingCandidateView[];
  reason: string;
  chosen?: { key: string; label: string; model: string };
  attempts: RoutingAttempt[];
  /** ordered replay steps (§8.10); optional so old logs / other callers stay valid */
  trace?: RoutingTraceStep[];
  ok: boolean;
  /** the answer came from another candidate than the one first chosen */
  switched: boolean;
}

/** Per-candidate runtime numbers shown in the detail page. */
export interface RoutingCandidateStats { key: string; ok: number; fail: number; latencyMs?: number; health: 'ok' | 'cooling' | 'disabled' | 'unknown'; cooldownUntil?: number }

export interface RoutingStatus {
  /** the routing group (null = none made yet) */
  groupId: string | null;
  config: RoutingConfig;
  candidates: (RoutingCandidateView & RoutingCandidateStats)[];
  spentTodayUsd: number;
  switchesToday: number;
  decisions: RoutingDecision[];
}

/** The model a conversation on a routing group really got (the composer shows 「自动 → 实际：…」). */
export interface RoutedInfo { sessionId: string; groupId: string; policy: RoutingPolicy; model: string; label: string; reason: string; switched: boolean; at: number }
