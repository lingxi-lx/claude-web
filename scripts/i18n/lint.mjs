// Quick checks on the English texts that a translator can get wrong without anything failing: spaces at the edges,
// doubled spaces, a fragment that starts lowercase / uppercase against its Chinese, full-width punctuation left.
import { AREAS } from './scan.mjs';
import { readCatalog } from './catalog.mjs';

const seen = new Set();
const out = [];
for (const area of AREAS) {
  for (const [k, en] of Object.entries(readCatalog(area))) {
    if (seen.has(k)) continue;
    seen.add(k);
    const why = [];
    if (/^\s/.test(k) !== /^\s/.test(en)) why.push('lead-space');
    if (/\s$/.test(k) !== /\s$/.test(en)) why.push('trail-space');
    if (/ {2,}/.test(en) && !/ {2,}/.test(k)) why.push('double-space');
    if (/[，。；：（）「」、！？“”]/.test(en.replace(/[“”]/g, ''))) why.push('fullwidth');
    if (/\{\w+\}/.test(k) && /^\{\w+\}/.test(k) !== /^\{\w+\}/.test(en) && !/^\{\w+\}/.test(en) === false) why.push('lead-placeholder');
    if (/^[a-z]/.test(en) && /^[一-鿿A-Z「（]/.test(k) && !/^\{/.test(en)) why.push('lowercase-start');
    if (why.length) out.push([why.join(','), k.slice(0, 60), en.slice(0, 70)]);
  }
}
const by = {};
for (const [w] of out) for (const x of w.split(',')) by[x] = (by[x] || 0) + 1;
console.log(by);
const only = process.argv[2];
for (const [w, k, en] of out) if (!only || w.includes(only)) console.log(w.padEnd(14), JSON.stringify(k), '=>', JSON.stringify(en));
