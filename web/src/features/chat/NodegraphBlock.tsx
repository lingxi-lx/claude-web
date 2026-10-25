import { useContext, useMemo, useState } from 'react';
import { NodeGraph } from '@/ui/node-graph/NodeGraph';
import { parseNodeGraph } from '@/ui/node-graph/schema';
import { changeSentence, initialPicks } from '@/ui/node-graph/marks';
import { layoutNodes } from '@/ui/node-graph/layout';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { insertInComposer } from '@/features/composer/quote';
import { useStore } from '@/store';
import { tr } from '@/i18n';
import { ArrivalCtx } from './turn-context';
import { useCopy } from './CodeBlock';
// spec 2026-10-24 D4: a ```nodegraph block drawn as an interactive graph. Bad JSON → the code plus one line saying so.

export default function NodegraphBlock({ source }: { source: string }) {
  const parsed = useMemo(() => parseNodeGraph(source), [source]);
  const arrival = useContext(ArrivalCtx);
  const [entrance] = useState(() => arrival.current);
  const init = useMemo(() => (parsed.ok ? initialPicks(parsed.graph) : {}), [parsed]);
  const [picks, setPicks] = useState<Record<string, string>>(init);
  const [showSrc, setShowSrc] = useState(false);
  const { ok: copied, copy } = useCopy();
  const height = useMemo(() => (parsed.ok ? Math.min(520, Math.max(260, layoutNodes(parsed.graph.nodes, parsed.graph.edges).height + 90)) : 0), [parsed]);
  if (!parsed.ok) {
    return (
      <>
        <pre className="code-body">{source}</pre>
        <div className="ng-bad" role="note">{tr('这张图格式有误')}<span className="sub">{parsed.error}</span></div>
      </>
    );
  }
  const changed = changeSentence(parsed.graph, init, picks);
  const send = () => {
    if (insertInComposer(changed)) return;
    void navigator.clipboard?.writeText(changed).catch(() => {});
    useStore.getState().toast(tr('没有可以填的输入框，这句话已复制'));
  };
  return (
    <div className="ng-chat">
      <ErrorBoundary area={tr('节点图')}>
        <NodeGraph graph={parsed.graph} ariaLabel={parsed.graph.title ?? tr('节点图')} height={height} entrance={entrance} picks={picks} onPick={(k, v) => setPicks((p) => ({ ...p, [k]: v }))} />
      </ErrorBoundary>
      <div className="ng-foot">
        <button type="button" className="link ng-src" aria-expanded={showSrc} onClick={() => setShowSrc((v) => !v)}>{showSrc ? tr('收起源码') : tr('查看源码')}</button>
        <button type="button" className="link ng-copy" onClick={() => copy(source)}>{copied ? tr('已复制') : tr('复制')}</button>
        {changed && <button type="button" className="btn sm ng-send" onClick={send}>{tr('把改动发给 Claude')}</button>}
      </div>
      {showSrc && <pre className="code-body ng-source">{source}</pre>}
    </div>
  );
}
