import { describe, expect, it } from 'vitest';
import { wordAt } from './dblclick-select';

describe('wordAt', () => {
  it('an English word, with underscores kept together', () => {
    const t = 'the activation_status changed';
    expect(wordAt(t, 6)).toEqual([4, 21]);
  });
  it('a Chinese word, not the whole sentence', () => {
    const t = '说明填了验证码之后';
    const [s, e] = wordAt(t, 0)!;
    expect(t.slice(s, e).length).toBeLessThan(t.length);
    expect(t.slice(s, e).length).toBeGreaterThan(0);
    // in the middle of the run: a word around 验, inside 验证码 — not the characters from the start or up to the end
    const [s2, e2] = wordAt(t, 4)!;
    expect(s2).toBe(4);
    expect(e2).toBeGreaterThan(4);
    expect(e2).toBeLessThanOrEqual(7);
  });
  it('on a space or punctuation: nothing', () => {
    expect(wordAt('a b', 1)).toBeNull();
    expect(wordAt('a，b', 1)).toBeNull();
  });
  it('offset at the very end of the text belongs to the last word', () => {
    expect(wordAt('hello', 5)).toEqual([0, 5]);
  });
});
