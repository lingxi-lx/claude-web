// The character themes that ship with the app (spec 2026-10-22 §4). Each one is a folder: theme.json, backdrop.js
// (run in the backdrop worker, read here as text) and theme.css — the same three files a theme made with the skill has.
import phosphorJson from './phosphor/theme.json';
import phosphorBackdrop from './phosphor/backdrop.js?raw';
import phosphorCss from './phosphor/theme.css?raw';
import paperJson from './paper/theme.json';
import paperBackdrop from './paper/backdrop.js?raw';
import paperCss from './paper/theme.css?raw';

export const BUILTIN_SOURCES: { json: unknown; backdrop?: string; css?: string }[] = [
  { json: phosphorJson, backdrop: phosphorBackdrop, css: phosphorCss },
  { json: paperJson, backdrop: paperBackdrop, css: paperCss },
];
