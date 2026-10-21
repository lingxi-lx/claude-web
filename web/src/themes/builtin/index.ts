// The character themes that ship with the app (spec 2026-10-22 §4). Each one is a folder — theme.json, backdrop.js
// (run in the backdrop worker, read here as text) and theme.css, the same three files a theme made with the skill has
// — picked up by the glob below: a new folder is a new theme. ORDER is the order on 设置 → 外观.
const jsons = import.meta.glob('./*/theme.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const backdrops = import.meta.glob('./*/backdrop.js', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const csses = import.meta.glob('./*/theme.css', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

export const ORDER = ['phosphor', 'abyss', 'koi', 'moon', 'dither', 'orb', 'garden', 'paper', 'letters', 'ink'];

const folder = (k: string) => k.split('/')[1];
const rank = (id: string) => { const i = ORDER.indexOf(id); return i < 0 ? ORDER.length : i; };

export const BUILTIN_SOURCES: { json: unknown; backdrop?: string; css?: string }[] = Object.keys(jsons)
  .map(folder)
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  .map((id) => ({ json: jsons[`./${id}/theme.json`], backdrop: backdrops[`./${id}/backdrop.js`], css: csses[`./${id}/theme.css`] }));
