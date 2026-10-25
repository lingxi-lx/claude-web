import { describe, expect, it } from 'vitest';
import { flowchartToGraph, isFlowchart } from './mermaid-flow';

const ok = (s: string) => { const r = flowchartToGraph(s); if (!r.ok) throw new Error(r.reason); return r.graph; };
const edges = (s: string) => ok(s).edges.map((e) => `${e.from}>${e.to}:${e.style}${e.label ? `:${e.label}` : ''}`);

describe('mermaid flowchart → node graph', () => {
  it('knows a flowchart', () => {
    expect(isFlowchart('flowchart LR\nA-->B')).toBe(true);
    expect(isFlowchart('%% note\ngraph TD;A-->B')).toBe(true);
    expect(isFlowchart('sequenceDiagram\nA->>B: hi')).toBe(false);
  });
  it('shapes, edge kinds and |labels|', () => {
    const g = ok('flowchart LR\n  A[Client] -->|HTTPS| B(API)\n  B -.-> C{{Cache}}\n  B ==> D[(Orders DB)]\n  D --- E((Replica))');
    expect(g.nodes.map((n) => [n.id, n.title])).toEqual([['A', 'Client'], ['B', 'API'], ['C', 'Cache'], ['D', 'Orders DB'], ['E', 'Replica']]);
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.style}${e.label ? `:${e.label}` : ''}`)).toEqual(['A>B:normal:HTTPS', 'B>C:dashed', 'B>D:strong', 'D>E:normal']);
  });
  it('text in the middle of a link', () => {
    expect(edges('graph LR\nA -- yes --> B\nA -. maybe .-> C\nA == sure ==> D')).toEqual(['A>B:normal:yes', 'A>C:dashed:maybe', 'A>D:strong:sure']);
  });
  it('chains, & groups and ; statements', () => {
    expect(edges('graph TD;A-->B-->C;A & B --> D')).toEqual(['A>B:normal', 'B>C:normal', 'A>D:normal', 'B>D:normal']);
  });
  it('quoted text keeps its brackets; <br> becomes a space', () => {
    expect(ok('flowchart LR\nA["a [b] c"] --> B["x<br/>y"]').nodes.map((n) => n.title)).toEqual(['a [b] c', 'x y']);
  });
  it('subgraph / classDef / class / style / click / comments are skipped; nodes inside a subgraph stay', () => {
    const g = ok('flowchart LR\n%% top\nsubgraph S [Group]\n  A[One] --> B\nend\nclassDef hot fill:#f00\nclass A hot\nstyle B fill:#0f0\nclick A "https://x"\nA:::hot --> C');
    expect(g.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
    expect(g.edges).toHaveLength(2);
  });
  it('a node named later gets its text', () => {
    expect(ok('flowchart LR\nA --> B\nB[Named]').nodes[1].title).toBe('Named');
  });
  it('what it cannot draw goes back to the original', () => {
    for (const s of ['flowchart LR', 'flowchart LR\nA --', 'flowchart LR\nA@{ shape: rect } --> B', 'flowchart LR\nA-1 --> B', 'sequenceDiagram\nA->>B: hi', 'flowchart XY\nA-->B']) {
      expect(flowchartToGraph(s).ok, s).toBe(false);
    }
  });
  it('node ids that are names on every object, and ids named like the skipped keywords (review D1 / D-minor)', () => {
    expect(edges('flowchart LR\nconstructor --> __proto__\ntoString --> constructor')).toEqual(['constructor>__proto__:normal', 'toString>constructor:normal']);
    expect(edges('flowchart LR\nclass --> style\nclick --> end2\nstyle --- click')).toEqual(['class>style:normal', 'click>end2:normal', 'style>click:normal']);
    expect(ok('flowchart LR\nA --> B\nclass A hot\nstyle B fill:#0f0\nclick A cb\ndirection LR').edges).toHaveLength(1);
  });
});
