import { describe, expect, it } from 'vitest';
import { clipFromSearch, searchWithClip } from './params';

describe('?theme=', () => {
  it('picks a known clip', () => {
    expect(clipFromSearch('?theme=ink')).toBe('ink');
    expect(clipFromSearch('?lang=en&theme=koi')).toBe('koi');
    expect(clipFromSearch('?theme=describe')).toBe('describe');
  });
  it('falls back to phosphor', () => {
    expect(clipFromSearch('')).toBe('phosphor');
    expect(clipFromSearch('?theme=nope')).toBe('phosphor');
    expect(clipFromSearch('?theme=')).toBe('phosphor');
    expect(clipFromSearch('?theme=metro')).toBe('phosphor');
  });
  it('writes the clip back, keeping the other parameters', () => {
    expect(searchWithClip('', 'orb')).toBe('?theme=orb');
    expect(searchWithClip('?lang=en', 'koi')).toBe('?lang=en&theme=koi');
    expect(searchWithClip('?theme=ink', 'orb')).toBe('?theme=orb');
  });
});
