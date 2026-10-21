import { describe, expect, it } from 'vitest';
import { filterOptions, nextSelection } from './select-model';

describe('shared select values', () => {
  it('replaces a single selection, including the empty option', () => {
    expect(nextSelection('old', 'new', false)).toBe('new');
    expect(nextSelection('old', '', false)).toBe('');
  });

  it('toggles multiple selections without mutating the input', () => {
    const original = ['one'];
    expect(nextSelection(original, 'two', true)).toEqual(['one', 'two']);
    expect(nextSelection(original, 'one', true)).toEqual([]);
    expect(original).toEqual(['one']);
  });

  it('searches option labels and descriptions', () => {
    const options = [{ label: 'First', description: 'Gemini' }, { label: 'Second' }];
    expect(filterOptions(options, ' gemINI ')).toEqual([options[0]]);
    expect(filterOptions(options, 'SECOND')).toEqual([options[1]]);
    expect(filterOptions(options, '')).toBe(options);
    expect(filterOptions(options, 'unknown')).toEqual([]);
  });
});
