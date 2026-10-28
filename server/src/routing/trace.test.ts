// 智能路由: decision trace helpers — relative timing, copy semantics and attaching a trace without mutating the
// decision. Deterministic through an injected clock.
import { describe, expect, it } from 'vitest';
import { DecisionTrace, traceOf, traceStep, withTrace } from './trace.js';

describe('traceStep', () => {
  it('clamps the offset and keeps a copy of the data', () => {
    const data = { rule: 'r1', ms: 12 };
    const step = traceStep('rule', '命中规则 r1', { at: -5, data });
    expect(step).toEqual({ at: 0, stage: 'rule', text: '命中规则 r1', data: { rule: 'r1', ms: 12 } });
    data.rule = 'changed';
    expect(step.data).toEqual({ rule: 'r1', ms: 12 });
  });
});

describe('DecisionTrace', () => {
  it('records offsets from the start and makes no claims after the fact', () => {
    let now = 1_000;
    const trace = new DecisionTrace(() => now);
    trace.add('group', '取组', { groupId: 'g' });
    now = 1_123;
    trace.add('classifier', '判断模型', { ms: 45 });
    expect(trace.steps()).toEqual([
      { at: 0, stage: 'group', text: '取组', data: { groupId: 'g' } },
      { at: 123, stage: 'classifier', text: '判断模型', data: { ms: 45 } },
    ]);
    expect(trace.size).toBe(2);
    expect(trace.latest('classifier')?.at).toBe(123);
    expect(trace.latest('attempt')).toBeUndefined();
  });

  it('steps() and toJSON() return copies', () => {
    const trace = new DecisionTrace(() => 0);
    trace.add('filter', '过滤', { left: 2 });
    const first = trace.steps();
    first[0].text = 'mutated';
    first[0].data!.left = 99;
    expect(trace.steps()[0]).toEqual({ at: 0, stage: 'filter', text: '过滤', data: { left: 2 } });
    expect(trace.toJSON()).toEqual(trace.steps());
  });
});

describe('withTrace / traceOf', () => {
  it('attaches a copy without mutating the decision', () => {
    const trace = new DecisionTrace(() => 0);
    trace.add('rank', '排序');
    const decision = { id: 'd1', attempts: [] as string[] };
    const traced = withTrace(decision, trace);
    expect(traced).toEqual({ id: 'd1', attempts: [], trace: [{ at: 0, stage: 'rank', text: '排序' }] });
    expect('trace' in decision).toBe(false);
    traced.trace[0].text = 'mutated';
    expect(trace.steps()[0].text).toBe('排序');
  });

  it('accepts a plain step list and reads a decision trace back as copies', () => {
    const steps = [traceStep('finish', '完成')];
    const traced = withTrace({ id: 'd2' }, steps);
    expect(traced.trace).toEqual(steps);
    steps[0].text = 'mutated';
    expect(traced.trace[0].text).toBe('完成');
    expect(traceOf(traced)).toEqual(traced.trace);
    expect(traceOf({})).toEqual([]);
  });
});
