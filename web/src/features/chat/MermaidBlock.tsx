import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from '@/util';
import { NodeGraph } from '@/ui/node-graph/NodeGraph';
import { flowchartToGraph, isFlowchart } from '@/ui/node-graph/mermaid-flow';
import { tr } from '@/i18n';

let seq = 0;
let inited: string | null = null;

async function getMermaid(theme: string) {
  const m = (await import('mermaid')).default;
  if (inited !== theme) {
    m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'light' || theme === 'paper' ? 'default' : 'dark', fontFamily: 'inherit' });
    inited = theme;
  }
  return m;
}

/**
 * Lazy mermaid renderer for ```mermaid fences. Only mounted once the block has finished streaming.
 * spec 2026-10-24 D4: a flowchart the node graph can read opens as 节点图, with 原图 one click away.
 */
export default function MermaidBlock({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  const flow = useMemo(() => (isFlowchart(source) ? flowchartToGraph(source) : null), [source]);
  const [view, setView] = useState<'graph' | 'raw'>(() => (flow?.ok ? 'graph' : 'raw'));
  const graphOn = view === 'graph' && !!flow?.ok;
  useEffect(() => {
    if (graphOn) return;
    let alive = true;
    const theme = document.documentElement.dataset.theme ?? 'dark';
    getMermaid(theme)
      .then(async (m) => {
        const id = `mmd-${++seq}`;
        const { svg } = await m.render(id, source);
        if (alive && ref.current) { ref.current.innerHTML = svg; setErr(''); }
      })
      .catch((e) => alive && setErr(String(e?.message ?? e)));
    return () => { alive = false; };
  }, [source, graphOn]);
  return (
    <div className="mermaid-wrap">
      {flow?.ok && (
        <div className="mmd-view" role="group" aria-label={tr('显示方式')}>
          <button type="button" className={clsx('btn sm', view === 'graph' && 'on')} aria-pressed={view === 'graph'} data-view="graph" onClick={() => setView('graph')}>{tr('节点图')}</button>
          <button type="button" className={clsx('btn sm', view === 'raw' && 'on')} aria-pressed={view === 'raw'} data-view="raw" onClick={() => setView('raw')}>{tr('原图')}</button>
        </div>
      )}
      {graphOn && flow?.ok
        ? <NodeGraph graph={flow.graph} ariaLabel={tr('流程图')} height={360} className="ng-mermaid" />
        : <div ref={ref} className="mermaid-svg" />}
      {err && !graphOn && <pre className="code-body" style={{ color: 'var(--red)' }}>mermaid: {err}{'\n'}{source}</pre>}
    </div>
  );
}
