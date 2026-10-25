import { useEffect, useMemo, useState } from 'react';
import type { NodeRun, OrchNode } from '@shared';
import { LazyNodeGraph } from '@/ui/node-graph';
import { layoutNodes } from '@/ui/node-graph/layout';
import { ORCH_CARD_W, orchestraGraph } from './orch-graph';
import { tr } from '@/i18n';
export { KIND_ICON, STATE_L } from './orch-graph';

/**
 * Execution graph (spec 2026-10-24 D3): the run view and the editor preview share the node graph; columns are the
 * same topological layers as before. `runs` gives cards their state (the running step glows, the edge into it is
 * strong, a failed one red); without it the graph is a plain preview.
 */
export function Graph({ nodes, runs, selected, onSelect }: { nodes: OrchNode[]; runs?: Record<string, NodeRun>; selected?: string | null; onSelect?: (id: string) => void }) {
  const live = !!runs && Object.values(runs).some((r) => r.state === 'running');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!live) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [live]);
  const graph = useMemo(() => orchestraGraph(nodes, runs, now), [nodes, runs, now]);
  const height = useMemo(() => Math.min(420, Math.max(160, layoutNodes(graph.nodes, graph.edges, { cardW: ORCH_CARD_W, align: 'top' }).height + 40)), [graph]);
  if (!nodes.length) return <div className="orch-graph empty">{tr('还没有节点')}</div>;
  return (
    <div className="orch-graph">
      <LazyNodeGraph graph={graph} ariaLabel={tr('执行图')} height={height} cardW={ORCH_CARD_W} align="top" entrance selected={selected ?? null} onSelect={onSelect} />
    </div>
  );
}
