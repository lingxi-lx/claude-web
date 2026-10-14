import { describe, expect, it } from 'vitest';
import { dropOrder, moveTo } from './reorder';

describe('moving projects', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('moveTo: up, down, to the top, past the ends', () => {
    expect(moveTo(ids, 'c', 1)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveTo(ids, 'a', 3)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTo(ids, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveTo(ids, 'b', 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveTo(ids, 'x', 0)).toEqual(ids);
  });
  it('dropOrder: before or after the project it is dropped on', () => {
    expect(dropOrder(ids, 'd', 'a', false)).toEqual(['d', 'a', 'b', 'c']);
    expect(dropOrder(ids, 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd']);
    expect(dropOrder(ids, 'a', 'b', false)).toEqual(ids);
    expect(dropOrder(ids, 'b', 'b', true)).toEqual(ids);
  });
});
