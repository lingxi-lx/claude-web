import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { displayText } from './fonts';
import subset from './fonts.generated.json';

const FONTS = path.resolve(__dirname, '../public/fonts');

describe('the pixel title font', () => {
  for (const locale of ['en', 'zh'] as const) {
    it(`covers every title character on the ${locale} page (else: npm run fonts --prefix site)`, () => {
      const have = new Set(subset[locale]);
      expect([...displayText(locale)].filter((ch) => !have.has(ch))).toEqual([]);
    });
    it(`is a small woff2 (${locale})`, () => {
      const f = path.join(FONTS, `pixel-${locale}.woff2`);
      expect(fs.existsSync(f)).toBe(true);
      expect(fs.statSync(f).size).toBeLessThanOrEqual(60 * 1024);
    });
  }
  it('ships its licence', () => {
    expect(fs.readFileSync(path.join(FONTS, 'OFL.txt'), 'utf8')).toMatch(/SIL OPEN FONT LICENSE/i);
  });
  it('includes the digits for the numbers strip', () => {
    expect(displayText('en')).toContain('0');
    expect(displayText('zh')).toContain('9');
  });
});
