import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUDGET, cssUrls, firstLoadBytes, firstLoadFiles, firstLoadRefs, gzipBytes, lazyScripts, SCENE_BUDGET, staticImports } from './budget.ts';

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

describe('what CSS and scripts pull in', () => {
  it('fonts and images in url(), not data: or other sites', () => {
    const css = "@font-face{src:url('/fonts/pixel-en.woff2') format('woff2')}a{background:url(/img/x.png)}b{background:url(\"data:image/svg+xml;utf8,<svg/>\")}c{background:url(https://cdn.test/y.png)}";
    expect(cssUrls(css, '/').sort()).toEqual(['fonts/pixel-en.woff2', 'img/x.png']);
  });
  it('static imports, not import()', () => {
    const js = 'import{a as b}from"./chunk.A.js";import"./side.js";const m=()=>import("./lazy.js");export{b};';
    expect(staticImports(js)).toEqual(['./chunk.A.js', './side.js']);
  });
  it('first load follows CSS fonts and static imports; the lazy chunk stays out and is measured gzipped', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'site-budget-'));
    fs.mkdirSync(path.join(dist, '_astro'));
    fs.mkdirSync(path.join(dist, 'fonts'));
    fs.writeFileSync(path.join(dist, '_astro/a.css'), "@font-face{src:url('/fonts/p.woff2')}");
    fs.writeFileSync(path.join(dist, 'fonts/p.woff2'), 'x'.repeat(5000));
    fs.writeFileSync(path.join(dist, '_astro/entry.js'), 'import"./shared.js";const go=()=>import("./main.js");');
    fs.writeFileSync(path.join(dist, '_astro/shared.js'), 'x'.repeat(300));
    fs.writeFileSync(path.join(dist, '_astro/main.js'), 'y'.repeat(20000));
    const html = '<link rel="stylesheet" href="/_astro/a.css"><script type="module" src="/_astro/entry.js"></script>';
    const files = firstLoadFiles(dist, html, '/');
    expect(files.sort()).toEqual(['_astro/a.css', '_astro/entry.js', '_astro/shared.js', 'fonts/p.woff2']);
    const css = fs.statSync(path.join(dist, '_astro/a.css')).size, entry = fs.statSync(path.join(dist, '_astro/entry.js')).size;
    expect(firstLoadBytes(dist, html, '/')).toBe(Buffer.byteLength(html) + css + 5000 + entry + 300);
    const lazy = lazyScripts(dist, new Set(files));
    expect(lazy).toEqual(['_astro/main.js']);
    expect(gzipBytes(dist, lazy)).toBeLessThan(1000);
    fs.rmSync(dist, { recursive: true, force: true });
  });
  it('the scene JS may be 400 KB gzipped', () => {
    expect(SCENE_BUDGET).toBe(409600);
  });
});
