import { describe, expect, it } from 'vitest';
import { makeNoise } from './ascii-noise';

describe('the noise under 字流', () => {
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
});
