// Reading and writing the English catalogs (plain object literals of JSON strings, keys sorted).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The catalog's current entries, read from its source text. */
export function readCatalog(area) {
  const file = path.join(root, area.catalog);
  if (!fs.existsSync(file)) return {};
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('{', src.indexOf(`${area.export}`));
  const end = src.lastIndexOf('};');
  if (start < 0 || end < 0) return {};
  try {
    return JSON.parse(`{${src.slice(start + 1, end).replace(/,\s*$/, '')}}`);
  } catch {
    return {};
  }
}

export function writeCatalog(area, entries) {
  const sorted = Object.keys(entries).sort().reduce((o, k) => { o[k] = entries[k]; return o; }, {});
  const header = fs.readFileSync(path.join(root, area.catalog), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n');
  const body = Object.entries(sorted).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
  fs.writeFileSync(path.join(root, area.catalog), `${header}\nexport const ${area.export}: Record<string, string> = {\n${body}\n};\n`);
}
