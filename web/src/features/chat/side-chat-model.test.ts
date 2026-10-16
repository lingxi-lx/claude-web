import { describe, expect, it } from 'vitest';
import { parseBtw, sideDraft, sideHistory } from './side-chat-model';

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
  it('放进对话 quotes the answer under the question', () => {
    expect(sideDraft({ id: '1', question: 'q?', response: 'one\ntwo' })).toBe('q?\n\n> one\n> two');
  });
});
