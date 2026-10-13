// server/src/characters/cafe-character.md → skill-text.ts (the skill ships inside the compiled server: tsc does not
// copy .md files, and the packaged app only carries server/dist). skill-text.test.ts fails when they differ.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'src', 'characters');
const md = readFileSync(path.join(dir, 'cafe-character.md'), 'utf8').replace(/\r\n/g, '\n');
writeFileSync(
  path.join(dir, 'skill-text.ts'),
  `// Generated from cafe-character.md by scripts/gen-skill-text.mjs — edit the .md, then run it.\nexport const SKILL_MD = ${JSON.stringify(md)};\n`,
);
console.log('skill-text.ts written');
