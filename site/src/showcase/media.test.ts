import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectedMediaFiles } from './clips';

const m = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../media.json'), 'utf8'));

describe('site/media.json', () => {
  it('lists exactly the files the showcase plays', () => {
    expect(Object.keys(m.files).sort()).toEqual(expectedMediaFiles());
  });
  it('has a sha256 and a size for each', () => {
    for (const [name, e] of Object.entries(m.files) as [string, { sha256: string; bytes: number }][]) {
      expect(e.sha256, name).toMatch(/^[0-9a-f]{64}$/);
      expect(e.bytes, name).toBeGreaterThan(0);
    }
  });
  it('names the release and the webm codec', () => {
    expect(m.repo).toBe('ypyik0669/claude-web');
    expect(m.tag).toBe('site-media');
    expect(m.webmCodecs).toMatch(/^(av01\.|vp9$)/);
  });
});
