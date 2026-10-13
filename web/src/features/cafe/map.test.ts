import { describe, expect, it } from 'vitest';
import type { BgAgent, BgSession, BgTask } from '@shared';
import { buildMap, guestKey, KEEP_ENDED_MS, MAX_ROWS, SEATS_PER_ROW, seatOf, walkable } from './map';
import { findPath } from './path';
import { toFloor, toScreen } from './iso';

const NOW = 1_800_000_000_000;
const agent = (key: string, o: Partial<BgAgent> = {}): BgAgent => ({ key, color: 1, label: key, state: 'running', beats: [], ...o });
const wf = (id: string, agents: BgAgent[], o: Partial<BgTask> = {}): BgTask => ({ id, kind: 'workflow', description: 'wf', name: id, status: 'running', startedAt: NOW - 1000, agents, phases: [{ index: 1, title: 'One' }, { index: 2, title: 'Two' }], ...o });
const sub = (id: string, o: Partial<BgTask> = {}): BgTask => ({ id, kind: 'agent', description: id, status: 'running', startedAt: NOW - 500, agents: [agent(id, { agentType: 'Explore' })], ...o });
const shell = (id: string): BgTask => ({ id, kind: 'shell', description: 'npm run dev', status: 'running', startedAt: NOW, agents: [] });
const sess = (tasks: BgTask[]): BgSession => ({ sessionId: 's', updatedAt: NOW, tasks, events: [] });

describe('iso', () => {
  it('goes to the screen and back', () => {
    const p = toScreen(5, 3);
    const f = toFloor(p.x, p.y);
    expect(f.u).toBeCloseTo(5);
    expect(f.v).toBeCloseTo(3);
  });
});

describe('buildMap', () => {
  it('an empty cafe still has two rows of free seats, a door, a counter the admin stands behind', () => {
    const m = buildMap(undefined, NOW);
    expect(m.seats).toHaveLength(2 * SEATS_PER_ROW);
    expect(m.seats.every((s) => !s.key)).toBe(true);
    expect(m.full).toBe(false);
    for (const p of [m.door, m.counter, m.admin]) expect(walkable(m, p.u, p.v)).toBe(true);
    expect(findPath(m, [m.door.u, m.door.v], [m.counter.u, m.counter.v])).not.toBeNull();
  });
  it('a row per phase, then one for single sub-agents; seats are numbered in order and stable', () => {
    const s = sess([wf('w1', [agent('w1', { phase: 1 }), agent('w2', { phase: 1 }), agent('w3', { phase: 1 }), agent('w4', { phase: 2 }), agent('w5', { phase: 2 })]), sub('a1')]);
    const m = buildMap(s, NOW);
    expect(m.rowLabels.map((r) => r.text)).toEqual(['w1 · One', 'w1 · Two', '子代理']);
    const taken = m.seats.filter((x) => x.key);
    expect(taken.map((x) => x.key)).toEqual(['w1/w1', 'w1/w2', 'w1/w3', 'w1/w4', 'w1/w5', 'a1/a1']);
    expect(seatOf(m, guestKey('w1', 'w4'))!.row).toBe(1);
    expect(seatOf(m, 'a1/a1')!.taskId).toBe('a1');
    expect(buildMap(s, NOW).seats).toEqual(m.seats);
    expect(m.seats.map((x) => x.no)).toEqual(m.seats.map((_, i) => i + 1));
  });
  it('more guests than seats: 8 rows, the rest wait', () => {
    const many = Array.from({ length: 70 }, (_, i) => agent(`a${i}`, { phase: 1 }));
    const m = buildMap(sess([wf('w', many)]), NOW);
    expect(m.seats.filter((s) => s.key)).toHaveLength(MAX_ROWS * SEATS_PER_ROW);
    expect(m.overflow).toBe(6);
    expect(m.full).toBe(true);
  });
  it('commands are machines in the VIP room; a task that ended long ago is gone', () => {
    const m = buildMap(sess([shell('b1'), sub('old', { status: 'completed', endedAt: NOW - KEEP_ENDED_MS - 1 }), sub('new', { status: 'completed', endedAt: NOW - 1000 })]), NOW);
    expect(m.machines).toEqual([{ taskId: 'b1', u: 33, v: 2 }]);
    expect(m.seats.filter((s) => s.key).map((s) => s.key)).toEqual(['new/new']);
  });
  it('every seat, spot and the queue can be reached from the door, along free tiles', () => {
    const m = buildMap(sess([wf('w1', [agent('w1', { phase: 1 }), agent('w2', { phase: 2 })]), sub('a1')]), NOW);
    const targets = [...m.seats.map((s) => [s.chair.u, s.chair.v] as [number, number]), ...m.spots.map((s) => [s.u, s.v] as [number, number]), ...m.queue.map((q) => [q.u, q.v] as [number, number])];
    for (const t of targets) {
      const p = findPath(m, [m.door.u, m.door.v], t);
      expect(p, JSON.stringify(t)).not.toBeNull();
      for (let i = 1; i < p!.length; i++) {
        expect(Math.abs(p![i][0] - p![i - 1][0]) + Math.abs(p![i][1] - p![i - 1][1])).toBe(1);
        expect(walkable(m, p![i][0], p![i][1])).toBe(true);
      }
    }
  });
  it('a blocked goal cannot be reached; a blocked start walks off', () => {
    const m = buildMap(undefined, NOW);
    expect(findPath(m, [5, 5], [0, 0])).toBeNull();
    const desk = m.seats[0];
    expect(findPath(m, [desk.u, desk.v], [desk.chair.u, desk.chair.v])).not.toBeNull();
  });
});
