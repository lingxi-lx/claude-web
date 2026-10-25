import { describe, it, expect } from 'vitest';
import { readZip, makeZip } from './zip.js';

describe('zip', () => {
  it('round-trips stored and deflated entries, keeps folders in names', () => {
    for (const deflate of [false, true]) {
      const z = readZip(makeZip({ 'a.json': '[1]', 'dir/b.txt': Buffer.from('héllo'.repeat(100)) }, { deflate }));
      expect(z.get('a.json')!.toString()).toBe('[1]');
      expect(z.get('dir/b.txt')!.toString()).toBe('héllo'.repeat(100));
    }
  });
  it('refuses something that is not a zip', () => {
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow();
  });
});
