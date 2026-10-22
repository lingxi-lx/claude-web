// Links into the README for "read more": the anchor GitHub gives a heading, computed from the README itself so a
// renamed heading cannot leave a dead link. The Chinese README's headings are the English ones', in the same order.
import en from '../../README.md?raw';
import zh from '../../README.zh-CN.md?raw';
import type { Locale } from './i18n';
import { REPO_URL } from './data/links';

/** GitHub's heading anchor: lower case, punctuation dropped (letters and digits of any script stay), spaces → -. */
export function githubSlug(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
}

export function headings(md: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced) {
      const m = /^#{2,4} (.+)$/.exec(line);
      if (m) out.push(m[1].trim());
    }
  }
  return out;
}

/** The README section whose English heading starts with `enPrefix` ("3. ", "About the installer"), in `locale`. */
export function readmeLink(locale: Locale, enPrefix: string): string {
  const enHeadings = headings(en);
  const i = enHeadings.findIndex((h) => h.startsWith(enPrefix));
  if (i < 0) throw new Error(`README.md has no heading starting with "${enPrefix}"`);
  if (locale === 'en') return `${REPO_URL}#${githubSlug(enHeadings[i])}`;
  const zhHeadings = headings(zh);
  if (zhHeadings.length !== enHeadings.length) throw new Error('README.md and README.zh-CN.md have different headings');
  return `${REPO_URL}/blob/main/README.zh-CN.md#${githubSlug(zhHeadings[i])}`;
}
