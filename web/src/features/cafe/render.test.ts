// render() before and after the split (the site draws the same room in layers): a recording fake canvas logs every
// call of one frame; the log's hash is a snapshot, so the product's picture cannot change without this failing.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BgSession } from '@shared';
import { ADMIN, BUILTIN, OCTOPUS } from '@characters';
import { createWorld, step, type World } from './sim';
import * as R from './render';

const log: string[] = [];
let ids = 0;
const fmt = (v: unknown): string => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : typeof v === 'string' || typeof v === 'boolean' ? String(v) : 'obj');

function fakeCanvas(): any {
  const id = ids++;
  const canvas: any = { width: 0, height: 0 };
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'canvas') return canvas;
      if (k === 'createImageData') return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'measureText') return (s: string) => ({ width: s.length * 6 });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') {
        return (...a: unknown[]) => {
          log.push(`${id}.${String(k)}(${a.map(fmt).join(',')})`);
          return { addColorStop: (o: number, col: string) => log.push(`grad(${o},${col})`) };
        };
      }
      return (...a: unknown[]) => { log.push(`${id}.${String(k)}(${a.map(fmt).join(',')})`); };
    },
    set(t, k, v) { t[k] = v; log.push(`${id}.${String(k)}=${fmt(v)}`); return true; },
  });
  canvas.getContext = () => ctx;
  return canvas;
}

function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

const T0 = 1_800_000_000_000;
const COLORS = ['#a3e635', '#fbbf24', '#2dd4bf', '#f472b6', '#60a5fa', '#a78bfa', '#fb923c', '#22d3ee', '#e879f9', '#4ade80'];
const sess = (t: number): BgSession => ({
  sessionId: 's', updatedAt: T0, events: [], tasks: [
    { id: 'a', kind: 'agent', description: 'api', status: 'running', startedAt: T0, agents: [{ key: 'a', color: 1, label: 'api', state: 'running', startedAt: T0, beats: [t - 500] }] },
    { id: 'b', kind: 'agent', description: 'tests', status: 'running', startedAt: T0 + 1, agents: [{ key: 'b', color: 2, label: 'tests', state: 'running', startedAt: T0 + 1, beats: [t - 500] }] },
  ],
});
function world(): World {
  let w = createWorld(3, T0 - 1000);
  for (let t = T0; t <= T0 + 15_000; t += 100) w = step(w, sess(t), t, { rate: 5, mainBusy: true, reduced: false });
  return w;
}
const look = (w: World): R.Look => ({
  now: w.t, agentColors: COLORS, chars: new Map(BUILTIN.map((c) => [c.id, c])), rate: 5, session: sess(w.t), still: false, mainBusy: true, title: 'demo',
  who: (x) => (x.key === 'admin' ? ADMIN.id : OCTOPUS.id),
});

beforeAll(() => {
  (globalThis as any).document = { createElement: () => fakeCanvas() };
});

describe('render', () => {
  it('draws the same frame as before the split', () => {
    const w = world();
    const page = fakeCanvas();
    log.length = 0;
    R.render(page.getContext('2d'), 1280, 800, w, R.fitView(w, 1280, 800), look(w));
    expect({ calls: log.length, hash: fnv(log.join('\n')) }).toMatchSnapshot();
  });

  it('splits the standing things in two without losing any', () => {
    const w = world();
    const sz = R.sceneSize(w.map);
    const L = look(w);
    const count = (pick?: (it: R.ItemTag) => boolean) => {
      const c = fakeCanvas().getContext('2d');
      const before = log.length;
      R.drawItems(c, w, sz, L, pick);
      return log.length - before;
    };
    count(); // character frames baked once
    const all = count();
    expect(all).toBeGreaterThan(100);
    expect(count((it) => it.d < 20) + count((it) => it.d >= 20)).toBe(all);
    expect(count((it) => it.kind === 'admin')).toBeGreaterThan(0);
  });

  it('draws the light sources on their own, back to source-over', () => {
    const w = world();
    const c = fakeCanvas().getContext('2d');
    const start = log.length;
    R.drawGlows(c, w, R.sceneSize(w.map), look(w));
    const mine = log.slice(start).filter((l) => l.includes('globalCompositeOperation'));
    expect(mine[0]).toMatch(/=lighter$/);
    expect(mine.at(-1)).toMatch(/=source-over$/);
    expect(log.slice(start).some((l) => l.includes('createRadialGradient'))).toBe(true);
  });
});
