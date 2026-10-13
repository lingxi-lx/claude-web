import { describe, expect, it } from 'vitest';
import type { BgAgent, BgSession, BgTask } from '@shared';
import { createWorld, step, MISSING_MS, type Doing, type World } from './sim';
import { estimateUsd, fee } from './money';

const T0 = 1_800_000_000_000;
const opts = { rate: 5, mainBusy: false, reduced: false };
const agent = (o: Partial<BgAgent> = {}): BgAgent => ({ key: 'a1', color: 2, label: 'researcher', state: 'running', beats: [], ...o });
const task = (agents: BgAgent[], o: Partial<BgTask> = {}): BgTask => ({ id: 't1', kind: 'agent', description: 'x', status: 'running', startedAt: T0, agents, ...o });
const sess = (tasks: BgTask[]): BgSession => ({ sessionId: 's', updatedAt: T0, tasks, events: [] });

/** Run from `from` to `to` in 100 ms steps; the doings each actor went through, in order, without repeats. */
function run(w: World, snap: (t: number) => BgSession | undefined, from: number, to: number, o = opts) {
  const seen: Record<string, Doing[]> = {};
  for (let t = from; t <= to; t += 100) {
    w = step(w, snap(t), t, o);
    for (const x of w.actors) {
      const l = (seen[x.key] ??= []);
      if (l.at(-1) !== x.doing) l.push(x.doing);
    }
  }
  return { w, seen };
}

describe('money', () => {
  it('网费 by the hour, dollars from the input price', () => {
    expect(fee(30 * 60_000, 5)).toBe(2.5);
    expect(fee(-5, 5)).toBe(0);
    expect(estimateUsd(1_000_000, 'claude-sonnet-5')).toBe(3);
    expect(estimateUsd(1000, 'gpt-5')).toBeUndefined();
    expect(estimateUsd(undefined, 'claude-opus-5-5')).toBeUndefined();
  });
});

describe('a guest', () => {
  it('walks in, checks in, sits down and works while its agent works', () => {
    const w0 = createWorld(1, T0 - 10_000);
    const live = (t: number) => sess([task([agent({ startedAt: T0, beats: [t - 1000] })])]);
    const { w, seen } = run(w0, (t) => (t >= T0 ? live(t) : undefined), T0 - 1000, T0 + 30_000);
    expect(seen['t1/a1']).toEqual(['toDesk', 'checkin', 'toSeat', 'work']);
    const x = w.actors[0];
    const seat = w.map.seats.find((s) => s.key === 't1/a1')!;
    expect([x.u, x.v]).toEqual([seat.chair.u, seat.chair.v]);
    expect(x.screen).toBe('code');
    expect(x.seat).toBe(seat.no);
    expect(w.admin.bubble?.text ?? '').toMatch(/^$|号机/);
  });
  it('with nothing to do it goes off to do something, and comes back when there is work', () => {
    let beat = T0;
    const snap = () => sess([task([agent({ startedAt: T0, beats: [beat] })])]);
    let { w } = run(createWorld(7, T0 - 10_000), (t) => (t >= T0 ? snap() : undefined), T0 - 1000, T0 + 15_000);
    expect(w.actors[0].doing).toBe('work');
    // quiet for a while: idle
    const r = run(w, snap, T0 + 15_100, T0 + 40_000);
    w = r.w;
    expect(r.seen['t1/a1'].some((d) => d === 'game' || d === 'toActivity' || d === 'activity')).toBe(true);
    // a tool call: back to work within 5 s
    beat = T0 + 40_100;
    const back = run(w, snap, T0 + 40_100, T0 + 46_000);
    expect(back.w.actors[0].doing).toBe('work');
  });
  it('a workflow agent that is done waits (idle) until its workflow ends, then pays and leaves', () => {
    const a = (t: number) => agent(t < T0 + 5000 ? { startedAt: T0, beats: [T0] } : { startedAt: T0, state: 'done', endedAt: T0 + 5000, tokens: 40_000, model: 'claude-haiku-4-5' });
    const other = agent({ key: 'a2', label: 'writer', startedAt: T0, beats: [T0 + 9000] });
    let wfStatus: BgTask['status'] = 'running';
    const snap = (t: number) => sess([task([a(t), other], { kind: 'workflow', status: wfStatus, ...(wfStatus !== 'running' ? { endedAt: T0 + 30_000 } : {}) })]);
    let { w, seen } = run(createWorld(3, T0 - 10_000), snap, T0 - 500, T0 + 25_000);
    expect(seen['t1/a1']).not.toContain('toCheckout');
    wfStatus = 'completed';
    const end = run(w, snap, T0 + 25_100, T0 + 60_000);
    w = end.w;
    seen = end.seen;
    expect(seen['t1/a1']).toEqual(expect.arrayContaining(['toCheckout', 'checkout', 'leave']));
    expect(w.actors.find((x) => x.key === 't1/a1')).toBeUndefined();
    const r = w.receipts.find((x) => x.key === 't1/a1')!;
    expect(r).toMatchObject({ name: 'researcher', ms: 5000, fee: fee(5000, 5), tokens: 40_000, kind: 'ok' });
    expect(r.usd).toBeCloseTo(0.04);
    expect(w.dings.length + 1).toBeGreaterThan(0);
  });
  it('a failed one gets a blue screen and pays as 异常下机; a stopped one is 被叫下机', () => {
    let state: BgAgent['state'] = 'running';
    const snap = (t: number) => sess([task([agent({ startedAt: T0, beats: [t - 500], state, ...(state !== 'running' ? { endedAt: t } : {}) })], { kind: 'workflow' })]);
    let { w } = run(createWorld(5, T0 - 10_000), snap, T0 - 500, T0 + 20_000);
    state = 'failed';
    const r = run(w, snap, T0 + 20_100, T0 + 50_000);
    expect(r.seen['t1/a1']).toEqual(expect.arrayContaining(['bsod', 'toCheckout', 'checkout']));
    expect(r.w.receipts[0].kind).toBe('failed');
    state = 'running';
    w = run(createWorld(5, T0 - 10_000), snap, T0 - 500, T0 + 20_000).w;
    state = 'stopped';
    const s = run(w, snap, T0 + 20_100, T0 + 50_000);
    expect(s.seen['t1/a1']).not.toContain('bsod');
    expect(s.w.receipts[0].kind).toBe('stopped');
  });
  it('one that vanishes from the snapshot waits, then is gone without paying', () => {
    const live = sess([task([agent({ startedAt: T0, beats: [T0 + 9000] })])]);
    let { w } = run(createWorld(9, T0 - 10_000), () => live, T0 - 500, T0 + 15_000);
    const r = run(w, () => undefined, T0 + 15_100, T0 + 15_100 + MISSING_MS - 1000);
    expect(r.w.actors[0].doing).toBe('wait');
    w = run(r.w, () => undefined, T0 + 15_100 + MISSING_MS - 900, T0 + 15_100 + MISSING_MS + 2000).w;
    expect(w.actors).toHaveLength(0);
    expect(w.receipts).toHaveLength(0);
  });
  it('what was already running when the cafe opened is at its seat at once; the same seed replays the same run', () => {
    const live = (t: number) => sess([task([agent({ startedAt: T0 - 60_000, beats: [t - 100] })])]);
    const w = step(createWorld(11, T0), live(T0), T0, opts);
    const s = w.map.seats.find((x) => x.key === 't1/a1')!;
    expect([w.actors[0].u, w.actors[0].v]).toEqual([s.chair.u, s.chair.v]);
    const a = run(createWorld(42, T0 - 10_000), (t) => sess([task([agent({ startedAt: T0, beats: [T0] })])]), T0, T0 + 60_000);
    const b = run(createWorld(42, T0 - 10_000), (t) => sess([task([agent({ startedAt: T0, beats: [T0] })])]), T0, T0 + 60_000);
    expect(JSON.stringify(a.seen)).toBe(JSON.stringify(b.seen));
    expect(a.w.actors.map((x) => [x.u, x.v, x.doing])).toEqual(b.w.actors.map((x) => [x.u, x.v, x.doing]));
  });
  it('with reduced motion a newcomer is at the counter at once', () => {
    const w = step(createWorld(1, T0 - 10_000), sess([task([agent({ startedAt: T0, beats: [T0] })])]), T0, { ...opts, reduced: true });
    expect([w.actors[0].u, w.actors[0].v]).toEqual([w.map.counter.u, w.map.counter.v]);
  });
});

describe('the admin', () => {
  it('types at the counter while the main conversation works, and says hello', () => {
    const w = step(createWorld(1, T0), undefined, T0 + 100, { ...opts, mainBusy: true });
    expect(w.admin.pose).toBe('type');
    expect([w.admin.u, w.admin.v]).toEqual([w.map.admin.u, w.map.admin.v]);
  });
  it('shouts now and then', () => {
    const { w } = run(createWorld(1, T0), () => undefined, T0, T0 + 25_000);
    expect(w.shout?.text ?? 'x').toBeTruthy();
    expect(w.nextShout).toBeGreaterThan(T0 + 20_000);
  });
});
