// 智能路由: the ordered trace of one decision (spec §8.10 "生成 Decision + Trace", §6.5 replay: 第 N 轮 · 规则命中 ·
// 判断模型 323ms). Pure helpers only: the caller supplies the text (already through tr()), so this module owns no
// user-visible strings and stays deterministic under a fake clock.
import type { RoutingDecision, RoutingTraceData, RoutingTraceStage, RoutingTraceStep } from './types.js';

export type { RoutingTraceData, RoutingTraceStage, RoutingTraceStep } from './types.js';

const cleanData = (data: RoutingTraceData | undefined): RoutingTraceData | undefined => (data ? { ...data } : undefined);
const cleanStep = (s: RoutingTraceStep): RoutingTraceStep => ({ ...s, ...(s.data ? { data: { ...s.data } } : {}) });

/** A standalone step (for code that does not keep a running trace). `at` is clamped to a non-negative integer. */
export function traceStep(stage: RoutingTraceStage, text: string, o: { at?: number; data?: RoutingTraceData } = {}): RoutingTraceStep {
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? Math.max(0, Math.round(o.at)) : 0;
  const data = cleanData(o.data);
  return { at, stage, text, ...(data ? { data } : {}) };
}

/** A running trace with a start time; `add` records the offset, so a decision's steps line up in the replay UI. */
export class DecisionTrace {
  private readonly start: number;
  private list: RoutingTraceStep[] = [];

  constructor(private readonly now: () => number = Date.now) {
    this.start = now();
  }

  add(stage: RoutingTraceStage, text: string, data?: RoutingTraceData): RoutingTraceStep {
    const at = Math.max(0, this.now() - this.start);
    const step = traceStep(stage, text, { at, ...(data ? { data } : {}) });
    this.list.push(step);
    return cleanStep(step);
  }

  /** A copy: mutating the returned array / steps cannot change the trace. */
  steps(): RoutingTraceStep[] {
    return this.list.map(cleanStep);
  }

  latest(stage?: RoutingTraceStage): RoutingTraceStep | undefined {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!stage || this.list[i].stage === stage) return cleanStep(this.list[i]);
    }
    return undefined;
  }

  get size(): number {
    return this.list.length;
  }

  toJSON(): RoutingTraceStep[] {
    return this.steps();
  }
}

/** Attach a trace to a decision-shaped object without mutating it (the decision is written to the log once, at finish). */
export function withTrace<T extends object>(decision: T, trace: DecisionTrace | readonly RoutingTraceStep[]): T & { trace: RoutingTraceStep[] } {
  const steps = trace instanceof DecisionTrace ? trace.steps() : trace.map(cleanStep);
  return { ...decision, trace: steps };
}

/** The trace already on a decision (empty when it has none), always as copies. */
export function traceOf(decision: Pick<RoutingDecision, 'trace'>): RoutingTraceStep[] {
  return (decision.trace ?? []).map(cleanStep);
}
