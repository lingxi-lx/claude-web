import { describe, expect, it } from 'vitest';
import { BAYER4, FRAGMENT } from './post';

describe('the post pass', () => {
  it('dithers with the 4×4 Bayer matrix', () => {
    expect([...BAYER4].sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
    expect(BAYER4.slice(0, 4)).toEqual([0, 8, 2, 10]);
  });
  it('is one small WebGL2 fragment shader with the three effects', () => {
    expect(FRAGMENT.startsWith('#version 300 es')).toBe(true);
    for (const name of ['uScene', 'uGlow', 'uGlowRect', 'bayer', 'vignette']) expect(FRAGMENT).toContain(name);
    expect(FRAGMENT.length).toBeLessThan(3000);
  });
});
