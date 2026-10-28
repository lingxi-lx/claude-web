import { describe, expect, it } from 'vitest';
import { MAX_TREE_DEPTH, MAX_TREE_NODES, compressTree, describeMatch, findNodes, isActionable, normalizeRef, refById, windowMatches, type Rect, type UiaNode, type UiaSnapshot } from './uia.js';

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

const button = (name: string, x: number, y: number, more: Partial<UiaNode> = {}): UiaNode => ({
  role: 'Button', name, bounds: r(x, y, 80, 24), patterns: ['Invoke'], ...more,
});

function snapshot(children: UiaNode[]): UiaSnapshot {
  return {
    app: { name: 'notepad', title: 'Untitled - Notepad' },
    window: { hwnd: 11, title: 'Untitled - Notepad', rect: r(0, 0, 800, 600) },
    root: { role: 'Window', name: 'Untitled - Notepad', bounds: r(0, 0, 800, 600), children },
  };
}

const notepad = (): UiaSnapshot => snapshot([
  {
    role: 'Pane', children: [
      { role: 'Edit', name: 'Text Editor', value: 'hello world', bounds: r(10, 40, 780, 500), patterns: ['Value', 'Text'] },
      { role: 'Text', name: 'Characters (11)', bounds: r(10, 560, 120, 20) },
      button('Save', 700, 8, { automationId: 'SaveButton' }),
      button('Close', 760, 8, { enabled: false }),
    ],
  },
  { role: 'Pane' }, // decorative and empty: dropped
]);

describe('compressTree', () => {
  it('keeps what says something, drops empty decoration, and numbers only actionable controls', () => {
    const tree = compressTree(notepad());
    expect(tree.refs.map((x) => [x.ref, x.name, x.patterns])).toEqual([
      ['e1', 'Text Editor', ['Value', 'Text']],
      ['e2', 'Save', ['Invoke']],
      ['e3', 'Close', ['Invoke']],
    ]);
    expect(tree.stats.nodes).toBeLessThan(10);
    expect(tree.stats.omitted).toBe(1); // the empty pane
    expect(tree.stats.refs).toBe(3);
    expect(tree.text).toContain('Window "Untitled - Notepad"');
    expect(tree.text).toContain('Button "Save" [e2] {Invoke}');
    expect(tree.text).toContain('(不可用)');
  });

  it('caps the number of nodes at maxNodes (default 400)', () => {
    const many = snapshot([{ role: 'Pane', children: Array.from({ length: 1000 }, (_, i) => button(`B${i}`, i, i)) }]);
    const tree = compressTree(many);
    expect(tree.stats.nodes).toBe(MAX_TREE_NODES);
    expect(tree.refs.length).toBeLessThanOrEqual(MAX_TREE_NODES);
    expect(tree.stats.omitted).toBeGreaterThan(500);
  });

  it('stops at maxDepth (default 8) and says how many children were left out', () => {
    let node: UiaNode = { role: 'Text', name: 'bottom' };
    for (let i = 0; i < 12; i++) node = { role: 'Pane', name: `p${i}`, children: [node] };
    const tree = compressTree(snapshot([node]));
    expect(tree.stats.depth).toBe(MAX_TREE_DEPTH);
    expect(tree.stats.depthHit).toBe(true);
    expect(tree.text).toContain('p7');
    expect(tree.text).not.toContain('bottom');
    expect(tree.text).toContain('…另有 1 项');
  });

  it('is pure: the same snapshot compresses to the same refs', () => {
    const snap = notepad();
    const a = compressTree(snap);
    const b = compressTree(snap);
    expect(a.refs).toEqual(b.refs);
    expect(a.text).toBe(b.text);
  });
});

describe('findNodes', () => {
  it('finds by role, name, text, automation id and returns the ref and bounds', () => {
    const tree = compressTree(notepad());
    const save = findNodes(tree, { role: 'Button', name: 'save' });
    expect(save).toHaveLength(1);
    expect(save[0]).toMatchObject({ ref: 'e2', role: 'Button', name: 'Save', bounds: r(700, 8, 80, 24) });
    const hello = findNodes(tree, { text: 'hello' });
    expect(hello.map((m) => m.name)).toContain('Text Editor');
    const id = findNodes(tree, { automationId: 'SaveButton' });
    expect(id.map((m) => m.ref)).toEqual(['e2']);
  });

  it('filters by window and by actionable controls only', () => {
    const tree = compressTree(notepad());
    expect(findNodes(tree, { text: 'hello', window: 'chrome' })).toEqual([]);
    expect(findNodes(tree, { text: 'hello', window: 'notepad' })).toHaveLength(1);
    expect(findNodes(tree, { name: 'Characters', actionableOnly: true })).toEqual([]);
    expect(findNodes(tree, { role: 'Button', actionableOnly: true })).toHaveLength(2);
  });

  it('returns nothing when no criterion is given, and honours limit', () => {
    const tree = compressTree(notepad());
    expect(findNodes(tree, {})).toEqual([]);
    expect(findNodes(tree, { role: 'Button', limit: 1 })).toHaveLength(1);
  });

  it('accepts a raw snapshot too', () => {
    expect(findNodes(notepad(), { name: 'Save' }).map((m) => m.ref)).toEqual(['e2']);
  });
});

describe('refById and helpers', () => {
  it('resolves eN, N and EN; unknown refs are null', () => {
    const tree = compressTree(notepad());
    expect(refById(tree, 'e2')?.name).toBe('Save');
    expect(refById(tree, '2')?.name).toBe('Save');
    expect(refById(tree, 'E2')?.name).toBe('Save');
    expect(refById(tree, 'e99')).toBeNull();
    expect(refById(null, 'e1')).toBeNull();
    expect(normalizeRef(' 12 ')).toBe('e12');
  });

  it('tells which roles and patterns are actionable', () => {
    expect(isActionable({ role: 'Button' })).toBe(true);
    expect(isActionable({ role: 'Edit' })).toBe(true);
    expect(isActionable({ role: 'Custom', patterns: ['Invoke'] })).toBe(true);
    expect(isActionable({ role: 'Text' })).toBe(false);
  });

  it('matches a window by application or title', () => {
    expect(windowMatches(notepad(), 'notepad')).toBe(true);
    expect(windowMatches(notepad(), 'untitled')).toBe(true);
    expect(windowMatches(notepad(), 'chrome')).toBe(false);
  });

  it('describes a match for the model', () => {
    const [m] = findNodes(compressTree(notepad()), { name: 'Save' });
    expect(describeMatch(m)).toContain('[e2] Button "Save"');
    expect(describeMatch(m)).toContain('80x24');
  });
});
