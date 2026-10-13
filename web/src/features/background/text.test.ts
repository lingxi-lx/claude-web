import { describe, expect, it } from 'vitest';
import { clip, textWidth } from './text';

describe('text', () => {
  it('clip: labels by display width (a CJK character is two)', () => {
    expect(clip('reader-gates', 20)).toBe('reader-gates');
    expect(clip('a-very-long-agent-name', 10)).toBe('a-very-lo…');
    expect(clip('一二三四五六七八', 8)).toBe('一二三…');
    expect(textWidth('ab', 12)).toBeLessThan(textWidth('一二', 12));
  });
});
