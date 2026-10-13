import { useEffect, useMemo, useState } from 'react';
import type { BgAgent, BgTask } from '@shared';
import { ws } from '@/ws/client';
import { applyTranscript, createConversation } from '@/model/conversation';
import { ItemList } from '@/features/chat/ChatView';
import { Icon } from '@/ui/icons';
import { CharacterIcon } from './Character';
import { agentColor, agentStateText, clock, KIND_LABEL, tokensText, unwrapHarnessMessage } from './model';
import { closeAgent, stopTask } from './state';

/** How often a running agent's conversation is read again while it is open. */
const REFRESH_MS = 3000;

/**
 * One agent's own conversation at the side of the 后台 page: what it read, ran and changed — the transcript the CLI
 * keeps for it (background.transcript), read again every few seconds while it runs.
 */
export function AgentDrawer({ sessionId, task, agent }: { sessionId: string; task: BgTask; agent: BgAgent }) {
  const [msgs, setMsgs] = useState<unknown[] | null>(null);
  const [err, setErr] = useState('');
  const id = agent.agentId;
  const running = agent.state === 'running';
  useEffect(() => {
    setMsgs(null); setErr('');
    if (!id) return;
    let live = true;
    const read = () => ws.request<unknown[]>({ kind: 'background.transcript', sessionId, agentId: id })
      .then((m) => { if (live) setMsgs(m ?? []); })
      .catch((e: any) => { if (live) setErr(String(e?.message ?? e)); });
    void read();
    const t = running ? setInterval(read, REFRESH_MS) : undefined;
    return () => { live = false; if (t) clearInterval(t); };
  }, [sessionId, id, running]);
  const conv = useMemo(() => {
    if (!msgs) return null;
    const c = createConversation();
    applyTranscript(c, (msgs as any[]).map(unwrapHarnessMessage), { live: running });
    return c;
  }, [msgs, running]);
  const facts = [
    agent.phaseTitle && `阶段 ${agent.phase ?? ''} · ${agent.phaseTitle}`.replace('  ', ' '),
    agent.model,
    agent.tokens ? `${tokensText(agent.tokens)} tok` : '',
    agent.toolCalls ? `${agent.toolCalls} 次工具调用` : '',
    agent.startedAt ? clock((agent.endedAt ?? Date.now()) - agent.startedAt) : '',
  ].filter(Boolean);
  return (
    <aside className="bg-drawer" aria-label={`${agent.label} 的对话`} style={{ '--c': agentColor(agent.color) } as React.CSSProperties}>
      <div className="bg-drawer-head">
        <CharacterIcon color={agent.color} type={agent.agentType} state={agent.state} size={28} />
        <div className="bg-drawer-title">
          <div className="n">{agent.label}</div>
          <div className="sub">{KIND_LABEL[task.kind]} · {agentStateText(agent)}{facts.length ? ` · ${facts.join(' · ')}` : ''}</div>
        </div>
        {task.status === 'running' && (task.kind === 'agent' || task.kind === 'workflow') && (
          <button className="btn sm" onClick={() => stopTask(sessionId, task.id)} title={task.kind === 'workflow' ? '工作流里的子代理只能和整个工作流一起停' : '停止这个子代理'}>
            <Icon name="stop" size={12} />{task.kind === 'workflow' ? '停止整个工作流' : '停止'}
          </button>
        )}
        <button className="icon-btn" aria-label="关闭" title="关闭 (Esc)" onClick={closeAgent}><Icon name="close" size={14} /></button>
      </div>
      {agent.error && <div className="bg-drawer-err">{agent.error}</div>}
      <div className="bg-drawer-body">
        {!id ? <div className="bg-idle">它还在排队，开始之后这里会是它的对话。</div>
          : err ? <div className="bg-drawer-err">读不到它的对话：{err}</div>
            : !conv ? <div className="bg-idle">读取中…</div>
              : conv.items.length === 0 ? <div className="bg-idle">它还没说话。</div>
                : <ItemList items={conv.items} version={msgs?.length ?? 0} actions="none" />}
      </div>
    </aside>
  );
}
