import { describe, expect, it } from 'vitest';
import { abortError, runTask, validatePlan, waitFor, type ActResult, type PlanAction, type PlannerDeps } from './planner.js';
import type { UiaSnapshot } from './uia.js';

const tree = (names: string[]): UiaSnapshot => ({
  app: { name: 'notepad', title: 'Untitled - Notepad' },
  window: { title: 'Untitled - Notepad' },
  root: {
    role: 'Window', name: 'Untitled - Notepad',
    children: names.length ? [{ role: 'Pane', children: names.map((name) => ({ role: 'Text', name })) }] : [],
  },
});

/** A desktop that exists only here: observations in a row, recorded actions, a virtual clock. */
class FakeDesktop {
  now = 0;
  observes = 0;
  actions: PlanAction[] = [];
  snapshots: UiaSnapshot[];
  actImpl: ((action: PlanAction, signal: AbortSignal) => Promise<ActResult>) | null = null;

  constructor(snapshots: UiaSnapshot[]) { this.snapshots = snapshots; }

  async observe(): Promise<UiaSnapshot> {
    const s = this.snapshots[Math.min(this.observes, this.snapshots.length - 1)];
    this.observes++;
    return s;
  }

  async act(action: PlanAction, ctx: { signal: AbortSignal }): Promise<ActResult> {
    this.actions.push(action);
    if (this.actImpl) return this.actImpl(action, ctx.signal);
    return { ok: true, text: `${action.action} done` };
  }

  async wait(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(abortError()); return; }
      const onAbort = () => { clearTimeout(timer); reject(abortError()); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, 0);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    if (signal.aborted) throw abortError();
    this.now += Math.max(0, ms);
  }

  deps(): PlannerDeps {
    return {
      observe: () => this.observe(),
      act: (a, ctx) => this.act(a, ctx),
      wait: (ms, signal) => this.wait(ms, signal),
      now: () => this.now,
    };
  }
}

describe('validatePlan', () => {
  it('refuses empty, oversized, and empty steps before anything runs', () => {
    expect(validatePlan({ steps: [] })).toContain('steps');
    expect(validatePlan({ steps: Array.from({ length: 51 }, () => ({ action: { action: 'invoke', ref: 'e1' } })) })).toContain('50');
    expect(validatePlan({ steps: [{} as any] })).toContain('第 1 步');
    expect(validatePlan({ steps: [{ action: { action: '' } as any }] })).toContain('action');
    expect(validatePlan({ steps: [{ waitFor: {} }] })).not.toBeNull();
    expect(validatePlan({ steps: [{ action: { action: 'invoke', ref: 'e1' } }] })).toBeNull();
    // a click / scroll with both a ref and a coordinate is ambiguous (the gate would check one, the helper act on the other)
    expect(validatePlan({ steps: [{ action: { action: 'click', ref: 'e2', coordinate: [10, 10] } }] })).toContain('其中一个');
    expect(validatePlan({ steps: [{ action: { action: 'scroll', ref: 'e2', coordinate: [10, 10] } }] })).toContain('其中一个');
    expect(validatePlan({ steps: [{ action: { action: 'click', coordinate: [10, 10] } }] })).toBeNull();
  });
});

describe('runTask', () => {
  it('runs the steps in order in one call, passing each action to the desktop', async () => {
    const desk = new FakeDesktop([tree([])]);
    const result = await runTask({
      steps: [
        { label: 'save', action: { action: 'invoke', ref: 'e1' } },
        { action: { action: 'value', ref: 'e2', text: 'hello' } },
        { action: { action: 'key', text: 'ctrl+s' } },
      ],
    }, desk.deps());
    expect(result.status).toBe('ok');
    expect(result.ok).toBe(true);
    expect(desk.actions.map((a) => a.action)).toEqual(['invoke', 'value', 'key']);
    expect(result.steps.map((s) => s.label)).toEqual(['save', 'value', 'key']);
    expect(result.steps.every((s) => s.ok)).toBe(true);
  });

  it('waits for a control between two local steps without asking the model again', async () => {
    const desk = new FakeDesktop([tree([]), tree(['Done'])]);
    const result = await runTask({
      steps: [{ action: { action: 'invoke', ref: 'e1' }, waitFor: { text: 'Done', intervalMs: 10, timeoutMs: 100 } }],
    }, desk.deps());
    expect(result.status).toBe('ok');
    expect(desk.actions).toHaveLength(1);
    expect(desk.observes).toBe(2);
    expect(result.steps[0].matches?.map((m) => m.name)).toContain('Done');
    expect(desk.now).toBe(10);
  });

  it('can wait for something to disappear', async () => {
    const desk = new FakeDesktop([tree(['Saving']), tree([])]);
    const result = await runTask({
      steps: [{ waitFor: { text: 'Saving', present: false, intervalMs: 10, timeoutMs: 100 } }],
    }, desk.deps());
    expect(result.status).toBe('ok');
    expect(desk.observes).toBe(2);
    expect(desk.actions).toEqual([]);
  });

  it('stops at the first failed step and does not run the rest', async () => {
    const desk = new FakeDesktop([tree([])]);
    desk.actImpl = async () => ({ ok: false, error: 'that button is gone' });
    const result = await runTask({
      steps: [
        { action: { action: 'invoke', ref: 'e1' } },
        { action: { action: 'invoke', ref: 'e2' } },
      ],
    }, desk.deps());
    expect(result.status).toBe('failed');
    expect(desk.actions).toHaveLength(1);
    expect(result.steps).toHaveLength(1);
    expect(result.text).toContain('that button is gone');
  });

  it('stops when the task budget is used up', async () => {
    const desk = new FakeDesktop([tree([])]);
    const result = await runTask({
      steps: [
        { action: { action: 'wait', ms: 200 } },
        { action: { action: 'invoke', ref: 'e1' } },
      ],
    }, desk.deps(), { budgetMs: 100 });
    expect(result.status).toBe('budget');
    expect(desk.actions).toEqual([]);
    expect(desk.now).toBe(100);
    expect(result.steps.at(-1)?.status).toBe('budget');
  });

  it('starts nothing after the task is aborted', async () => {
    const desk = new FakeDesktop([tree([])]);
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await runTask({ steps: [{ action: { action: 'invoke', ref: 'e1' } }] }, desk.deps(), { signal: ctrl.signal });
    expect(result.status).toBe('aborted');
    expect(desk.actions).toEqual([]);
    expect(result.steps[0].status).toBe('aborted');
  });

  it('aborts a wait that is under way', async () => {
    const desk = new FakeDesktop([tree([])]);
    // a wait that only ends when the signal does — the takeover case
    const deps = desk.deps();
    deps.wait = (_ms, signal) => new Promise<void>((_, reject) => {
      if (signal.aborted) { reject(abortError()); return; }
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
    });
    const ctrl = new AbortController();
    const run = runTask({ steps: [{ action: { action: 'wait', ms: 10_000 } }] }, deps, { signal: ctrl.signal, budgetMs: 20_000 });
    setTimeout(() => ctrl.abort(), 5);
    const result = await run;
    expect(result.status).toBe('aborted');
  });

  it('times out a step whose action never finishes', async () => {
    const desk = new FakeDesktop([tree([])]);
    desk.actImpl = () => new Promise<ActResult>(() => { /* never */ });
    const result = await runTask({ steps: [{ action: { action: 'click', coordinate: [1, 1] }, timeoutMs: 100 }] }, desk.deps(), { stepTimeoutMs: 100 });
    expect(result.status).toBe('failed');
    expect(result.steps[0].text).toContain('超时');
  });

  it('turns a thrown action into a failed step', async () => {
    const desk = new FakeDesktop([tree([])]);
    desk.actImpl = async () => { throw new Error('boom'); };
    const result = await runTask({ steps: [{ action: { action: 'click', coordinate: [1, 1] } }] }, desk.deps());
    expect(result.status).toBe('failed');
    expect(result.text).toContain('boom');
  });

  it('reports an invalid plan without observing', async () => {
    const desk = new FakeDesktop([tree([])]);
    const result = await runTask({ steps: [] }, desk.deps());
    expect(result.status).toBe('failed');
    expect(desk.observes).toBe(0);
  });
});

describe('waitFor', () => {
  it('times out with a clear status when the condition never holds', async () => {
    const desk = new FakeDesktop([tree([])]);
    const result = await waitFor({ text: 'Nope', intervalMs: 10, timeoutMs: 30 }, desk.deps(), { timeoutMs: 30 });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('timeout');
    expect(desk.observes).toBeGreaterThan(1);
    expect(result.text).toContain('Nope');
  });

  it('treats an empty condition as a failure, not as success', async () => {
    const desk = new FakeDesktop([tree([])]);
    const result = await waitFor({}, desk.deps());
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
  });

  it('waits for a window title', async () => {
    const desk = new FakeDesktop([tree([]), { ...tree([]), window: { title: 'Save As' }, app: { name: 'notepad', title: 'Save As' } }]);
    const result = await waitFor({ window: 'Save As', intervalMs: 10 }, desk.deps(), { timeoutMs: 100 });
    expect(result.ok).toBe(true);
    expect(desk.observes).toBe(2);
  });
});
