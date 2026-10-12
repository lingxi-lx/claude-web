import { describe, expect, it } from 'vitest';
import type { BgAgent, BgSession, BgTask } from '@shared';
import { agentColor, agentStateText, clock, liveCounts, orderedTasks, pillText, sortSessions, stopNote, taskStateText, taskTitle, tokensText } from './model';

const agent = (o: Partial<BgAgent> = {}): BgAgent => ({ key: 'w1', color: 1, label: 'a', state: 'running', beats: [], ...o });
const task = (o: Partial<BgTask> = {}): BgTask => ({ id: 't', kind: 'workflow', description: 'd', status: 'running', startedAt: 1, agents: [], ...o });
const session = (tasks: BgTask[], updatedAt = 1): BgSession => ({ sessionId: 's', updatedAt, tasks, events: [] });

describe('后台 words', () => {
  it('counts what is running', () => {
    const s = session([
      task({ id: 'wf', name: 'bench', agents: [agent(), agent({ key: 'w2', state: 'running' }), agent({ key: 'w3', state: 'queued' }), agent({ key: 'w4', state: 'done' })] }),
      task({ id: 'a', kind: 'agent', backgrounded: true, agents: [agent({ key: 'a' })] }),
      task({ id: 'b', kind: 'shell', backgrounded: true }),
      task({ id: 'old', kind: 'shell', status: 'completed' }),
    ]);
    expect(liveCounts(s)).toEqual({ tasks: 3, workflows: 1, agents: 1, shells: 1, running: 3 });
    expect(pillText(s)).toBe('后台 · 1 个工作流 · 1 个子代理 · 1 条命令 · 3 个在跑');
    expect(pillText(session([task({ agents: [agent()] })]))).toBe('后台 · 1 个工作流 · 1 个在跑');
    expect(pillText(session([task({ kind: 'agent', agents: [agent()] })]))).toBe('后台 · 1 个子代理');
    expect(pillText(session([task({ status: 'completed' })]))).toBeNull();
    expect(pillText(undefined)).toBeNull();
  });

  it('after the turn\'s Stop, says what kept running in the background', () => {
    expect(stopNote(session([task(), task({ id: 'x', kind: 'agent', backgrounded: false })]))).toBe('后台还有 1 个任务在跑，在「后台」里停');
    expect(stopNote(session([task({ kind: 'agent', backgrounded: false })]))).toBeNull();
    expect(stopNote(undefined)).toBeNull();
  });

  it('names states and tasks', () => {
    expect(['queued', 'running', 'done', 'failed'].map((state) => agentStateText(agent({ state: state as BgAgent['state'] })))).toEqual(['排队', '在跑', '完成', '失败']);
    expect(agentStateText(agent({ state: 'done', cached: true }))).toBe('用了上次的结果');
    expect(taskStateText(task({ status: 'stopped', reason: '进程结束了' }))).toBe('已停止 · 进程结束了');
    expect(taskTitle(task({ name: 'bench' }))).toBe('bench');
    expect(taskTitle(task({ kind: 'agent', agents: [agent({ label: '查 reducer' })] }))).toBe('查 reducer');
    expect(taskTitle(task({ kind: 'shell', description: '' }))).toBe('后台命令');
  });

  it('colours go round ten', () => {
    expect([1, 10, 11, 0].map(agentColor)).toEqual(['var(--agent-1)', 'var(--agent-10)', 'var(--agent-1)', 'var(--agent-1)']);
  });

  it('orders conversations and tasks: running first, newest first', () => {
    const ended = { ...session([task({ status: 'completed' })], 9), sessionId: 'ended' };
    const live = { ...session([task()], 1), sessionId: 'live' };
    const live2 = { ...session([task()], 5), sessionId: 'live2' };
    expect(sortSessions([ended, live, live2]).map((s) => s.sessionId)).toEqual(['live2', 'live', 'ended']);
    expect(orderedTasks(session([task({ id: 'a', status: 'completed', startedAt: 9 }), task({ id: 'b', startedAt: 1 }), task({ id: 'c', startedAt: 5 })])).map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });

  it('formats time and tokens', () => {
    expect(clock(192_000)).toBe('3:12');
    expect(clock(3_723_000)).toBe('1:02:03');
    expect(tokensText(142_000)).toBe('142.0k');
    expect(tokensText(undefined)).toBe('0');
    expect(tokensText(1_500_000)).toBe('1.5M');
  });
});
