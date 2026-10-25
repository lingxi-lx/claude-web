import { describe, expect, it } from 'vitest';
import { approach, LAYER_FACTORS, MAX_SHIFT, parallaxOffset, pointerNorm } from './motion';

describe('parallax', () => {
  it('the factors and the reach of the spec', () => {
    expect(LAYER_FACTORS).toEqual([0.4, 0.7, 1.0, 0.55]);
    expect(MAX_SHIFT).toBe(12);
  });
  it('the pointer from -1 to 1 across the stage, clamped', () => {
    const r = { left: 100, top: 0, width: 200, height: 100 };
    expect(pointerNorm(200, 50, r)).toEqual({ x: 0, y: 0 });
    expect(pointerNorm(300, 100, r)).toEqual({ x: 1, y: 1 });
    expect(pointerNorm(0, -50, r)).toEqual({ x: -1, y: -1 });
  });
  it('a layer moves factor × 12 px at the edge', () => {
    expect(parallaxOffset({ x: 1, y: -1 }, 0.4)).toEqual({ x: 4.8, y: -4.8 });
    expect(parallaxOffset({ x: 0.5, y: 0 }, 1)).toEqual({ x: 6, y: 0 });
    expect(parallaxOffset({ x: 3, y: 0 }, 1).x).toBe(12);
  });
  it('approaches the target smoothly and never overshoots', () => {
    const a = approach(0, 10, 16, 140);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(10);
    expect(approach(0, 10, 10_000, 140)).toBeCloseTo(10, 5);
    expect(approach(5, 5, 16)).toBe(5);
  });
});
