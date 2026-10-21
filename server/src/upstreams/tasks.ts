// 任务中心 (phase B/C): the scheduler for periodic account upkeep — check-in, growth, lottery, cat travel,
// activity, keepalive, quota refresh and health checks. Ours, not the sidecars': their own timers stay off.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { MetaStore } from '../meta/store.js';
import type { UpstreamService } from './service.js';
import type { MaintenanceKind, MaintenanceRun, MaintenanceTask, TaskRequest, UpstreamAccount } from './types.js';
import { nextCron } from '../schedules/cron.js';
import { CATCH_UP_WINDOW, missedRun } from '../schedules/catch-up.js';
import { tr } from '../i18n/index.js';

const TICK_MS = 30_000;
const KEEP_RUNS = 500;
/** how often a component-stopped account gets a recovery check */
const RECOVERY_EVERY_MS = 60 * 60_000;
const DEFAULT_TASK = '0 8 * * *';

const KINDS: MaintenanceKind[] = ['checkin', 'keepalive', 'growth', 'travel', 'lottery', 'activity', 'quota-refresh', 'account-check'];
const DAILY: MaintenanceKind[] = ['checkin', 'travel', 'lottery'];

/** The user's day (local time), not UTC: a daily task must not run twice around local midnight. */
const localDay = (now: number): string => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const kindLabel = (kind: MaintenanceKind): string => {
  switch (kind) {
    case 'checkin': return tr('签到');
    case 'keepalive': return tr('保活');
    case 'growth': return tr('成长任务');
    case 'travel': return tr('猫咪旅行');
    case 'lottery': return tr('抽奖');
    case 'activity': return tr('活动');
    case 'quota-refresh': return tr('刷新额度');
    case 'account-check': return tr('账号检查');
  }
};

export interface TaskDeps {
  meta: MetaStore;
  upstreams: UpstreamService;
  now?: () => number;
  tickMs?: number;
  /** a human line for the UI (one per finished task) */
  notify?: (line: string) => void;
}

export class MaintenanceScheduler extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private running = new Set<string>();

  constructor(private deps: TaskDeps) {
    super();
  }

  private get meta(): MetaStore { return this.deps.meta; }
  private get now(): number { return (this.deps.now ?? Date.now)(); }

  list(): MaintenanceTask[] { return this.meta.maintenanceTasks(); }

  runs(limit = 200): MaintenanceRun[] {
    const all = this.meta.maintenanceRuns();
    return all.slice(-Math.max(1, Math.min(KEEP_RUNS, limit)));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.deps.tickMs ?? TICK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async upsert(patch: Partial<MaintenanceTask> & { id?: string }): Promise<MaintenanceTask> {
    const list = this.list();
    const existing = patch.id ? list.find((x) => x.id === patch.id) : undefined;
    // work on a copy: a rejected edit must not leave half a task behind
    const task: MaintenanceTask = existing
      ? { ...existing, target: { ...existing.target }, schedule: { ...existing.schedule } }
      : {
          id: `task_${crypto.randomBytes(4).toString('hex')}`,
          kind: 'checkin',
          target: { kind: 'account', accountId: '' },
          schedule: { cron: DEFAULT_TASK },
          enabled: true,
          createdAt: this.now,
        };
    const scheduleBefore = JSON.stringify(task.schedule);
    if (patch.name !== undefined) task.name = patch.name.trim() || undefined;
    if (patch.kind !== undefined) {
      if (!KINDS.includes(patch.kind)) throw new Error(tr('没有这种任务类型'));
      task.kind = patch.kind;
    }
    if (patch.target !== undefined) task.target = patch.target;
    const target = task.target;
    if (target.kind === 'account') {
      if (!this.deps.upstreams.store.get(target.accountId)) throw new Error(tr('没有这个账号'));
    } else if (!this.deps.upstreams.groups().some((g) => g.id === target.groupId)) {
      throw new Error(tr('没有这个账号池'));
    }
    if (patch.schedule !== undefined) {
      task.schedule = { ...patch.schedule };
      this.validateSchedule(task.schedule);
    }
    if (patch.enabled !== undefined) task.enabled = patch.enabled;
    if (task.enabled && (!task.nextRunAt || JSON.stringify(task.schedule) !== scheduleBefore)) {
      task.nextRunAt = this.nextAfter(task, this.now);
      delete task.lastError;
    }
    if (!task.enabled) task.nextRunAt = undefined;
    if (existing) Object.assign(existing, task);
    else list.push(task);
    await this.meta.saveTasks();
    this.emit('changed');
    return existing ?? task;
  }

  async remove(id: string): Promise<void> {
    this.meta.data.maintenanceTasks = this.list().filter((t) => t.id !== id);
    await this.meta.saveTasks();
    this.emit('changed');
  }

  /** Run every target account now, whatever the schedule says (the UI's "run now"). */
  async run(id: string): Promise<MaintenanceRun[]> {
    const task = this.list().find((t) => t.id === id);
    if (!task) throw new Error(tr('没有这个任务'));
    if (this.running.has(id)) throw new Error(tr('任务正在运行'));
    return this.execute(task, { slot: this.now, force: true, now: this.now });
  }

  /** One scheduler pass; public so tests can drive it with a fixed clock. */
  async tick(now = this.now): Promise<void> {
    await this.recoverStopped(now);
    const due: { task: MaintenanceTask; slot: number; catchUp: boolean }[] = [];
    let changed = false;
    for (const task of this.list()) {
      if (!task.enabled) continue;
      if (!task.nextRunAt) {
        task.nextRunAt = this.nextAfter(task, now);
        changed = true;
        continue;
      }
      if (task.nextRunAt > now) continue;
      if (this.running.has(task.id)) continue;
      const missed = missedRun(task.nextRunAt, now);
      if (missed === 'drop') {
        task.nextRunAt = this.nextAfter(task, now);
        changed = true;
        continue;
      }
      due.push({ task, slot: task.nextRunAt, catchUp: missed === 'catch-up' });
    }
    if (changed) await this.meta.saveTasks();
    await Promise.all(due.map((d) => this.execute(d.task, { slot: d.slot, now, catchUp: d.catchUp })));
  }

  /** last auto-recovery sweep (ms); one per RECOVERY_EVERY_MS, whatever the tick rate is */
  private lastRecovery = 0;

  /**
   * Put back accounts the *component* stopped (3 consecutive auth failures) once they answer a check again.
   * A stop the user made has no `autoDisabledAt` and is never undone here.
   */
  private async recoverStopped(now: number): Promise<void> {
    if (now - this.lastRecovery < RECOVERY_EVERY_MS) return;
    this.lastRecovery = now;
    // tests drive the scheduler with a partial upstream service (no store): nothing to recover there
    const store = (this.deps.upstreams as { store?: { list?(): { id: string; enabled: boolean; autoDisabledAt?: number }[] } }).store;
    for (const a of store?.list?.() ?? []) {
      if (!a.autoDisabledAt || a.enabled) continue;
      try {
        const r = await this.deps.upstreams.probe(a.id);
        if (r.health === 'ok') await this.deps.upstreams.update(a.id, { enabled: true });
      } catch { /* the component may be down; the next sweep tries again */ }
    }
  }

  async handle(req: TaskRequest): Promise<unknown> {
    switch (req.kind) {
      case 'tasks.list': return { tasks: this.list(), runs: this.runs() };
      case 'tasks.upsert': return this.upsert(req.task);
      case 'tasks.remove': await this.remove(req.id); return null;
      case 'tasks.run': return this.run(req.id);
      case 'tasks.runs': return this.runs(req.limit);
    }
  }

  private async execute(task: MaintenanceTask, opts: { slot: number; now: number; force?: boolean; catchUp?: boolean }): Promise<MaintenanceRun[]> {
    if (this.running.has(task.id)) return [];
    this.running.add(task.id);
    const out: MaintenanceRun[] = [];
    try {
      const accounts = this.accountsFor(task);
      if (!accounts.length) task.lastError = tr('没有可执行这个任务的账号');
      for (const account of accounts) {
        const key = opts.force
          ? `${task.id}:${account.id}:manual:${opts.now}`
          : `${task.id}:${account.id}:${this.slotOf(task.kind, opts.slot, opts.now)}`;
        if (!opts.force && this.meta.maintenanceRuns().some((r) => r.idempotencyKey === key)) continue;
        const started = this.now;
        let ok = false;
        let result: string | undefined;
        let error: string | undefined;
        try {
          const r = await this.deps.upstreams.runAccountTask(account.id, task.kind);
          ok = r.ok;
          result = r.detail ?? (r.ok ? tr('完成') : tr('未成功'));
          if (r.ok && account.health !== 'ok') await this.deps.upstreams.store.setHealth(account.id, { health: 'ok', lastOkAt: started, lastError: undefined });
          // the component had stopped it by itself (auth failures) and it answers again: put it back
          if (r.ok && account.autoDisabledAt && !account.enabled) await this.deps.upstreams.update(account.id, { enabled: true });
        } catch (e: any) {
          error = e?.message ?? String(e);
          result = error;
        }
        const run: MaintenanceRun = {
          id: `run_${crypto.randomBytes(5).toString('hex')}`,
          taskId: task.id,
          accountId: account.id,
          at: started,
          ok,
          durationMs: Math.max(0, this.now - started),
          ...(result ? { result } : {}),
          ...(error ? { error } : {}),
          idempotencyKey: key,
        };
        out.push(run);
        this.pushRun(run);
      }
      task.lastRunAt = opts.now;
      const failed = out.filter((r) => !r.ok);
      if (failed.length) task.lastError = failed[0].error ?? failed[0].result;
      else delete task.lastError;
      task.nextRunAt = task.enabled ? this.nextAfter(task, this.now) : undefined;
      await this.meta.saveTasks();
      if (out.length) {
        const okCount = out.length - failed.length;
        const label = task.name?.trim() || kindLabel(task.kind);
        const line = opts.catchUp
          ? tr('补跑「{name}」：{ok} 个成功，{failed} 个失败', { name: label, ok: okCount, failed: failed.length })
          : tr('「{name}」：{ok} 个成功，{failed} 个失败', { name: label, ok: okCount, failed: failed.length });
        this.emit('changed');
        this.deps.notify?.(line);
        // a quiet run stays in the history; a failure is worth the toast (and the OS notification when away)
        if (failed.length) {
          const why = failed[0].error ?? failed[0].result ?? '';
          this.emit('notice', tr('定时任务「{name}」有 {failed} 个账号失败：{error}', { name: label, failed: failed.length, error: why.slice(0, 160) }), true);
        }
      }
      return out;
    } finally {
      this.running.delete(task.id);
    }
  }

  private pushRun(run: MaintenanceRun): void {
    const all = this.meta.maintenanceRuns();
    all.push(run);
    if (all.length > KEEP_RUNS) this.meta.data.maintenanceRuns = all.slice(-KEEP_RUNS);
  }

  private accountsFor(task: MaintenanceTask): UpstreamAccount[] {
    const target = task.target;
    const all = target.kind === 'account'
      ? [this.deps.upstreams.store.get(target.accountId)]
      : this.deps.upstreams.groups().find((g) => g.id === target.groupId)?.members.map((id) => this.deps.upstreams.store.get(id)) ?? [];
    return all.filter((a): a is UpstreamAccount => !!a && a.enabled && a.health !== 'expired' && a.health !== 'disabled')
      .filter((a) => this.deps.upstreams.familyTasks(a.kind).includes(task.kind));
  }

  private slotOf(kind: MaintenanceKind, slot: number, now: number): string {
    if (DAILY.includes(kind)) return localDay(now);
    return String(slot);
  }

  private nextAfter(task: MaintenanceTask, from: number): number {
    if (task.schedule.cron) return nextCron(task.schedule.cron, new Date(from)).getTime();
    const minutes = Math.max(5, Math.round(task.schedule.everyMinutes ?? 60));
    return from + minutes * 60_000;
  }

  private validateSchedule(s: MaintenanceTask['schedule']): void {
    if (!s.cron && !s.everyMinutes) throw new Error(tr('定时需要 cron 或间隔分钟数'));
    if (s.cron) nextCron(s.cron, new Date(this.now));
    if (!s.cron && s.everyMinutes !== undefined) {
      const m = Number(s.everyMinutes);
      if (!Number.isFinite(m) || m < 5 || m > 7 * 24 * 60) throw new Error(tr('间隔需要在 5 分钟到 7 天之间'));
    }
  }
}
