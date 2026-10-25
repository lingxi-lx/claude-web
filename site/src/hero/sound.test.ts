import { describe, expect, it } from 'vitest';
import { tickInterval } from './sound';

describe('typing ticks', () => {
  it('none when nobody types, faster with more people', () => {
    expect(tickInterval(0)).toBe(Infinity);
    expect(tickInterval(1)).toBe(320);
    expect(tickInterval(4)).toBe(160);
  });
});
