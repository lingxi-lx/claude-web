// Prints the English of Chinese keys: node scripts/i18n/get.mjs <key>...   (a substring search with --find <text>)
import { AREAS } from './scan.mjs';
import { readCatalog } from './catalog.mjs';

const args = process.argv.slice(2);
const find = args[0] === '--find' ? args[1] : null;
const seen = new Set();
for (const area of AREAS) {
  const cat = readCatalog(area);
  for (const [k, en] of Object.entries(cat)) {
    if (seen.has(k)) continue;
    if (find ? k.includes(find) || en.toLowerCase().includes(find.toLowerCase()) : args.includes(k)) { seen.add(k); console.log(JSON.stringify(k), '=>', JSON.stringify(en)); }
  }
}
