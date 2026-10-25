import { describe, expect, it } from 'vitest';
import type { BgSession } from '@shared';
import { layoutNodes } from '@/ui/node-graph/layout';
import { backgroundGraph, edgeStyleFor, phaseState } from './graph-data';

const now = 1_000_000;
const agent = (key: string, state: 'queued' | 'running' | 'done' | 'failed' | 'stopped', phase?: number) =>
  ({ key, color: 1, label: key, phase, phaseTitle: phase ? `阶段${phase}` : undefined, agentType: 'general-purpose', model: 'opus', state, startedAt: now - 5000, tokens: 1200 });
const session = {
  sessionId: 's',
  tasks: [
    { id: 'wf1', kind: 'workflow', name: 'review', description: 'review', status: 'running', startedAt: now - 9000, tokens: 0, phases: [{ index: 1, title: '一' }, { index: 2, title: '二' }], agents: [agent('w1', 'running', 1), agent('w2', 'done', 1), agent('w3', 'queued', 2)] },
    { id: 'ag1', kind: 'agent', description: 'look around', status: 'running', startedAt: now - 3000, tokens: 0, agents: [agent('ag1', 'running')] },
    { id: 'sh1', kind: 'shell', description: 'npm run dev', status: 'running', startedAt: now - 1000, tokens: 0, agents: [] },
  ],
} as unknown as BgSession;
const styleOf = (r: ReturnType<typeof backgroundGraph>) => Object.fromEntries(r.graph.edges.map((e) => [e.id, e.style]));

describe('background graph', () => {
  it('main → workflow → phases → agents, plus the sub-agent and the command', () => {
    const r = backgroundGraph(session, { now });
    expect(r.graph.nodes.map((n) => n.id)).toEqual(['main', 'wf|wf1', 'wf|wf1|p1', 'wf1|w1', 'wf1|w2', 'wf|wf1|p2', 'wf1|w3', 'ag1|ag1', 'shell|sh1']);
    expect(styleOf(r)).toEqual({
      'main>wf|wf1': 'strong', 'wf|wf1>wf|wf1|p1': 'strong', 'wf|wf1|p1>wf1|w1': 'strong', 'wf|wf1|p1>wf1|w2': 'normal',
      'wf|wf1>wf|wf1|p2': 'dashed', 'wf|wf1|p2>wf1|w3': 'dashed', 'main>ag1|ag1': 'strong', 'main>shell|sh1': 'strong',
    });
    expect(r.graph.nodes[0].subtitle).toBe('3 个在跑');
    expect(Object.keys(r.picks).sort()).toEqual(['ag1|ag1', 'wf1|w1', 'wf1|w2', 'wf1|w3']);
    expect(r.picks['wf1|w1']).toEqual({ agentKey: 'w1', taskId: 'wf1' });
  });
  it('columns read left to right', () => {
    const r = backgroundGraph(session, { now });
    expect(layoutNodes(r.graph.nodes, r.graph.edges).cols).toEqual([['main'], ['wf|wf1', 'ag1|ag1', 'shell|sh1'], ['wf|wf1|p1', 'wf|wf1|p2'], ['wf1|w1', 'wf1|w2', 'wf1|w3']]);
  });
  it('agent cards carry their details as rows; compact drops them', () => {
    const full = backgroundGraph(session, { now }).graph.nodes.find((n) => n.id === 'wf1|w1')!;
    expect(full.rows.map((r) => r.id)).toEqual(['type', 'model', 'tokens', 'time']);
    expect(full.state).toBe('running');
    expect(backgroundGraph(session, { now, compact: true }).graph.nodes.find((n) => n.id === 'wf1|w1')!.rows).toEqual([]);
  });
  it('one task only (the drawer)', () => {
    expect(backgroundGraph(session, { now, taskId: 'ag1' }).graph.nodes.map((n) => n.id)).toEqual(['main', 'ag1|ag1']);
  });
  it('a failed agent: red, no travelling dot', () => {
    const s = { tasks: [{ ...session.tasks[1], agents: [agent('ag1', 'failed')] }] } as unknown as BgSession;
    const e = backgroundGraph(s, { now }).graph.edges[0];
    expect([e.style, e.pulse]).toEqual(['error', false]);
  });
  it('caps the agents, running first', () => {
    const many = { tasks: [{ id: 't', kind: 'agent', status: 'running', description: 'x', startedAt: now, tokens: 0, agents: Array.from({ length: 20 }, (_, i) => agent(`a${i}`, i === 19 ? 'running' : 'done')) }] } as unknown as BgSession;
    const r = backgroundGraph(many, { now, compact: true });
    expect(r.more).toBe(4);
    expect(r.graph.nodes.some((n) => n.id === 't|a19')).toBe(true);
  });
  it('style and phase rules', () => {
    expect(['running', 'failed', 'done', 'queued', 'stopped'].map((s) => edgeStyleFor(s as never))).toEqual(['strong', 'error', 'normal', 'dashed', 'dashed']);
    expect(phaseState([])).toBe('queued');
  });
});
