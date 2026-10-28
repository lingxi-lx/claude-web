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

describe('the calling key limits what routing may pick (S1, §7.4)', () => {
  const all = cfg({ candidates: [free, local, sub, paidPriced, paidUnpriced], allowPaid: true, budgetUsd: 100 });
  const pick = (access: Parameters<typeof filterCandidates>[0]['access'], spent = 0) =>
    filterCandidates({ config: all, policy: 'auto', needs, look, unusable: () => null, spentTodayUsd: spent, access }).ok.map((e) => e.c);

  it('a candidate whose model fails the key model allow-list is out (not just the virtual smart-* name)', () => {
    expect(pick({ modelAllowlist: ['qwen*', 'smart-*'] })).toEqual([local]);
    expect(pick({ modelDeny: ['gpt-*'] })).not.toContain(paidPriced);
  });

  it('a share key gets no subscription accounts and no paid sources by default', () => {
    expect(pick({ subscription: false, paid: false })).toEqual([free, local]);
    expect(pick({ subscription: true, paid: false })).toEqual([free, local, sub]);
  });

  it('paid only against the key own budget — never an unpriced one, never past it — and the owner budget still holds', () => {
    expect(pick({ paid: { budgetUsd: 2, spentTodayUsd: 0 } })).toContain(paidPriced);
    expect(pick({ paid: { budgetUsd: 2, spentTodayUsd: 0 } })).not.toContain(paidUnpriced);
    expect(pick({ paid: { budgetUsd: 2, spentTodayUsd: 2 } })).not.toContain(paidPriced);
    expect(pick({ paid: { budgetUsd: 2, spentTodayUsd: 0 } }, 100)).not.toContain(paidPriced);
  });

  it('a per-key source list keeps only those sources', () => {
    expect(pick({ sources: ['p:local'] })).toEqual([local]);
    expect(pick({ sources: ['p:or#deepseek/deepseek-r1:free'] })).toEqual([free]);
  });

  it('Router.plan applies the access and the answer is charged as this request spend', () => {
    const r = new Router();
    const req = ir([{ role: 'user', parts: [{ type: 'text', text: 'x' }] }]);
    const p = r.plan({ groupId: 'g', config: cfg({ candidates: [sub, paidPriced], allowPaid: true, budgetUsd: 100 }), model: 'smart-auto', ir: req, json: {}, look, unusable: () => null, access: { subscription: false, paid: { budgetUsd: 5, spentTodayUsd: 0 } } });
    expect(p.order.map((e) => e.c)).toEqual([paidPriced]);
    expect(p.decision.candidates.find((c) => c.excluded)?.excluded).toMatch(/订阅/);
    r.attempt(p, p.order[0], { status: 200, kind: 'done', usage: { input: 500_000, output: 0 } });
    expect(p.spentUsd).toBe(1);
  });

  it('planAsync applies it too, and the trace says why each candidate was left out', async () => {
    const r = new Router();
    const req = ir([{ role: 'user', parts: [{ type: 'text', text: 'x' }] }]);
    const p = await r.planAsync({ groupId: 'g', config: cfg({ candidates: [free, sub, paidPriced], allowPaid: true, budgetUsd: 100, mode: 'order' }), model: 'smart-auto', ir: req, json: {}, look, unusable: () => null, access: { subscription: false, paid: false } });
    expect(p.order.map((e) => e.c)).toEqual([free]);
    r.finish(p);
    const filtered = (p.decision.trace ?? []).filter((s) => s.stage === 'filter').map((s) => s.text).join('\n');
    expect(filtered).toMatch(/订阅/);
    expect(filtered).toMatch(/付费额度/);
  });
});
