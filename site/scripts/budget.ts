// The first load of each home page stays within budget (docs/superpowers/specs/2026-10-21-website-design.md §7): the
// HTML, what it loads right away (stylesheets, preloads, icons, scripts, images, the poster), the fonts its CSS
// url()s, and the chunks its scripts import statically — ≤ 1.5 MB. What a script import()s later (the café scene) is not
// first load; it has its own cap: all of it ≤ 400 KB gzipped. The theme recordings are not counted (plan 3).
//   node site/scripts/budget.ts        (after astro build; `npm run build --prefix site` runs it)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BUDGET = 1.5 * 1024 * 1024;
export const SCENE_BUDGET = 400 * 1024;

const TAG = /<(script|link|img|video|source)\b[^>]*>/gi;
const attr = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag)?.[1];

export function firstLoadRefs(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(TAG)) {
    const tag = m[0];
    const kind = m[1].toLowerCase();
    if (kind === 'link' && !/^(stylesheet|preload|modulepreload|icon)$/i.test(attr(tag, 'rel') ?? '')) continue;
    const value = attr(tag, kind === 'link' ? 'href' : kind === 'video' ? 'poster' : 'src');
    if (!value) continue;
    const ref = value.split(/[?#]/)[0];
    // //host/x is another site even when the base is "/"
    if (!ref.startsWith('//') && ref.startsWith(base)) out.add(ref.slice(base.length));
  }
  return [...out];
}

/** Local files a stylesheet url()s (fonts, images); not data: URIs or other sites. */
export function cssUrls(css: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const ref = m[2].split(/[?#]/)[0];
    if (ref.startsWith('data:') || ref.startsWith('//') || /^[a-z]+:/i.test(ref)) continue;
    if (ref.startsWith(base)) out.add(ref.slice(base.length));
  }
  return [...out];
}

/** The modules a script imports statically, relative (./x.js) or absolute (/_astro/x.js); import()s are not first load. */
export function staticImports(js: string): string[] {
  return [...js.matchAll(/\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']((?:\.{1,2})?\/[^"']+)["']/g)].map((m) => m[1]);
}

export function firstLoadFiles(dist: string, html: string, base: string): string[] {
  const seen = new Set<string>();
  const queue = firstLoadRefs(html, base);
  // an inline module script (Astro inlines small ones) imports by absolute path
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) for (const i of staticImports(m[1])) if (i.startsWith(base)) queue.push(i.slice(base.length));
  while (queue.length) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    const f = path.join(dist, rel);
    if (!fs.existsSync(f)) continue;
    seen.add(rel);
    if (rel.endsWith('.css')) queue.push(...cssUrls(fs.readFileSync(f, 'utf8'), base));
    if (rel.endsWith('.js')) for (const i of staticImports(fs.readFileSync(f, 'utf8'))) queue.push(i.startsWith('/') ? i.slice(base.length) : path.posix.join(path.posix.dirname(rel), i));
  }
  return [...seen];
}

export function firstLoadBytes(dist: string, html: string, base: string): number {
  return firstLoadFiles(dist, html, base).reduce((n, rel) => n + fs.statSync(path.join(dist, rel)).size, Buffer.byteLength(html));
}

/** Scripts in _astro/ that no home page loads up front: what entry.ts import()s (the café scene). */
export function lazyScripts(dist: string, firstLoad: Set<string>): string[] {
  const dir = path.join(dist, '_astro');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => `_astro/${f}`).filter((rel) => !firstLoad.has(rel)).sort();
}

export function gzipBytes(dist: string, files: string[]): number {
  return files.reduce((n, rel) => n + zlib.gzipSync(fs.readFileSync(path.join(dist, rel)), { level: 9 }).length, 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  let over = false;
  const all = new Set<string>();
  for (const page of ['index.html', 'zh/index.html']) {
    const html = fs.readFileSync(path.join(dist, page), 'utf8');
    for (const f of firstLoadFiles(dist, html, '/')) all.add(f);
    const n = firstLoadBytes(dist, html, '/');
    console.log(`${page}: first load ${(n / 1048576).toFixed(2)} MB of ${(BUDGET / 1048576).toFixed(1)} MB`);
    if (n > BUDGET) over = true;
  }
  const lazy = lazyScripts(dist, all);
  const z = gzipBytes(dist, lazy);
  console.log(`scene JS (loaded later): ${(z / 1024).toFixed(0)} KB gzipped of ${SCENE_BUDGET / 1024} KB (${lazy.length} files)`);
  if (z > SCENE_BUDGET) over = true;
  if (over) {
    console.error('over budget (spec §7)');
    process.exit(1);
  }
}
