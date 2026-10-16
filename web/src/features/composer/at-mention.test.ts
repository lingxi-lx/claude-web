import { describe, expect, it } from 'vitest';
import { atQueryAt, pickAt } from './at-mention';

describe('@ mention', () => {
  it('the @word right before the caret', () => {
    expect(atQueryAt('@', 1)).toEqual({ start: 0, q: '' });
    expect(atQueryAt('look at @src/Comp', 17)).toEqual({ start: 8, q: 'src/Comp' });
    expect(atQueryAt('look at @src/Comp and', 21)).toBeNull(); // the caret moved past it
    expect(atQueryAt('mail me@example.com', 19)).toBeNull(); // not after a space
    expect(atQueryAt('line\n@a', 7)).toEqual({ start: 5, q: 'a' });
  });
  it('picking writes the path and a space, quoting a path with spaces', () => {
    expect(pickAt('see @comp now', { start: 4, q: 'comp' }, 'web/Composer.tsx')).toEqual({ text: 'see @web/Composer.tsx  now', caret: 22 });
    expect(pickAt('@my', { start: 0, q: 'my' }, 'my docs/a.md')).toEqual({ text: '@"my docs/a.md" ', caret: 16 });
  });
});
