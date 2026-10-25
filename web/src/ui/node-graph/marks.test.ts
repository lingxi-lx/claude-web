import { describe, expect, it } from 'vitest';
import { normalizeNodeGraph, type NodeGraphData } from './schema';
import { badgeView, changeSentence, edgeStyles, initialPicks, pickKey, pulses } from './marks';
import { ACCESS_SAMPLE } from './sample';

const g = (() => { const r = normalizeNodeGraph(ACCESS_SAMPLE); if (!r.ok) throw new Error(r.error); return r.graph; })() as NodeGraphData;

describe('marks and the badge', () => {
  it('starts from every dropdown row\'s value', () => {
    expect(initialPicks(g)).toEqual({ 'link/read': 'Anyone', 'link/write': 'Admin' });
    expect(pickKey('link', 'read')).toBe('link/read');
  });
  it('the mp4: one open path, then read → Admin closes it', () => {
    const init = initialPicks(g);
    const s0 = edgeStyles(g, init);
    expect(s0['e-open']).toBe('error');
    expect(s0['e-backup']).toBe('dashed');
    expect(badgeView(g.badge, s0)).toEqual({ text: '1 open path', tone: 'error' });
    const s1 = edgeStyles(g, { ...init, 'link/read': 'Admin' });
    expect(s1['e-open']).toBe('dashed');
    expect(badgeView(g.badge, s1)).toEqual({ text: 'No open paths', tone: 'ok' });
  });
  it('an option without marks leaves the edges as they are', () => {
    expect(edgeStyles(g, { 'link/write': 'Team' })).toEqual(edgeStyles(g, {}));
  });
  it('the badge tone follows the counted style (review D-minor)', () => {
    const st = { a: 'strong', b: 'dashed', c: 'normal' } as const;
    expect(badgeView({ kind: 'count', count: 'strong', text: '{n} hot', okText: 'calm' }, st)).toEqual({ text: '1 hot', tone: 'strong' });
    expect(badgeView({ kind: 'count', count: 'dashed', text: '{n} off', okText: 'all on' }, st)).toEqual({ text: '1 off', tone: 'plain' });
    expect(badgeView({ kind: 'count', count: 'error', text: '{n}', okText: 'fine' }, st)).toEqual({ text: 'fine', tone: 'ok' });
  });
  it('a plain badge, and none', () => {
    expect(badgeView({ kind: 'text', text: 'draft' }, {})).toEqual({ text: 'draft', tone: 'plain' });
    expect(badgeView(undefined, {})).toBeNull();
  });
  it('which edges carry a travelling dot', () => {
    const e = g.edges[0];
    expect(pulses(e, 'error')).toBe(true);
    expect(pulses(e, 'strong')).toBe(true);
    expect(pulses(e, 'normal')).toBe(false);
    expect(pulses({ ...e, pulse: false }, 'error')).toBe(false);
  });
  it('the sentence for 把改动发给 Claude', () => {
    const init = initialPicks(g);
    expect(changeSentence(g, init, init)).toBe('');
    expect(changeSentence(g, init, { ...init, 'link/read': 'Admin' })).toBe('我在图里把「Share link」的 read 从 Anyone 改成了 Admin。');
    expect(changeSentence(g, init, { 'link/read': 'Admin', 'link/write': 'Team' })).toBe('我在图里把「Share link」的 read 从 Anyone 改成了 Admin；「Share link」的 write 从 Admin 改成了 Team。');
  });
  it('edge ids that are names on every object (review D1)', () => {
    const r = normalizeNodeGraph({ nodes: [{ id: 'a', title: 'A', rows: [{ id: 'k', label: 'k', value: 'on', options: [{ value: 'on', marks: { constructor: 'error' } }, 'off'] }] }, { id: 'b', title: 'B' }], edges: [{ id: 'constructor', from: 'a', to: 'b' }, { id: 'toString', from: 'b', to: 'a' }] });
    if (!r.ok) throw new Error(r.error);
    const s = edgeStyles(r.graph, {});
    expect({ ...s }).toEqual({ constructor: 'error', toString: 'normal' });
    expect(edgeStyles(r.graph, { 'a/k': 'off' }).constructor).toBe('normal');
    expect(badgeView({ kind: 'count', count: 'error', text: '{n}', okText: 'ok' }, s)?.text).toBe('1');
  });
});
