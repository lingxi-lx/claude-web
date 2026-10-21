import { useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import type { MaintenanceKind, MaintenanceTask } from '@shared';
import { useGateway } from './state';
import { FAMILY_LABEL, FAMILY_TASKS, KIND_LABEL, targetFamily } from './tasks-model';
import { tr } from '@/i18n';
import { Select } from '@/ui/Select';

const ALL_KINDS = Object.keys(KIND_LABEL) as MaintenanceKind[];

/** 新建 / 编辑一个定时任务: what to do, to whom, and when. */
export function TaskEditor({ task, onClose, onSaved }: { task?: MaintenanceTask; onClose(): void; onSaved(): void }) {
  const accounts = useGateway((s) => s.accounts);
  const pools = useGateway((s) => s.pools);
  const toast = useStore((s) => s.toast);
  const initialTarget = task?.target.kind === 'group' ? `g:${task.target.groupId}`
    : task?.target.kind === 'account' ? `a:${task.target.accountId}`
    : accounts[0] ? `a:${accounts[0].id}` : pools[0] ? `g:${pools[0].id}` : '';
  const [target, setTarget] = useState(initialTarget);
  const [kind, setKind] = useState<MaintenanceKind>(task?.kind ?? 'checkin');
  const [name, setName] = useState(task?.name ?? '');
  const [mode, setMode] = useState<'cron' | 'every'>(task?.schedule.everyMinutes ? 'every' : 'cron');
  const [cron, setCron] = useState(task?.schedule.cron ?? '0 8 * * *');
  const [every, setEvery] = useState(task?.schedule.everyMinutes ?? 60);
  const [enabled, setEnabled] = useState(task?.enabled ?? true);
  const [busy, setBusy] = useState(false);

  const draftTarget = target.startsWith('g:')
    ? { kind: 'group' as const, groupId: target.slice(2) }
    : { kind: 'account' as const, accountId: target.slice(2) };
  const family = targetFamily({ target: draftTarget }, accounts, pools);
  const kinds = family ? FAMILY_TASKS[family] : ALL_KINDS;
  const effectiveKind = kinds.includes(kind) ? kind : kinds[0] ?? kind;

  const save = async () => {
    if (!target) { toast(tr('先选一个账号或账号池')); return; }
    setBusy(true);
    try {
      await ws.request({
        kind: 'tasks.upsert',
        task: {
          ...(task ? { id: task.id } : {}),
          name,
          kind: effectiveKind,
          target: draftTarget,
          schedule: mode === 'cron' ? { cron: cron.trim() } : { everyMinutes: Number(every) },
          enabled,
        },
      });
      toast(tr('已保存'), true);
      onSaved();
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ width: 560 }}>
        <h3>{task ? tr('编辑任务') : tr('新建任务')}</h3>
        <label className="field"><span>{tr('名称（可留空）')}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('用任务类型作名字')} /></label>
        <label className="field">
          <span>{tr('对谁执行')}</span>
          <Select value={target} onValueChange={(value) => setTarget(String(value))} aria-label={tr('对谁执行')} searchable={accounts.length + pools.length > 8} options={[
            ...accounts.map((a) => ({ value: `a:${a.id}`, label: a.name, description: `${tr('账号')} · ${FAMILY_LABEL[a.kind]}` })),
            ...pools.map((g) => ({ value: `g:${g.id}`, label: g.name, description: `${tr('账号池')} · ${FAMILY_LABEL[g.kind]}` })),
          ]} />
        </label>
        <label className="field">
          <span>{tr('做什么')}</span>
          <Select value={effectiveKind} onValueChange={(value) => setKind(String(value) as MaintenanceKind)} aria-label={tr('做什么')} options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        </label>
        <div className="row">
          <label className="chip"><input type="radio" checked={mode === 'cron'} onChange={() => setMode('cron')} /> {tr('每天定时')}</label>
          <label className="chip"><input type="radio" checked={mode === 'every'} onChange={() => setMode('every')} /> {tr('按间隔')}</label>
        </div>
        {mode === 'cron' ? (
          <label className="field">
            <span>{tr('cron（分 时 日 月 周，本机时间）')}</span>
            <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 8 * * *" />
            <div className="row">
              <button className="btn sm ghost" onClick={() => setCron('0 8 * * *')}>{tr('每天 08:00')}</button>
              <button className="btn sm ghost" onClick={() => setCron('0 20 * * *')}>{tr('每天 20:00')}</button>
              <button className="btn sm ghost" onClick={() => setCron('0 */6 * * *')}>{tr('每 6 小时')}</button>
            </div>
          </label>
        ) : (
          <label className="field">
            <span>{tr('每隔多少分钟（至少 5）')}</span>
            <input type="number" min={5} value={every} onChange={(e) => setEvery(Number(e.target.value) || 5)} />
            <div className="row">
              <button className="btn sm ghost" onClick={() => setEvery(30)}>{tr('30 分钟')}</button>
              <button className="btn sm ghost" onClick={() => setEvery(360)}>{tr('6 小时')}</button>
              <button className="btn sm ghost" onClick={() => setEvery(1440)}>{tr('1 天')}</button>
            </div>
          </label>
        )}
        <label className="chip"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {tr('启用')}</label>
        <div className="row">
          <span className="grow" />
          <button className="btn sm ghost" onClick={onClose} disabled={busy}>{tr('取消')}</button>
          <button className="btn sm" onClick={() => void save()} disabled={busy}>{busy ? tr('保存中…') : tr('保存')}</button>
        </div>
      </div>
    </div>
  );
}
