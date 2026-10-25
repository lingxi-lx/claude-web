// 总览's lanes (spec 2026-10-16 pages §1; the official app's Overview: ready for review / waiting on you / working /
// landing / idle / resolved). Pure: MissionPanel feeds it what the window knows — the runner state, what waits, the
// PR the conversation's PR bar found (only conversations whose bar has looked have one).
import type { BranchPr, RunnerState } from '@shared';

export type Lane = 'attention' | 'running' | 'review' | 'landing' | 'idle' | 'error';

export function laneOf(i: { state?: RunnerState | 'history'; pending: number; pr?: BranchPr | null }): Lane {
  if (i.pending > 0 || i.state === 'waiting') return 'attention';
  if (i.state === 'error') return 'error';
  if (i.state === 'running' || i.state === 'starting') return 'running';
  const pr = i.pr;
  if (pr && pr.state === 'open' && !pr.draft) return pr.review === 'approved' || pr.autoMerge ? 'landing' : 'review';
  return 'idle';
}

export const RESOLVED_DAYS = 7;

/** 已解决: archived conversations that were active in the last week, newest first. */
export function resolved<T extends { sessionId: string; lastModified: number }>(all: T[], archived: (id: string) => boolean, now = Date.now(), max = 10): T[] {
  const since = now - RESOLVED_DAYS * 24 * 3600_000;
  return all.filter((s) => archived(s.sessionId) && s.lastModified >= since).sort((a, b) => b.lastModified - a.lastModified).slice(0, max);
}

/**
 * Whether a waiting request can be answered from the overview card (允许 / 拒绝). Not one that has to be read to be
 * judged — a question, a plan, which apps to control (操控电脑), which site to change or which script to run (允许的网站,
 * server/src/web/site-gate.ts SITE_TOOL): for those the card opens the conversation, where the whole request is shown.
 */
export function quickAnswer(toolName: string): boolean {
  return !['AskUserQuestion', 'ExitPlanMode', 'browser.site', 'mcp__computer__request_access'].includes(toolName);
}
