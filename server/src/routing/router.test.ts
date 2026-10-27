// 智能路由 (spec 2026-10-26 §7): the hard filter (free-first never paid, unknown price refused under a budget) and
// the §7.3 rule that a request continuing after a tool ran is never moved to another model.
import { describe, expect, it } from 'vitest';
import type { IrRequest } from '../gateway/ir.js';
import { filterCandidates, needsOf, type CandidateLookup } from './candidates.js';
import { Router } from './router.js';
import { DEFAULT_ROUTING, type RoutingCandidate, type RoutingConfig } from './types.js';

const providers: Record<string, any> = {
  paid: { id: 'paid', name: 'Paid', type: 'openai', baseUrl: 'https://api.example.com/v1' },
  local: { id: 'local', name: 'Local', type: 'openai', baseUrl: 'http://127.0.0.1:11434/v1' },
  claudeacct: { id: 'claudeacct', name: 'Acct', type: 'claude-account' },
};
const look: CandidateLookup = { provider: (id) => providers[id], accountKind: () => undefined };

const free: RoutingCandidate = { providerId: 'or', model: 'deepseek/deepseek-r1:free', allowAuto: true };
const local: RoutingCandidate = { providerId: 'local', model: 'qwen3', allowAuto: true };
const sub: RoutingCandidate = { providerId: 'claudeacct', model: 'claude-sonnet-4-5', allowAuto: true };
const paidPriced: RoutingCandidate = { providerId: 'paid', model: 'gpt-4.1', allowAuto: true, price: { input: 2, output: 8 } };
const paidUnpriced: RoutingCandidate = { providerId: 'paid', model: 'mystery-model', allowAuto: true };
const paidClaude: RoutingCandidate = { providerId: 'paid', model: 'claude-opus-4-1', allowAuto: true };

const needs = { tools: false, images: false, thinking: false, tokens: 100, afterTool: false };
const cfg = (o: Partial<RoutingConfig>): RoutingConfig => ({ ...DEFAULT_ROUTING, ...o });
const run = (config: RoutingConfig, policy: RoutingConfig['policy'], spent = 0) =>
  filterCandidates({ config, policy, needs, look, unusable: () => null, spentTodayUsd: spent });

describe('hard filter', () => {
  it('免费优先 never picks a paid or subscription candidate, even with paid allowed and a budget', () => {
    const f = run(cfg({ candidates: [paidPriced, sub, free, local, paidClaude], allowPaid: true, budgetUsd: 100 }), 'free');
    expect(f.ok.map((e) => e.c)).toEqual([free, local]);
    expect(f.out.every((x) => x.cost !== 'free')).toBe(true);
  });

  it('paid needs both the permission and a budget left', () => {
    expect(run(cfg({ candidates: [paidPriced] }), 'auto').ok).toEqual([]);
    expect(run(cfg({ candidates: [paidPriced], allowPaid: true }), 'auto').ok).toEqual([]);
    expect(run(cfg({ candidates: [paidPriced], allowPaid: true, budgetUsd: 5 }), 'auto', 5).ok).toEqual([]);
    expect(run(cfg({ candidates: [paidPriced], allowPaid: true, budgetUsd: 5 }), 'auto', 1).ok.map((e) => e.c)).toEqual([paidPriced]);
  });

  it('a paid candidate with an unknown price is refused under a budget unless the user allowed it; Claude has a list price', () => {
    const f = run(cfg({ candidates: [paidUnpriced, paidClaude], allowPaid: true, budgetUsd: 10 }), 'auto');
    expect(f.ok.map((e) => e.c)).toEqual([paidClaude]);
    expect(f.out[0].c).toBe(paidUnpriced);
    expect(f.out[0].why).toMatch(/价格/);
    const allowed = run(cfg({ candidates: [{ ...paidUnpriced, allowUnpriced: true }], allowPaid: true, budgetUsd: 10 }), 'auto');
    expect(allowed.ok).toHaveLength(1);
  });

  it('a candidate the user did not allow for routing is never used', () => {
    expect(run(cfg({ candidates: [{ ...free, allowAuto: false }] }), 'free').ok).toEqual([]);
  });
});

const ir = (messages: IrRequest['messages'], tools = false): IrRequest => ({ model: 'smart-auto', messages, stream: true, ...(tools ? { tools: [{ name: 't', schema: {} }] } : {}) });

describe('Router.plan', () => {
  const plan = (r: Router, req: IrRequest, config: Partial<RoutingConfig>, sessionKey?: string) => r.plan({
    groupId: 'g', config: cfg({ candidates: [free, local], ...config }), model: req.model, ir: req, json: {}, sessionKey, look, unusable: () => null,
  });

  it('a fresh request may fail over to the next candidates (up to maxAttempts)', () => {
    const p = plan(new Router(), ir([{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }]), { maxAttempts: 3 });
    expect(p.order).toHaveLength(2);
  });

  it('after a tool ran, one try only: a failure is never replayed on another model', () => {
    const req = ir([
      { role: 'user', parts: [{ type: 'text', text: 'run it' }] },
      { role: 'assistant', parts: [{ type: 'tool_call', id: 'c1', name: 't', args: {} }] },
      { role: 'user', parts: [{ type: 'tool_result', id: 'c1', content: 'done' }] },
    ], true);
    expect(needsOf(req, {}).afterTool).toBe(true);
    const p = plan(new Router(), req, { maxAttempts: 5 });
    expect(p.order).toHaveLength(1);
    expect(p.decision.reason).toMatch(/工具已经执行过/);
  });

  it('failover off: one try', () => {
    expect(plan(new Router(), ir([{ role: 'user', parts: [{ type: 'text', text: 'x' }] }]), { failover: false }).order).toHaveLength(1);
  });

  it('the conversation keeps the model it had (affinity) while it is usable', () => {
    const r = new Router();
    const req = ir([{ role: 'user', parts: [{ type: 'text', text: 'x' }] }]);
    const first = plan(r, req, {}, 'sess');
    const other = first.order.find((e) => e !== first.order[0])!;
    r.attempt(first, first.order[0], { status: 500, kind: 'switch' });
    r.attempt(first, other, { status: 200, kind: 'done' });
    r.finish(first);
    expect(first.decision.switched).toBe(true);
    expect(plan(r, req, {}, 'sess').order[0].key).toBe(other.key);
  });

  it('spend counts only answered paid candidates, at their price', () => {
    const r = new Router();
    const p = plan(r, ir([{ role: 'user', parts: [{ type: 'text', text: 'x' }] }]), { candidates: [paidPriced], allowPaid: true, budgetUsd: 1 });
    r.attempt(p, p.order[0], { status: 200, kind: 'done', usage: { input: 1_000_000, output: 0 } });
    expect(r.log.spentToday()).toBe(2);
    // and now the budget is gone: the paid candidate is out
    expect(plan(r, ir([{ role: 'user', parts: [{ type: 'text', text: 'x' }] }]), { candidates: [paidPriced], allowPaid: true, budgetUsd: 1 }).order).toEqual([]);
  });
});
