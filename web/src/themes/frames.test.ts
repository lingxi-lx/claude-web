import { describe, expect, it } from 'vitest';
import { checkAnim, strWidth } from './frames';

const ok = { fps: 8, loop: [['✎  ', '───'], ['a✎ ', '───']], done: [['a ✓', '───']], color: { '✓': 'green' }, inline: { loop: ['✎', '✐'] } };

describe('frames', () => {
  it('measures cells', () => {
    expect(strWidth('ab')).toBe(2);
    expect(strWidth('字')).toBe(2);
    expect(strWidth('▓░')).toBe(2);
    expect(strWidth('ｱ')).toBe(1);
    expect(strWidth('Ａ')).toBe(2);
  });
  it('accepts a good clip', () => expect(checkAnim(ok)).toEqual([]));
  it('rejects uneven frames', () => expect(checkAnim({ ...ok, loop: [['ab'], ['abc']] }).join()).toMatch(/宽度/));
  it('rejects frames with a different number of rows', () => expect(checkAnim({ ...ok, loop: [['ab'], ['ab', 'cd']], done: undefined }).join()).toMatch(/行数/));
  it('rejects too wide / too tall', () => {
    expect(checkAnim({ ...ok, loop: [['x'.repeat(15)]], done: undefined }).join()).toMatch(/14/);
    expect(checkAnim({ ...ok, loop: [['a', 'b', 'c']], done: undefined }).join()).toMatch(/2 行/);
  });
  it('rejects an unknown colour and a missing loop', () => {
    expect(checkAnim({ ...ok, color: { x: '#f00' } }).join()).toMatch(/颜色/);
    expect(checkAnim({ fps: 8 }).join()).toMatch(/loop/);
    expect(checkAnim(null).join()).toMatch(/对象/);
  });
  it('rejects a wide inline frame and a silly fps', () => {
    expect(checkAnim({ ...ok, inline: { loop: ['abcd'] } }).join()).toMatch(/3/);
    expect(checkAnim({ ...ok, fps: 0 }).join()).toMatch(/fps/);
    expect(checkAnim({ ...ok, inline: { loop: ['a'], fps: 99 } }).join()).toMatch(/fps/);
  });
});
