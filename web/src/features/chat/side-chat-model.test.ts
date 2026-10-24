import { describe, expect, it } from 'vitest';
import { parseBtw, sideDraft, sideHistory, withQuote } from './side-chat-model';

describe('side chat', () => {
  it('the engine hears the answered turns again, not the waiting or failed ones', () => {
    expect(sideHistory([
      { id: '1', question: 'a', response: 'A' },
      { id: '2', question: 'b', response: null },
      { id: '3', question: 'c', error: 'boom' },
      { id: '4', question: 'd' },
      { id: '5', question: 'e', response: 'E' },
    ])).toEqual([{ question: 'a', response: 'A' }, { question: 'e', response: 'E' }]);
  });
  it('/btw in the input box', () => {
    expect(parseBtw('/btw why is this slow?')).toBe('why is this slow?');
    expect(parseBtw('  /btw  ')).toBe('');
    expect(parseBtw('/btw\nline two')).toBe('line two');
    expect(parseBtw('/btwx')).toBeNull();
    expect(parseBtw('hello /btw x')).toBeNull();
  });
  // 2026-10-24 review M2: a quote from the selection menu replaced a question already typed in an open side chat
  it('a quote handed over goes in front of what is typed, never replaces it', () => {
    expect(withQuote('', '> a\n\n')).toBe('> a\n\n');
    expect(withQuote('   ', '> a\n\n')).toBe('> a\n\n');
    expect(withQuote('why?', '> a\n\n')).toBe('> a\n\nwhy?');
  });
  it('放进对话 quotes the answer under the question', () => {
    expect(sideDraft({ id: '1', question: 'q?', response: 'one\ntwo' })).toBe('q?\n\n> one\n> two');
  });
});
