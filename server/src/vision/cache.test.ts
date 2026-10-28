import { describe, expect, it } from 'vitest';
import { LruCache, VISION_CACHE_SIZE, sha256Image, visionCacheKey } from './cache.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('sha256Image', () => {
  it('hashes the image bytes, not its base64 spelling', () => {
    const a = b64('same picture');
    expect(sha256Image(a)).toBe(sha256Image(a));
    expect(sha256Image(a)).toHaveLength(64);
    expect(sha256Image(a)).not.toBe(sha256Image(b64('other picture')));
    expect(sha256Image(`data:image/png;base64,${a}`)).toBe(sha256Image(a));
    expect(sha256Image(new Uint8Array(Buffer.from('same picture')))).toBe(sha256Image(a));
  });

  it('keys a question case-insensitively and never mixes two pictures', () => {
    const one = b64('one');
    const two = b64('two');
    expect(visionCacheKey(one, '  Save button? ')).toBe(visionCacheKey(one, 'save BUTTON?'));
    expect(visionCacheKey(one, 'button?')).not.toBe(visionCacheKey(two, 'button?'));
  });
});

describe('LruCache', () => {
  it('holds 256 entries by default and forgets the oldest first', () => {
    const cache = new LruCache<number, string>();
    expect(VISION_CACHE_SIZE).toBe(256);
    for (let i = 0; i < 257; i++) cache.set(i, `v${i}`);
    expect(cache.size).toBe(256);
    expect(cache.get(0)).toBeUndefined();
    expect(cache.get(1)).toBe('v1');
    expect(cache.get(256)).toBe('v256');
  });

  it('a read makes an entry recent', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('overwrites without growing and can be cleared', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe(2);
    expect(cache.keys()).toEqual(['a']);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
