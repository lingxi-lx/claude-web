import { describe, expect, it } from 'vitest';
import { NG_MAX_NODES, normalizeNodeGraph, parseNodeGraph } from './schema';
import { ACCESS_SAMPLE } from './sample';

const ok = (x: unknown) => { const r = normalizeNodeGraph(x); if (!r.ok) throw new Error(r.error); return r.graph; };
const bad = (x: unknown) => { const r = normalizeNodeGraph(x); if (r.ok) throw new Error('expected an error'); return r.error; };
const two = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];

describe('nodegraph format', () => {
  it('fills the defaults: edge ids and styles, row ids, string options', () => {
    const g = ok({
      nodes: [{ id: 'a', title: 'A', rows: [{ label: 'read', value: 'Anyone', options: ['Anyone', { value: 'Admin', marks: { e1: 'dashed' } }] }] }, { id: 'b', title: 'B' }],
      edges: [{ id: 'e1', from: 'a', to: 'b', fromRow: 'read', style: 'error' }, { from: 'b', to: 'a' }, { from: 'b', to: 'a' }],
    });
    expect(g.nodes[0].rows[0]).toEqual({ id: 'r0', label: 'read', value: 'Anyone', options: [{ value: 'Anyone', label: 'Anyone', marks: {} }, { value: 'Admin', label: 'Admin', marks: { e1: 'dashed' } }] });
    expect(g.nodes[1].rows).toEqual([]);
    expect(g.edges.map((e) => [e.id, e.style, e.fromRow])).toEqual([['e1', 'error', 'r0'], ['b>a', 'normal', undefined], ['b>a#2', 'normal', undefined]]);
  });
  it('a value missing from its options is offered first', () => {
    const g = ok({ nodes: [{ id: 'a', title: 'A', rows: [{ id: 'k', label: 'k', value: 'v', options: ['w'] }] }] });
    expect(g.nodes[0].rows[0].options.map((o) => o.value)).toEqual(['v', 'w']);
  });
  it('lists: plain strings and items with tags', () => {
    const g = ok({ nodes: [{ id: 'a', title: 'A', list: { title: '2 reads', items: ['x', { text: 'y', tags: ['US'] }] } }] });
    expect(g.nodes[0].list).toEqual({ title: '2 reads', items: [{ text: 'x', tags: [] }, { text: 'y', tags: ['US'] }] });
  });
  it('badge: a plain string, or a rule that counts error edges by default', () => {
    expect(ok({ nodes: two, badge: 'draft' }).badge).toEqual({ kind: 'text', text: 'draft' });
    expect(ok({ nodes: two, badge: { text: '{n} open', okText: 'none' } }).badge).toEqual({ kind: 'count', count: 'error', text: '{n} open', okText: 'none' });
  });
  it('the mp4 sample is valid', () => {
    const g = ok(ACCESS_SAMPLE);
    expect(g.nodes).toHaveLength(5);
    expect(g.edges.find((e) => e.id === 'e-read')?.fromRow).toBe('read');
  });
  it('text that is not JSON', () => {
    const r = parseNodeGraph('{"nodes": [');
    expect(r.ok).toBe(false);
    expect(parseNodeGraph(JSON.stringify({ nodes: two })).ok).toBe(true);
  });
  it('errors name the place', () => {
    expect(bad([])).toMatch(/^\$:/);
    expect(bad({})).toMatch(/^nodes:/);
    expect(bad({ nodes: [] })).toMatch(/^nodes:/);
    expect(bad({ nodes: [{ id: 'a' }] })).toMatch(/^nodes\[0\]\.title:/);
    expect(bad({ nodes: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] })).toMatch(/^nodes\[1\]\.id:/);
    expect(bad({ nodes: two, edges: [{ from: 'a', to: 'zz' }] })).toMatch(/^edges\[0\]\.to:.*zz/);
    expect(bad({ nodes: two, edges: [{ from: 'a', to: 'b', style: 'red' }] })).toMatch(/^edges\[0\]\.style:.*red/);
    expect(bad({ nodes: two, edges: [{ from: 'a', to: 'b', fromRow: 'nope' }] })).toMatch(/^edges\[0\]\.fromRow:/);
    expect(bad({ nodes: two, edges: [{ id: 'x', from: 'a', to: 'b' }, { id: 'x', from: 'b', to: 'a' }] })).toMatch(/^edges\[1\]\.id:/);
    expect(bad({ nodes: [{ id: 'a', title: 'A', rows: [{ label: 'x', value: 'v', options: [{ value: 'w', marks: { ghost: 'error' } }] }] }] })).toMatch(/^nodes\[0\]\.rows\[0\]\.options\[0\]\.marks:.*ghost/);
    expect(bad({ nodes: [{ id: 'a', title: 'A', rows: [{ id: 'k', label: 'k', value: '1' }, { id: 'k', label: 'k2', value: '2' }] }] })).toMatch(/^nodes\[0\]\.rows\[1\]\.id:/);
    expect(bad({ nodes: [{ id: 'a', title: 'A', state: 'sleepy' }] })).toMatch(/^nodes\[0\]\.state:/);
    expect(bad({ nodes: two, edges: [{ from: 'a', to: 'b', pulse: 'yes' }] })).toMatch(/^edges\[0\]\.pulse:/);
    expect(bad({ nodes: Array.from({ length: NG_MAX_NODES + 1 }, (_, i) => ({ id: `n${i}`, title: 'x' })) })).toMatch(/^nodes:/);
  });
  it('keys it does not know are ignored', () => {
    expect(ok({ nodes: [{ id: 'a', title: 'A', colour: 'red' }], theme: 'x' }).nodes[0].id).toBe('a');
  });
});
