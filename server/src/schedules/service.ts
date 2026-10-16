import type { MetaStore, Schedule } from '../meta/store.js';
import type { RunnerPool } from '../runtime/pool.js';
import type { PermissionMode, ScheduleRun } from '../protocol.js';
import { nextCron } from './cron.js';
import { tr } from '../i18n/index.js';
import { EventEmitter } from 'node:events';
import { missedRun } from './catch-up.js';

/** Ready-made schedules users can start from (the UI fills cwd). */
export const SCHEDULE_TEMPLATES: { id: string; name: string; cron: string; prompt: string; permissionMode: PermissionMode; freshSession?: boolean }[] = [
  { id: 'ci', name: tr('CI 巡检'), cron: '*/30 * * * *', prompt: tr('用 gh 查看这个仓库最近的 CI 运行状态；如果有失败，读取日志找出原因并给出修复建议（不要直接改代码）。只在有失败时详细汇报，否则一句话说明全部通过。'), permissionMode: 'acceptEdits' },
  { id: 'daily', name: tr('每日总结'), cron: '0 18 * * 1-5', prompt: tr('总结今天这个仓库的 git 提交（git log --since=today），按功能 / 修复 / 杂项分组，写成一段可以直接发到群里的中文日报。'), permissionMode: 'acceptEdits', freshSession: true },
  { id: 'deps', name: tr('依赖更新检查'), cron: '0 9 * * 1', prompt: tr('检查项目依赖是否有新版本（npm outdated / pip list --outdated 等，按项目类型选），列出主版本变更和安全相关的更新，并说明升级风险。不要修改 lockfile。'), permissionMode: 'default', freshSession: true },
  { id: 'changelog', name: tr('每周 changelog'), cron: '0 10 * * 5', prompt: tr('根据本周的提交（git log --since="7 days ago"）起草 CHANGELOG 条目，按 Added / Changed / Fixed 分类，写入 CHANGELOG.md 的顶部（如果没有就创建）。'), permissionMode: 'acceptEdits', freshSession: true },
  { id: 'todo', name: tr('TODO 巡查'), cron: '0 11 * * 3', prompt: tr('搜索代码里的 TODO / FIXME / HACK 注释，按文件归类，估计每条的优先级，输出一份清单。'), permissionMode: 'default', freshSession: true },
  { id: 'tests', name: tr('跑测试'), cron: '0 */4 * * *', prompt: tr('运行项目的测试套件，只汇报失败的用例和可能的原因；全部通过就一句话。'), permissionMode: 'acceptEdits' },
];

/** MMDDHHmm, local time: a run's worktree name stays short and sorts by time. */
function runStamp(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

function computeNext(s: Schedule, from = Date.now()): number {
  if (s.cron) return nextCron(s.cron, new Date(from)).getTime();
  return from + Math.max(1, s.everyMinutes || 60) * 60_000;
}

/** computeNext for places that must not throw: a stored cron can be invalid (saved before validation, hand-edited, "0 0 30 2 *"). */
function safeNext(s: Schedule, from = Date.now()): { next?: number; error?: string } {
  try { return { next: computeNext(s, from) }; } catch (e) { return { error: (e as Error).message }; }
}

/**
 * Local scheduler: interval (`everyMinutes`) or cron (`cron`). Each schedule keeps one session so context
 * accumulates like /loop, unless `freshSession` asks for a new one per run. Every run is logged (meta.scheduleRuns).
 */
export class ScheduleService extends EventEmitter {
  private timer: NodeJS.Timeout;
  private running = new Set<string>();
  constructor(private meta: MetaStore, private pool: RunnerPool) {
    super();
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref();
    // a time missed more than seven days ago is dropped (catch-up.ts); within seven days the next tick runs it once.
    // (an invalid cron used to throw here and take the whole server down at startup)
    for (const s of this.meta.schedules()) {
      if (!s.enabled || s.manual || missedRun(s.nextRunAt, Date.now()) !== 'drop') continue;
      const n = safeNext(s);
      void this.meta.touchSchedule(s.id, n.error ? { lastError: n.error } : { nextRunAt: n.next }).catch(() => {});
    }
  }

  nextRun(s: Schedule) { return computeNext(s); }

  private async tick() {
    const now = Date.now();
    for (const s of this.meta.schedules()) {
      if (!s.enabled || s.manual || this.running.has(s.id)) continue;
      if ((s.nextRunAt ?? 0) > now) continue;
      // asleep for more than a week: drop what was missed (the same rule as at startup; the tick is what sees a wake)
      const missed = missedRun(s.nextRunAt, now);
      if (missed === 'drop') { const d = safeNext(s, now); await this.meta.touchSchedule(s.id, d.error ? { lastError: d.error } : { nextRunAt: d.next }).catch(() => {}); continue; }
      // a cron that can't produce a next time would otherwise fire the prompt on every 30s tick
      const n = safeNext(s, now);
      if (n.error) { if (s.lastError !== n.error) await this.meta.touchSchedule(s.id, { lastError: n.error }).catch(() => {}); continue; }
      if (missed === 'catch-up') this.emit('notice', { text: tr('补跑定时任务「{name}」：电脑睡着或应用关着时错过了', { name: s.name }), notify: true });
      await this.run(s, false, missed === 'catch-up').catch(() => {});
    }
  }

  async run(s: Schedule, manual = false, catchUp = false) {
    this.running.add(s.id);
    const started = Date.now();
    const runId = `${s.id}-${started.toString(36)}`;
    try {
      // before anything is sent: a throw here must not leave a prompt delivered with nextRunAt still in the past
      const next = manual ? s.nextRunAt ?? computeNext(s, started) : computeNext(s, started);
      // each run in its own worktree: only for a new conversation per run (a kept conversation stays where it is)
      const worktree = s.freshSession && s.worktree ? `sched-${s.id.replace(/[^\w-]/g, '').slice(0, 6)}-${runStamp(started)}` : undefined;
      const runner = this.pool.open({ sessionId: s.freshSession ? undefined : s.sessionId, cwd: s.cwd, model: s.model, permissionMode: (s.permissionMode as PermissionMode) ?? 'acceptEdits', worktree });
      for (let i = 0; i < 60 && runner.state === 'starting'; i++) await new Promise((r) => setTimeout(r, 500));
      if (runner.state === 'running' || runner.state === 'waiting') {
        // 立即运行 leaves the schedule as it was (and a manual task has no timer to retry it): only say why
        if (manual) { await this.meta.touchSchedule(s.id, { lastError: tr('对话正忙，这次没有运行') }); return; }
        await this.meta.touchSchedule(s.id, { nextRunAt: Date.now() + 60_000, lastError: tr('对话正忙，1 分钟后重试') });
        return; // busy — try again in a minute
      }
      runner.send(s.prompt);
      await this.meta.touchSchedule(s.id, { lastRunAt: started, nextRunAt: next, sessionId: runner.sessionId, lastError: undefined, runs: (s.runs ?? 0) + 1 });
      runner.once('info', (i) => void this.meta.touchSchedule(s.id, { sessionId: i.sessionId }));
      // wait for the turn to finish (bounded) to log outcome + a short summary
      const outcome = await new Promise<{ ok: boolean; summary?: string; error?: string }>((resolve) => {
        const timeout = setTimeout(() => { off(); resolve({ ok: true, summary: tr('（仍在运行）') }); }, 30 * 60_000);
        const onMsg = (m: any) => {
          if (m?.type === 'result') { clearTimeout(timeout); off(); resolve({ ok: !m.is_error, summary: typeof m.result === 'string' ? m.result.slice(0, 300) : undefined, error: m.is_error ? m.subtype : undefined }); }
        };
        const off = () => runner.off('message', onMsg);
        runner.on('message', onMsg);
      });
      const run: ScheduleRun = { id: runId, scheduleId: s.id, at: started, sessionId: runner.sessionId, ok: outcome.ok, durationMs: Date.now() - started, summary: outcome.summary, error: outcome.error, ...(catchUp ? { catchUp } : {}) };
      await this.meta.addScheduleRun(run);
      if (!outcome.ok) await this.meta.touchSchedule(s.id, { lastError: outcome.error });
    } catch (e: any) {
      await this.meta.addScheduleRun({ id: runId, scheduleId: s.id, at: started, ok: false, durationMs: Date.now() - started, error: e.message });
      await this.meta.touchSchedule(s.id, manual ? { lastError: e.message } : { lastError: e.message, nextRunAt: safeNext(s).next });
      throw e;
    } finally {
      this.running.delete(s.id);
    }
  }
}
