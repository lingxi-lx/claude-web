import { describe, expect, it } from 'vitest';
import { quoteMarkdown, withLine, withQuote } from './quote';

describe('引用到输入框 (right-click quote)', () => {
  it('every line is quoted; blank lines inside stay as `>`, outer ones go', () => {
    expect(quoteMarkdown('\n  \nfirst  \r\n\r\nsecond\n\n')).toBe('> first\n>\n> second');
    expect(quoteMarkdown('  \n')).toBe('');
  });

  it('goes after what is typed, with an empty line to write on', () => {
    expect(withQuote('', 'a\nb')).toBe('> a\n> b\n\n');
    expect(withQuote('look at this  \n', 'a')).toBe('look at this\n\n> a\n\n');
    expect(withQuote('typed', '   ')).toBe('typed');
  });
});

describe('withLine (把改动发给 Claude)', () => {
  it('the sentence goes after what is typed, as its own paragraph', () => {
    expect(withLine('', ' 我在图里把… ')).toBe('我在图里把…');
    expect(withLine('hello  \n', 'x')).toBe('hello\n\nx');
  });
});
