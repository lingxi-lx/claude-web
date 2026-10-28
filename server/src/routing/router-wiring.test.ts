// 智能路由: the selectors, the intent classifier, the decision trace and the quota tracker wired into Router.
import { describe, expect, it } from 'vitest';
import type { IrRequest } from '../gateway/ir.js';
import type { CandidateLookup } from './candidates.js';
import { Router } from './router.js';
import { QuotaTracker } from './quota.js';
import { DEFAULT_ROUTING, candidateKey, type RoutingCandidate, type RoutingConfig } from './types.js';

const providers: Record<string, any> = {
  a: { id: 'a', name: 'A', type: 'openai', baseUrl: 'http://127.0.0.1:1/v1' },
  b: { id: 'b', name: 'B', type: 'openai', baseUrl: 'http://127.0.0.1:2/v1' },
  c: { id: 'c', name: 'C', type: 'openai', baseUrl: 'http://127.0.0.1:3/v1' },
};
const look: CandidateLookup = { provider: (id) => providers[id], accountKind: () => undefined };
const A: RoutingCandidate = { providerId: 'a', model: 'm', allowAuto: true };
const B: RoutingCandidate = { providerId: 'b', model: 'm', allowAuto: true };
const C: RoutingCandidate = { providerId: 'c', model: 'm', allowAuto: true };
const cfg = (o: Partial<RoutingConfig>): RoutingConfig => ({ ...DEFAULT_ROUTING, candidates: [A, B, C], ...o });
const ir = (text: string): IrRequest => ({ model: 'smart-auto', messages: [{ role: 'user', parts: [{ type: 'text', text }] }], stream: true });
const NOW = 1_800_000_000_000;

const mk = (o: { quota?: QuotaTracker; ask?: (k: string, p: string) => Promise<string> } = {}) =>
  new Router(undefined, { quota: o.quota ?? new QuotaTracker(() => NOW), clock: () => NOW, ...(o.ask ? { ask: (k, p) => o.ask!(k, p) } : {}) });

const plan = (r: Router, config: RoutingConfig, model = 'smart-auto', text = 'hi', sessionKey?: string) =>
  r.plan({ groupId: 'g', config, model, ir: ir(text), json: {}, look, unusable: () => null, ...(sessionKey ? { sessionKey } : {}) });

describe('quota in the router', () => {
  it('a source cooling after a 429 is filtered out, with the reason in the decision and its trace', () => {
    const quota = new QuotaTracker(() => NOW);
    quota.observe('p:a', 429, { 'retry-after': '30' }, NOW);
    const p = plan(mk({ quota }), cfg({}));
    expect(p.order.map((e) => e.key)).not.toContain(candidateKey(A));
    const out = p.decision.candidates.find((c) => c.key === candidateKey(A))!;
    expect(out.excluded).toMatch(/限流冷却中/);
    expect(out.quota?.cooldownUntil).toBe(NOW + 30_000);
    expect(p.trace!.steps().some((s) => s.stage === 'filter' && s.data?.key === candidateKey(A))).toBe(true);
  });

  it('ranks by remaining quota: the nearly-empty source drops below the same source with quota left', () => {
    const quota = new QuotaTracker(() => NOW);
    quota.observe('p:a', 200, { 'x-ratelimit-limit-requests': '100', 'x-ratelimit-remaining-requests': '1' }, NOW);
    quota.observe('p:b', 200, { 'x-ratelimit-limit-requests': '100', 'x-ratelimit-remaining-requests': '100' }, NOW);
    const p = plan(mk({ quota }), cfg({ candidates: [A, B] }));
    expect(p.order[0].key).toBe(candidateKey(B));
    const sa = p.decision.candidates.find((c) => c.key === candidateKey(A))!;
    expect(sa.quota?.remaining).toBe(0.01);
  });
});

describe('selectors as routing modes', () => {
  it('order keeps the configured order', () => {
    const p = plan(mk(), cfg({ mode: 'order', candidates: [C, A, B] }));
    expect(p.order.map((e) => e.c.providerId)).toEqual(['c', 'a', 'b']);
  });

  it('rotate moves on only after a request went out', () => {
    const r = mk();
    const c = cfg({ mode: 'rotate', maxAttempts: 1 });
    const first = plan(r, c);
    expect(first.order[0].c.providerId).toBe('a');
    // a preview (nothing attempted) keeps the cursor
    r.finish(plan(r, c));
    expect(plan(r, c).order[0].c.providerId).toBe('a');
    r.attempt(first, first.order[0], { status: 200, kind: 'done' });
    r.finish(first);
    expect(plan(r, c).order[0].c.providerId).toBe('b');
  });

  it('usage puts the least used first', () => {
    const r = mk();
    const c = cfg({ mode: 'usage', maxAttempts: 1 });
    const p1 = plan(r, c);
    r.attempt(p1, p1.order[0], { status: 200, kind: 'done' });
    r.finish(p1);
    expect(plan(r, c).order[0].c.providerId).toBe('b');
  });

  it('pace spends the quota that would be lost at the reset first', () => {
    const quota = new QuotaTracker(() => NOW);
    // a: 90 % left, resets in 10 min (would be wasted); b: 20 % left, resets in 4 h
    quota.observe('p:a', 200, { 'x-ratelimit-limit-requests': '10', 'x-ratelimit-remaining-requests': '9', 'x-ratelimit-reset-requests': '10m0s' }, NOW);
    quota.observe('p:b', 200, { 'x-ratelimit-limit-requests': '10', 'x-ratelimit-remaining-requests': '2', 'x-ratelimit-reset-requests': '4h0m0s' }, NOW);
    const p = plan(mk({ quota }), cfg({ mode: 'pace', candidates: [B, A] }));
    expect(p.order[0].c.providerId).toBe('a');
  });

  it('weight 0 never leads; an unknown mode falls back to smart', () => {
    const p = plan(mk(), cfg({ mode: 'weight', candidates: [{ ...A, weight: 0 }, { ...B, weight: 5 }] }));
    expect(p.order[0].c.providerId).toBe('b');
    const s = plan(mk(), cfg({ mode: 'bogus' as any }));
    expect(s.trace!.steps()[0].data?.mode).toBe('smart');
  });
});

describe('trace', () => {
  it('a decision carries group → filter → rank → order → attempt → finish once finished', () => {
    const r = mk();
    const p = plan(r, cfg({}));
    r.attempt(p, p.order[0], { status: 500, kind: 'switch' });
    r.attempt(p, p.order[1], { status: 200, kind: 'done', firstByteMs: 120 });
    r.finish(p);
    const d = r.log.recent('g')[0];
    const stages = d.trace!.map((s) => s.stage);
    expect(stages[0]).toBe('group');
    expect(stages).toEqual(expect.arrayContaining(['filter', 'rank', 'order', 'attempt', 'finish']));
    expect(stages.indexOf('order')).toBeLessThan(stages.indexOf('attempt'));
    expect(stages[stages.length - 1]).toBe('finish');
    expect(d.trace!.filter((s) => s.stage === 'attempt')).toHaveLength(2);
    expect(d.switched).toBe(true);
  });
});

describe('intent classifier', () => {
  const intents = { intents: [{ label: '写代码', prefer: [candidateKey(C)] }, { label: '翻译', prefer: [candidateKey(B)] }], intentJudge: candidateKey(A) };

  it('custom policy: the judge picks an intent, its candidate goes first, even over affinity', async () => {
    const asked: string[] = [];
    const r = mk({ ask: async (k, p) => { asked.push(k); return p.includes('translate this') ? '2' : '0'; } });
    const config = cfg({ policy: 'custom', ...intents });
    // the conversation had A
    const first = plan(r, config, 'smart-custom', 'hello', 'sess');
    r.attempt(first, first.order[0], { status: 200, kind: 'done' });
    r.finish(first);
    const p = await r.planAsync({ groupId: 'g', config, model: 'smart-custom', ir: ir('translate this please'), json: {}, sessionKey: 'sess', look, unusable: () => null });
    expect(asked).toEqual([candidateKey(A)]);
    expect(p.order[0].c.providerId).toBe('b');
    expect(p.decision.reason).toMatch(/翻译/);
    expect(p.trace!.steps().some((s) => s.stage === 'classifier' && s.data?.n === 2)).toBe(true);
  });

  it('no call for another strategy, after a tool ran, or when a structured rule matches; a failing judge leaves the order', async () => {
    let calls = 0;
    const r = mk({ ask: async () => { calls++; throw new Error('down'); } });
    await r.planAsync({ groupId: 'g', config: cfg({ ...intents }), model: 'smart-auto', ir: ir('x'), json: {}, look, unusable: () => null });
    await r.planAsync({ groupId: 'g', config: cfg({ policy: 'custom', ...intents, rules: [{ id: 'r1', when: { keywords: ['x'] }, prefer: [candidateKey(B)] }] }), model: 'smart-custom', ir: ir('x'), json: {}, look, unusable: () => null });
    const afterTool: IrRequest = { model: 'smart-custom', stream: true, messages: [
      { role: 'user', parts: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', parts: [{ type: 'tool_call', id: 't', name: 'x', args: {} }] },
      { role: 'user', parts: [{ type: 'tool_result', id: 't', content: 'ok' }] },
    ] };
    await r.planAsync({ groupId: 'g', config: cfg({ policy: 'custom', ...intents }), model: 'smart-custom', ir: afterTool, json: {}, look, unusable: () => null });
    expect(calls).toBe(0);
    const p = await r.planAsync({ groupId: 'g', config: cfg({ policy: 'custom', ...intents }), model: 'smart-custom', ir: ir('y'), json: {}, look, unusable: () => null });
    expect(calls).toBe(1);
    expect(p.order).toHaveLength(3);
    expect(p.trace!.steps().find((s) => s.stage === 'classifier')?.data?.n).toBe(0);
  });
});
