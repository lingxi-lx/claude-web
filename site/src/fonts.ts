// The characters the pixel font is cut down to: the big title, the install title, the chapter titles, digits and the
// few marks next to them. scripts/fonts.ts subsets the font to exactly these.
import { copy } from './copy';
import type { Locale } from './i18n';

export function displayText(locale: Locale): string {
  const c = copy(locale);
  const s = [c.hero.title, c.install.title, ...c.chapters.map((x) => x.title), '0123456789 ,.+−·→↓%'].join('');
  return [...new Set(s)].sort().join('');
}
