import { describe, expect, it } from 'vitest';
import { wrapIndex } from './focus-trap';

describe('wrapIndex: Tab stays in the box (U9)', () => {
  it('wraps at the ends, lets the browser move it in between', () => {
    expect(wrapIndex(2, 3, false)).toBe(0);
    expect(wrapIndex(0, 3, true)).toBe(2);
    expect(wrapIndex(0, 3, false)).toBeNull();
    expect(wrapIndex(1, 3, true)).toBeNull();
  });
  it('a focus outside the box comes back in; an empty box does nothing', () => {
    expect(wrapIndex(-1, 3, false)).toBe(0);
    expect(wrapIndex(-1, 3, true)).toBe(2);
    expect(wrapIndex(-1, 0, false)).toBeNull();
  });
});
