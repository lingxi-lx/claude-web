import { describe, expect, it } from 'vitest';
import { formatComments } from './review-comments-model';

describe('formatComments', () => {
  it('one message, the comments in file and line order, each with its line of code', () => {
    expect(formatComments([
      { id: '2', path: 'src/b.ts', line: 3, side: 'new', code: '  return x;', text: 'x can be null here' },
      { id: '1', path: 'src/a.ts', line: 12, side: 'new', code: 'const x = foo();', text: 'name it better\nand add a test' },
      { id: '3', path: 'src/a.ts', line: 4, side: 'old', code: 'old()', text: 'why was this removed?' },
    ])).toBe([
      '请按下面这些代码审阅评论修改：',
      '',
      '1. src/a.ts:4（改动前）\n   > old()\n   why was this removed?',
      '',
      '2. src/a.ts:12\n   > const x = foo();\n   name it better\n   and add a test',
      '',
      '3. src/b.ts:3\n   > return x;\n   x can be null here',
    ].join('\n'));
  });
  it('a blank line of code is left out', () => {
    expect(formatComments([{ id: '1', path: 'a', line: 1, side: 'new', code: '   ', text: 'hi' }])).toBe('请按下面这些代码审阅评论修改：\n\n1. a:1\n   hi');
  });
});
