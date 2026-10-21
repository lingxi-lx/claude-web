// What a backdrop's `data()` gets (backdrop.js API, server/src/themes/ascii-theme.md): the user's projects, from the
// conversation list — 花园 grows one plant per project. Pure; Backdrop.tsx sends it.
import type { SessionSummary } from '@shared';

export interface BackdropProject {
  /** the folder's name */
  name: string;
  /** conversations in it */
  count: number;
  /** 0..1 against the busiest project (log scale, so one huge project does not flatten the rest) */
  size: number;
  /** used in the last day */
  recent: boolean;
  /** a conversation in it is running now */
  live: boolean;
}
export interface BackdropData { projects: BackdropProject[] }

const DAY = 24 * 60 * 60 * 1000;
const base = (cwd: string) => cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd;

export function backdropData(sessions: readonly SessionSummary[], now: number, max = 24): BackdropData {
  const by = new Map<string, { name: string; count: number; last: number; live: boolean }>();
  for (const s of sessions) {
    if (!s.cwd) continue;
    const key = s.cwd.toLowerCase();
    const p = by.get(key) ?? { name: base(s.cwd), count: 0, last: 0, live: false };
    p.count++;
    p.last = Math.max(p.last, s.lastModified || 0);
    p.live ||= s.live === 'running' || s.live === 'waiting';
    by.set(key, p);
  }
  const list = [...by.values()].sort((a, b) => b.last - a.last).slice(0, max);
  const top = Math.max(1, ...list.map((p) => p.count));
  return {
    projects: list.map((p) => ({ name: p.name, count: p.count, size: Math.log1p(p.count) / Math.log1p(top), recent: now - p.last < DAY, live: p.live })),
  };
}
