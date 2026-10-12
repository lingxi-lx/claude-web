import { describe, expect, it } from 'vitest';
import { applyBg, createBgState, endRunning, snapshotBg, MAX_EVENTS, MAX_EVENT_TEXT, SNAPSHOT_EVENTS } from './registry.js';

const T0 = 1_790_000_000_000;
const sys = (subtype: string, o: Record<string, unknown>) => ({ type: 'system', subtype, uuid: 'u', session_id: 's', ...o });
const phase = (index: number, title: string) => ({ type: 'workflow_phase', index, title });
const agent = (index: number, o: Record<string, unknown>) => ({ type: 'workflow_agent', index, label: `a${index}`, phaseIndex: index <= 3 ? 1 : 2, phaseTitle: index <= 3 ? '文字回合' : '图片回合', model: 'claude-haiku-4-5', queuedAt: T0, promptPreview: 'secret prompt', lastProgressAt: T0, ...o });
const progress = (list: unknown[], extra: Record<string, unknown> = {}) => sys('task_progress', { task_id: 'wf1', tool_use_id: 'tu1', description: 'x', usage: { total_tokens: 10, tool_uses: 1, duration_ms: 5 }, workflow_progress: list, ...extra });

describe('background registry', () => {
  it('follows a workflow from queued to done, phase by phase', () => {
    const s = createBgState('s1');
    expect(applyBg(s, sys('task_started', { task_id: 'wf1', tool_use_id: 'tu1', description: 'bench phase 4', task_type: 'local_workflow', workflow_name: 'bench-phase4' }), T0)).toBe(true);
    const queued = [phase(1, '文字回合'), phase(2, '图片回合'), ...[1, 2, 3, 4, 5].map((i) => agent(i, { state: 'start' }))];
    applyBg(s, progress(queued), T0 + 10);
    let t = snapshotBg(s).tasks[0];
    expect(t).toMatchObject({ kind: 'workflow', name: 'bench-phase4', status: 'running', toolUseId: 'tu1' });
    expect(t.phases).toEqual([{ index: 1, title: '文字回合' }, { index: 2, title: '图片回合' }]);
    expect(t.agents.map((a) => [a.key, a.state, a.color, a.phase])).toEqual([['w1', 'queued', 1, 1], ['w2', 'queued', 2, 1], ['w3', 'queued', 3, 1], ['w4', 'queued', 4, 2], ['w5', 'queued', 5, 2]]);
    // the prompt preview never goes to the windows
    expect(JSON.stringify(snapshotBg(s))).not.toContain('secret prompt');

    const running = [phase(1, '文字回合'), phase(2, '图片回合'),
      agent(1, { state: 'progress', agentId: 'aa1', startedAt: T0 + 20, toolCalls: 2, tokens: 900, lastToolName: 'Edit', lastToolSummary: '改了 readerGates.test.ts' }),
      agent(2, { state: 'progress', agentId: 'aa2', startedAt: T0 + 20, toolCalls: 0 }),
      agent(3, { state: 'done', agentId: 'aa3', startedAt: T0 + 20, durationMs: 400, tokens: 3100, toolCalls: 4 }),
      agent(4, { state: 'start' }), agent(5, { state: 'start' })];
    applyBg(s, progress(running), T0 + 1000);
    t = snapshotBg(s).tasks[0];
    expect(t.agents[0]).toMatchObject({ state: 'running', agentId: 'aa1', lastSummary: '改了 readerGates.test.ts', lastTool: 'Edit', tokens: 900, toolCalls: 2, startedAt: T0 + 20 });
    expect(t.agents[0].beats).toEqual([T0 + 1000]);
    // its own clock when it says how long it took
    expect(t.agents[2]).toMatchObject({ state: 'done', endedAt: T0 + 20 + 400 });
    const texts = snapshotBg(s).events.map((e) => `${e.who}|${e.tone}|${e.text}`);
    expect(texts).toContain('a1|start|开始');
    expect(texts).toContain('a1|tool|改了 readerGates.test.ts');
    expect(texts).toContain('a3|done|完成');

    // the same summary again (a progress-only resend) says nothing new
    const before = snapshotBg(s).events.length;
    applyBg(s, progress(running), T0 + 1500);
    expect(snapshotBg(s).events.length).toBe(before);

    applyBg(s, progress([agent(4, { state: 'error', agentId: 'aa4', startedAt: T0 + 2000, error: 'API Error: 529' })]), T0 + 3000);
    expect(snapshotBg(s).tasks[0].agents[3]).toMatchObject({ state: 'failed', error: 'API Error: 529' });
    expect(snapshotBg(s).events.at(-1)).toMatchObject({ who: 'a4', tone: 'error', text: '失败：API Error: 529' });

    applyBg(s, sys('task_notification', { task_id: 'wf1', status: 'completed', summary: 'done', output_file: 'x' }), T0 + 4000);
    t = snapshotBg(s).tasks[0];
    expect(t).toMatchObject({ status: 'completed', endedAt: T0 + 4000, summary: 'done' });
    // what was still queued / running when the workflow ended is settled with it
    expect(t.agents.map((a) => a.state)).toEqual(['done', 'done', 'done', 'failed', 'done']);
  });

  it('a feed line is one short line', () => {
    const s = createBgState('s1');
    applyBg(s, sys('task_started', { task_id: 'wf1', description: 'x', task_type: 'local_workflow' }), T0);
    applyBg(s, progress([agent(1, { state: 'progress', agentId: 'q', lastToolSummary: `line one
${'x'.repeat(300)}` })]), T0 + 1);
    const e = snapshotBg(s).events.find((x) => x.tone === 'tool')!;
    expect(e.text.length).toBe(MAX_EVENT_TEXT);
    expect(e.text.startsWith('line one x')).toBe(true);
    expect(e.text.endsWith('…')).toBe(true);
  });

  it('a reused result says so', () => {
    const s = createBgState('s1');
    applyBg(s, sys('task_started', { task_id: 'wf1', description: 'x', task_type: 'local_workflow' }), T0);
    applyBg(s, progress([agent(1, { state: 'done', cached: true, agentId: 'aa1' })]), T0 + 1);
    expect(snapshotBg(s).events.at(-1)).toMatchObject({ tone: 'done', text: '用了上次的结果' });
  });

  it('a sub-agent task is one character; a background command is a machine', () => {
    const s = createBgState('s1');
    applyBg(s, sys('task_started', { task_id: 'a77', tool_use_id: 'tu2', description: '查一下 reducer', task_type: 'local_agent', subagent_type: 'Explore', is_backgrounded: false }), T0);
    applyBg(s, sys('task_started', { task_id: 'b1', description: 'npm run dev', task_type: 'local_bash', is_backgrounded: true }), T0 + 1);
    applyBg(s, sys('task_progress', { task_id: 'a77', description: 'x', usage: { total_tokens: 5000, tool_uses: 3, duration_ms: 9 }, last_tool_name: 'Grep', summary: 'Searching the reducer' }), T0 + 2);
    const [ag, sh] = snapshotBg(s).tasks;
    expect(ag).toMatchObject({ kind: 'agent', backgrounded: false, toolUses: 3, lastTool: 'Grep' });
    expect(ag.agents).toEqual([expect.objectContaining({ key: 'a77', agentId: 'a77', label: '查一下 reducer', agentType: 'Explore', state: 'running', color: 1, toolCalls: 3, lastSummary: 'Searching the reducer', beats: [T0 + 2] })]);
    expect(sh).toMatchObject({ kind: 'shell', backgrounded: true, agents: [] });
    applyBg(s, sys('task_notification', { task_id: 'a77', status: 'failed', summary: 'boom', output_file: '' }), T0 + 3);
    applyBg(s, sys('task_updated', { task_id: 'b1', patch: { status: 'killed' } }), T0 + 4);
    const [ag2, sh2] = snapshotBg(s).tasks;
    expect(ag2.agents[0].state).toBe('failed');
    expect(sh2.status).toBe('stopped');
  });

  it('ignores ambient tasks and messages that are not about tasks', () => {
    const s = createBgState('s1');
    expect(applyBg(s, sys('task_started', { task_id: 'm', description: 'watch', task_type: 'monitor_mcp', ambient: true }), T0)).toBe(false);
    expect(applyBg(s, sys('task_started', { task_id: 'n', description: 'x', skip_transcript: true }), T0)).toBe(false);
    expect(applyBg(s, { type: 'assistant', message: {} }, T0)).toBe(false);
    expect(applyBg(s, sys('task_progress', { task_id: 'unknown', usage: {} }), T0)).toBe(false);
    expect(snapshotBg(s).tasks).toEqual([]);
  });

  it('a progress for a task it never saw start still shows up (a window opened mid-run)', () => {
    const s = createBgState('s1');
    expect(applyBg(s, progress([phase(1, 'p'), agent(1, { state: 'progress', agentId: 'q' })]), T0)).toBe(true);
    expect(snapshotBg(s).tasks[0]).toMatchObject({ id: 'wf1', kind: 'workflow', status: 'running' });
  });

  it('when the process goes, everything running stops with it', () => {
    const s = createBgState('s1');
    applyBg(s, sys('task_started', { task_id: 'wf1', description: 'x', task_type: 'local_workflow' }), T0);
    applyBg(s, progress([agent(1, { state: 'progress', agentId: 'q' }), agent(2, { state: 'start' })]), T0 + 1);
    applyBg(s, sys('task_started', { task_id: 'b1', description: 'sleep', task_type: 'local_bash' }), T0 + 2);
    applyBg(s, sys('task_notification', { task_id: 'b1', status: 'completed', summary: '', output_file: '' }), T0 + 3);
    expect(endRunning(s, '进程结束了', T0 + 10)).toBe(true);
    const [wf, sh] = snapshotBg(s).tasks;
    expect(wf).toMatchObject({ status: 'stopped', reason: '进程结束了', endedAt: T0 + 10 });
    expect(wf.agents.map((a) => a.state)).toEqual(['failed', 'failed']);
    expect(sh.status).toBe('completed');
    expect(endRunning(s, 'again', T0 + 11)).toBe(false);
  });

  it('keeps the latest events, and the snapshot carries fewer', () => {
    const s = createBgState('s1');
    applyBg(s, sys('task_started', { task_id: 'a1', description: 'x', task_type: 'local_agent' }), T0);
    for (let i = 0; i < MAX_EVENTS + 30; i++) applyBg(s, sys('task_progress', { task_id: 'a1', usage: { total_tokens: 1, tool_uses: i, duration_ms: 1 }, summary: `step ${i}` }), T0 + i);
    expect(s.allEvents.length).toBe(MAX_EVENTS);
    const snap = snapshotBg(s);
    expect(snap.events.length).toBe(SNAPSHOT_EVENTS);
    expect(snap.events.at(-1)!.text).toBe(`step ${MAX_EVENTS + 29}`);
    expect(s.tasks[0].agents[0].beats.length).toBe(24);
  });

  it('colours go round in the order agents appear, across tasks', () => {
    const s = createBgState('s1');
    for (let i = 0; i < 12; i++) applyBg(s, sys('task_started', { task_id: `a${i}`, description: 'x', task_type: 'local_agent' }), T0 + i);
    expect(snapshotBg(s).tasks.map((t) => t.agents[0].color)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2]);
  });
});
