import { describe, expect, it } from 'vitest';
import { thinkingTitle } from './thinking-title';

describe('thinkingTitle', () => {
  const summary = '**Inspecting the zip contents**\n\nThe user wants…\n\n**Planning the watermark script:**\n\nffmpeg can…';
  it('the first heading once done, the latest while streaming, without trailing punctuation', () => {
    expect(thinkingTitle(summary, false)).toBe('Inspecting the zip contents');
    expect(thinkingTitle(summary, true)).toBe('Planning the watermark script');
  });
  it('raw reasoning without headings, and bold words inside a sentence, give none', () => {
    expect(thinkingTitle('总价在 cart.ts 里算，折扣是浮点数。', false)).toBe('');
    expect(thinkingTitle('this is **very** important', false)).toBe('');
  });
});
