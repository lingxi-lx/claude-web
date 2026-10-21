import { useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import type { MaintenanceKind, MaintenanceRun, MaintenanceTask, UpstreamKind } from '@shared';
import { useGateway } from './state';
import { TaskEditor } from './TaskEditor';
import { FAMILY_LABEL, kindLabel, scheduleText, targetText } from './tasks-model';
import { tr } from '@/i18n';

const when = (t?: number): string => (t ? new Date(t).toLocaleString() : tr('还没跑过'));

interface Quick { id: string; label: string; families: UpstreamKind[]; taskKind: MaintenanceKind; schedule: MaintenanceTask['schedule'] }
const QUICK: Quick[] = [
  { id: 'wb-checkin', label: tr('每天签到'), families: ['workbuddy'], taskKind: 'checkin', schedule: { cron: '0 8 * * *' } },
  { id: 'gem-keepalive', label: tr('每 6 小时保活'), families: ['gemini'], taskKind: 'keepalive', schedule: { everyMinutes: 360 } },
  // Gemini's sidecar reports no 5-hour / weekly quota windows: a quota task there would never run
  { id: 'quota', label: tr('每天刷新额度'), families: ['claude', 'workbuddy'], taskKind: 'quota-refresh', schedule: { cron: '0 6 * * *' } },
];

/** 任务: periodical account upkeep, run by our scheduler (the sidecars' own timers are off). */
export function TasksTab() {
  const tasks = useGateway((s) => s.tasks);
  const runs = useGateway((s) => s.runs);
  const accounts = useGateway((s) => s.accounts);
  const pools = useGateway((s) => s.pools);
  const toast = useStore((s) => s.toast);
  const [editing, setEditing] = useState<MaintenanceTask | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => useGateway.getState().load().catch(() => {});
  const run = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(id);
    try {
      await fn();
      if (ok) toast(ok, true);
      await reload();
    } catch (e: any) { toast(e.message); } finally { setBusy(null); }
  };
  const accountName = (id?: string) => accounts.find((a) => a.id === id)?.name ?? id ?? '—';
  const addQuick = async (q: Quick) => {
    const targets = accounts
      .filter((a) => q.families.includes(a.kind))
      .filter((a) => !tasks.some((t) => t.kind === q.taskKind && t.target.kind === 'account' && t.target.accountId === a.id));
    if (!targets.length) {
      toast(tr('没有可加的账号，或者这些账号已经有这个任务了'));
      return;
    }
    setBusy(q.id);
    try {
      for (const a of targets) {
        await ws.request({ kind: 'tasks.upsert', task: { kind: q.taskKind, name: q.label, target: { kind: 'account', accountId: a.id }, schedule: q.schedule, enabled: true } });
      }
      toast(tr('已添加 {n} 个任务', { n: targets.length }), true);
      await reload();
    } catch (e: any) { toast(e.message); } finally { setBusy(null); }
  };
  return (
    <div className="gateway-tab">
      <div className="gateway-row">
        <span className="sub">{tr('常用')}</span>
        {QUICK.map((q) => (
          <button key={q.id} className="btn sm ghost" disabled={busy === q.id} onClick={() => void addQuick(q)}>
            {q.label}
            <span className="sub">{q.families.map((f) => FAMILY_LABEL[f]).join(' / ')}</span>
          </button>
        ))}
        <span className="grow" />
        <button className="btn sm" onClick={() => setAdding(true)}>{tr('自定义任务')}</button>
      </div>
      {tasks.length === 0 && <div className="empty">{tr('点上面的「每天签到」或「每 6 小时保活」，一次给所有同类账号加上。')}</div>}
      {tasks.map((t) => (
        <div className="gateway-card" key={t.id} style={{ marginTop: 10 }}>
          <div className="gateway-row">
            <b>{t.name?.trim() || kindLabel(t.kind)}</b>
            <span className="gateway-badge">{kindLabel(t.kind)}</span>
            <span className="sub">{targetText(t, accounts, pools)}</span>
            <span className="grow" />
            <span className="sub">{scheduleText(t)}</span>
            <span className={`gateway-badge ${t.enabled ? 'ok' : ''}`}>{t.enabled ? tr('启用') : tr('停用')}</span>
          </div>
          <div className="gateway-row">
            <span className="sub">{tr('下次：{when}', { when: when(t.nextRunAt) })}</span>
            <span className="sub">{tr('上次：{when}', { when: when(t.lastRunAt) })}</span>
            <span className="grow" />
            <button className="btn sm ghost" disabled={busy === t.id} onClick={() => void run(t.id, () => ws.request({ kind: 'tasks.run', id: t.id }), tr('已执行'))}>{tr('立即执行')}</button>
            <button className="btn sm ghost" onClick={() => void run(t.id, () => ws.request({ kind: 'tasks.upsert', task: { id: t.id, enabled: !t.enabled } }))}>{t.enabled ? tr('停用') : tr('启用')}</button>
            <button className="btn sm ghost" onClick={() => setEditing(t)}>{tr('编辑')}</button>
            <button className="btn sm ghost danger" onClick={async () => {
              if (await dlg.confirm(tr('删除任务「{name}」？', { name: t.name || kindLabel(t.kind) }), { danger: true })) {
                await run(t.id, () => ws.request({ kind: 'tasks.remove', id: t.id }), tr('已删除'));
              }
            }}>{tr('删除')}</button>
          </div>
          {t.lastError && <div className="sub" style={{ color: 'var(--warn)' }}>{t.lastError}</div>}
        </div>
      ))}

      <div className="gateway-row" style={{ marginTop: 18 }}>
        <span className="grow">{tr('最近执行（{n}）', { n: runs.length })}</span>
      </div>
      {runs.length === 0 && <div className="empty">{tr('还没有执行记录。补跑也会记在这里。')}</div>}
      {runs.length > 0 && (
        <div className="gateway-runs">
          {[...runs].reverse().slice(0, 100).map((r: MaintenanceRun) => (
            <div className="gateway-row" key={r.id}>
              <span className={`gateway-badge ${r.ok ? 'ok' : 'bad'}`}>{r.ok ? tr('成功') : tr('失败')}</span>
              <span className="gw-who">
                <span className="l">{(() => { const t = tasks.find((x) => x.id === r.taskId); return t ? kindLabel(t.kind) : tr('已删除的任务'); })()}</span>
                <span className="sub">{accountName(r.accountId)} · {new Date(r.at).toLocaleString()} · {r.durationMs} ms</span>
                {(r.error || r.result) && <span className="sub" title={r.error || r.result}>{String(r.error || r.result).slice(0, 120)}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {(adding || editing) && (
        <TaskEditor
          task={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
}
