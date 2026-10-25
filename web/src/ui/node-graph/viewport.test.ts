import { describe, expect, it } from 'vitest';
import { wheelZoom } from '@/ui/wheel-zoom';
import { entranceTimes, fitView, motionOn, NG_ZOOM, pct, zoomAt, zoomBy } from './viewport';

describe('viewport', () => {
  it('fit: centred, never above max', () => {
    expect(fitView({ w: 400, h: 200 }, { w: 800, h: 400 })).toEqual({ scale: 1.25, x: 150, y: 75 });
  });
  it('fit: a huge graph stops at the minimum zoom', () => {
    expect(fitView({ w: 4000, h: 100 }, { w: 400, h: 300 })).toEqual({ scale: 0.25, x: -300, y: 137.5 });
  });
  it('fit: no size yet (a hidden panel) leaves 100%', () => {
    expect(fitView({ w: 400, h: 200 }, { w: 0, h: 0 })).toEqual({ scale: 1, x: 0, y: 0 });
  });
  it('zooming keeps the point under the pointer', () => {
    expect(zoomAt({ scale: 1, x: 10, y: 20 }, 2, { x: 110, y: 220 })).toEqual({ scale: 2, x: -90, y: -180 });
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 10, { x: 0, y: 0 }).scale).toBe(NG_ZOOM.max);
  });
  it('the − / + buttons zoom about the middle', () => {
    expect(zoomBy({ scale: 1, x: 0, y: 0 }, 1, { w: 200, h: 100 }).scale).toBeCloseTo(1.2);
    expect(zoomBy({ scale: 1, x: 0, y: 0 }, -1, { w: 200, h: 100 }).scale).toBeCloseTo(1 / 1.2);
  });
  it('the percentage', () => {
    expect(pct(1.16)).toBe('116%');
    expect(pct(0.999)).toBe('100%');
  });
  it('the wheel rule is the shared one (stage A3)', () => {
    expect(wheelZoom(1, { deltaY: -100, shiftKey: false }, NG_ZOOM)).toBeCloseTo(1.2);
    expect(wheelZoom(NG_ZOOM.max, { deltaY: -100, shiftKey: false }, NG_ZOOM)).toBeNull();
    expect(wheelZoom(1, { deltaY: -100, shiftKey: true }, NG_ZOOM)).toBeNull();
  });
  it('no animation when reduced or above 150 cards', () => {
    expect(motionOn(150, false)).toBe(true);
    expect(motionOn(151, false)).toBe(false);
    expect(motionOn(3, true)).toBe(false);
  });
  it('cards one after another, then the edges', () => {
    const t = entranceTimes(3, 2);
    expect([t.card(0), t.card(2), t.edge(0), t.edge(1), t.total]).toEqual([0, 180, 372, 412, 832]);
    expect(entranceTimes(2, 0).total).toBe(410);
  });
});
