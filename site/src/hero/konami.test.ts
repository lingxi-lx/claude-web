import { describe, expect, it } from 'vitest';
import { KONAMI, konamiDetector } from './konami';

const feed = (keys: string[]) => { const d = konamiDetector(); return keys.map((k) => d(k)); };

describe('Konami', () => {
  it('fires on the last key of the sequence only', () => {
    const r = feed(KONAMI);
    expect(r.slice(0, -1).every((x) => !x)).toBe(true);
    expect(r.at(-1)).toBe(true);
  });
  it('takes B and A in either case', () => {
    expect(feed([...KONAMI.slice(0, 8), 'B', 'A']).at(-1)).toBe(true);
  });
  it('starts over after a wrong key, and an extra Up does not break it', () => {
    expect(feed([...KONAMI.slice(0, 5), 'x', ...KONAMI.slice(5)]).at(-1)).toBe(false);
    expect(feed(['ArrowUp', ...KONAMI]).at(-1)).toBe(true);
    expect(feed(['ArrowUp', 'x', ...KONAMI]).at(-1)).toBe(true);
  });
  it('can fire again', () => {
    expect(feed([...KONAMI, ...KONAMI]).filter(Boolean)).toHaveLength(2);
  });
});
