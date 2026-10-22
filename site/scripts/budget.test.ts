import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUDGET, firstLoadBytes, firstLoadRefs } from './budget.ts';

const BASE = '/';
const HTML = [
  '<link rel="stylesheet" href="/_astro/a.css">',
  '<link rel="icon" type="image/svg+xml" href="/icon.svg">',
  '<link rel="canonical" href="/">',
  '<link rel="alternate" hreflang="zh" href="/zh/">',
  '<script type="module" src="/_astro/main.js?v=1"></script>',
  '<script src="//cdn.example.test/x.js"></script>',
  '<img src="/_astro/cafe.gif" alt="">',
  '<img src="https://example.test/remote.png" alt="">',
  '<video poster="/poster.webp"></video>',
  '<a href="/download/">x</a>',
  '<img data-src="/lazy.png" alt="">',
].join('\n');

describe('firstLoadRefs', () => {
  it('counts what loads with the page: stylesheets, icons, scripts, images, posters (not other sites)', () => {
    expect(firstLoadRefs(HTML, BASE).sort()).toEqual(['_astro/a.css', '_astro/cafe.gif', '_astro/main.js', 'icon.svg', 'poster.webp']);
  });
});

describe('firstLoadBytes', () => {
  it('adds the HTML and the files that exist in dist', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'site-budget-'));
    fs.mkdirSync(path.join(dist, '_astro'));
    fs.writeFileSync(path.join(dist, '_astro/a.css'), 'x'.repeat(100));
    fs.writeFileSync(path.join(dist, '_astro/cafe.gif'), 'x'.repeat(1000));
    expect(firstLoadBytes(dist, HTML, BASE)).toBe(Buffer.byteLength(HTML) + 1100);
    fs.rmSync(dist, { recursive: true, force: true });
  });
  it('is 1.5 MB', () => {
    expect(BUDGET).toBe(1572864);
  });
});
