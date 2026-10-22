import { describe, expect, it } from 'vitest';
import { Demo, DEMO_SEED, GUESTS, LOOP_MS, PHASE_START, phaseAt, snapshotAt } from './demo';

/** One loop in 100 ms steps; what happened when. */
function watch() {
  const d = new Demo(DEMO_SEED);
  const seen: { t: number; key: string; doing: string; activity?: string }[] = [];
  let needsYouAt = -1;
  const receipts = new Map<string, number>();
  for (let t = 100; t < LOOP_MS; t += 100) {
    d.advance(100);
    for (const a of d.world.actors) seen.push({ t: d.t, key: a.key, doing: a.doing, activity: a.activity });
    if (needsYouAt < 0 && d.needsYou()) needsYouAt = d.t;
    for (const r of d.world.receipts) if (!receipts.has(r.key)) receipts.set(r.key, d.t);
  }
  return { seen, needsYouAt, receipts };
}

describe('the demo day', () => {
  it('names the phases by the clock', () => {
    expect(phaseAt(0)).toBe('idle');
    expect(phaseAt(3000)).toBe('arrive');
    expect(phaseAt(19_000)).toBe('needsYou');
    expect(phaseAt(59_999)).toBe('done');
    expect(PHASE_START.checkout).toBe(24_000);
  });

  it('has nobody in it at 0 s and four guests over the loop', () => {
    expect(snapshotAt(0).tasks).toEqual([]);
    expect(snapshotAt(5000).tasks.map((t) => t.id)).toEqual(['api', 'tests', 'docs']);
    expect(snapshotAt(31_000).tasks.map((t) => t.id)).toEqual(['api', 'tests', 'docs', 'lint']);
    expect(snapshotAt(31_000).tasks.find((t) => t.id === 'lint')!.agents[0].color).toBe(5);
  });

  const { seen, needsYouAt, receipts } = watch();
  const at = (key: string, from: number, to: number) => seen.filter((s) => s.key === key && s.t >= from && s.t <= to);

  it('3 s: three guests walk in and check in', () => {
    for (const k of [GUESTS.api, GUESTS.tests, GUESTS.docs]) expect(at(k, 3000, 11_000).some((s) => s.doing === 'toDesk' || s.doing === 'checkin')).toBe(true);
  });
  it('api works at its seat', () => {
    expect(at(GUESTS.api, 8000, 18_000).some((s) => s.doing === 'work')).toBe(true);
  });
  it('docs goes for noodles', () => {
    expect(at(GUESTS.docs, 8000, 22_000).some((s) => (s.doing === 'toActivity' || s.doing === 'activity') && s.activity === 'eat')).toBe(true);
  });
  it('18 s: api needs you', () => {
    expect(needsYouAt).toBeGreaterThanOrEqual(18_000);
    expect(needsYouAt).toBeLessThan(18_200);
  });
  it('24 s: tests checks out with a receipt', () => {
    expect(receipts.get(GUESTS.tests)).toBeGreaterThan(24_000);
    expect(receipts.get(GUESTS.tests)).toBeLessThan(36_000);
  });
  it('30 s: a fourth guest, lint, comes in', () => {
    expect(at(GUESTS.lint, 30_000, 40_000).length).toBeGreaterThan(0);
  });
  it('40 s: everybody pays before the loop ends', () => {
    for (const k of Object.values(GUESTS)) expect(receipts.get(k)).toBeLessThan(LOOP_MS);
  });

  it('jumpTo gives the same world as playing there, whatever the frame length', () => {
    const a = new Demo(DEMO_SEED);
    a.jumpTo('checkout');
    const b = new Demo(DEMO_SEED);
    while (b.t < PHASE_START.checkout) b.advance(Math.min(16.7, PHASE_START.checkout - b.t));
    expect(a.t).toBe(b.t);
    expect(JSON.stringify(a.world.actors)).toBe(JSON.stringify(b.world.actors));
  });

  it('a decision ends "needs you" and api works on', () => {
    const d = new Demo(DEMO_SEED);
    d.jumpTo('needsYou');
    d.advance(1000);
    expect(d.needsYou()).toBe(true);
    d.decide(true);
    expect(d.needsYou()).toBe(false);
    d.advance(2100);
    const api = d.snapshot().tasks.find((t) => t.id === 'api')!.agents[0];
    expect(api.beats.at(-1)).toBeGreaterThan(d.now() - 2500);
  });

  it('loops with the same seed', () => {
    const d = new Demo(DEMO_SEED);
    d.decide(true);
    d.advance(LOOP_MS + 1000);
    expect(d.t).toBe(1000);
    expect(d.decision).toBeUndefined();
  });
});
