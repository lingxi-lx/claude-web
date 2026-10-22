import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectKeys } from '../../../scripts/i18n/scan.mjs';
import { EN_SITE } from './en';

const ROOT = path.resolve(__dirname, '../../..');
const SITE = path.join(ROOT, 'site/src');
const CJK = /[㐀-鿿]/;
/** web/src/features/settings/wording.test.ts's list, and 会话 (the interface says 对话). */
const BANNED_ZH = ['会话', '档案', '引擎', '窗格', '停靠'];
const BANNED_EN = [/\beffort\b/i, /ultracode/i, /\bACP\b/, /\bsessions?\b/i];

function astroFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...astroFiles(p));
    else if (p.endsWith('.astro')) out.push(p);
  }
  return out;
}

describe('the site\'s words', () => {
  const keys = [...collectKeys(ROOT).byArea.get('EN_SITE')!.keys()];

  it('are found by the shared scanner', () => {
    expect(keys.length).toBeGreaterThan(40);
  });

  it('say 对话 and none of the implementation words, in either language', () => {
    expect(keys.filter((k) => BANNED_ZH.some((w) => k.includes(w)))).toEqual([]);
    expect(Object.values(EN_SITE).filter((v) => BANNED_EN.some((re) => re.test(v)))).toEqual([]);
  });

  it('live in .ts files: an .astro file has no Chinese of its own', () => {
    const files = astroFiles(SITE);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => CJK.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
