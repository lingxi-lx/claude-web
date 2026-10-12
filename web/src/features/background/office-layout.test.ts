import { describe, expect, it } from 'vitest';
import type { BgAgent, BgTask } from '@shared';
import { AISLE, QUEUE_SPOTS, clip, layoutOffice, monitorBars, officeRows, queueSpot, seatOf, textWidth, toFloor, type OfficeLayout } from './office-layout';

let seq = 0;
const agent = (over: Partial<BgAgent> = {}): BgAgent => ({ key: `w${seq}`, color: (seq++ % 10) + 1, label: `agent-${seq}`, state: 'running', beats: [], ...over });
const workflow = (id: string, phases: [number, string, number][], over: Partial<BgTask> = {}): BgTask => ({
  id, kind: 'workflow', description: id, name: id, status: 'running', startedAt: 1,
  phases: phases.map(([index, title]) => ({ index, title })),
  agents: phases.flatMap(([index, title, n]) => Array.from({ length: n }, (_, i) => agent({ key: `w${index}-${i}`, phase: index, phaseTitle: title }))),
  ...over,
});
const sub = (id: string, over: Partial<BgAgent> = {}): BgTask => ({ id, kind: 'agent', description: id, status: 'running', startedAt: 1, agents: [agent({ key: id, label: id, agentType: 'Explore', ...over })] });
const shell = (id: string): BgTask => ({ id, kind: 'shell', description: `npm run ${id}`, status: 'running', startedAt: 1, agents: [] });

/** The floor and wall area a desk draws on (Office.tsx: top face, two sides, the monitor above the back edge). */
const deskBox = (l: OfficeLayout, i: number) => { const d = l.desks[i]; return { x0: d.x - 2, x1: d.x + 66, y0: d.y - 37, y1: d.y + 28 }; };
const overlaps = (a: { x0: number; x1: number; y0: number; y1: number }, b: typeof a) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const inside = (l: OfficeLayout, p: { x: number; y: number }) => p.x >= 0 && p.x <= l.width && p.y >= 0 && p.y <= l.height;
/** Inside the floor diamond (with a little slack for the edges). */
const onFloor = (l: OfficeLayout, p: { x: number; y: number }, slack = 0.05) => {
  const { u, v } = toFloor(l, p);
  const U = toFloor(l, l.room.left).u, V = toFloor(l, l.room.right).v;
  return u >= -slack && v >= -slack && u <= U + slack && v <= V + slack;
};

describe('office layout (spec 2026-10-12 §3)', () => {
  const twoPhases = [workflow('wf', [[0, '文字回合', 3], [1, '图片回合', 3]]), sub('task-a'), shell('dev')];

  it('one row per workflow phase in phase order, then 子代理; desks in task / agent order', () => {
    const t = workflow('wf', [[2, 'C', 1], [0, 'A', 2], [1, 'B', 1]]);
    const l = layoutOffice([t, sub('s1'), sub('s2')]);
    expect(l.rows.map((r) => r.label)).toEqual(['A', 'B', 'C', '子代理']);
    expect(l.desks.map((d) => [d.row, d.key])).toEqual([[0, 'w0-0'], [0, 'w0-1'], [1, 'w1-0'], [2, 'w2-0'], [3, 's1'], [3, 's2']]);
    expect(l.desks.slice(4).map((d) => d.taskId)).toEqual(['s1', 's2']);
    // each row sits further from the screen wall than the one before
    const vs = l.rows.map((r) => toFloor(l, r).v);
    for (let i = 1; i < vs.length; i++) expect(vs[i]).toBeGreaterThan(vs[i - 1]);
  });

  it('agents with no phase sit in a row named after their workflow; empty phases take no row', () => {
    const t = workflow('wf', [[0, 'A', 1], [1, 'B', 0]], { name: 'bench-phase4' });
    t.agents.push(agent({ key: 'loose' }));
    expect(officeRows([t]).map((r) => [r.label, r.items.length])).toEqual([['A', 1], ['bench-phase4', 1]]);
  });

  it('a phase only the agents know about still gets its row and their title', () => {
    const t = workflow('wf', [[0, 'A', 1]]);
    t.agents.push(agent({ key: 'x', phase: 3, phaseTitle: '收尾' }), agent({ key: 'y', phase: 2 }));
    expect(officeRows([t]).map((r) => r.label)).toEqual(['A', '阶段 3', '收尾']);
  });

  it('two workflows: each phase row says whose it is', () => {
    const rows = officeRows([workflow('wf-a', [[0, '读', 1]]), workflow('wf-b', [[0, '读', 1]])]);
    expect(rows.map((r) => r.label)).toEqual(['wf-a · 读', 'wf-b · 读']);
  });

  it('nothing overlaps: desks, machines, the queue at the door, the overflow sign', () => {
    const big = workflow('wf', [[0, 'A', 30], [1, 'B', 7]]);
    const l = layoutOffice([big, sub('s1'), shell('a'), shell('b'), shell('c')]);
    const boxes = l.desks.map((d, i) => (d.kind === 'agent' ? deskBox(l, i) : { x0: d.x - 12, x1: d.x + 12, y0: d.y - 26, y1: d.y + 6 }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `${i} / ${j}`).toBe(false);
    const queue = Array.from({ length: QUEUE_SPOTS }, (_, i) => queueSpot(l, i));
    for (const q of queue) for (const b of boxes) expect(overlaps({ x0: q.x - 12, x1: q.x + 12, y0: q.y - 20, y1: q.y + 5 }, b)).toBe(false);
    for (const o of l.overflow) for (const b of boxes) expect(overlaps({ x0: o.x - 24, x1: o.x + 24, y0: o.y - 30, y1: o.y + 4 }, b)).toBe(false);
    // seats are distinct and every character stands on the floor
    const seats = l.desks.filter((d) => d.kind === 'agent').map(seatOf);
    expect(new Set(seats.map((s) => `${s.x},${s.y}`)).size).toBe(seats.length);
    for (const s of [...seats, ...queue]) expect(onFloor(l, s), JSON.stringify(s)).toBe(true);
  });

  it('wraps a phase every perRow desks, and stops at maxPerPhase with a 「还有 N 个」 sign at the end of its row', () => {
    const l = layoutOffice([workflow('wf', [[0, 'A', 30], [1, 'B', 2]])]);
    const a = l.desks.filter((d) => d.row === 0);
    expect(a).toHaveLength(24);
    expect(new Set(a.map((d) => toFloor(l, d).v.toFixed(2))).size).toBe(4); // 4 lines of 6
    expect(l.overflow).toEqual([expect.objectContaining({ row: 0, more: 6 })]);
    // the sign comes after the row's last desk, before the next row
    const sign = toFloor(l, l.overflow[0]);
    const last = toFloor(l, a[a.length - 1]);
    expect(sign.v).toBeGreaterThanOrEqual(last.v);
    expect(sign.v).toBeLessThan(toFloor(l, l.desks.find((d) => d.row === 1)!).v);
    expect(sign.u).toBeLessThan(last.u);

    const small = layoutOffice([workflow('wf', [[0, 'A', 10]])], { perRow: 4, maxPerPhase: 9 });
    expect(small.desks).toHaveLength(9);
    expect(new Set(small.desks.map((d) => toFloor(small, d).v.toFixed(2))).size).toBe(3); // 4 + 4 + 1
    expect(small.overflow[0].more).toBe(1);
    // the last line had room: the sign takes the next slot of that line
    const l9 = toFloor(small, small.desks[8]);
    expect(toFloor(small, small.overflow[0]).v).toBeCloseTo(l9.v + 1.2, 5);
  });

  it('background commands are machines in the back of the aisle by the door wall', () => {
    const l = layoutOffice(twoPhases);
    const shells = l.desks.filter((d) => d.kind === 'shell');
    expect(shells.map((d) => [d.key, d.taskId])).toEqual([['dev', 'dev']]);
    const door = toFloor(l, l.door);
    for (const s of shells) {
      const f = toFloor(l, s);
      expect(f.u).toBeLessThan(AISLE);
      expect(f.v).toBeLessThan(door.v - 1);
    }
    for (const d of l.desks.filter((x) => x.kind === 'agent')) expect(toFloor(l, d).u - 1).toBeGreaterThan(AISLE);
    // many machines push the door forward instead of piling into the queue
    const many = layoutOffice(Array.from({ length: 9 }, (_, i) => shell(`s${i}`)));
    const lastShell = Math.max(...many.desks.map((d) => toFloor(many, d).v));
    expect(toFloor(many, queueSpot(many, 1)).v).toBeGreaterThan(lastShell + 0.5);
  });

  it('the door is on the door wall, the screen on the screen wall, both inside the picture', () => {
    for (const l of [layoutOffice([]), layoutOffice(twoPhases), layoutOffice([workflow('wf', [[0, 'A', 40]])])]) {
      expect(toFloor(l, l.door).u).toBeCloseTo(0, 5);
      const s = l.screen;
      expect(toFloor(l, { x: s.x, y: s.y + 28 }).v).toBeCloseTo(0, 5);
      expect(toFloor(l, { x: s.x + s.w, y: s.y - s.w / 2 + 28 }).v).toBeCloseTo(0, 5);
      for (const p of [l.door, { x: s.x, y: s.y - s.h }, { x: s.x + s.w, y: s.y - s.w / 2 - s.h }, l.room.top, l.room.left, l.room.right, l.room.bottom, { x: l.room.top.x, y: l.room.top.y - l.room.wall }]) expect(inside(l, p), JSON.stringify(p)).toBe(true);
      for (const d of l.desks) expect(inside(l, d)).toBe(true);
      for (const r of l.rows) expect(r.x - textWidth(clip(r.label, 28), 12)).toBeGreaterThanOrEqual(0);
    }
  });

  it('the room grows with the rows and the longest line', () => {
    const one = layoutOffice([workflow('wf', [[0, 'A', 2]])]);
    const three = layoutOffice([workflow('wf', [[0, 'A', 2], [1, 'B', 2], [2, 'C', 2]])]);
    const wide = layoutOffice([workflow('wf', [[0, 'A', 6]])]);
    expect(three.height).toBeGreaterThan(one.height);
    expect(three.width).toBeGreaterThan(one.width);
    expect(wide.width).toBeGreaterThan(one.width);
    expect(three.room.grid.length).toBeGreaterThan(one.room.grid.length);
  });

  it('an empty office is an empty room of a sane size', () => {
    const l = layoutOffice([]);
    expect(l.desks).toEqual([]);
    expect(l.rows).toEqual([]);
    expect(l.overflow).toEqual([]);
    expect(l.width).toBeGreaterThan(400);
    expect(l.width).toBeLessThan(1000);
    expect(l.height).toBeGreaterThan(250);
    expect(l.height).toBeLessThan(700);
    expect(l.room.grid.length).toBeGreaterThan(0);
    // other tasks take no desk
    expect(layoutOffice([{ id: 'o', kind: 'other', description: 'x', status: 'running', startedAt: 1, agents: [] }]).desks).toEqual([]);
  });

  it('is deterministic: the same tasks give the same office', () => {
    expect(layoutOffice(twoPhases)).toEqual(layoutOffice(structuredClone(twoPhases)));
    const l = layoutOffice(twoPhases);
    expect(l.desks.map((d) => d.key)).toEqual(['w0-0', 'w0-1', 'w0-2', 'w1-0', 'w1-1', 'w1-2', 'task-a', 'dev']);
  });

  it('the queue fills the spots nearest the door first and keeps to them', () => {
    const l = layoutOffice(twoPhases);
    const door = toFloor(l, l.door);
    const d = (i: number) => { const f = toFloor(l, queueSpot(l, i)); return Math.hypot(f.u - door.u, f.v - door.v); };
    expect(d(0)).toBeLessThanOrEqual(d(3));
    expect(d(3)).toBeLessThanOrEqual(d(QUEUE_SPOTS - 1) + 1e-9);
    expect(queueSpot(l, QUEUE_SPOTS + 5)).toEqual(queueSpot(l, QUEUE_SPOTS - 1));
  });

  it('monitor bars: the last two minutes of tool calls, oldest bucket first', () => {
    const now = 1_000_000;
    expect(monitorBars([], now)).toEqual([0, 0, 0, 0, 0, 0]);
    // one call 10 s ago, three 50 s ago, one long ago (not shown), one in the future (not shown)
    const b = monitorBars([now - 10_000, now - 50_000, now - 50_500, now - 51_000, now - 500_000, now + 1], now);
    expect(b).toHaveLength(6);
    expect(b[5]).toBeCloseTo(1 / 3, 5);
    expect(b[3]).toBe(1);
    expect(b.filter((x) => x > 0)).toHaveLength(2);
    expect(Math.max(...monitorBars(Array.from({ length: 9 }, (_, i) => now - i * 100), now))).toBe(1);
  });

  it('clip: labels by display width (a CJK character is two)', () => {
    expect(clip('reader-gates', 20)).toBe('reader-gates');
    expect(clip('a-very-long-agent-name', 10)).toBe('a-very-lo…');
    expect(clip('一二三四五六七八', 8)).toBe('一二三…');
    expect(textWidth('ab', 12)).toBeLessThan(textWidth('一二', 12));
  });
});
