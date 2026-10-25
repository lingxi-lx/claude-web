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
});
