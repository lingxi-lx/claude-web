import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIRS = ['web/src', 'server/src', 'desktop/src', 'scripts'];
const files = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') files(p, out); }
    else if (/\.(tsx?|[cm]?js|css|json)$/.test(e.name)) out.push(p);
  }
  return out;
};

// a `\b` written through a shell (`node -e`, a heredoc) arrives as a real backspace: the regex then never matches
describe('source files hold no control characters', () => {
  it('nothing but tab / newline / CR below a space', () => {
    const bad: string[] = [];
    let seen = 0;
    for (const d of DIRS) {
      for (const p of files(path.join(ROOT, d))) {
        seen++;
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(line)) bad.push(`${path.relative(ROOT, p)}:${i + 1}`);
        });
      }
    }
    expect(seen).toBeGreaterThan(500);
    expect(bad).toEqual([]);
  });
});
