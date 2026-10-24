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
  it('Shift always leaves the wheel to the page; a sideways-only wheel too', () => {
    expect(wheelZoom(1, { deltaY: -100, shiftKey: true }, O)).toBeNull();
    expect(wheelZoom(1, { deltaY: 0, shiftKey: false }, O)).toBeNull();
  });
});
