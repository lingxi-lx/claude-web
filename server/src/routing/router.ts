// 智能路由: one request's plan (filter → order → intent → affinity → how many may be tried) and its bookkeeping
// afterwards. The gateway calls `planAsync` (or the synchronous `plan` for a preview) before trying anyone, `attempt`
// after each try and `finish` once the request is over. Every step is written to the decision's trace (trace.ts), so
// the detail page can replay why a candidate was left out, how the rest scored and which one answered.
import crypto from 'node:crypto';
import { claudePrice, isClaudeModel } from '../usage/pricing.js';
import { tr } from '../i18n/index.js';
import type { IrRequest } from '../gateway/ir.js';
import { filterCandidates, needsOf, type CandidateLookup, type Eligible, type RouteAccess } from './candidates.js';
import { rank, ruleMatches } from './policies.js';
import { Affinity } from './affinity.js';
import { DecisionLog, type SpendStore } from './decisions.js';
import { selectEligible, type PaceWindow, type SelectorMode } from './selectors.js';
import { createIntentClassifier, type IntentClassifier } from './intent.js';
import { DecisionTrace } from './trace.js';
import { quotaTracker, sourceKeyOfCandidate, type QuotaTracker } from './quota.js';
import { judgeAsk, type JudgeAsk } from './intent-ask.js';
import type { RoutedInfo, RoutingAttempt, RoutingConfig, RoutingDecision, RoutingMode, RoutingPolicy, RoutingQuotaView } from './types.js';
import { DEFAULT_ROUTING, ROUTING_MODES, policyOfModel } from './types.js';

export interface RoutePlan {
  decision: RoutingDecision;
  /** who to try, in order (already cut to how many may be tried) */
  order: Eligible[];
  sessionKey?: string;
  /** the running trace; written onto the decision at `finish` */
  trace?: DecisionTrace;
  /** 轮流: the cursor to keep once this request really went out */
  cursor?: number;
  /** USD this request spent on a paid candidate (the gateway charges it to the calling key) */
  spentUsd?: number;
}

/** What the judge model said for this request (planAsync → plan). */
export interface IntentOutcome { n: number; ms: number }

/** 重置前用完: the window length assumed when a reset time is known (subscription windows are 5 h). */
const PACE_MS = 5 * 3600_000;

const lastUserText = (ir: IrRequest | null): string => {
  if (!ir) return '';
  for (let i = ir.messages.length - 1; i >= 0; i--) {
    const m = ir.messages[i];
    if (m.role !== 'user') continue;
    const t = m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
    if (t.trim()) return t.slice(0, 20_000);
  }
  return '';
};

export const modeOf = (m: unknown): RoutingMode => (ROUTING_MODES.includes(m as RoutingMode) ? (m as RoutingMode) : 'smart');

const modeLabel = (m: RoutingMode): string => ({
  smart: tr('智能打分'), order: tr('按顺序'), rotate: tr('轮流'), usage: tr('最少使用'), pace: tr('重置前用完'), weight: tr('按权重'), fast: tr('速度优先'),
}[m]);

/** Put `prefer` (candidate keys) first, in its order; the rest keep theirs. */
const preferFirst = <T extends { key: string }>(list: T[], prefer: string[]): T[] => {
  const pos = (k: string) => { const i = prefer.indexOf(k); return i < 0 ? Infinity : i; };
  return list.map((x, i) => ({ x, i })).sort((a, b) => pos(a.x.key) - pos(b.x.key) || a.i - b.i).map((y) => y.x);
};

const validIntents = (c: RoutingConfig) => (c.intents ?? []).filter((x) => x && typeof x.label === 'string' && x.label.trim() && Array.isArray(x.prefer));

export interface PlanInput {
  groupId: string;
  config: RoutingConfig | undefined;
  model: string;
  ir: IrRequest | null;
  json: any;
  sessionId?: string;
  sessionKey?: string;
  look: CandidateLookup;
  unusable: Parameters<typeof filterCandidates>[0]['unusable'];
  /** the judge model's answer (planAsync fills it) */
  intent?: IntentOutcome;
  /** the calling key's limits (§7.4): its model lists, subscription / paid / source permissions */
  access?: RouteAccess;
}

export class Router {
  readonly affinity = new Affinity();
  readonly log: DecisionLog;
  readonly quota: QuotaTracker;
  private cursors = new Map<string, number>();
  private used = new Map<string, number>();
  private seq = 0;
  private classifiers = new Map<string, IntentClassifier>();
  private ask: JudgeAsk;
  private clock: () => number;

  constructor(spend?: SpendStore, o: { quota?: QuotaTracker; ask?: JudgeAsk; clock?: () => number } = {}) {
    this.log = new DecisionLog(spend);
    this.quota = o.quota ?? quotaTracker;
    this.ask = o.ask ?? judgeAsk;
    this.clock = o.clock ?? Date.now;
  }

  /** What the quota tracker knows about a candidate's source (for the views). */
  private quotaOf(c: { providerId?: string; accountId?: string; upstreamGroupId?: string }, now: number): RoutingQuotaView | undefined {
    const key = sourceKeyOfCandidate(c);
    const v = key ? this.quota.view(key, now) : undefined;
    if (!v) return undefined;
    const out: RoutingQuotaView = {
      ...(v.remaining !== undefined ? { remaining: v.remaining } : {}),
      ...(v.resetAt !== undefined ? { resetAt: v.resetAt } : {}),
      ...(v.cooldownUntil !== undefined ? { cooldownUntil: v.cooldownUntil } : {}),
      ...(v.last429At !== undefined ? { last429At: v.last429At } : {}),
    };
    return Object.keys(out).length ? out : undefined;
  }

  /**
   * The judge model's intent for this request, when the group has intents and a judge, the strategy is 自定义, it is
   * the first request of a turn (no tool result yet), and no structured rule already matches. Never throws.
   */
  async classify(o: PlanInput): Promise<IntentOutcome | undefined> {
    try {
      const config = { ...DEFAULT_ROUTING, ...(o.config ?? {}) };
      const intents = validIntents(config);
      if (!intents.length || !config.intentJudge) return undefined;
      const policy: RoutingPolicy = policyOfModel(o.model) ?? config.policy;
      if (policy !== 'custom') return undefined;
      const needs = needsOf(o.ir, o.json);
      if (needs.afterTool) return undefined;
      const text = lastUserText(o.ir);
      if (!text.trim()) return undefined;
      if ((config.rules ?? []).some((r) => ruleMatches(r, needs, text))) return undefined;
      const judge = config.intentJudge;
      let c = this.classifiers.get(judge);
      if (!c) {
        c = createIntentClassifier({ model: judge, ask: (prompt, x) => this.ask(judge, prompt, x.signal), now: this.clock });
        this.classifiers.set(judge, c);
        if (this.classifiers.size > 20) this.classifiers.delete(this.classifiers.keys().next().value!);
      }
      const t0 = this.clock();
      const n = await c.classify({ message: text, intents: intents.map((x) => x.label.trim()) });
      return { n, ms: Math.max(0, this.clock() - t0) };
    } catch {
      return undefined;
    }
  }

  /** `plan` after asking the judge model (only when the group has intents and a judge). */
  async planAsync(o: PlanInput): Promise<RoutePlan> {
    const intent = o.intent ?? (await this.classify(o));
    return this.plan({ ...o, ...(intent ? { intent } : {}) });
  }

  plan(o: PlanInput): RoutePlan {
    const now = this.clock();
    const trace = new DecisionTrace(this.clock);
    const config = { ...DEFAULT_ROUTING, ...(o.config ?? {}) };
    const policy: RoutingPolicy = policyOfModel(o.model) ?? config.policy;
    const mode = modeOf(config.mode);
    trace.add('group', tr('{n} 个候选 · 排序方式：{mode}', { n: config.candidates.length, mode: modeLabel(mode) }), { policy, mode, candidates: config.candidates.length });
    const needs = needsOf(o.ir, o.json);
    // a source the upstream rate-limited (429 / quota used up) waits out its cooldown
    const unusable = (c: Parameters<PlanInput['unusable']>[0], key: string): string | null => {
      const u = o.unusable(c, key);
      if (u) return u;
      const until = this.quota.cooling(sourceKeyOfCandidate(c), now);
      return until ? tr('限流冷却中（约 {s}s 后恢复）', { s: Math.max(1, Math.ceil((until - now) / 1000)) }) : null;
    };
    const f = filterCandidates({ config, policy, needs, look: o.look, unusable, spentTodayUsd: this.log.spentToday(), access: o.access });
    for (const x of f.out) trace.add('filter', `${x.label}：${x.why}`, { key: x.key, excluded: true });
    trace.add('filter', tr('{ok} 个可用，{out} 个排除', { ok: f.ok.length, out: f.out.length }), { ok: f.ok.length, out: f.out.length });
    const byKey = new Map(f.ok.map((e) => [e.key, e]));
    const remainingOf = (k: string): number | undefined => {
      const e = byKey.get(k);
      return e ? this.quota.remaining(sourceKeyOfCandidate(e.c), now) : undefined;
    };
    const text = lastUserText(o.ir);
    const ranked = rank({
      policy, eligible: f.ok, numbers: (k) => ({ ...this.log.numbers(k), remaining: remainingOf(k) }),
      total: config.candidates.length, needs, text, rules: config.rules, ruleText: config.ruleText,
    });
    const scores = new Map(ranked.list.map((x) => [x.key, x.score]));
    let list: Eligible[] = ranked.list;
    let cursor: number | undefined;
    if (mode === 'smart') {
      if (list.length) trace.add('rank', tr('按策略打分：{list}', { list: ranked.list.map((x) => `${x.label} ${x.score}`).join('、') }), Object.fromEntries(ranked.list.map((x) => [x.key, x.score])));
    } else {
      const sel = selectEligible(mode as SelectorMode, f.ok, {
        cursor: this.cursors.get(o.groupId) ?? 0,
        used: (k) => this.used.get(k) ?? 0,
        window: (k): PaceWindow | undefined => {
          const e = byKey.get(k);
          const t = e ? this.quota.tightest(sourceKeyOfCandidate(e.c), now) : undefined;
          return t ? { remaining: t.remaining, ...(t.resetAt !== undefined ? { resetAt: t.resetAt, windowMs: PACE_MS } : {}) } : undefined;
        },
        // 权重: the user's weight, else the quota it has left (CLIProxyAPI's credential weight, by remaining quota)
        weight: (k) => { const e = byKey.get(k); return e?.c.weight ?? remainingOf(k) ?? 1; },
        latencyMs: (k) => this.log.numbers(k).latencyMs,
        now,
        seed: (now ^ ++this.seq) >>> 0,
      });
      list = sel.list;
      cursor = sel.cursor;
      if (list.length) trace.add('rank', tr('按「{mode}」排序：{list}', { mode: modeLabel(mode), list: list.map((x) => x.label).join(' → ') }), { mode });
    }
    let reason: string | undefined;
    if (ranked.rule) {
      // rank() already put the rule's candidates first for the smart order; the selectors get it here
      const rule = config.rules?.find((r) => r.id === ranked.rule);
      if (rule && mode !== 'smart') list = preferFirst(list, rule.prefer);
      trace.add('rule', tr('自定义规则「{rule}」命中', { rule: ranked.rule }), { rule: ranked.rule });
    }
    // 意图判断: the judge's pick goes first, and it decides this turn even over the conversation's last model
    let intentPick = false;
    if (o.intent) {
      const intents = validIntents(config);
      const hit = o.intent.n > 0 ? intents[o.intent.n - 1] : undefined;
      trace.add('classifier', hit
        ? tr('意图判断：「{label}」（{ms}ms）', { label: hit.label, ms: o.intent.ms })
        : tr('意图判断：都不属于（{ms}ms）', { ms: o.intent.ms }), { n: o.intent.n, ms: o.intent.ms });
      if (hit?.prefer.length && !ranked.rule) {
        list = preferFirst(list, hit.prefer);
        intentPick = !!list[0] && hit.prefer.includes(list[0].key);
        if (intentPick) reason = tr('意图「{label}」优先用 {model}', { label: hit.label, model: list[0].label });
      }
    }
    // affinity: the model this conversation had stays first while it is still usable
    const had = intentPick ? undefined : this.affinity.get(o.groupId, o.sessionKey, now);
    const kept = had ? list.find((e) => e.key === had) : undefined;
    if (kept) {
      list = [kept, ...list.filter((e) => e !== kept)];
      reason = tr('保持这个对话上次用的模型');
      trace.add('affinity', reason, { key: kept.key });
    } else if (had) {
      const why = f.out.find((x) => x.key === had)?.why ?? tr('已不在候选里');
      reason = tr('上次的模型现在不能用（{why}），重新挑选', { why });
      trace.add('affinity', reason, { key: had });
    } else if (!reason) reason = ranked.rule ? tr('自定义规则「{rule}」命中', { rule: ranked.rule }) : mode === 'smart' ? tr('按策略排序的第一个') : tr('按「{mode}」排的第一个', { mode: modeLabel(mode) });
    // §7.3: a request that goes on after a tool already ran is never moved to another model; switching off = one try
    const max = !config.failover || needs.afterTool ? 1 : Math.max(1, Math.min(5, Math.floor(config.maxAttempts || 1)));
    if (needs.afterTool && list.length > 1) reason += tr('；工具已经执行过，这一轮失败也不换模型');
    const order = list.slice(0, max);
    if (!order.length) reason = f.out.length ? tr('没有满足要求的候选') : tr('还没有候选模型（网关 → 智能路由里添加）');
    trace.add('order', order.length ? tr('依次尝试：{list}', { list: order.map((e) => e.label).join(' → ') }) : reason, { tries: order.length, max });
    const decision: RoutingDecision = {
      id: crypto.randomBytes(6).toString('hex'),
      ts: now,
      groupId: o.groupId,
      ...(o.sessionId ? { sessionId: o.sessionId } : {}),
      policy,
      needs,
      candidates: [
        ...list.map((e) => { const q = this.quotaOf(e.c, now); return { key: e.key, label: e.label, cost: e.cost, caps: e.caps, score: scores.get(e.key), ...(q ? { quota: q } : {}) }; }),
        ...f.out.map((x) => { const q = this.quotaOf(x.c, now); return { key: x.key, label: x.label, cost: x.cost, caps: x.caps, excluded: x.why, ...(q ? { quota: q } : {}) }; }),
      ],
      reason,
      attempts: [],
      ok: false,
      switched: false,
    };
    return { decision, order, sessionKey: o.sessionKey, trace, ...(cursor !== undefined ? { cursor } : {}) };
  }

  attempt(plan: RoutePlan, e: Eligible, a: { status: number; kind: RoutingAttempt['outcome']; firstByteMs?: number; usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null }) {
    plan.decision.attempts.push({ key: e.key, label: e.label, status: a.status, outcome: a.kind });
    const outcome = { done: tr('成功'), final: tr('请求本身的错误'), switch: tr('失败，换下一个'), broken: tr('输出中断'), aborted: tr('客户端断开') }[a.kind];
    plan.trace?.add('attempt', `${e.label} · ${a.status || '—'} · ${outcome}${a.firstByteMs !== undefined ? ` · ${a.firstByteMs}ms` : ''}`, { key: e.key, status: a.status, outcome: a.kind });
    if (a.kind === 'aborted') return;
    // a 4xx that is the request's own fault says nothing about the candidate
    if (a.kind !== 'final') this.log.outcome(e.key, a.kind === 'done', a.firstByteMs);
    if (a.kind === 'done') {
      plan.decision.ok = true;
      plan.decision.chosen = { key: e.key, label: e.label, model: e.c.model };
      plan.decision.switched = plan.decision.attempts.length > 1;
      this.affinity.set(plan.decision.groupId, plan.sessionKey, e.key);
      this.used.set(e.key, (this.used.get(e.key) ?? 0) + 1);
      if (this.used.size > 1000) this.used.delete(this.used.keys().next().value!);
      if (e.cost === 'paid' && a.usage) {
        const u = { input: a.usage.input, output: a.usage.output, cacheRead: a.usage.cacheRead ?? 0, cacheWrite: a.usage.cacheWrite ?? 0 };
        const usd = e.c.price ? (u.input * e.c.price.input + u.output * e.c.price.output) / 1e6 : isClaudeModel(e.c.model) ? claudePrice(e.c.model, u) : 0;
        this.log.addSpend(usd);
        plan.spentUsd = usd;
      }
    }
  }

  /** The request is over: the decision goes into the log; what the conversation really got, when it got an answer. */
  finish(plan: RoutePlan): RoutedInfo | null {
    const d = plan.decision;
    if (!d.ok && !d.chosen && d.attempts.length) d.chosen = undefined;
    // 轮流 moves on only once a request really went out (a preview / a refused request keeps the cursor)
    if (plan.cursor !== undefined && d.attempts.length) {
      this.cursors.set(d.groupId, plan.cursor);
      if (this.cursors.size > 100) this.cursors.delete(this.cursors.keys().next().value!);
    }
    if (plan.trace) {
      plan.trace.add('finish', d.ok && d.chosen ? tr('由 {label} 回答{s}', { label: d.chosen.label, s: d.switched ? tr('（换过候选）') : '' }) : tr('没有候选回答'), { ok: d.ok, switched: d.switched });
      d.trace = plan.trace.steps();
    }
    this.log.add(d);
    if (!d.ok || !d.chosen || !d.sessionId) return null;
    return { sessionId: d.sessionId, groupId: d.groupId, policy: d.policy, model: d.chosen.model, label: d.chosen.label, reason: d.reason, switched: d.switched, at: d.ts };
  }
}
