import { useScopedSessionId } from '@/store';
import { clsx } from '@/util';
import { Icon } from '@/ui/icons';
import { CharacterIcon } from './Character';
import { agentColor, agentStateText, taskStateText } from './model';
import { openBackground, useBackground } from './state';

/**
 * In a conversation's Workflow card: the workflow's agents as it runs — a chip each, in its colour, by phase — and
 * 打开 to the 后台 page on it. Nothing while 后台 has not heard of this workflow (an old transcript, an older server).
 */
export function WorkflowLive({ toolUseId }: { toolUseId: string }) {
  const sessionId = useScopedSessionId();
  const task = useBackground((s) => (sessionId ? s.sessions[sessionId]?.tasks.find((t) => t.toolUseId === toolUseId) : undefined));
  if (!sessionId || !task) return null;
  const running = task.agents.filter((a) => a.state === 'running').length;
  const done = task.agents.filter((a) => a.state === 'done').length;
  const phases = task.phases?.length ? task.phases : [{ index: 0, title: '' }];
  return (
    <div className={clsx('bg-wf', task.status === 'running' && 'live')} data-task={task.id}>
      <div className="bg-wf-head">
        <span className="t">{task.status === 'running' ? `${running} 个在跑 · ${done}/${task.agents.length} 完成` : `${taskStateText(task)} · ${done}/${task.agents.length} 完成`}</span>
        <span className="grow" />
        <button className="btn sm" onClick={() => openBackground(sessionId, task.id)}><Icon name="office" size={13} />在「后台」里看</button>
      </div>
      {phases.map((p) => {
        const agents = task.agents.filter((a) => (p.index ? a.phase === p.index : true));
        if (!agents.length) return null;
        return (
          <div key={p.index} className="bg-wf-phase">
            {p.title && <div className="bg-wf-ph">{p.title}</div>}
            <div className="bg-wf-chips">
              {agents.map((a) => (
                <span key={a.key} className={clsx('bg-wf-chip', a.state)} style={{ '--c': agentColor(a.color) } as React.CSSProperties} title={`${a.label} · ${agentStateText(a)}${a.lastSummary ? ` · ${a.lastSummary}` : ''}`}>
                  <CharacterIcon color={a.color} type={a.agentType} state={a.state} size={16} />
                  <span className="l">{a.label}</span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
