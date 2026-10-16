// Writes the spring tokens (web/src/ui/springs.ts) into web/src/tokens.css between the springs markers.
// `npx tsx scripts/gen-springs.ts` writes; `--check` exits 1 when tokens.css is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { springTokens } from '../web/src/ui/springs';

const file = new URL('../web/src/tokens.css', import.meta.url);
const css = readFileSync(file, 'utf8');
const B = '/* springs:begin */';
const E = '/* springs:end */';
const i = css.indexOf(B);
const j = css.indexOf(E);
if (i < 0 || j < i) throw new Error('tokens.css: springs markers not found');
const next = css.slice(0, i + B.length) + springTokens() + css.slice(j);
if (process.argv.includes('--check')) {
  if (next !== css) {
    console.error('tokens.css springs are stale: run npx tsx scripts/gen-springs.ts');
    process.exit(1);
  }
} else if (next !== css) writeFileSync(file, next);
