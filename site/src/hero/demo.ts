// The site's demo day (spec §4.1): a 60 s loop of the conversation's background, fed to the product's café sim
// exactly as the app feeds it, at a fixed seed — every visitor sees the same show.
//   0 s nobody · 3 s api / tests / docs come in · ~12 s docs (nothing to do) goes for noodles · 18 s api needs you
//   (its beats stop; the site shows a permission card) · 24 s tests done → pays · 30 s lint (another colour) comes
//   in, docs back to work · 40 s all done → they pay and leave · 60 s again.
import { createWorld, step, type BgAgent, type BgSession, type BgTask, type World } from './engine';

export const EPOCH = 1_800_000_000_000;
export const LOOP_MS = 60_000;
export const STEP_MS = 50;
export const POSTER_MS = 20_000;
/** Chosen so docs' first idle pick is the noodles (demo.test.ts "docs goes for noodles"). */
export const DEMO_SEED = 7;

export type DemoPhase = 'idle' | 'arrive' | 'noodles' | 'needsYou' | 'checkout' | 'guest' | 'done';
export const PHASE_START: Record<DemoPhase, number> = { idle: 0, arrive: 3000, noodles: 12_000, needsYou: 18_000, checkout: 24_000, guest: 30_000, done: 40_000 };
const ORDER = Object.entries(PHASE_START).sort((a, b) => a[1] - b[1]) as [DemoPhase, number][];

export function phaseAt(t: number): DemoPhase {
  let p: DemoPhase = 'idle';
  for (const [name, start] of ORDER) if (t >= start) p = name;
  return p;
}

export interface Decision { at: number; allow: boolean }

export const GUESTS = { api: 'api/api', tests: 'tests/tests', docs: 'docs/docs', lint: 'lint/lint' } as const;

const NEEDS_FROM = PHASE_START.needsYou, NEEDS_TO = PHASE_START.checkout;
const STEPS: Record<string, string[]> = {
  api: ['Read src/cart.ts', 'Grep applyCoupon', 'Edit src/cart.ts', 'Bash npm test'],
  tests: ['Read tests/cart.test.ts', 'Edit tests/cart.test.ts', 'Bash npx vitest run'],
  docs: ['Read README.md', 'Edit docs/cart.md'],
  lint: ['Bash npm run lint', 'Edit src/orders.ts'],
};

interface Plan { id: string; color: number; start: number; end: number; beatFrom: number; noStart?: boolean; paused?: (t: number) => boolean }

function plans(decision: Decision | undefined): Plan[] {
  const resumed = decision?.at ?? NEEDS_TO;
  return [
    { id: 'api', color: 1, start: 3000, end: 40_000, beatFrom: 3000, paused: (t) => t >= NEEDS_FROM && t < resumed },
    { id: 'tests', color: 2, start: 3001, end: 24_000, beatFrom: 3001 },
    // no start time and no beats until 30 s: idle the moment it sits down
    { id: 'docs', color: 3, start: 3002, end: 40_000, beatFrom: 30_000, noStart: true },
    { id: 'lint', color: 5, start: 30_000, end: 40_000, beatFrom: 30_000 },
  ];
}

function agentAt(p: Plan, t: number): BgAgent {
  const done = t >= p.end;
  const until = Math.min(t, p.end);
  const beats: number[] = [];
  for (let b = p.beatFrom; b <= until; b += 2000) if (!p.paused?.(b)) beats.push(EPOCH + b);
  const steps = STEPS[p.id];
  return {
    key: p.id, color: p.color, label: p.id, state: done ? 'done' : 'running', model: 'claude-sonnet-4-5',
    ...(p.noStart ? {} : { startedAt: EPOCH + p.start }),
    ...(done ? { endedAt: EPOCH + p.end } : {}),
    tokens: Math.round(((until - p.start) / 1000) * 900),
    toolCalls: beats.length,
    ...(beats.length ? { lastSummary: steps[(beats.length - 1) % steps.length], lastTool: steps[(beats.length - 1) % steps.length].split(' ')[0] } : {}),
    beats: beats.slice(-24),
  };
}

export function snapshotAt(t: number, decision?: Decision): BgSession {
  const tasks: BgTask[] = [];
  for (const p of plans(decision)) {
    if (t < p.start) continue;
    const a = agentAt(p, t);
    tasks.push({
      id: p.id, kind: 'agent', description: p.id, status: a.state === 'done' ? 'completed' : 'running', startedAt: EPOCH + p.start,
      ...(a.state === 'done' ? { endedAt: EPOCH + p.end } : {}), tokens: a.tokens, agents: [a],
    });
  }
  return { sessionId: 'demo', updatedAt: EPOCH + t, tasks, events: [] };
}

export class Demo {
  t = 0;
  world: World;
  decision: Decision | undefined;
  private acc = 0;
  private snap: { key: string; s: BgSession } | undefined;

  constructor(private readonly seed = DEMO_SEED, private readonly rate = 5) {
    this.world = createWorld(seed, EPOCH);
  }

  now(): number { return EPOCH + this.t; }

  /** The snapshot for now; the same object for 250 ms (the sim rebuilds the plan when the snapshot changes). */
  snapshot(): BgSession {
    const key = `${Math.floor(this.t / 250)}|${this.decision ? `${this.decision.at}${this.decision.allow}` : ''}`;
    if (this.snap?.key !== key) this.snap = { key, s: snapshotAt(this.t, this.decision) };
    return this.snap.s;
  }

  /** Move the clock on in fixed 50 ms steps (the remainder waits for the next call); past 60 s it starts again. */
  advance(dtMs: number, reduced = false): void {
    this.acc += Math.max(0, dtMs);
    while (this.acc >= STEP_MS - 1e-6) {
      this.acc -= STEP_MS;
      this.t += STEP_MS;
      // reset() clears the remainder: keep it, the rest of this call plays in the new loop
      if (this.t >= LOOP_MS) { const left = this.acc; this.reset(); this.acc = left; continue; }
      this.world = step(this.world, this.snapshot(), this.now(), { rate: this.rate, mainBusy: true, reduced });
    }
  }

  seek(ms: number): void {
    this.reset();
    this.advance(Math.min(ms, LOOP_MS - STEP_MS));
  }

  jumpTo(p: DemoPhase): void { this.seek(PHASE_START[p]); }

  phase(): DemoPhase { return phaseAt(this.t); }

  needsYou(): boolean { return this.t >= NEEDS_FROM && this.t < NEEDS_TO && !this.decision; }

  decide(allow: boolean): void {
    if (this.needsYou()) this.decision = { at: this.t, allow };
  }

  reset(): void {
    this.t = 0;
    this.acc = 0;
    this.decision = undefined;
    this.snap = undefined;
    this.world = createWorld(this.seed, EPOCH);
  }
}
