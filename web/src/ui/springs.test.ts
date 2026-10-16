import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPRINGS, settleMs, springAt, springCurve, springTokens } from './springs';

describe('springs', () => {
  it('starts at 0 and settles at 1', () => {
    for (const p of Object.values(SPRINGS)) {
      expect(springAt(p, 0)).toBeCloseTo(0, 6);
      expect(Math.abs(1 - springAt(p, settleMs(p) / 1000))).toBeLessThan(0.01);
    }
  });
  it('bouncy overshoots 7–11%, snappy a little, gentle not at all', () => {
    expect(springCurve(SPRINGS.bouncy).peak).toBeGreaterThan(1.07);
    expect(springCurve(SPRINGS.bouncy).peak).toBeLessThan(1.11);
    expect(springCurve(SPRINGS.snappy).peak).toBeGreaterThan(1.005);
    expect(springCurve(SPRINGS.snappy).peak).toBeLessThan(1.04);
    expect(springCurve(SPRINGS.gentle).peak).toBeLessThanOrEqual(1.0005);
  });
  it('settles in a usable time', () => {
    for (const p of Object.values(SPRINGS)) {
      const ms = settleMs(p);
      expect(ms).toBeGreaterThan(200);
      expect(ms).toBeLessThan(700);
      expect(ms % 10).toBe(0);
    }
  });
  it('linear() starts with 0 and ends with 1', () => {
    const { linear } = springCurve(SPRINGS.bouncy);
    expect(linear.startsWith('linear(0, ')).toBe(true);
    expect(linear.endsWith(', 1)')).toBe(true);
  });
  it('tokens.css carries the generated block', () => {
    const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
    const block = css.split('/* springs:begin */')[1]?.split('/* springs:end */')[0];
    expect(block?.trim()).toBe(springTokens().trim());
  });
});
