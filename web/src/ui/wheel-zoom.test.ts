// web/src/ui/wheel-zoom.test.ts
import { describe, expect, it } from 'vitest';
import { wheelZoom } from './wheel-zoom';

const O = { min: 0.25, max: 8, step: 1.25 };

describe('wheelZoom', () => {
  it('wheel up zooms in, down zooms out', () => {
    expect(wheelZoom(1, { deltaY: -100, shiftKey: false }, O)).toBeCloseTo(1.25);
    expect(wheelZoom(1, { deltaY: 100, shiftKey: false }, O)).toBeCloseTo(0.8);
  });
  it('clamps at the limits', () => {
    expect(wheelZoom(7, { deltaY: -100, shiftKey: false }, O)).toBe(8);
    expect(wheelZoom(0.3, { deltaY: 100, shiftKey: false }, O)).toBe(0.25);
  });
  it('already at a limit and pushing on: the page scrolls (null)', () => {
    expect(wheelZoom(8, { deltaY: -100, shiftKey: false }, O)).toBeNull();
    expect(wheelZoom(0.25, { deltaY: 100, shiftKey: false }, O)).toBeNull();
  });
  // 2026-10-24 review M4: a full step per event ran away on a mac trackpad (dozens of small events per swipe)
  it('a small delta zooms a part of a step; a wheel notch (100 px or more) a full step', () => {
    expect(wheelZoom(1, { deltaY: -10, shiftKey: false }, O)).toBeCloseTo(1.25 ** 0.1);
    expect(wheelZoom(1, { deltaY: 10, shiftKey: false }, O)).toBeCloseTo(1.25 ** -0.1);
    expect(wheelZoom(1, { deltaY: -50, shiftKey: false }, O)).toBeCloseTo(1.25 ** 0.5);
    expect(wheelZoom(1, { deltaY: -300, shiftKey: false }, O)).toBeCloseTo(1.25);
    // ten small events ≈ one notch
    let s = 1;
    for (let i = 0; i < 10; i++) s = wheelZoom(s, { deltaY: -10, shiftKey: false }, O)!;
    expect(s).toBeCloseTo(1.25);
  });
  it('a line-mode wheel (deltaMode 1, Firefox) counts a line as 40 px', () => {
    expect(wheelZoom(1, { deltaY: -3, deltaMode: 1, shiftKey: false }, O)).toBeCloseTo(1.25);
    expect(wheelZoom(1, { deltaY: -1, deltaMode: 1, shiftKey: false }, O)).toBeCloseTo(1.25 ** 0.4);
  });
  it('a small delta at a limit still leaves the wheel to the page', () => {
    expect(wheelZoom(8, { deltaY: -5, shiftKey: false }, O)).toBeNull();
    expect(wheelZoom(0.25, { deltaY: 5, shiftKey: false }, O)).toBeNull();
  });
  it('Shift always leaves the wheel to the page; a sideways-only wheel too', () => {
    expect(wheelZoom(1, { deltaY: -100, shiftKey: true }, O)).toBeNull();
    expect(wheelZoom(1, { deltaY: 0, shiftKey: false }, O)).toBeNull();
  });
});
