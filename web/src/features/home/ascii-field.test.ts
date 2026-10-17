import { describe, expect, it } from 'vitest';
import { makeNoise } from './ascii-noise';

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
});

describe('the click ripple and the quieter field', () => {
  it('a ripple starts as a small disc, opens into a ring moving outwards, and is gone after RIPPLE_MS', async () => {
    const { rippleLevel, RIPPLE_MS, RIPPLE_REACH } = await import('./ascii-noise');
    expect(rippleLevel(0, 30)).toBeGreaterThan(0.5);
    // later: the centre is dark, a cell on the ring is lit
    const mid = RIPPLE_MS * 0.5;
    expect(rippleLevel(0, mid)).toBe(0);
    const lit = [...Array(RIPPLE_REACH).keys()].filter((d) => rippleLevel(d, mid) > 0.2);
    expect(lit.length).toBeGreaterThan(10);
    expect(Math.min(...lit)).toBeGreaterThan(100);
    expect(rippleLevel(lit[0], RIPPLE_MS)).toBe(0);
    expect(rippleLevel(10, -1)).toBe(0);
  });
  it('the field has gaps and lit cells', async () => {
    const { bandLevel, makeNoise } = await import('./ascii-noise');
    const n = makeNoise(7);
    let empty = 0, lit = 0;
    for (let y = 0; y < 60; y++) for (let x = 0; x < 200; x++) { const l = bandLevel(n, x, y, 3); if (l === 0) empty++; else lit++; }
    expect(empty).toBeGreaterThan(1500);
    expect(lit).toBeGreaterThan(1500);
  });
});
