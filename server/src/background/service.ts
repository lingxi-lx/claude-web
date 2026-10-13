// 后台 (spec 2026-10-12-background-office-design.md §2): every conversation's background — workflows and their agents,
// sub-agents, background commands — kept from the SDK stream of the conversation pool, pushed to the windows at most
// once a second per conversation, and what is on disk about it (finished runs, sub-agent transcripts) on request.
import { EventEmitter } from 'node:events';
import { applyBg, createBgState, endRunning, snapshotBg, type BgState } from './registry.js';
import { listRuns, readAgentTranscript, readRun, sessionDirOf } from './disk.js';
import type { BackgroundRequest, BgRunSummary, BgSession, BgTask } from './types.js';

/** A conversation whose background has all ended is kept this long (the page's 「结束了」). */
export const KEEP_ENDED_MS = 24 * 3600_000;
export const MAX_SESSIONS = 50;

export interface BgPool {
  on(e: 'message', f: (sessionId: string, m: unknown) => void): unknown;
  on(e: 'state', f: (sessionId: string, state: string, error?: string) => void): unknown;
}

export class BackgroundService extends EventEmitter {
  private states = new Map<string, BgState>();
  private timers = new Map<string, NodeJS.Timeout>();
  private lastPush = new Map<string, number>();
  private readonly now: () => number;
  private readonly flushMs: number;

  constructor(o: { pool: BgPool; now?: () => number; flushMs?: number }) {
    super();
    this.now = o.now ?? Date.now;
    this.flushMs = o.flushMs ?? 1000;
    o.pool.on('message', (sid, m) => this.observe(sid, m));
    // the CLI process ended or is being replaced (a provider switch, a forced stop): its background went with it
    o.pool.on('state', (sid, state) => {
      if (state !== 'closed' && state !== 'error' && state !== 'starting') return;
      const s = this.states.get(sid);
      if (s && endRunning(s, '进程结束了', this.now())) this.schedule(sid);
    });
  }

  observe(sessionId: string, m: unknown): void {
    const t = (m as any)?.type === 'system' ? (m as any).subtype : undefined;
    if (typeof t !== 'string' || !t.startsWith('task_')) return;
    let s = this.states.get(sessionId);
    const fresh = !s;
    if (!s) s = createBgState(sessionId);
    if (!applyBg(s, m, this.now())) return;
    if (fresh) { this.states.set(sessionId, s); this.trim(); }
    this.schedule(sessionId);
  }

  /** The first change goes out at once; changes after it are gathered for `flushMs`. */
  private schedule(sessionId: string): void {
    if (this.timers.has(sessionId)) return;
    const wait = Math.max(0, (this.lastPush.get(sessionId) ?? 0) + this.flushMs - this.now());
    if (wait === 0) { this.push(sessionId); return; }
    const timer = setTimeout(() => { this.timers.delete(sessionId); this.push(sessionId); }, wait);
    timer.unref?.();
    this.timers.set(sessionId, timer);
  }

  private push(sessionId: string): void {
    const s = this.states.get(sessionId);
    if (!s) return;
    this.lastPush.set(sessionId, this.now());
    this.emit('changed', snapshotBg(s));
  }

  private running = (s: BgState) => s.tasks.some((t) => t.status === 'running');

  /** Ended conversations past KEEP_ENDED_MS go; beyond MAX_SESSIONS the oldest ended ones go first. */
  private trim(): void {
    const now = this.now();
    for (const [id, s] of this.states) if (!this.running(s) && now - s.updatedAt > KEEP_ENDED_MS) this.drop(id);
    if (this.states.size <= MAX_SESSIONS) return;
    const ended = [...this.states.values()].filter((s) => !this.running(s)).sort((a, b) => a.updatedAt - b.updatedAt);
    for (const s of ended.slice(0, this.states.size - MAX_SESSIONS)) this.drop(s.sessionId);
  }

  private drop(id: string): void {
    this.states.delete(id);
    this.lastPush.delete(id);
    const t = this.timers.get(id);
    if (t) { clearTimeout(t); this.timers.delete(id); }
  }

  list(): BgSession[] {
    this.trim();
    return [...this.states.values()].map(snapshotBg);
  }

  /** Whether the conversation has background work running now (the pool keeps such a process, the composer shows the pill). */
  hasRunning(sessionId: string): boolean {
    const s = this.states.get(sessionId);
    return !!s && this.running(s);
  }

  async history(sessionId: string): Promise<BgRunSummary[]> {
    const dir = sessionDirOf(sessionId);
    return dir ? listRuns(dir) : [];
  }

  async run(sessionId: string, runId: string): Promise<BgTask | null> {
    const dir = sessionDirOf(sessionId);
    return dir ? readRun(dir, runId) : null;
  }

  async transcript(sessionId: string, agentId: string): Promise<unknown[]> {
    const dir = sessionDirOf(sessionId);
    return dir ? readAgentTranscript(dir, agentId) : [];
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

const KINDS = new Set<string>(['background.list', 'background.history', 'background.run', 'background.transcript']);

export function isBackgroundRequest(req: { kind: string }): req is BackgroundRequest {
  return KINDS.has(req.kind);
}

export async function handleBackground(s: BackgroundService, req: BackgroundRequest): Promise<unknown> {
  switch (req.kind) {
    case 'background.list': return s.list();
    case 'background.history': return s.history(req.sessionId);
    case 'background.run': return s.run(req.sessionId, req.runId);
    case 'background.transcript': return s.transcript(req.sessionId, req.agentId);
  }
}
