// Hand edits of English texts. Usage: node scripts/i18n/set.mjs <file.json>   ({ "<中文 key>": "<English>" })
// (Without a file: only drops the catalog entries whose Chinese is no longer in the code.)
// Each text is written to every catalog whose area uses the key (and checked like merge.mjs checks them).
import fs from 'node:fs';
import { AREAS, collectKeys } from './scan.mjs';
import { readCatalog, root, writeCatalog } from './catalog.mjs';

const CJK = /[㐀-鿿]/;
const ph = (s) => [...new Set([...s.matchAll(/\{(\w+)\??/g)].map((m) => m[1]))].sort().join(',');
const edits = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : {};
const { byArea } = collectKeys(root);
let n = 0;
let pruned = 0;
const unknown = new Set(Object.keys(edits));
for (const area of AREAS) {
  const used = byArea.get(area.export);
  const cat = readCatalog(area);
  let changed = false;
  for (const [k, en] of Object.entries(edits)) {
    if (!used.has(k)) continue;
    unknown.delete(k);
    if (ph(k) !== ph(en)) { console.log(`placeholders differ, skipped: ${k}`); continue; }
    if ([...en].some((c) => CJK.test(c) && !k.includes(c))) { console.log(`Chinese in the English, skipped: ${k}`); continue; }
    if (cat[k] !== en) { cat[k] = en; changed = true; n++; }
  }
  for (const k of Object.keys(cat)) if (!used.has(k)) { delete cat[k]; changed = true; pruned++; }
  if (changed) writeCatalog(area, cat);
}
for (const k of unknown) console.log(`no such key: ${k}`);
console.log(`set ${n}, dropped ${pruned}`);
