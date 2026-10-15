import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx, fmtMs } from '@/util';
import { Icon, type IconName } from '@/ui/icons';
import type { NodeRun, OrchNode } from '@shared';
import { CARD_H, CARD_W, fitScale, layoutGraph } from './graph-layout';
import { agentLabel } from './labels';
import { tr } from '@/i18n';

export const KIND_ICON: Record<OrchNode['kind'], IconName> = { task: 'agent', compare: 'compare', approval: 'approval' };

function sub(n: OrchNode) {
  if (n.kind === 'task') return `${agentLabel(n.agent)}${n.workspace === 'worktree' ? tr(' · 独立副本') : ''}${n.untilDone ? tr(' · 直到完成') : ''}`;
  if (n.kind === 'compare') return `${n.agents.map(agentLabel).join(' / ')}${n.judge ? tr(' · 裁判') : ''}`;
  return tr('人工审批');
}

/**
 * Execution graph: topological columns of node cards with SVG edges. `runs` colours cards / edges by
 * state (run view); without it the graph is a plain preview (editor).
 */
export function Graph({ nodes, runs, selected, onSelect }: { nodes: OrchNode[]; runs?: Record<string, NodeRun>; selected?: string | null; onSelect?: (id: string) => void }) {
  const g = useMemo(() => layoutGraph(nodes.map((n) => ({ id: n.id, dependsOn: n.dependsOn ?? [] }))), [nodes]);
  const live = !!runs && Object.values(runs).some((r) => r.state === 'running');
  const [, tick] = useState(0);
  useEffect(() => { if (!live) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [live]);
  // fit the graph to the panel width (down to 50 %, then it scrolls) so wide DAGs aren't cut off
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const hasNodes = nodes.length > 0;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth - 20));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasNodes]);
  const scale = fitScale(g.width, avail);
  if (!hasNodes) return <div className="orch-graph empty">{tr('还没有节点')}</div>;
  return (
    <div className="orch-graph" ref={box}>
      <div style={{ width: g.width * scale, height: g.height * scale }}>
      <div className="orch-canvas" style={{ width: g.width, height: g.height, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: '0 0' }}>
        <svg width={g.width} height={g.height} aria-hidden="true">
          {g.edges.map((e) => <path key={`${e.from}>${e.to}`} d={e.d} className={clsx('edge', runs && `st-${runs[e.from]?.state ?? 'pending'}`)} />)}
        </svg>
        {nodes.map((n) => {
          const b = g.boxes[n.id];
          if (!b) return null;
          const r = runs?.[n.id];
          const secs = r?.startedAt ? (r.finishedAt ?? Date.now()) - r.startedAt : 0;
          return (
            <button key={n.id} type="button" className={clsx('orch-card', `k-${n.kind}`, r && `st-${r.state}`, selected === n.id && 'sel')} style={{ left: b.x, top: b.y, width: CARD_W, height: CARD_H }} onClick={() => onSelect?.(n.id)} title={n.title || n.id}>
              <span className="ic"><Icon name={r?.state === 'done' ? 'check' : r?.state === 'failed' ? 'close' : KIND_ICON[n.kind]} size={13} /></span>
              <span className="tx">
                <span className="t">{n.title || n.id}</span>
                <span className="s">{r && r.state !== 'pending' ? `${STATE_L[r.state]}${secs && (r.state === 'running' || r.finishedAt) ? ` · ${fmtMs(secs)}` : ''}` : sub(n)}</span>
              </span>
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}

export const STATE_L: Record<NodeRun['state'], string> = { pending: tr('待执行'), running: tr('运行中'), waiting: tr('等你'), done: tr('完成'), failed: tr('失败'), skipped: tr('跳过'), cancelled: tr('已取消') };
