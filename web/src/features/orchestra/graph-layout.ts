import { tr } from '@/i18n';
// The orchestra editor's helpers. The graph itself is ui/node-graph (spec 2026-10-24 D3): layout in ui/node-graph/layout.ts,
// cards / edges in orch-graph.ts.

/** Next free `n<k>` id for a new node. */
export function nextNodeId(ids: string[]): string {
  let k = ids.length + 1;
  while (ids.includes(`n${k}`)) k++;
  return `n${k}`;
}

/** Template variables a node's prompt can use: input + every other node's output / approval. */
export function promptVars(nodes: { id: string; kind: string; title: string }[], self: string): { token: string; label: string }[] {
  const out = [{ token: '{{input}}', label: tr('启动输入') }];
  for (const n of nodes) {
    if (n.id === self) continue;
    if (n.kind === 'approval') out.push({ token: `{{nodes.${n.id}.approval}}`, label: tr('{title} 的审批意见', { title: n.title || n.id }) });
    else out.push({ token: `{{nodes.${n.id}.output}}`, label: tr('{title} 的输出', { title: n.title || n.id }) });
  }
  return out;
}
