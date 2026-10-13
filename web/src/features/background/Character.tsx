// 后台's cast (spec 2026-10-12 §3): a blob in its agent's colour, its accessory by agent type — none for a workflow's
// agents, glasses for Explore, a cap for Plan, a badge with the first letter for any other type — and its state in its
// face: bobbing at work, relaxed (leaning back, a check) when done, an x when it failed, eyes shut and a grey pause
// badge when its task was stopped before it finished. A background command is a
// little machine, not a character. `Character` / `Machine` are SVG groups (base centre at 0, 0) to place in a picture;
// the `…Icon` versions are inline SVGs for cards and lists.
import type { CSSProperties } from 'react';
import type { BgAgent, BgAgentState, BgTask } from '@shared';
import { clsx } from '@/util';
import { agentColor, agentStateText, tokensText } from './model';

/** The blob: 22 wide, 18 tall, its base centre at (0, 0). */
const BODY = 'M-11,0 q0,-18 11,-18 q11,0 11,18 z';
/** Characters at work bob out of step with each other: a delay into the 1.8 s cycle by colour. */
const bobDelay = (color: number) => `${-((color * 0.53) % 1.8).toFixed(2)}s`;

export interface CharacterProps {
  /** The agent's colour number (`BgAgent.color`, 1…10). */
  color: number;
  /** `subagent_type`: undefined (a workflow's agent) → nothing, Explore → glasses, Plan → a cap, else a letter badge. */
  type?: string;
  state: BgAgentState;
  /** A scale: 1 draws the blob 22 units wide. */
  size?: number;
  /** No bobbing even at work (a list where many would move at once). */
  still?: boolean;
}

function Eyes({ state }: { state: BgAgentState }) {
  if (state === 'done') return <path className="bg-lids" d="M-6.2,-8.4 q2.2,-2.4 4.4,0 M1.8,-8.4 q2.2,-2.4 4.4,0" />;
  if (state === 'failed' || state === 'stopped') return <path className="bg-lids" d="M-6,-8.6 h4 M2,-8.6 h4" />;
  return (
    <g>
      <circle className="bg-eye" cx={-4} cy={-9} r={2.6} />
      <circle className="bg-eye" cx={4} cy={-9} r={2.6} />
      <circle className="bg-pupil" cx={-3.4} cy={-8.6} r={1.2} />
      <circle className="bg-pupil" cx={4.6} cy={-8.6} r={1.2} />
    </g>
  );
}

function Accessory({ type }: { type?: string }) {
  const t = type?.trim();
  if (!t) return null;
  if (t === 'Explore') {
    return (
      <g className="bg-glasses">
        <circle cx={-4} cy={-9} r={3.7} />
        <circle cx={4} cy={-9} r={3.7} />
        <path d="M-0.4,-9.4 h0.8 M-7.7,-9.6 l-2.4,-1.2 M7.7,-9.6 l2.4,-1.2" />
      </g>
    );
  }
  if (t === 'Plan') {
    return (
      <g className="bg-hat">
        <path d="M-8,-15 q8,-10 16,0 z" />
        <path className="bg-brim" d="M-10.5,-15 h21" />
        <circle cx={0} cy={-20.4} r={1.2} />
      </g>
    );
  }
  return (
    <g className="bg-tag">
      <circle cx={-9} cy={-14.5} r={4.5} />
      <text x={-9} y={-12.4}>{[...t][0].toUpperCase()}</text>
    </g>
  );
}

function Badge({ state }: { state: BgAgentState }) {
  if (state === 'done') {
    return (
      <g className="bg-badge done">
        <circle cx={10} cy={-18.5} r={5} />
        <path d="M7.6,-18.6 l1.7,1.7 l3.1,-3.4" />
      </g>
    );
  }
  if (state === 'failed') {
    return (
      <g className="bg-badge failed">
        <circle cx={10} cy={-18.5} r={5} />
        <path d="M8.2,-20.3 l3.6,3.6 M11.8,-20.3 l-3.6,3.6" />
      </g>
    );
  }
  if (state === 'stopped') {
    return (
      <g className="bg-badge stopped">
        <circle cx={10} cy={-18.5} r={5} />
        <path d="M8.6,-20.6 v4.2 M11.4,-20.6 v4.2" />
      </g>
    );
  }
  return null;
}

export function Character({ color, type, state, size = 1, still }: CharacterProps) {
  const bob = state === 'running' && !still;
  return (
    <g className={clsx('bg-fig', `is-${state}`)} style={{ '--c': agentColor(color) } as CSSProperties} transform={size !== 1 ? `scale(${size})` : undefined}>
      <ellipse className="bg-shadow" cx={0} cy={1} rx={11} ry={4} />
      <g className={bob ? 'bg-bob' : undefined} style={bob ? { animationDelay: bobDelay(color) } : undefined}>
        <g transform={state === 'done' ? 'rotate(-7)' : undefined}>
          <path className="bg-body" d={BODY} />
          <Eyes state={state} />
          <Accessory type={type} />
        </g>
        <Badge state={state} />
      </g>
    </g>
  );
}

/** A character as an inline icon, `size` CSS px square. */
export function CharacterIcon({ size = 22, className, ...p }: CharacterProps & { className?: string }) {
  return (
    <svg className={clsx('bg-icon', className)} width={size} height={size} viewBox="-15.5 -25 31 31" aria-hidden focusable="false">
      <Character {...p} size={1} />
    </svg>
  );
}

/** A background command: a little machine with a terminal, its light on while the command runs. Base centre at (0, 0). */
export function Machine({ running, size = 1 }: { running: boolean; size?: number }) {
  return (
    <g className={clsx('bg-machine', running && 'on')} transform={size !== 1 ? `scale(${size})` : undefined}>
      <ellipse className="bg-shadow" cx={0} cy={1} rx={11} ry={3.6} />
      <rect className="bg-machine-body" x={-1} y={-23} width={2} height={5} />
      <circle className="bg-machine-led" cx={0} cy={-23.6} r={1.7} />
      <rect className="bg-machine-body" x={-10} y={-19} width={20} height={19} rx={4} />
      <rect className="bg-machine-term" x={-7} y={-15.5} width={14} height={8.5} rx={1.5} />
      <path className="bg-machine-ink" d="M-5,-13.6 l2,1.7 l-2,1.7" />
      <path className="bg-machine-ink bg-cursor" d="M-1.4,-10.1 h3.4" />
      <path className="bg-machine-vent" d="M-5.5,-4 h11" />
    </g>
  );
}

export function MachineIcon({ running, size = 22, className }: { running: boolean; size?: number; className?: string }) {
  return (
    <svg className={clsx('bg-icon', className)} width={size} height={size} viewBox="-13.5 -27 27 29" aria-hidden focusable="false">
      <Machine running={running} />
    </svg>
  );
}

/** The line under a character's name: its phase, else what kind of agent it is, else its workflow. */
export function phaseLine(t: BgTask, a: BgAgent): string {
  if (a.phaseTitle) return a.phaseTitle;
  if (t.kind === 'agent') return a.agentType ? `子代理 · ${a.agentType}` : '子代理';
  return t.name || t.description || '';
}

/** What a character's tooltip says: who, where, how it is doing, on which model, its last step, its tokens. */
export function agentTip(t: BgTask, a: BgAgent): string {
  return [
    a.label,
    phaseLine(t, a),
    agentStateText(a),
    a.model,
    a.error || a.lastSummary || a.lastTool,
    a.tokens ? `${tokensText(a.tokens)} token` : '',
  ].filter(Boolean).join('\n');
}
