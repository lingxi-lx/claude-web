import { useEffect, useMemo, useState } from 'react';
import type { BgSession } from '@shared';
import { clsx } from '@/util';
import { LazyNodeGraph } from '@/ui/node-graph';
import { backgroundGraph } from './graph-data';
import { tr } from '@/i18n';
// spec 2026-10-24 D2: the 指挥台 as a node graph — main conversation → workflows → phases → agents, sub-agents and
// background commands. Same props as the old radial SVG, so both callers (the 后台 page, the right panel) stay untouched.
// Only agent cards open something (the agent's conversation); the picture's data is in graph-data.ts.

export function CommandGraph({ session, taskId, compact, onPick }: { session: BgSession; taskId?: string; compact?: boolean; onPick: (agentKey: string, taskId: string) => void }) {
  const live = !compact && session.tasks.some((t) => t.status === 'running');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!live) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [live]);
  const { graph, more, picks } = useMemo(() => backgroundGraph(session, { taskId, compact, now }), [session, taskId, compact, now]);
  return (
    <div className={clsx('bg-graph', compact && 'compact')}>
      <LazyNodeGraph graph={graph} ariaLabel={tr('指挥台')} height={compact ? 240 : 380} cardW={compact ? 150 : 200} compact={compact} entrance
        canSelect={(id) => !!picks[id]} onSelect={(id) => { const p = picks[id]; if (p) onPick(p.agentKey, p.taskId); }} />
      {more > 0 && <div className="bg-graph-more">{tr('还有 {more} 个', { more })}</div>}
    </div>
  );
}
