// 后台's office (spec 2026-10-12 §3): a little isometric room. The wall screen is the main conversation; every agent has
// a desk (one row per workflow phase, one 「子代理」 row), its monitor showing its recent tool calls; the queued stand by
// the door and walk to their desk when they start; a line flows from the screen to everyone at work and flashes back
// when one hands in its result; background commands are machines in the back of the aisle. Where things go is
// office-layout.ts; this file only draws. Under 减少动画 nobody walks, bobs or flows (background.css).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { BgAgent, BgSession, BgTask } from '@shared';
import { clsx } from '@/util';
import { agentColor, agentStateText, taskStateText } from './model';
import { Character, Machine, agentTip } from './Character';
import { QUEUE_SPOTS, ROW_FONT, ROW_LABEL_UNITS, clip, layoutOffice, monitorBars, queueSpot, seatOf, textWidth, type DeskSpot, type OfficeLayout, type Pt } from './office-layout';

type Pick = (agentKey: string, taskId: string) => void;

const pts = (p: number[][]) => p.map(([x, y]) => `${x},${y}`).join(' ');
/** The wall screen's edge: a point `f` (0…1) along its lower edge, lifted `up` px. */
const onScreen = (l: OfficeLayout, f: number, up = 0): Pt => ({ x: l.screen.x + f * l.screen.w, y: l.screen.y - (f * l.screen.w) / 2 - up });
/** A character's head, where the lines reach. */
const head = (p: Pt): Pt => ({ x: p.x, y: p.y - 13 });
const curve = (a: Pt, b: Pt) => `M${a.x},${a.y} Q${(a.x + b.x) / 2 - 14},${(a.y + b.y) / 2 + 10} ${b.x},${b.y}`;

/** Enter / Space on a focusable picture element = a click. */
export function pressKeys(go: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  };
}

function Room({ l }: { l: OfficeLayout }) {
  const { top: T, left: L, right: R, bottom: B, wall } = l.room;
  return (
    <g className="bg-room" aria-hidden>
      <polygon className="bg-wall-l" points={pts([[L.x, L.y], [T.x, T.y], [T.x, T.y - wall], [L.x, L.y - wall]])} />
      <polygon className="bg-wall-r" points={pts([[T.x, T.y], [R.x, R.y], [R.x, R.y - wall], [T.x, T.y - wall]])} />
      <polyline className="bg-wall-edge" points={pts([[L.x, L.y - wall], [T.x, T.y - wall], [R.x, R.y - wall]])} />
      <polyline className="bg-wall-edge" points={pts([[T.x, T.y], [T.x, T.y - wall]])} />
      <polygon className="bg-floor" points={pts([[T.x, T.y], [R.x, R.y], [B.x, B.y], [L.x, L.y]])} />
      {l.room.grid.map(([a, b], i) => <line key={i} className="bg-grid" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />)}
    </g>
  );
}

/** A zig-zag across the wall screen: still when nothing runs, a sweeping pulse while something does. */
const PULSE = [0, -2, 3, -9, 6, -3, 0, -1, 2, -12, 5, -4, 1, 0];
function WallScreen({ l, busy }: { l: OfficeLayout; busy: boolean }) {
  const s = l.screen;
  const line = PULSE.map((d, i) => { const p = onScreen(l, 0.08 + (0.84 * i) / (PULSE.length - 1), 13); return [p.x, p.y + (busy ? d : 0)]; });
  return (
    <g className={clsx('bg-wallscreen', busy && 'on')}>
      <polygon className="bg-wallscreen-face" points={pts([[s.x, s.y], [s.x + s.w, s.y - s.w / 2], [s.x + s.w, s.y - s.w / 2 - s.h], [s.x, s.y - s.h]])} />
      <text className="bg-wallscreen-label" transform={`translate(${s.x + 12},${s.y - s.h + 11}) skewY(-26.565)`}>主对话</text>
      <polyline className="bg-beat-base" points={pts(line)} />
      {busy && <polyline className="bg-beat" pathLength={100} points={pts(line)} />}
    </g>
  );
}

function Door({ l }: { l: OfficeLayout }) {
  const d = l.door;
  return (
    <g className="bg-doorway" aria-hidden>
      <polygon className="bg-door" points={pts([[d.x - 28, d.y - 14], [d.x + 28, d.y + 14], [d.x + 28, d.y - 40], [d.x - 28, d.y - 68]])} />
      <polygon className="bg-door-mat" points={pts([[d.x - 22, d.y - 11], [d.x + 22, d.y + 11], [d.x + 4, d.y + 20], [d.x - 40, d.y - 2]])} />
      <text className="bg-door-label" transform={`translate(${d.x - 24},${d.y - 72}) skewY(26.565)`}>门口</text>
    </g>
  );
}

function Desk({ d, agent, now }: { d: DeskSpot; agent?: BgAgent; now: number }) {
  const on = agent?.state === 'running';
  const bars = agent?.state === 'running' ? monitorBars(agent.beats, now) : [];
  return (
    <g className={clsx('bg-desk', 'bg-place', on && 'on')} style={{ transform: `translate(${d.x}px, ${d.y}px)`, ...(agent ? { '--c': agentColor(agent.color) } : {}) } as CSSProperties} aria-hidden>
      <polygon className="bg-desk-l" points="0,0 24,12 24,26 0,14" />
      <polygon className="bg-desk-r" points="24,12 64,-8 64,6 24,26" />
      <polygon className="bg-desk-t" points="0,0 40,-20 64,-8 24,12" />
      <polygon className="bg-mon" points="6,-3 34,-17 34,-35 6,-21" />
      {bars.map((h, j) => {
        const f = (j + 0.5) / bars.length, x = 8 + 22 * f, y = -5.2 - 11 * f, hh = 1.6 + 10.5 * h;
        return <polygon key={j} className="bg-mon-bar" points={pts([[x, y], [x + 2.6, y - 1.3], [x + 2.6, y - 1.3 - hh], [x, y - hh]])} />;
      })}
    </g>
  );
}

function Sign({ x, y, more }: { x: number; y: number; more: number }) {
  const text = `还有 ${more} 个`;
  const w = Math.ceil(textWidth(text, 11)) + 14;
  return (
    <g className="bg-sign" transform={`translate(${x},${y})`}>
      <path className="bg-sign-post" d="M0,0 v-14" />
      <rect className="bg-sign-board" x={-w / 2} y={-31} width={w} height={18} rx={5} />
      <text className="bg-sign-text" x={0} y={-18.5}>{text}</text>
    </g>
  );
}

const SHELL_STATE: Record<BgTask['status'], string> = { running: '在跑', completed: '完成', failed: '失败', stopped: '已停止' };

export function Office({ session, taskId, onPick }: { session: BgSession; taskId?: string; onPick: Pick }) {
  const tasks = useMemo(() => (taskId ? session.tasks.filter((t) => t.id === taskId) : session.tasks), [session.tasks, taskId]);
  const l = useMemo(() => layoutOffice(tasks), [tasks]);
  const now = session.updatedAt;

  const find = useMemo(() => {
    const m = new Map<string, { task: BgTask; agent?: BgAgent }>();
    for (const t of tasks) {
      m.set(`${t.id}|`, { task: t });
      for (const a of t.agents) m.set(`${t.id}|${a.key}`, { task: t, agent: a });
    }
    return (d: DeskSpot) => m.get(d.kind === 'shell' ? `${d.taskId}|` : `${d.taskId}|${d.key}`);
  }, [tasks]);

  // everyone in desk order (a stable order: a character that changes state keeps its place in the picture, so its
  // walk is a transition and not a re-mount); the queued stand at the door, nearest spots first
  const people = useMemo(() => {
    let queued = 0;
    const out: { id: string; task: BgTask; agent: BgAgent; at: Pt | null; seat: Pt; queued: boolean }[] = [];
    for (const d of l.desks) {
      if (d.kind !== 'agent') continue;
      const e = find(d);
      if (!e?.agent) continue;
      const seat = seatOf(d);
      if (e.agent.state === 'queued') { const i = queued++; out.push({ id: `${d.taskId}|${d.key}`, task: e.task, agent: e.agent, seat, at: i < QUEUE_SPOTS ? queueSpot(l, i) : null, queued: true }); }
      else out.push({ id: `${d.taskId}|${d.key}`, task: e.task, agent: e.agent, seat, at: seat, queued: false });
    }
    return { list: out, extra: Math.max(0, queued - QUEUE_SPOTS) };
  }, [l, find]);

  const busy = tasks.some((t) => t.status === 'running');
  const working = people.list.filter((p) => p.agent.state === 'running').sort((a, b) => a.seat.x - b.seat.x);

  // a line flashes back to the screen when an agent hands in its result while we watch
  const prev = useRef<Map<string, string> | null>(null);
  const [flashes, setFlashes] = useState<{ id: string; n: number; from: Pt; color: number }[]>([]);
  const stateSig = people.list.map((p) => `${p.id}:${p.agent.state}`).join(',');
  useEffect(() => {
    const cur = new Map(people.list.map((p) => [p.id, p.agent.state]));
    const before = prev.current;
    prev.current = cur;
    if (!before) return;
    const fresh = people.list.filter((p) => p.agent.state === 'done' && before.get(p.id) === 'running');
    if (fresh.length) setFlashes((f) => [...f, ...fresh.map((p, i) => ({ id: p.id, n: Date.now() + i, from: head(p.seat), color: p.agent.color }))].slice(-12));
  }, [stateSig]); // the people behind the signature are the ones this render saw

  const door = queueSpot(l, QUEUE_SPOTS - 1);
  return (
    <div className="bg-office">
      <svg className="bg-office-svg" viewBox={`0 0 ${l.width} ${l.height}`} role="group" aria-label="办公室">
        <Room l={l} />
        <WallScreen l={l} busy={busy} />
        <Door l={l} />
        {l.rows.map((r, i) => (
          <text key={i} className="bg-row-label" x={r.x} y={r.y} fontSize={ROW_FONT}>
            <title>{r.label}</title>
            {clip(r.label, ROW_LABEL_UNITS)}
          </text>
        ))}
        {l.desks.map((d) => {
          const e = find(d);
          if (d.kind === 'agent') return <Desk key={`${d.taskId}|${d.key}`} d={d} agent={e?.agent} now={now} />;
          if (!e) return null;
          const state = SHELL_STATE[e.task.status];
          return (
            <g key={`shell|${d.taskId}`} className="bg-spot bg-place" style={{ transform: `translate(${d.x}px, ${d.y}px)` }} role="img" aria-label={`${e.task.description} · ${state}`}>
              <title>{[e.task.description, taskStateText(e.task), e.task.summary || e.task.lastTool].filter(Boolean).join('\n')}</title>
              <Machine running={e.task.status === 'running'} />
            </g>
          );
        })}
        {l.overflow.map((o) => <Sign key={`more|${o.row}`} x={o.x} y={o.y} more={o.more} />)}

        <g className="bg-lines" aria-hidden>
          {working.map((p, i) => (
            <path key={p.id} className="bg-flow" style={{ '--c': agentColor(p.agent.color) } as CSSProperties} d={curve(onScreen(l, 0.15 + (0.7 * (i + 1)) / (working.length + 1)), head(p.seat))} />
          ))}
          {flashes.map((f) => (
            <path key={`${f.id}|${f.n}`} className="bg-flash" pathLength={100} style={{ '--c': agentColor(f.color) } as CSSProperties} d={curve(onScreen(l, 0.5), f.from)} />
          ))}
        </g>

        {people.list.map((p) => {
          if (!p.at) return null;
          const a = p.agent;
          const label = `${a.label} · ${agentStateText(a)}`;
          return (
            <g key={p.id} className="bg-walk" style={{ transform: `translate(${p.at.x}px, ${p.at.y}px)` }}>
              <g className={clsx('bg-char', `is-${a.state}`)} style={{ '--c': agentColor(a.color) } as CSSProperties} role="button" tabIndex={0} aria-label={label} onClick={() => onPick(a.key, p.task.id)} onKeyDown={pressKeys(() => onPick(a.key, p.task.id))}>
                <title>{agentTip(p.task, a)}</title>
                <rect className="bg-hit" x={-17} y={-28} width={34} height={p.queued ? 34 : 46} />
                <ellipse className="bg-ring" cx={0} cy={-8} rx={17} ry={16} />
                <Character color={a.color} type={a.agentType} state={a.state} />
                {!p.queued && <text className="bg-char-name" y={15}>{clip(a.label, 14)}</text>}
              </g>
            </g>
          );
        })}
        {people.extra > 0 && <text className="bg-queue-more" x={door.x + 18} y={door.y + 16}>+{people.extra}</text>}
      </svg>
    </div>
  );
}
