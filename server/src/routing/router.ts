// 智能路由: one request's plan (filter → rank → affinity → how many may be tried) and its bookkeeping afterwards.
// The gateway calls `plan` before trying anyone, `attempt` after each try and `finish` once the request is over.
import crypto from 'node:crypto';
import { claudePrice, isClaudeModel } from '../usage/pricing.js';
import { tr } from '../i18n/index.js';
import type { IrRequest } from '../gateway/ir.js';
import { filterCandidates, needsOf, type CandidateLookup, type Eligible } from './candidates.js';
import { rank } from './policies.js';
import { Affinity } from './affinity.js';
import { DecisionLog, type SpendStore } from './decisions.js';
import type { RoutedInfo, RoutingAttempt, RoutingConfig, RoutingDecision, RoutingPolicy } from './types.js';
import { DEFAULT_ROUTING, policyOfModel } from './types.js';

export interface RoutePlan {
  decision: RoutingDecision;
  /** who to try, in order (already cut to how many may be tried) */
  order: Eligible[];
  sessionKey?: string;
}

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

export class Router {
  readonly affinity = new Affinity();
  readonly log: DecisionLog;
  constructor(spend?: SpendStore) { this.log = new DecisionLog(spend); }

  plan(o: {
    groupId: string;
    config: RoutingConfig | undefined;
    model: string;
    ir: IrRequest | null;
    json: any;
    sessionId?: string;
    sessionKey?: string;
    look: CandidateLookup;
    unusable: Parameters<typeof filterCandidates>[0]['unusable'];
  }): RoutePlan {
    const config = { ...DEFAULT_ROUTING, ...(o.config ?? {}) };
    const policy: RoutingPolicy = policyOfModel(o.model) ?? config.policy;
    const needs = needsOf(o.ir, o.json);
    const f = filterCandidates({ config, policy, needs, look: o.look, unusable: o.unusable, spentTodayUsd: this.log.spentToday() });
    const ranked = rank({ policy, eligible: f.ok, numbers: (k) => this.log.numbers(k), total: config.candidates.length, needs, text: lastUserText(o.ir), rules: config.rules, ruleText: config.ruleText });
    let list: Eligible[] = ranked.list;
    let reason: string;
    // affinity: the model this conversation had stays first while it is still usable
    const had = this.affinity.get(o.groupId, o.sessionKey);
    const kept = had ? list.find((e) => e.key === had) : undefined;
    if (kept) {
      list = [kept, ...list.filter((e) => e !== kept)];
      reason = tr('保持这个对话上次用的模型');
    } else if (had) {
      const why = f.out.find((x) => x.key === had)?.why ?? tr('已不在候选里');
      reason = tr('上次的模型现在不能用（{why}），重新挑选', { why });
    } else reason = ranked.rule ? tr('自定义规则「{rule}」命中', { rule: ranked.rule }) : tr('按策略排序的第一个');
    // §7.3: a request that goes on after a tool already ran is never moved to another model; switching off = one try
    const max = !config.failover || needs.afterTool ? 1 : Math.max(1, Math.min(5, Math.floor(config.maxAttempts || 1)));
    if (needs.afterTool && list.length > 1) reason += tr('；工具已经执行过，这一轮失败也不换模型');
    const order = list.slice(0, max);
    if (!order.length) reason = f.out.length ? tr('没有满足要求的候选') : tr('还没有候选模型（网关 → 智能路由里添加）');
    const scores = new Map(ranked.list.map((x) => [x.key, x.score]));
    const decision: RoutingDecision = {
      id: crypto.randomBytes(6).toString('hex'),
      ts: Date.now(),
      groupId: o.groupId,
      ...(o.sessionId ? { sessionId: o.sessionId } : {}),
      policy,
      needs,
      candidates: [
        ...list.map((e) => ({ key: e.key, label: e.label, cost: e.cost, caps: e.caps, score: scores.get(e.key) })),
        ...f.out.map((x) => ({ key: x.key, label: x.label, cost: x.cost, caps: x.caps, excluded: x.why })),
      ],
      reason,
      attempts: [],
      ok: false,
      switched: false,
    };
    return { decision, order, sessionKey: o.sessionKey };
  }

  attempt(plan: RoutePlan, e: Eligible, a: { status: number; kind: RoutingAttempt['outcome']; firstByteMs?: number; usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null }) {
    plan.decision.attempts.push({ key: e.key, label: e.label, status: a.status, outcome: a.kind });
    if (a.kind === 'aborted') return;
    // a 4xx that is the request's own fault says nothing about the candidate
    if (a.kind !== 'final') this.log.outcome(e.key, a.kind === 'done', a.firstByteMs);
    if (a.kind === 'done') {
      plan.decision.ok = true;
      plan.decision.chosen = { key: e.key, label: e.label, model: e.c.model };
      plan.decision.switched = plan.decision.attempts.length > 1;
      this.affinity.set(plan.decision.groupId, plan.sessionKey, e.key);
      if (e.cost === 'paid' && a.usage) {
        const u = { input: a.usage.input, output: a.usage.output, cacheRead: a.usage.cacheRead ?? 0, cacheWrite: a.usage.cacheWrite ?? 0 };
        const usd = e.c.price ? (u.input * e.c.price.input + u.output * e.c.price.output) / 1e6 : isClaudeModel(e.c.model) ? claudePrice(e.c.model, u) : 0;
        this.log.addSpend(usd);
      }
    }
  }

  /** The request is over: the decision goes into the log; what the conversation really got, when it got an answer. */
  finish(plan: RoutePlan): RoutedInfo | null {
    const d = plan.decision;
    if (!d.ok && !d.chosen && d.attempts.length) d.chosen = undefined;
    this.log.add(d);
    if (!d.ok || !d.chosen || !d.sessionId) return null;
    return { sessionId: d.sessionId, groupId: d.groupId, policy: d.policy, model: d.chosen.model, label: d.chosen.label, reason: d.reason, switched: d.switched, at: d.ts };
  }
}
