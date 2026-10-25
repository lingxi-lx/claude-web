import { describe, expect, it } from 'vitest';
import { NODEGRAPH_EXAMPLE, NODEGRAPH_HINT_KEY, nodegraphHintPrompt } from './nodegraph-hint.js';

describe('nodegraph hint (spec D4)', () => {
  it('off: nothing is added', () => expect(nodegraphHintPrompt(false)).toBe(''));
  it('on: the fence, the whole format, short, English', () => {
    const t = nodegraphHintPrompt(true);
    expect(t).toContain('```nodegraph');
    for (const w of ['nodes', 'edges', 'fromRow', 'options', 'marks', 'badge', 'okText', '{n}', 'normal', 'strong', 'error', 'dashed', 'flowchart']) expect(t).toContain(w);
    expect(t.length).toBeLessThan(2400);
    expect(/[\u4e00-\u9fff]/.test(t)).toBe(false);
  });
  it('the setting key', () => expect(NODEGRAPH_HINT_KEY).toBe('ui.nodegraphHint'));
  it('the example is valid JSON and its fromRow is a row of its from card (review D2; the full format check is web/src/ui/node-graph/hint-example.test.ts)', () => {
    expect(nodegraphHintPrompt(true)).toContain(NODEGRAPH_EXAMPLE);
    const g = JSON.parse(NODEGRAPH_EXAMPLE) as { nodes: { id: string; rows?: { id: string }[] }[]; edges: { from: string; fromRow?: string }[] };
    for (const e of g.edges) if (e.fromRow) expect(g.nodes.find((n) => n.id === e.from)?.rows?.map((r) => r.id)).toContain(e.fromRow);
    expect(nodegraphHintPrompt(true)).toMatch(/fromRow[^\n]*must be the id of a row of the edge's from card/);
  });
});
