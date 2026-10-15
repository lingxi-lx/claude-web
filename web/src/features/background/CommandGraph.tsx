// 后台's 指挥台 (spec 2026-10-12 §3): the main conversation in the middle, its agents on an orbit around it (two orbits
// when there are many). An agent at work has dots flowing along its edge, a queued one is dim, a finished one has a
// check, a failed one an x; background commands are small squares. `compact` is the right panel's version (300–440 px):
// shorter names, none on the inner orbit.
import type { CSSProperties } from 'react';
import type { BgAgent, BgSession, BgTask } from '@shared';
import { clsx } from '@/util';
import { agentColor, agentStateText, taskStateText } from './model';
import { agentTip } from './Character';
import { clip, pressKeys, textWidth } from './text';
import { tr } from '@/i18n';

type Pick = (agentKey: string, taskId: string) => void;
type State = BgAgent['state'];
interface Node { id: string; task: BgTask; agent?: BgAgent; state: State; x: number; y: number; inner: boolean }

const W = 320;
/** One orbit is enough up to this many; past it the rest go on an inner one. */
const ONE_ORBIT = 12;
/** A command's status as a node: stopped is neither done nor failed, so it is just dim (as a stopped agent is). */
const SHELL_STATE: Record<BgTask['status'], State> = { running: 'running', completed: 'done', failed: 'failed', stopped: 'stopped' };

export function CommandGraph({ session, taskId, compact, onPick }: { session: BgSession; taskId?: string; compact?: boolean; onPick: Pick }) {
  const tasks = taskId ? session.tasks.filter((t) => t.id === taskId) : session.tasks;
  const all: Omit<Node, 'x' | 'y' | 'inner'>[] = [];
  for (const t of tasks) {
    if (t.kind === 'shell') all.push({ id: `shell|${t.id}`, task: t, state: SHELL_STATE[t.status] });
    else for (const a of t.agents) all.push({ id: `${t.id}|${a.key}`, task: t, agent: a, state: a.state });
  }
  // too many to draw: the ones at work first, then the rest in order (shown in their own order)
  const cap = compact ? 16 : 28;
  let shown = all;
  if (all.length > cap) {
    const keep = new Set([...all.filter((n) => n.state === 'running'), ...all.filter((n) => n.state !== 'running')].slice(0, cap).map((n) => n.id));
    shown = all.filter((n) => keep.has(n.id));
  }
  const more = all.length - shown.length;

  const H = compact ? 214 : 244, cx = W / 2, cy = H / 2 + (compact ? 0 : 2);
  const outerN = shown.length <= ONE_ORBIT ? shown.length : Math.min(16, Math.ceil(shown.length * 0.6));
  const orbit = (i: number, n: number, rx: number, ry: number, off: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * (i + off)) / Math.max(1, n);
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  };
  const outer = { rx: 126, ry: compact ? 78 : 90 }, inner = { rx: 72, ry: compact ? 42 : 50 };
  const nodes: Node[] = shown.map((n, i) => (i < outerN
    ? { ...n, inner: false, ...orbit(i, outerN, outer.rx, outer.ry, 0) }
    : { ...n, inner: true, ...orbit(i - outerN, shown.length - outerN, inner.rx, inner.ry, 0.5) }));
  const running = all.filter((n) => n.state === 'running').length;

  return (
    <div className={clsx('bg-graph', compact && 'compact')}>
      <svg className="bg-graph-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={tr('指挥台')}>
        <ellipse className="bg-orbit" cx={cx} cy={cy} rx={outer.rx} ry={outer.ry} />
        {shown.length > outerN && <ellipse className="bg-orbit" cx={cx} cy={cy} rx={inner.rx} ry={inner.ry} />}
        {nodes.map((n) => (
          <line key={`e|${n.id}`} className={clsx('bg-edge', `is-${n.state}`, n.state === 'running' && 'bg-flow')} style={edgeColor(n)} x1={cx} y1={cy} x2={n.x} y2={n.y} />
        ))}
        <g className="bg-hub">
          <rect x={cx - 48} y={cy - 18} width={96} height={36} rx={9} />
          <text className="bg-hub-name" x={cx} y={cy - 2}>{tr('主对话')}</text>
          <text className="bg-hub-sub" x={cx} y={cy + 11}>{running ? tr('{running} 个在跑', { running }) : tr('没有在跑的')}</text>
        </g>
        {nodes.map((n) => <GraphNode key={n.id} n={n} cy={cy} compact={!!compact} onPick={onPick} />)}
        {more > 0 && <text className="bg-graph-more" x={W - 8} y={H - 8}>{tr('还有 {more} 个', { more })}</text>}
      </svg>
    </div>
  );
}

const edgeColor = (n: { agent?: BgAgent }) => ({ '--c': n.agent ? agentColor(n.agent.color) : 'var(--office-machine)' }) as CSSProperties;

function GraphNode({ n, cy, compact, onPick }: { n: Node; cy: number; compact: boolean; onPick: Pick }) {
  const r = (compact ? { running: 7.5, done: 6.5, queued: 6, failed: 6.5, stopped: 6 } : { running: 9, done: 8, queued: 7, failed: 8, stopped: 7 })[n.state];
  const a = n.agent;
  const name = a ? a.label : n.task.description;
  const labelled = !(compact && n.inner);
  const fs = n.inner ? 8.5 : compact ? 9.5 : 10;
  const text = clip(name, n.inner ? 10 : compact ? 9 : 14);
  const half = textWidth(text, fs) / 2 + 2;
  // above the node in the top half, below it in the bottom half; kept inside the picture
  const ly = n.y < cy ? -r - 5 : r + fs + 3;
  const lx = Math.min(Math.max(n.x, half), W - half) - n.x;
  const shape = a ? <circle className="bg-node-dot" r={r} /> : <rect className="bg-node-dot" x={-r} y={-r} width={2 * r} height={2 * r} rx={3} />;
  const k = r * 0.42;
  const body = (
    <>
      {n.state === 'running' && (a ? <circle className="bg-node-glow" r={r + 5} /> : <rect className="bg-node-glow" x={-r - 4} y={-r - 4} width={2 * r + 8} height={2 * r + 8} rx={6} />)}
      {shape}
      {n.state === 'done' && <path className="bg-node-mark" d={`M${-r * 0.45},${r * 0.02} l${r * 0.3},${r * 0.3} l${r * 0.55},${-r * 0.6}`} />}
      {n.state === 'failed' && <path className="bg-node-mark" d={`M${-k},${-k} l${2 * k},${2 * k} M${k},${-k} l${-2 * k},${2 * k}`} />}
      {labelled && <text className="bg-node-label" x={lx} y={ly} fontSize={fs}>{text}</text>}
    </>
  );
  const style = edgeColor(n);
  const at = `translate(${n.x},${n.y})`;
  if (!a) {
    const state = taskStateText(n.task);
    return (
      <g className={clsx('bg-node', 'shell', `is-${n.state}`)} transform={at} style={style} role="img" aria-label={`${name} · ${state}`}>
        <title>{[name, state, n.task.summary || n.task.lastTool].filter(Boolean).join('\n')}</title>
        {body}
      </g>
    );
  }
  const go = () => onPick(a.key, n.task.id);
  return (
    <g className={clsx('bg-node', `is-${n.state}`)} transform={at} style={style} role="button" tabIndex={0} aria-label={`${a.label} · ${agentStateText(a)}`} onClick={go} onKeyDown={pressKeys(go)}>
      <title>{agentTip(n.task, a)}</title>
      <circle className="bg-node-ring" r={r + 4} />
      <circle className="bg-hit" r={Math.max(r + 4, 13)} />
      {body}
    </g>
  );
}
