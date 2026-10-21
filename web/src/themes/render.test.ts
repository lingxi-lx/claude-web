import { describe, expect, it } from 'vitest';
import { frameHtml } from './render';

describe('frameHtml', () => {
  it('escapes', () => expect(frameHtml(['a<b&'])).toBe('a&lt;b&amp;'));
  it('colours by character, with a token only', () => expect(frameHtml(['✓ '], { '✓': 'green' })).toBe('<b style="color:var(--green)">✓</b> '));
  it('joins rows with a newline', () => expect(frameHtml(['ab', 'cd'])).toBe('ab\ncd'));
});
