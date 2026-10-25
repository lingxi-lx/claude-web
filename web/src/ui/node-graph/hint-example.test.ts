import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeNodeGraph } from './schema';
import { edgeStyles, initialPicks, badgeView } from './marks';

// review D2: the example Claude is shown (NODEGRAPH_EXAMPLE in the server's runtime/nodegraph-hint.ts — read from that
// file, the web cannot import the server) must pass this format: before, its edge started at a row of another card.
const HINT_FILE = path.resolve(__dirname, '../../../../server/src/runtime/nodegraph-hint.ts');

function example(): unknown {
  const src = fs.readFileSync(HINT_FILE, 'utf8');
  const block = /NODEGRAPH_EXAMPLE = \[([^]*?)\]\.join/.exec(src);
  if (!block) throw new Error('NODEGRAPH_EXAMPLE not found in nodegraph-hint.ts');
  const lines = [...block[1].matchAll(/^\s*'([^']*)',?\s*$/gm)].map((m) => m[1]);
  return JSON.parse(lines.join('\n'));
}

describe('the hint\'s example (review D2)', () => {
  it('passes normalizeNodeGraph, and its dropdown closes the open path', () => {
    const r = normalizeNodeGraph(example());
    if (!r.ok) throw new Error(r.error);
    const g = r.graph;
    const e2 = g.edges.find((e) => e.id === 'e2')!;
    expect(g.nodes.find((n) => n.id === e2.from)!.rows.map((x) => x.id)).toContain(e2.fromRow);
    const picks = initialPicks(g);
    expect(badgeView(g.badge, edgeStyles(g, picks))?.tone).toBe('error');
    expect(badgeView(g.badge, edgeStyles(g, { ...picks, 'link/read': 'Admin' }))?.tone).toBe('ok');
  });
  it('the old example (fromRow on the other card) is refused', () => {
    const r = normalizeNodeGraph({ nodes: [{ id: 'anyone', title: 'A' }, { id: 'link', title: 'L', rows: [{ id: 'read', label: 'read', value: 'x' }] }], edges: [{ from: 'anyone', to: 'link', fromRow: 'read' }] });
    expect(r.ok).toBe(false);
  });
});
