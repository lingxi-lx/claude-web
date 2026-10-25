import { describe, expect, it } from 'vitest';
import { normalizeNodeGraph, type NgNode } from './schema';
import { ACCESS_SAMPLE } from './sample';
import { cardSize, edgeGeom, labelWidth, layers, layoutNodes, moveBoxes, rowAnchor, NG_BODY_PAD, NG_CARD_W, NG_GAP_X, NG_HEAD_H, NG_LIST_HEAD, NG_LIST_ITEM, NG_PAD, NG_ROW_H } from './layout';

const g = (() => { const r = normalizeNodeGraph(ACCESS_SAMPLE); if (!r.ok) throw new Error(r.error); return r.graph; })();
const card = (id: string, extra: Partial<NgNode> = {}): NgNode => ({ id, title: id, rows: [], ...extra });
const n = (id: string, dependsOn: string[] = []) => ({ id, dependsOn });

describe('layers (moved from orchestra/graph-layout)', () => {
  it('puts nodes one column after their deepest dependency', () => {
    expect(layers([n('c', ['a', 'b']), n('a'), n('b', ['a'])]).map((l) => l.map((x) => x.id))).toEqual([['a'], ['b'], ['c']]);
  });
  it('puts a node one column after its deepest dependency', () => {
    const cols = layers([{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['a', 'b'] }, { id: 'd', dependsOn: [] }]);
    expect(cols.map((c) => c.map((x) => x.id))).toEqual([['a', 'd'], ['b'], ['c']]);
  });
  it('a cycle still lands somewhere', () => {
    const cols = layers([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }]);
    expect(cols.flat().map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
});

describe('layoutNodes', () => {
  it('columns from the edges, left to right', () => {
    const p = layoutNodes(g.nodes, g.edges);
    expect(p.cols).toEqual([['anyone', 'admin', 'backup'], ['link'], ['bucket']]);
    expect(p.boxes.link.x).toBe(NG_PAD + NG_CARD_W + NG_GAP_X);
    expect(p.boxes.bucket.x).toBe(NG_PAD + 2 * (NG_CARD_W + NG_GAP_X));
  });
  it('centres a short column on the tallest; align top starts every column at the top', () => {
    const p = layoutNodes(g.nodes, g.edges);
    const tallest = Math.max(...p.cols.map((c) => c.reduce((h, id) => h + p.boxes[id].h, 0) + (c.length - 1) * 28));
    expect(p.boxes.link.y).toBe(NG_PAD + (tallest - p.boxes.link.h) / 2);
    const t = layoutNodes(g.nodes, g.edges, { align: 'top' });
    expect(t.boxes.link.y).toBe(NG_PAD);
    expect(t.boxes.anyone.y).toBe(NG_PAD);
  });
  it('a card with x / y keeps them and the canvas grows to hold it', () => {
    const p = layoutNodes([card('a'), card('b', { x: 900, y: 500 })], []);
    expect(p.boxes.b).toMatchObject({ x: 900, y: 500 });
    expect(p.width).toBe(900 + NG_CARD_W + NG_PAD);
    expect(p.height).toBe(500 + NG_HEAD_H + NG_PAD);
  });
  it('self loops and edges to unknown cards do not move anything', () => {
    const p = layoutNodes([card('a')], [{ id: 'x', from: 'a', to: 'a', style: 'normal' }, { id: 'y', from: 'zz', to: 'a', style: 'normal' }]);
    expect(p.cols).toEqual([['a']]);
  });
  it('nothing to draw', () => expect(layoutNodes([], [])).toEqual({ boxes: {}, width: 0, height: 0, cols: [] }));
  it('dragging moves one box', () => {
    const b = { a: { x: 0, y: 0, w: 10, h: 10 }, b: { x: 50, y: 0, w: 10, h: 10 } };
    expect(moveBoxes(b, { a: { dx: 5, dy: -3 } })).toEqual({ a: { x: 5, y: -3, w: 10, h: 10 }, b: b.b });
  });
});

describe('card sizes and edges', () => {
  it('a card is its header, rows and list', () => {
    expect(cardSize(card('a')).h).toBe(NG_HEAD_H);
    const link = g.nodes.find((x) => x.id === 'link')!;
    expect(cardSize(link)).toEqual({ w: NG_CARD_W, h: NG_HEAD_H + 2 * NG_ROW_H + NG_BODY_PAD });
    const bucket = g.nodes.find((x) => x.id === 'bucket')!;
    expect(cardSize(bucket, 180)).toEqual({ w: 180, h: NG_HEAD_H + NG_LIST_HEAD + 4 * NG_LIST_ITEM + NG_BODY_PAD });
  });
  it('a straight edge between two headers', () => {
    const e = edgeGeom('e', { x: 0, y: 0, w: 100, h: 52 }, { x: 200, y: 0, w: 100, h: 52 }, null);
    expect(e.d).toBe('M100,26 C150,26 150,26 200,26');
    expect(e.mid).toEqual({ x: 150, y: 26 });
    expect(e.len).toBeCloseTo(100, 0);
  });
  it('an edge leaving from a row', () => {
    expect(rowAnchor(1)).toBe(NG_HEAD_H + NG_BODY_PAD / 2 + NG_ROW_H + NG_ROW_H / 2);
    const e = edgeGeom('e', { x: 0, y: 0, w: 100, h: 120 }, { x: 200, y: 0, w: 100, h: 52 }, 1);
    expect(e.d.startsWith(`M100,${rowAnchor(1)} `)).toBe(true);
  });
  it('a backwards edge bows out', () => {
    expect(edgeGeom('e', { x: 200, y: 0, w: 100, h: 52 }, { x: 0, y: 0, w: 100, h: 52 }, null).d).toBe('M300,26 C380,26 -80,26 0,26');
  });
  it('label widths', () => {
    expect(labelWidth('ab', 10)).toBe(24);
    expect(labelWidth('读', 10)).toBe(22);
  });
});
