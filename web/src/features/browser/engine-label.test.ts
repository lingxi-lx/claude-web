import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

// 设置 → 联网's search choices are named in the page's language by WebSettings.tsx ENGINE_LABEL, keyed by the server's
// search ids (server/src/web/search.ts ENGINES): a key the server does not have is a name that is never shown, and the
// choice it was meant for falls back to the server's label in the server's language. Read as text: search.ts is the
// server's (its imports are not the web's).
const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const block = (text: string, start: RegExp) => {
  const at = text.search(start);
  expect(at, String(start)).toBeGreaterThanOrEqual(0);
  // up to the first line that closes an object or array literal at the top level
  const end = text.slice(at).search(/\n[}\]];/);
  return end < 0 ? text.slice(at) : text.slice(at, at + end);
};

describe('the search choices\' names (WebSettings ENGINE_LABEL)', () => {
  const serverIds = [...block(read('../../../../server/src/web/search.ts'), /export const ENGINES\b/).matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]);
  const labelKeys = [...block(read('./WebSettings.tsx'), /const ENGINE_LABEL\b/).matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);

  it('reads both lists', () => {
    expect(serverIds).toContain('auto');
    expect(labelKeys).toContain('auto');
  });
  it('every key is one of the server\'s search ids', () => {
    expect(labelKeys.filter((k) => !serverIds.includes(k))).toEqual([]);
  });
});
