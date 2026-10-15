import { useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { basename } from '@/util';
import { Icon } from '@/ui/icons';
import { dlg } from '@/ui/dialog';
import { EmptyState } from '@/ui/EmptyState';
import { EMPTY } from '@/ui/terms';
import type { OrchOrphan } from '@shared';
import { tr } from '@/i18n';

/**
 * 遗留的独立副本: worktree directories left under <dataDir>/worktrees after their run record was deleted. Listed on
 * demand; deleting one goes through the same check as everything else (clean + git link intact) and
 * keeps its branch.
 */
export function Orphans() {
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<OrchOrphan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); try { setList(await ws.request<OrchOrphan[]>({ kind: 'orchestra.orphans.list' })); } catch (e: any) { toast(e.message); } finally { setBusy(false); } };
  const remove = async (o: OrchOrphan) => {
    if (!(await dlg.confirm(tr('删除这个遗留的独立副本？'), { message: tr("{path}\n\n只有 git 能确认里面没有未提交改动时才会删除；分支 {branch} 保留。", { path: o.path, branch: o.branch ?? tr('（无）') }), danger: true, okLabel: tr('删除') }))) return;
    setBusy(true);
    try { await ws.request({ kind: 'orchestra.orphans.remove', path: o.path }); toast(tr('已删除'), true); await load(); } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="orch-orphans">
      <div className="orch-side-h">
        <b>{tr('遗留的独立副本')}</b>
        <span className="grow" />
        <button className="icon-btn xs" title={list ? tr('刷新') : tr('检查')} aria-label={tr('检查遗留的独立副本')} disabled={busy} onClick={() => void load()}><Icon name="refresh" size={12} /></button>
      </div>
      {list === null && <div className="orch-idle sm">{tr('删除运行记录时没清理的独立副本（worktree）会留在数据目录里，点右上角检查。')}</div>}
      {list?.length === 0 && <EmptyState e={EMPTY.orphans} className="orch-empty sm" />}
      {list?.map((o) => (
        <div key={o.path} className="orch-row" title={o.path}>
          <div className="grow">
            <div className="t">{basename(o.path)}</div>
            <div className="s">{o.broken ? tr('git 链接已断（需要手动检查）') : o.dirty ? tr('有未提交的改动') : tr('干净{v}', { v: o.branch ? ` · ${o.branch}` : '' })}</div>
          </div>
          <button className="icon-btn xs" disabled={busy || o.broken || o.dirty} title={o.broken || o.dirty ? tr('不能自动删除') : tr('删除')} aria-label={tr('删除 {basename}', { basename: basename(o.path) })} onClick={() => void remove(o)}><Icon name="trash" size={12} /></button>
        </div>
      ))}
    </div>
  );
}
