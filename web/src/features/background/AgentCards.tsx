// 后台's cards (spec 2026-10-12 §3): one per agent — its character and name, its phase, a big state word, a bar, its
// last step — and one per background command. Cards at work glow in their agent's colour. Past `max` cards, the ones
// at work come first and a 「还有 N 个」 card opens the rest.
import { useState, type CSSProperties } from 'react';
import type { BgAgent, BgSession, BgTask } from '@shared';
import { clsx } from '@/util';
import { agentColor, agentStateText, clock, KIND_LABEL, taskStateText, tokensText } from './model';
import { CharacterIcon, MachineIcon, agentTip, phaseLine } from './Character';

type Pick = (agentKey: string, taskId: string) => void;
type Item = { kind: 'agent'; task: BgTask; agent: BgAgent } | { kind: 'shell'; task: BgTask };

const live = (i: Item) => (i.kind === 'agent' ? i.agent.state === 'running' : i.task.status === 'running');
const SHELL_WORD: Record<BgTask['status'], string> = { running: '在跑', completed: '完成', failed: '失败', stopped: '已停止' };

/** How far along the bar is, 0…1: a running agent's time so far against the longest-running agent of its task (never
 *  quite full: full means done), done / failed full, queued empty, stopped where it was when it stopped. */
function progress(a: BgAgent, now: number, longest: number): number {
  if (a.state === 'done' || a.state === 'failed') return 1;
  if (a.state === 'queued' || !a.startedAt) return 0;
  const until = a.state === 'stopped' ? (a.endedAt ?? now) : now;
  return 0.06 + 0.82 * Math.min(1, Math.max(0, until - a.startedAt) / Math.max(1, longest));
}

export function AgentCards({ session, taskId, onPick, max = 15 }: { session: BgSession; taskId?: string; onPick: Pick; max?: number }) {
  const [all, setAll] = useState(false);
  const now = session.updatedAt;
  const tasks = taskId ? session.tasks.filter((t) => t.id === taskId) : session.tasks;
  const items: Item[] = [];
  const longest = new Map<string, number>();
  for (const t of tasks) {
    if (t.kind === 'shell') { items.push({ kind: 'shell', task: t }); continue; }
    for (const a of t.agents) {
      items.push({ kind: 'agent', task: t, agent: a });
      if (a.state === 'running' && a.startedAt) longest.set(t.id, Math.max(longest.get(t.id) ?? 0, now - a.startedAt));
    }
  }
  const folded = !all && items.length > max;
  const shown = folded ? [...items.filter(live), ...items.filter((i) => !live(i))].slice(0, max) : items;

  return (
    <div className="bg-cards">
      {shown.map((i) => (i.kind === 'agent'
        ? <AgentCard key={`${i.task.id}|${i.agent.key}`} task={i.task} agent={i.agent} p={progress(i.agent, now, longest.get(i.task.id) ?? 0)} onPick={onPick} />
        : <ShellCard key={`shell|${i.task.id}`} task={i.task} now={now} />))}
      {folded && <button type="button" className="bg-card bg-card-more" onClick={() => setAll(true)}>还有 {items.length - max} 个</button>}
      {all && items.length > max && <button type="button" className="bg-card bg-card-more" onClick={() => setAll(false)}>收起</button>}
    </div>
  );
}

function AgentCard({ task, agent: a, p, onPick }: { task: BgTask; agent: BgAgent; p: number; onPick: Pick }) {
  const word = agentStateText(a);
  const foot = a.error || a.lastSummary || a.lastTool || a.model || '';
  const meta = [a.tokens ? `${tokensText(a.tokens)} token` : '', a.state !== 'queued' && a.state !== 'running' && a.startedAt && a.endedAt ? clock(a.endedAt - a.startedAt) : ''].filter(Boolean).join(' · ');
  return (
    <button type="button" className={clsx('bg-card', `is-${a.state}`)} style={{ '--c': agentColor(a.color) } as CSSProperties} title={agentTip(task, a)} aria-label={`${a.label} · ${word}`} onClick={() => onPick(a.key, task.id)}>
      <span className="bg-card-head">
        <CharacterIcon color={a.color} type={a.agentType} state={a.state} size={24} />
        <span className="bg-card-name">{a.label}</span>
      </span>
      <span className="bg-card-phase">{phaseLine(task, a)}</span>
      <span className="bg-card-state">{word}</span>
      <span className="bg-bar"><span style={{ transform: `scaleX(${p})` }} /></span>
      <span className="bg-card-foot">
        <span className="tx">{foot}</span>
        {meta && <span className="meta">{meta}</span>}
      </span>
    </button>
  );
}

function ShellCard({ task: t, now }: { task: BgTask; now: number }) {
  const on = t.status === 'running';
  const elapsed = (t.endedAt ?? (on ? now : t.startedAt)) - t.startedAt;
  return (
    <div className={clsx('bg-card', 'shell', `is-${t.status}`)} title={[t.description, taskStateText(t), t.summary].filter(Boolean).join('\n')}>
      <span className="bg-card-head">
        <MachineIcon running={on} size={24} />
        <span className="bg-card-name">{t.description || KIND_LABEL.shell}</span>
      </span>
      <span className="bg-card-phase">{KIND_LABEL.shell}</span>
      <span className="bg-card-state">{SHELL_WORD[t.status]}</span>
      <span className={clsx('bg-bar', on && 'indet')}><span style={{ transform: `scaleX(${on ? 1 : t.status === 'stopped' ? 0 : 1})` }} /></span>
      <span className="bg-card-foot">
        <span className="tx">{t.summary || t.lastTool || t.reason || ''}</span>
        {elapsed > 0 && <span className="meta">{clock(elapsed)}</span>}
      </span>
    </div>
  );
}
