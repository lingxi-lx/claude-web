// Texture (spec 2026-10-16): hairline edges, the dark themes' inner ring, Inter Dark, radii — read from the stylesheets.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
const SRC = fileURLToPath(new URL('..', import.meta.url));
const cssFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith('.css') ? [p] : [];
  });
// the phone shell does not load tokens.css (it copies a dozen colours of its own)
const STYLED = cssFiles(SRC).filter((f) => !/[\\/]shell[\\/]/.test(f));

describe('texture tokens', () => {
  it('every stylesheet parses', () => {
    for (const f of cssFiles(SRC)) expect(() => postcss.parse(readFileSync(f, 'utf8'), { from: f })).not.toThrow();
  });
  it('hairline is 1px, and 0.5px at 2x', () => {
    expect(tokens).toMatch(/--hairline:\s*1px/);
    expect(tokens).toMatch(/@media \(resolution >= 2x\)\s*\{\s*:root\s*\{[^}]*--hairline:\s*0\.5px/);
  });
  it('elevation rings come from --ring-*', () => {
    for (const n of ['--elev-1', '--elev-2', '--elev-3', '--elev-composer']) {
      expect(tokens).toMatch(new RegExp(`${n}:\\s*var\\(--ring-[12]\\)`));
    }
  });
  it('dark themes get an inner highlight; light and paper are excluded', () => {
    expect(tokens).toContain(":root:not([data-theme='light']):not([data-theme='paper'])");
  });
  it('no 1px edge lines are left outside tokens.css', () => {
    const bad = STYLED.filter((f) => !f.endsWith('tokens.css'))
      .flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => [f, i + 1, l] as const))
      .filter(([, , l]) => /0 0 0 1px var\(--edge-|1px solid var\(--edge-/.test(l));
    expect(bad.map(([f, n]) => `${f}:${n}`)).toEqual([]);
  });
});

describe('type and radii', () => {
  const fonts = readFileSync(new URL('../fonts.css', import.meta.url), 'utf8');
  it('Inter Dark: a thin face below 400 and a strong face from 501, so 400 lands on the thin one', () => {
    expect(fonts).toMatch(/font-family: 'Inter Dark';[\s\S]*?font-weight: 350 380/);
    expect(fonts).toMatch(/font-family: 'Inter Dark';[\s\S]*?font-weight: 501 900/);
  });
  it('dark themes put Inter Dark first and keep Inter Variable as the fallback', () => {
    expect(tokens).toMatch(/--font: 'Inter Dark', 'Inter Variable'/);
  });
  it('no CSS asks for weight 500 (it would fall to the thin face in dark themes)', () => {
    const bad = cssFiles(SRC).filter((f) => /font-weight:\s*500\b/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('radii', () => {
    expect(tokens).toMatch(/--r-bubble:\s*18px/);
    expect(tokens).toMatch(/--r-composer:\s*20px/);
  });
});
