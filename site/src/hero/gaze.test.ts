import { describe, expect, it } from 'vitest';
import { faceToward, nearest } from './gaze';

describe('looking at the pointer', () => {
  it('turns to the bigger of the two directions, like walking does', () => {
    expect(faceToward({ u: 3, v: 3 }, { u: 9, v: 4 })).toBe('se');
    expect(faceToward({ u: 3, v: 3 }, { u: 0, v: 4 })).toBe('nw');
    expect(faceToward({ u: 3, v: 3 }, { u: 4, v: 9 })).toBe('sw');
    expect(faceToward({ u: 3, v: 3 }, { u: 3.6, v: 0 })).toBe('ne');
  });
  it('the three nearest within reach', () => {
    const list = [{ k: 'a', u: 0, v: 0 }, { k: 'b', u: 5, v: 5 }, { k: 'c', u: 1, v: 1 }, { k: 'd', u: 2, v: 2 }, { k: 'e', u: 30, v: 30 }];
    expect(nearest(list, { u: 0.5, v: 0.5 }, 3).map((x) => x.k)).toEqual(['a', 'c', 'd']);
    expect(nearest(list, { u: 30.5, v: 30.5 }, 3).map((x) => x.k)).toEqual(['e']);
  });
});
