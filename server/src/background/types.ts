// 后台 (spec docs/superpowers/specs/2026-10-12-background-office-design.md): what a conversation has running besides
// its turn — workflows and their agents, sub-agents, background commands — as the server keeps it for every window.
// Shared with the web through protocol.ts.

/** What a task is: a workflow (`local_workflow`), one sub-agent (`local_agent`), a background command (`local_bash`), anything else. */
export type BgKind = 'workflow' | 'agent' | 'shell' | 'other';
export type BgStatus = 'running' | 'completed' | 'failed' | 'stopped';
/** A workflow agent's `start` before it has an agent id is queued; `progress` is running. */
export type BgAgentState = 'queued' | 'running' | 'done' | 'failed';

/** One character in the office: a workflow's agent, or the agent a `local_agent` task is. */
export interface BgAgent {
  /** Stable within its task: `w<index>` for a workflow agent, the task id for a sub-agent task. */
  key: string;
  /** 1…10, in the order the conversation's agents first appeared: `--agent-<n>`. */
  color: number;
  label: string;
  /** The workflow phase it belongs to (`phaseIndex`), if any. */
  phase?: number;
  phaseTitle?: string;
  /** Names its transcript (`subagents/…/agent-<id>.jsonl`). */
  agentId?: string;
  /** `subagent_type` (Explore, Plan, general-purpose…): the character's accessory. Workflow agents have none. */
  agentType?: string;
  model?: string;
  state: BgAgentState;
  queuedAt?: number;
  startedAt?: number;
  endedAt?: number;
  tokens?: number;
  toolCalls?: number;
  lastTool?: string;
  /** What it is doing / did last, in a line (`lastToolSummary`, or a sub-agent's progress summary). */
  lastSummary?: string;
  /** A resumed workflow reused this agent's earlier result. */
  cached?: boolean;
  error?: string;
  attempt?: number;
  /** When its tool calls went up (ms, the latest 24): the desk monitor's activity. */
  beats: number[];
}

export interface BgPhase { index: number; title: string }

export interface BgTask {
  id: string;
  toolUseId?: string;
  kind: BgKind;
  /** The SDK's raw `task_type`. */
  type?: string;
  description: string;
  /** A workflow's `meta.name`. */
  name?: string;
  status: BgStatus;
  /** Registered in the background (the turn did not wait for it). */
  backgrounded?: boolean;
  startedAt: number;
  endedAt?: number;
  summary?: string;
  lastTool?: string;
  tokens?: number;
  toolUses?: number;
  /** A workflow's phases, in order. */
  phases?: BgPhase[];
  /** A workflow: its agents; a sub-agent task: the one agent; a command: none. */
  agents: BgAgent[];
  /** Why it ended when it was not by itself (「进程结束了」). */
  reason?: string;
  /** A workflow's run id (`wf_…`), when known (a finished run read from disk). */
  runId?: string;
}

export interface BgEvent {
  at: number;
  taskId: string;
  /** The agent's `key`, when the event is one agent's. */
  agent?: string;
  who: string;
  color?: number;
  text: string;
  tone: 'start' | 'tool' | 'done' | 'error' | 'stop';
}

/** One conversation's background, as pushed to the windows (`events`: the latest 50, oldest first). */
export interface BgSession { sessionId: string; updatedAt: number; tasks: BgTask[]; events: BgEvent[] }

/** A finished workflow run found on disk (`<conversation>/workflows/<runId>.json`). */
export interface BgRunSummary { runId: string; name: string; status: string; startedAt: number; durationMs?: number; agentCount: number; tokens?: number; taskId?: string }

export type BackgroundRequest =
  | { kind: 'background.list' }
  | { kind: 'background.history'; sessionId: string }
  | { kind: 'background.run'; sessionId: string; runId: string }
  | { kind: 'background.transcript'; sessionId: string; agentId: string };

export type BackgroundEvent = { kind: 'background.changed'; session: BgSession };
