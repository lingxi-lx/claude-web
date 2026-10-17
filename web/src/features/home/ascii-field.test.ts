import { describe, expect, it } from 'vitest';
import { cellLevel, makeNoise } from './ascii-noise';

describe('新对话页的动态背景', () => {
  it('the noise is in [0, 1), smooth, and the same for the same seed', () => {
    const a = makeNoise(7), b = makeNoise(7);
    for (let i = 0; i < 200; i++) {
      const v = a(i * 0.37, i * 0.11, i * 0.05);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(v).toBe(b(i * 0.37, i * 0.11, i * 0.05));
    }
    expect(Math.abs(a(3.5, 2.5, 1) - a(3.501, 2.5, 1))).toBeLessThan(0.01);
  });
  it('cells are empty below the cut and lit up to 1 above it — a field with gaps, not a wall', () => {
    const n = makeNoise(7);
    let empty = 0, lit = 0;
    for (let y = 0; y < 60; y++) for (let x = 0; x < 200; x++) { const l = cellLevel(n, x, y, 3); if (l === 0) empty++; else { lit++; expect(l).toBeLessThanOrEqual(1); } }
    expect(empty).toBeGreaterThan(2000);
    expect(lit).toBeGreaterThan(1000);
  });
});
