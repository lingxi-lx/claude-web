// The first load of each home page stays within budget (docs/superpowers/specs/2026-10-21-website-design.md §7):
// the HTML and what it loads right away (stylesheets, icons, scripts, images, video posters) — not what a script
// fetches later on purpose (the scene's lazy chunk, the theme recordings).
//   node site/scripts/budget.ts        (after astro build; `npm run build --prefix site` runs it)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BUDGET = 1.5 * 1024 * 1024;

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

export function firstLoadBytes(dist: string, html: string, base: string): number {
  let n = Buffer.byteLength(html);
  for (const rel of firstLoadRefs(html, base)) {
    const f = path.join(dist, rel);
    if (fs.existsSync(f)) n += fs.statSync(f).size;
  }
  return n;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  let over = false;
  for (const page of ['index.html', 'zh/index.html']) {
    const n = firstLoadBytes(dist, fs.readFileSync(path.join(dist, page), 'utf8'), '/');
    console.log(`${page}: first load ${(n / 1048576).toFixed(2)} MB of ${(BUDGET / 1048576).toFixed(1)} MB`);
    if (n > BUDGET) over = true;
  }
  if (over) {
    console.error('over the first-load budget (spec §7)');
    process.exit(1);
  }
}
