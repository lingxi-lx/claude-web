import { describe, expect, it } from 'vitest';
import { buildMap } from './engine';
import { EPOCH, snapshotAt } from './demo';
import { isFront } from './layers';

const m = buildMap(snapshotAt(31_000), EPOCH + 31_000);

describe('which layer', () => {
  it('the counter, the admin, the queue and the glass are in front', () => {
    expect(isFront({ d: 17, kind: 'furniture', u: 1, v: 12, key: 'counter' }, m)).toBe(true);
    expect(isFront({ d: 13.5, kind: 'admin', u: 0, v: 13, key: 'admin' }, m)).toBe(true);
    expect(isFront({ d: 20.5, kind: 'queue', u: 4, v: 16 }, m)).toBe(true);
    expect(isFront({ d: 33.9, kind: 'glass', u: 26, v: 7 }, m)).toBe(true);
  });
  it('desks, chairs, the other furniture and seated guests are behind', () => {
    expect(isFront({ d: 11.4, kind: 'desk', u: 7, v: 3 }, m)).toBe(false);
    expect(isFront({ d: 11.4, kind: 'chairBack', u: 7, v: 4 }, m)).toBe(false);
    expect(isFront({ d: 10, kind: 'furniture', u: 0, v: 9, key: 'power' }, m)).toBe(false);
    expect(isFront({ d: 11.5, kind: 'actor', u: 7, v: 4, key: 'api/api' }, m)).toBe(false);
  });
  it('a guest at the counter is in front with it', () => {
    expect(isFront({ d: 16.5, kind: 'actor', u: 3, v: 13, key: 'tests/tests' }, m)).toBe(true);
  });
});
