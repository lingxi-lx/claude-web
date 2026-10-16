// 任务 chip (spec 2026-10-16 sessions-env §2; the official app's task chips): Claude saw work outside the current task
// (sessions-mcp `suggest_task`); one click starts it in a new conversation beside this one — in its own git worktree
// when the folder is a repository — and this conversation carries on. Started / dismissed is remembered (meta.json).
import { useState } from 'react';
import { parsePeerId } from '@shared';
import type { ToolUseBlock } from '@/model/conversation';
import { useScopedSessionId, useStore } from '@/store';
import { Icon } from '@/ui/icons';
import { tr } from '@/i18n';
import { TERMS } from '@/ui/terms';
import { taskWorktreeName } from './task-chip-model';

const NONE: string[] = [];
const NO_STARTS: Record<string, string> = {};

export function TaskChipBody({ t }: { t: ToolUseBlock }) {
  const sid = useScopedSessionId();
  const cwd = useStore((s) => (sid ? s.open[sid]?.cwd : undefined));
  const repo = useStore((s) => !!(sid && s.sessions.find((x) => x.sessionId === sid)?.gitBranch));
  const dismissed = useStore((s) => (sid ? s.sessionMeta[sid]?.taskDismissed : undefined)) ?? NONE;
  const started = useStore((s) => (sid ? s.sessionMeta[sid]?.taskStarted : undefined)) ?? NO_STARTS;
  const [busy, setBusy] = useState(false);
  const i = (t.input ?? {}) as { title?: string; prompt?: string; worktree?: boolean };
  const title = String(i.title ?? '');
  const prompt = String(i.prompt ?? '');
  if (!title || !prompt) return null;
  const startedId = started[t.id];
  const off = dismissed.includes(t.id);
  const useWorktree = i.worktree !== false && repo;

  const start = async () => {
    if (!sid || !cwd || busy) return;
    setBusy(true);
    const st = useStore.getState();
    try {
      // beside this conversation: a new split, then the conversation opens in it (the focused pane)
      const g = st.layout;
      st.dispatchLayout({ t: 'pane.split', paneId: (g.groups.find((x) => x.id === g.activeGroupId) ?? g.groups[0]).focusedPaneId, dir: 'row' });
      // a conversation on another machine: the task starts there too (its folder is on that disk)
      const peer = parsePeerId(sid)?.peerId;
      const id = await st.openSession({ cwd, peer, worktree: useWorktree ? taskWorktreeName(title, t.id) : undefined });
      await st.send(id, prompt);
      await st.setSessionMeta(sid, { taskStarted: { ...started, [t.id]: id } });
    } catch (e: any) {
      st.toast(String(e?.message ?? e));
    }
    setBusy(false);
  };
  const jump = () => {
    if (!startedId) return;
    const st = useStore.getState();
    if (st.open[startedId]) st.setActive(startedId);
    else void st.loadHistory(startedId);
  };

  return (
    <div className={`task-chip${off ? ' off' : ''}`}>
      <div className="tc-head">
        <Icon name="sparkle" size={13} />
        <span className="tc-t">{title}</span>
        {useWorktree && !startedId && <span className="tc-tag">{TERMS.worktree}</span>}
      </div>
      <div className="tc-p">{prompt.length > 280 ? `${prompt.slice(0, 280)}…` : prompt}</div>
      <div className="tc-acts">
        {startedId ? (
          <button className="btn sm" onClick={jump}><Icon name="arrowRight" size={12} /> {tr('已开始，跳到那个对话')}</button>
        ) : off ? (
          <button className="btn sm ghost" disabled={!sid} onClick={() => sid && void useStore.getState().setSessionMeta(sid, { taskDismissed: dismissed.filter((x) => x !== t.id) })}>{tr('恢复')}</button>
        ) : (
          <>
            <button className="btn sm primary" disabled={!sid || !cwd || busy} onClick={() => void start()}>{busy ? tr('正在开…') : tr('在新对话里做')}</button>
            <button className="btn sm ghost" disabled={!sid} onClick={() => sid && void useStore.getState().setSessionMeta(sid, { taskDismissed: [...dismissed, t.id] })}>{tr('忽略')}</button>
          </>
        )}
      </div>
    </div>
  );
}
