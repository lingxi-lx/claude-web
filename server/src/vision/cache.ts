/**
 * The description cache: a small LRU keyed by the sha256 of the picture (and the question). A screen the model has
 * already asked about costs nothing the second time — the idea Magpie calls `sightsKept`.
 *
 * Pure and bounded: no timers, no disk, no network.
 */
import { createHash } from 'node:crypto';

/** Same size as Magpie's sightsKept: enough for a long session, small enough to forget. */
export const VISION_CACHE_SIZE = 256;

/** sha256 of the image bytes (a data: URL's prefix is ignored). */
export function sha256Image(image: string | Uint8Array): string {
  let bytes: Buffer;
  if (typeof image === 'string') {
    const comma = image.startsWith('data:') ? image.indexOf(',') : -1;
    const data = comma >= 0 ? image.slice(comma + 1) : image;
    bytes = Buffer.from(data, 'base64');
  } else {
    bytes = Buffer.from(image.buffer, image.byteOffset, image.byteLength);
  }
  return createHash('sha256').update(bytes).digest('hex');
}

/** The cache key: the picture's hash plus what was asked about it (case-insensitive). */
export function visionCacheKey(image: string | Uint8Array, question: string): string {
  return `${sha256Image(image)}\u0000${question.trim().toLowerCase()}`;
}

/**
 * A fixed-capacity LRU. `Map` keeps insertion order, so the first key is the least recently used; get and set move
 * an entry to the end.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  readonly max: number;

  constructor(max: number = VISION_CACHE_SIZE) {
    this.max = Math.max(1, Math.floor(max));
  }

  get size(): number { return this.map.size; }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  has(key: K): boolean { return this.map.has(key); }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  delete(key: K): boolean { return this.map.delete(key); }
  clear(): void { this.map.clear(); }
  /** Oldest first — for tests and diagnostics. */
  keys(): K[] { return [...this.map.keys()]; }
}
