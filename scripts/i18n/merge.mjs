// Writes translated chunks into the English catalogs. Usage: node scripts/i18n/merge.mjs <dir>
// Reads <dir>/todo-NN.json (extract.mjs) and <dir>/done-NN.json (the English texts in the same order), checks each text against its key (the same placeholders, no
// Chinese left, not empty), merges what passes into the catalog of the area that uses the key, and prints the rest
// (<dir>/rejected.json: the keys to translate again, with the reason).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS, collectKeys } from './scan.mjs';
import { readCatalog, writeCatalog } from './catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.resolve(process.argv[2] ?? '.');
const CJK = /[㐀-鿿]/;
const ph = (s) => [...s.matchAll(/\{(\w+)\??/g)].map((m) => m[1]).sort().join(',');
const phSet = (s) => [...new Set(ph(s).split(',').filter(Boolean))].join(',');

// done-NN.json is an array of English texts, one per entry of todo-NN.json, in the same order
const done = {};
const short = [];
for (const f of fs.readdirSync(dir).filter((x) => /^todo-.*\.json$/.test(x))) {
  const todo = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const outFile = path.join(dir, f.replace('todo-', 'done-'));
  if (!fs.existsSync(outFile)) { short.push(`${f}: no done file`); continue; }
  const out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  if (!Array.isArray(out) || out.length !== todo.length) { short.push(`${f}: ${Array.isArray(out) ? out.length : 'not an array'} texts for ${todo.length} keys`); continue; }
  todo.forEach((row, i) => { done[row.k] = out[i]; });
}
if (short.length) console.log(['chunks not merged:', ...short].join('\n  '));

const { byArea } = collectKeys(root);
const rejected = [];
const accepted = new Map(AREAS.map((a) => [a.export, {}]));
let taken = 0;
for (const area of AREAS) {
  for (const [k] of byArea.get(area.export)) {
    if (!(k in done)) continue;
    const en = done[k];
    let why = null;
    if (typeof en !== 'string' || !en.trim()) why = 'empty';
    else if (phSet(en) !== phSet(k)) why = `placeholders ${phSet(k)} → ${phSet(en)}`;
    else if ((en.match(new RegExp(CJK.source, 'g')) ?? []).some((ch) => !k.includes(ch))) why = 'Chinese left'; // only Chinese the key itself has (search keywords, a quoted name) may stay
    if (why) rejected.push({ k, en, why });
    else { accepted.get(area.export)[k] = en; taken++; }
  }
}

for (const area of AREAS) {
  const add = accepted.get(area.export);
  if (!Object.keys(add).length) continue;
  const merged = { ...readCatalog(area), ...add };
  writeCatalog(area, merged);
}
fs.writeFileSync(path.join(dir, 'rejected.json'), JSON.stringify(rejected, null, 1));
console.log(`merged ${taken}, rejected ${rejected.length}`);
