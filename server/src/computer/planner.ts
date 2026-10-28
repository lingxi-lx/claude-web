/**
 * A whole desktop task in one call: several steps, each one action and/or a condition to wait for, run locally
 * between observations — the model is not asked again between them.
 *
 * The planner owns no window, mouse or clock: `observe` returns a UIA snapshot, `act` performs one action, `wait`
 * sleeps (and must stop on abort). That makes it testable with a fake desktop, and leaves the gate, the helper and
 * the takeover signal to the caller. Every step and the task as a whole have a time budget; an aborted task never
 * starts another action.
 */
import { compressTree, findNodes, refById, windowMatches, type CompressedTree, type UiaSnapshot, type UiMatch } from './uia.js';
import { tr } from '../i18n/index.js';

export interface PlanAction {
  /** "invoke" / "value" / "toggle" / "select" / "expand" / "collapse" / "click" / "type" / "key" / "scroll" / "wait" */
  action: string;
  /** a control from computer_observe / computer_find */
  ref?: string;
  /** otherwise a position in the last screenshot */
  coordinate?: [number, number];
  /** text to type / value to set / key chord / item to select */
  text?: string;
  value?: string;
  count?: number;
  /** action "wait": milliseconds (or `duration` in seconds) */
  ms?: number;
  duration?: number;
}

export interface WaitCondition {
  /** wait until a control of this role exists (or is gone with present: false) */
  role?: string;
  /** name contains this */
  name?: string;
  /** name, value or automation id contains this */
  text?: string;
  /** the application / window title contains this */
  window?: string;
  /** a ref from the last observation */
  ref?: string;
  /** default true: wait until found; false: wait until gone */
  present?: boolean;
  /** how many matches are enough (default 1) */
  count?: number;
  /** poll interval, default 100 ms */
  intervalMs?: number;
  /** default 5000 ms, at most 120000 */
  timeoutMs?: number;
}

export interface PlanStep {
  label?: string;
  action?: PlanAction;
  waitFor?: WaitCondition | WaitCondition[];
  /** this step's budget; default 5000 ms */
  timeoutMs?: number;
}

export interface Plan {
  steps: PlanStep[];
  /** default 60 s, at most 10 min */
  budgetMs?: number;
}

export interface ActResult { ok: boolean; text?: string; error?: string }

export interface PlannerDeps {
  observe: () => Promise<UiaSnapshot>;
  /** one action; must stop (or at least stop sending input) when the signal aborts */
  act: (action: PlanAction, ctx: { step: number; signal: AbortSignal }) => Promise<ActResult>;
  /** sleep; reject with an AbortError when the signal aborts */
  wait: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

export type WaitStatus = 'ok' | 'timeout' | 'aborted' | 'failed';
export interface WaitResult {
  ok: boolean;
  status: WaitStatus;
  matches: UiMatch[];
  snapshot?: UiaSnapshot;
  ms: number;
  text: string;
}

export type TaskStatus = 'ok' | 'failed' | 'aborted' | 'budget';
export interface StepResult {
  index: number;
  label: string;
  ok: boolean;
  status: 'ok' | 'failed' | 'aborted' | 'budget';
  ms: number;
  text: string;
  matches?: UiMatch[];
}
export interface TaskResult { ok: boolean; status: TaskStatus; steps: StepResult[]; ms: number; text: string }

export interface TaskRunOptions {
  signal?: AbortSignal;
  /** overrides plan.budgetMs */
  budgetMs?: number;
  /** default 5000 ms */
  stepTimeoutMs?: number;
  /** default 100 ms */
  pollMs?: number;
  now?: () => number;
}

const DEFAULT_TASK_BUDGET_MS = 60_000;
const MAX_TASK_BUDGET_MS = 600_000;
const DEFAULT_STEP_MS = 5_000;
const DEFAULT_WAIT_MS = 5_000;
const MAX_WAIT_MS = 120_000;
const MAX_STEPS = 50;
const TIMED_OUT = Symbol('timed-out');

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function abortError(message?: string): Error {
  const e = new Error(message ?? tr('已停止。'));
  e.name = 'AbortError';
  return e;
}

export function isAbortError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as Error).name === 'AbortError';
}

/** Sleep that ends early (and rejects) when the signal aborts. */
export function defaultWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const done = () => { signal.removeEventListener('abort', onAbort); resolve(); };
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(done, Math.max(0, Math.round(ms)));
    timer.unref?.();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const timeoutOf = (c: WaitCondition): number =>
  clamp(Number.isFinite(c.timeoutMs) ? Number(c.timeoutMs) : DEFAULT_WAIT_MS, 10, MAX_WAIT_MS);

const intervalOf = (c: WaitCondition, fallback: number): number =>
  clamp(Number.isFinite(c.intervalMs) ? Number(c.intervalMs) : fallback, 10, 2_000);

function nodeCriteria(c: WaitCondition): boolean {
  return !!(c.role?.trim() || c.name?.trim() || c.text?.trim() || c.ref?.trim());
}

function matchesIn(snapshot: UiaSnapshot, c: WaitCondition): UiMatch[] | null {
  const present = c.present !== false;
  const want = Math.max(1, Math.min(100, Math.floor(c.count ?? 1)));
  if (c.window && !windowMatches(snapshot, c.window)) return present ? null : [];
  if (c.ref?.trim()) {
    const tree: CompressedTree = compressTree(snapshot);
    const hit = refById(tree, c.ref);
    const matches: UiMatch[] = hit ? [{ ...hit, depth: 0 }] : [];
    return present ? (matches.length >= want ? matches : null) : (matches.length < want ? matches : null);
  }
  if (!nodeCriteria(c)) {
    if (!c.window) return null; // nothing to look at: never satisfied
    return present ? [] : null; // reached only when the window test above passed
  }
  const matches = findNodes(snapshot, { role: c.role, name: c.name, text: c.text, limit: 100 });
  return present ? (matches.length >= want ? matches : null) : (matches.length < want ? matches : null);
}

function allConditions(snapshot: UiaSnapshot, conditions: WaitCondition[]): UiMatch[] | null {
  const all: UiMatch[] = [];
  for (const c of conditions) {
    const matches = matchesIn(snapshot, c);
    if (!matches) return null;
    all.push(...matches);
  }
  return all;
}

function conditionList(condition: WaitCondition | WaitCondition[]): WaitCondition[] {
  const list = Array.isArray(condition) ? condition : [condition];
  return list.filter((c): c is WaitCondition => !!c && typeof c === 'object');
}

function describeCondition(c: WaitCondition): string {
  const bits: string[] = [];
  if (c.window) bits.push(tr('窗口「{text}」', { text: c.window }));
  if (c.role) bits.push(tr('角色 {role}', { role: c.role }));
  if (c.name) bits.push(tr('名字含「{text}」', { text: c.name }));
  if (c.text) bits.push(tr('文本含「{text}」', { text: c.text }));
  if (c.ref) bits.push(tr('ref {ref}', { ref: c.ref }));
  const what = bits.join('、') || tr('控件');
  return c.present === false ? tr('{what}消失', { what }) : tr('{what}出现', { what });
}

/**
 * Wait until every condition holds, polling `observe` between `wait`s. One observation per poll; no action is sent.
 */
export async function waitFor(
  condition: WaitCondition | WaitCondition[],
  deps: PlannerDeps,
  opts: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal; now?: () => number } = {},
): Promise<WaitResult> {
  const now = opts.now ?? deps.now ?? Date.now;
  const t0 = now();
  const conditions = conditionList(condition);
  if (!conditions.length) {
    return { ok: false, status: 'failed', matches: [], ms: 0, text: tr('没有给出要等待的条件。') };
  }
  if (conditions.some((c) => !c.role?.trim() && !c.name?.trim() && !c.text?.trim() && !c.window?.trim() && !c.ref?.trim())) {
    return { ok: false, status: 'failed', matches: [], ms: 0, text: tr('等待条件里没有说要等什么。') };
  }
  const ctrl = new AbortController();
  const outer = opts.signal;
  const onAbort = () => ctrl.abort(outer?.reason);
  if (outer?.aborted) ctrl.abort(outer.reason);
  else outer?.addEventListener('abort', onAbort, { once: true });
  const ownTimeout = Math.min(...conditions.map(timeoutOf));
  const timeout = clamp(opts.timeoutMs === undefined ? ownTimeout : Math.min(opts.timeoutMs, ownTimeout), 10, MAX_WAIT_MS);
  const poll = intervalOf(conditions[0], opts.pollMs ?? 100);
  const deadline = t0 + timeout;
  let last: UiaSnapshot | undefined;
  try {
    for (;;) {
      if (ctrl.signal.aborted) {
        return { ok: false, status: 'aborted', matches: [], ...(last ? { snapshot: last } : {}), ms: now() - t0, text: tr('等待已停止：用户接管了操控。') };
      }
      try {
        last = await deps.observe();
      } catch (e) {
        if (isAbortError(e) || ctrl.signal.aborted) {
          return { ok: false, status: 'aborted', matches: [], ...(last ? { snapshot: last } : {}), ms: now() - t0, text: tr('等待已停止：用户接管了操控。') };
        }
        return { ok: false, status: 'failed', matches: [], ...(last ? { snapshot: last } : {}), ms: now() - t0, text: tr('观察窗口失败：{message}', { message: (e as Error)?.message ?? String(e) }) };
      }
      const matches = allConditions(last, conditions);
      if (matches) {
        return { ok: true, status: 'ok', matches, snapshot: last, ms: now() - t0, text: tr('已等到：{what}。', { what: conditions.map(describeCondition).join('，') }) };
      }
      const left = deadline - now();
      if (left <= 0) {
        return { ok: false, status: 'timeout', matches: [], ...(last ? { snapshot: last } : {}), ms: now() - t0, text: tr('等了 {ms} 毫秒，{what}还是没有出现。', { ms: timeout, what: conditions.map(describeCondition).join('，') }) };
      }
      try {
        await deps.wait(Math.min(poll, left), ctrl.signal);
      } catch (e) {
        if (isAbortError(e) || ctrl.signal.aborted) {
          return { ok: false, status: 'aborted', matches: [], ...(last ? { snapshot: last } : {}), ms: now() - t0, text: tr('等待已停止：用户接管了操控。') };
        }
        return { ok: false, status: 'failed', matches: [], ...(last ? { snapshot: last } : {}), ms: now() - t0, text: tr('等待失败：{message}', { message: (e as Error)?.message ?? String(e) }) };
      }
    }
  } finally {
    outer?.removeEventListener('abort', onAbort);
  }
}

/** Why the plan cannot run, or null when it can. Checked before anything is observed or sent. */
export function validatePlan(plan: Plan | null | undefined): string | null {
  if (!plan || typeof plan !== 'object') return tr('任务计划必须是一个对象。');
  if (!Array.isArray(plan.steps) || !plan.steps.length) return tr('"steps" 必须是非空的动作列表。');
  if (plan.steps.length > MAX_STEPS) return tr('一个任务最多 {max} 步。', { max: MAX_STEPS });
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    if (!s || typeof s !== 'object') return tr('第 {n} 步不是一个对象。', { n: i + 1 });
    if (!s.action && !s.waitFor) return tr('第 {n} 步既没有动作，也没有等待条件。', { n: i + 1 });
    if (s.action) {
      if (typeof s.action !== 'object' || typeof s.action.action !== 'string' || !s.action.action.trim()) {
        return tr('第 {n} 步的 action 必须带一个动作名。', { n: i + 1 });
      }
      if (s.action.coordinate !== undefined) {
        const c = s.action.coordinate;
        if (!Array.isArray(c) || c.length !== 2 || !c.every((v) => typeof v === 'number' && Number.isFinite(v))) {
          return tr('第 {n} 步的 coordinate 必须是 [x, y]。', { n: i + 1 });
        }
        // the permission gate checks one spot and the helper would act on the other: refuse, as computer_act does
        if ((s.action.action === 'click' || s.action.action === 'scroll') && typeof s.action.ref === 'string' && s.action.ref.trim()) {
          return tr('第 {n} 步的 {action} 只给 ref 或 coordinate 其中一个。', { n: i + 1, action: s.action.action });
        }
      }
    }
    if (s.waitFor) {
      const list = conditionList(s.waitFor);
      if (!list.length) return tr('第 {n} 步的 waitFor 是空的。', { n: i + 1 });
      for (const c of list) {
        if (!c.role?.trim() && !c.name?.trim() && !c.text?.trim() && !c.window?.trim() && !c.ref?.trim()) {
          return tr('第 {n} 步的 waitFor 没有说要等什么。', { n: i + 1 });
        }
      }
    }
  }
  return null;
}

const stepLabel = (step: PlanStep, index: number): string =>
  (typeof step.label === 'string' && step.label.trim()) || step.action?.action || tr('第 {n} 步', { n: index + 1 });

function waitMsOf(action: PlanAction): number {
  if (typeof action.ms === 'number' && Number.isFinite(action.ms)) return action.ms;
  if (typeof action.duration === 'number' && Number.isFinite(action.duration)) return action.duration * 1000;
  return 0;
}

async function raceStep<T>(
  work: Promise<T>,
  ms: number,
  signal: AbortSignal,
  deps: PlannerDeps,
): Promise<T | typeof TIMED_OUT> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(signal.reason);
  if (signal.aborted) ctrl.abort(signal.reason);
  else signal.addEventListener('abort', onAbort, { once: true });
  try {
    // the action's own rejection stays handled while the clock gets under way
    const settled = work.then(
      (value) => ({ state: 'value' as const, value }),
      (error) => ({ state: 'error' as const, error }),
    );
    // let the action get under way (its first look at the screen) before the clock starts: a caller's wait may
    // resolve without really waiting (tests), and that must not beat an action that is already on its way
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const timer = deps.wait(Math.max(0, ms), ctrl.signal)
      .then(() => TIMED_OUT)
      .catch(() => TIMED_OUT);
    const result = (await Promise.race([settled, timer])) as typeof TIMED_OUT | { state: 'value'; value: T } | { state: 'error'; error: unknown };
    if (result === TIMED_OUT) return TIMED_OUT;
    if (result.state === 'value') return result.value;
    throw result.error;
  } finally {
    // the step is over (or failed): stop the timer's wait
    ctrl.abort();
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Run a plan. Stops at the first failed, timed-out or aborted step; never starts a step after abort. The result says
 * every step's outcome in plain words, for the model.
 */
export async function runTask(plan: Plan, deps: PlannerDeps, opts: TaskRunOptions = {}): Promise<TaskResult> {
  const now = opts.now ?? deps.now ?? Date.now;
  const t0 = now();
  const invalid = validatePlan(plan);
  if (invalid) return { ok: false, status: 'failed', steps: [], ms: 0, text: invalid };

  const budgetWanted = opts.budgetMs ?? plan.budgetMs;
  const stepWanted = opts.stepTimeoutMs;
  const budget = clamp(typeof budgetWanted === 'number' && Number.isFinite(budgetWanted) ? budgetWanted : DEFAULT_TASK_BUDGET_MS, 100, MAX_TASK_BUDGET_MS);
  const stepBudget = clamp(typeof stepWanted === 'number' && Number.isFinite(stepWanted) ? stepWanted : DEFAULT_STEP_MS, 100, 120_000);
  const deadline = t0 + budget;
  const controller = new AbortController();
  const outer = opts.signal;
  const onOuterAbort = () => controller.abort(outer?.reason);
  if (outer?.aborted) controller.abort(outer.reason);
  else outer?.addEventListener('abort', onOuterAbort, { once: true });

  const steps: StepResult[] = [];
  const stop = (status: TaskStatus, text: string): TaskResult => ({
    ok: status === 'ok',
    status,
    steps,
    ms: now() - t0,
    text,
  });
  const push = (index: number, label: string, status: StepResult['status'], started: number, text: string, matches?: UiMatch[]): StepResult => {
    const s: StepResult = { index, label, ok: status === 'ok', status, ms: Math.max(0, now() - started), text, ...(matches ? { matches } : {}) };
    steps.push(s);
    return s;
  };

  try {
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const label = stepLabel(step, i);
      if (controller.signal.aborted) {
        push(i, label, 'aborted', now(), tr('已停止：用户接管了操控。'));
        return stop('aborted', tr('任务已停止：用户接管了操控。'));
      }
      const left = deadline - now();
      if (left <= 0) {
        push(i, label, 'budget', now(), tr('总预算已经用完。'));
        return stop('budget', tr('任务超出总预算（{ms} 毫秒），已停止。', { ms: budget }));
      }
      const started = now();
      const stepWantedMs = typeof step.timeoutMs === 'number' && Number.isFinite(step.timeoutMs) ? step.timeoutMs : stepBudget;
      const stepDeadline = started + Math.min(Math.max(100, stepWantedMs), left);
      const stepCtrl = new AbortController();
      const onTaskAbort = () => stepCtrl.abort(controller.signal.reason);
      if (controller.signal.aborted) stepCtrl.abort(controller.signal.reason);
      else controller.signal.addEventListener('abort', onTaskAbort, { once: true });
      try {
        const action = step.action;
        if (action) {
          if (action.action === 'wait') {
            const ms = Math.max(0, Math.min(waitMsOf(action), stepDeadline - now()));
            try {
              await deps.wait(ms, stepCtrl.signal);
              push(i, label, 'ok', started, tr('等待了 {ms} 毫秒。', { ms: Math.round(ms) }));
            } catch (e) {
              if (isAbortError(e) || controller.signal.aborted) {
                push(i, label, 'aborted', started, tr('已停止：用户接管了操控。'));
                return stop('aborted', tr('任务已停止：用户接管了操控。'));
              }
              push(i, label, 'failed', started, tr('等待失败：{message}', { message: (e as Error)?.message ?? String(e) }));
              return stop('failed', tr('任务在第 {n} 步失败：{reason}', { n: i + 1, reason: (e as Error)?.message ?? String(e) }));
            }
          } else {
            let result: ActResult | typeof TIMED_OUT;
            try {
              result = await raceStep(deps.act(action, { step: i, signal: stepCtrl.signal }), Math.max(0, stepDeadline - now()), stepCtrl.signal, deps);
            } catch (e) {
              if (isAbortError(e) || controller.signal.aborted || stepCtrl.signal.aborted) {
                push(i, label, 'aborted', started, tr('已停止：用户接管了操控。'));
                return stop('aborted', tr('任务已停止：用户接管了操控。'));
              }
              push(i, label, 'failed', started, tr('动作失败：{message}', { message: (e as Error)?.message ?? String(e) }));
              return stop('failed', tr('任务在第 {n} 步失败：{reason}', { n: i + 1, reason: (e as Error)?.message ?? String(e) }));
            }
            if (result === TIMED_OUT || !result || controller.signal.aborted) {
              stepCtrl.abort();
              if (controller.signal.aborted) {
                push(i, label, 'aborted', started, tr('已停止：用户接管了操控。'));
                return stop('aborted', tr('任务已停止：用户接管了操控。'));
              }
              push(i, label, 'failed', started, tr('这一步超时了（{ms} 毫秒）。', { ms: Math.round(Math.min(Math.max(100, stepWantedMs), left)) }));
              return stop('failed', tr('任务在第 {n} 步失败：这一步超时了。', { n: i + 1 }));
            }
            if (!result.ok) {
              const why = result.error || result.text || tr('动作没有成功。');
              push(i, label, 'failed', started, why);
              return stop('failed', tr('任务在第 {n} 步失败：{reason}', { n: i + 1, reason: why }));
            }
            push(i, label, 'ok', started, result.text || tr('完成。')); // replaced below when waitFor runs
          }
        }
        if (step.waitFor) {
          const condLeft = Math.max(0, stepDeadline - now());
          const waited = await waitFor(step.waitFor, deps, { timeoutMs: condLeft, pollMs: opts.pollMs, signal: stepCtrl.signal, now });
          if (!waited.ok) {
            const tail = waited.status === 'aborted' ? tr('已停止：用户接管了操控。') : waited.text;
            // replace the provisional result, if one was pushed
            const idx = steps.findIndex((s) => s.index === i);
            if (idx >= 0) steps.splice(idx, 1);
            push(i, label, waited.status === 'aborted' ? 'aborted' : 'failed', started, tail, waited.matches);
            return stop(waited.status === 'aborted' ? 'aborted' : 'failed',
              waited.status === 'aborted' ? tr('任务已停止：用户接管了操控。') : tr('任务在第 {n} 步失败：{reason}', { n: i + 1, reason: waited.text }));
          }
          const idx = steps.findIndex((s) => s.index === i);
          if (idx >= 0) steps.splice(idx, 1);
          push(i, label, 'ok', started, tr('完成：{what}', { what: waited.text }), waited.matches);
        } else if (!action) {
          push(i, label, 'failed', started, tr('这一步既没有动作，也没有等待条件。'));
          return stop('failed', tr('任务在第 {n} 步失败：没有动作。', { n: i + 1 }));
        }
      } finally {
        controller.signal.removeEventListener('abort', onTaskAbort);
        stepCtrl.abort();
      }
    }
    const brief = steps.map((s) => `${s.index + 1}. ${s.label}: ${s.ok ? tr('完成') : tr('失败')} — ${s.text}`).join('\n');
    return stop('ok', `${tr('任务完成（{n} 步，{ms} 毫秒）。', { n: steps.length, ms: now() - t0 })}\n${brief}`);
  } finally {
    outer?.removeEventListener('abort', onOuterAbort);
  }
}
