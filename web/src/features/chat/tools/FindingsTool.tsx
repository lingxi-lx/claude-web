// 代码审查卡 (spec 2026-10-16 review-pr §2): `/code-review`'s findings (the ReportFindings tool), grouped by file, each
// with 修这一条 / 忽略, and 修复还开着的 at the bottom. Dismissing is remembered per conversation (meta.json).
import { useState } from 'react';
import type { ToolUseBlock } from '@/model/conversation';
import { useScopedSessionId, useStore } from '@/store';
import { clsx } from '@/util';
import { Icon } from '@/ui/icons';
import { tr } from '@/i18n';
import { FileLink } from './FileTools';
import { dismissKey, fixMessage, groupFindings, openFindings, readFindings, type Finding } from './findings';

const NONE: string[] = [];

const OUTCOME: Record<NonNullable<Finding['outcome']>, () => string> = {
  fixed: () => tr('已修'),
  skipped: () => tr('跳过了'),
  no_change_needed: () => tr('不用改'),
};

export function FindingsBody({ t }: { t: ToolUseBlock }) {
  const sid = useScopedSessionId();
  const cwd = useStore((s) => (sid ? s.open[sid]?.cwd : undefined));
  const dismissed = useStore((s) => (sid ? s.sessionMeta[sid]?.reviewDismissed : undefined)) ?? NONE;
  const [why, setWhy] = useState<Record<number, boolean>>({});
  const items = readFindings(t.input);
  const open = openFindings(items, t.id, dismissed);
  const send = (fs: Finding[]) => {
    if (!sid || !fs.length) return;
    useStore.getState().send(sid, fixMessage(fs)).catch((e) => useStore.getState().toast(String(e?.message ?? e)));
  };
  const dismiss = (i: number, on: boolean) => {
    if (!sid) return;
    const k = dismissKey(t.id, i);
    const next = on ? [...dismissed, k] : dismissed.filter((x) => x !== k);
    void useStore.getState().setSessionMeta(sid, { reviewDismissed: next });
  };
  const abs = (file: string) => (cwd && !/^([a-zA-Z]:[\\/]|\/)/.test(file) ? `${cwd.replace(/[\\/]+$/, '')}/${file}` : file);
  if (t.status !== 'done' && !items.length) return <div className="fd-empty">{tr('审查中…')}</div>;
  if (!items.length) return <div className="fd-empty"><Icon name="checkCircle" size={14} /> {tr('没发现问题')}</div>;
  return (
    <div className="findings">
      {groupFindings(items).map((g) => (
        <div key={g.file} className="fd-file">
          <div className="fd-path"><FileLink path={abs(g.file)}>{g.file}</FileLink></div>
          {g.items.map(({ f, i }) => {
            const off = dismissed.includes(dismissKey(t.id, i));
            return (
              <div key={i} className={clsx('fd-item', (off || f.outcome) && 'done')} data-finding={i}>
                <div className="fd-row">
                  {f.line ? <FileLink path={abs(f.file)} line={f.line}><span className="fd-line">:{f.line}</span></FileLink> : <span className="fd-line" />}
                  <span className="fd-sum">{f.summary}</span>
                  {f.category && <span className="fd-tag">{f.category}</span>}
                  {f.verdict === 'PLAUSIBLE' && <span className="fd-tag soft" title={tr('核对时没能完全确认')}>{tr('可能')}</span>}
                  {f.outcome && <span className={clsx('fd-tag', f.outcome === 'fixed' && 'ok')}>{OUTCOME[f.outcome]()}</span>}
                </div>
                {f.failure_scenario && (
                  <button className="fd-why" aria-expanded={!!why[i]} onClick={() => setWhy((w) => ({ ...w, [i]: !w[i] }))}>
                    <Icon name="chevronRight" size={11} className="chev" /> {tr('怎么会出错')}
                  </button>
                )}
                {why[i] && f.failure_scenario && <div className="fd-scn">{f.failure_scenario}</div>}
                {!f.outcome && (
                  <div className="fd-acts">
                    {!off && <button className="btn sm" disabled={!sid} onClick={() => send([f])}>{tr('修这一条')}</button>}
                    <button className="btn sm ghost" disabled={!sid} onClick={() => dismiss(i, !off)}>{off ? tr('恢复') : tr('忽略')}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {open.length > 0 && (
        <div className="fd-foot">
          <button className="btn sm primary" disabled={!sid} onClick={() => send(open.map((x) => x.f))}>{tr('修复还开着的（{n}）', { n: open.length })}</button>
        </div>
      )}
    </div>
  );
}
