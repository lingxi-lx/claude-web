import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dirSource, fetchMedia, releaseSource, retrying, sha256, type MediaManifest } from './fetch-media';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cw-media-'));
function fixture() {
  const src = tmp();
  const a = Buffer.from('poster bytes');
  const b = Buffer.from('video bytes');
  fs.writeFileSync(path.join(src, 'phosphor.en.webp'), a);
  fs.writeFileSync(path.join(src, 'phosphor.en.webm'), b);
  const m: MediaManifest = { repo: 'x/y', tag: 'site-media', webmCodecs: 'vp9', files: {
    'phosphor.en.webp': { sha256: sha256(a), bytes: a.length },
    'phosphor.en.webm': { sha256: sha256(b), bytes: b.length },
  } };
  return { src, m };
}
const quiet = () => {};

describe('fetchMedia', () => {
  it('copies the files that match', async () => {
    const { src, m } = fixture();
    const out = tmp();
    expect(await fetchMedia(m, out, dirSource(src), undefined, quiet)).toEqual({ copied: ['phosphor.en.webm', 'phosphor.en.webp'], missing: [] });
    expect(fs.readFileSync(path.join(out, 'phosphor.en.webm'), 'utf8')).toBe('video bytes');
  });

  it('fails the build on a sha256 mismatch', async () => {
    const { src, m } = fixture();
    fs.writeFileSync(path.join(src, 'phosphor.en.webm'), 'tampered');
    await expect(fetchMedia(m, tmp(), dirSource(src), undefined, quiet)).rejects.toThrow(/sha256 mismatch.*phosphor\.en\.webm/);
  });

  it('warns and goes on when the files cannot be reached', async () => {
    const { m } = fixture();
    const warned: string[] = [];
    const r = await fetchMedia(m, tmp(), async () => null, undefined, (s) => warned.push(s));
    expect(r).toEqual({ copied: [], missing: ['phosphor.en.webm', 'phosphor.en.webp'] });
    expect(warned[0]).toMatch(/2 of 2 files unreachable/);
  });

  it('SITE_MEDIA_STRICT: a file that cannot be reached fails the build', async () => {
    const { src, m } = fixture();
    fs.rmSync(path.join(src, 'phosphor.en.webm'));
    await expect(fetchMedia(m, tmp(), dirSource(src), undefined, quiet, true)).rejects.toThrow(/1 of 2 files unreachable.*phosphor\.en\.webm/);
  });

  it('retries a file that does not come, with a growing pause, then gives up', async () => {
    const { src, m } = fixture();
    const local = dirSource(src);
    const asked: string[] = [];
    const waits: number[] = [];
    const wait = async (ms: number) => { waits.push(ms); };
    // the webm comes on the third try, the poster at once
    let tries = 0;
    const flaky = retrying(async (f) => { asked.push(f); return f.endsWith('.webm') && ++tries < 3 ? null : local(f); }, 2, 100, wait);
    expect(await fetchMedia(m, tmp(), flaky, undefined, quiet, true)).toEqual({ copied: ['phosphor.en.webm', 'phosphor.en.webp'], missing: [] });
    expect(asked.filter((f) => f.endsWith('.webm'))).toHaveLength(3);
    expect(waits).toEqual([100, 200]);
    // never there: three asks, then missing
    const never: string[] = [];
    const gone = retrying(async (f) => { never.push(f); return null; }, 2, 1, wait);
    expect((await fetchMedia(m, tmp(), gone, undefined, quiet)).missing).toEqual(['phosphor.en.webm', 'phosphor.en.webp']);
    expect(never).toHaveLength(6);
  });

  it('uses the cache when its copy matches', async () => {
    const { src, m } = fixture();
    const cache = tmp();
    await fetchMedia(m, tmp(), dirSource(src), cache, quiet);
    expect(await fetchMedia(m, tmp(), async () => null, cache, quiet)).toEqual({ copied: ['phosphor.en.webm', 'phosphor.en.webp'], missing: [] });
  });

  it('the release source answers null when nothing is there', async () => {
    const { m } = fixture();
    expect(await releaseSource(m, 'http://127.0.0.1:9')('phosphor.en.webp')).toBeNull();
  });
});
