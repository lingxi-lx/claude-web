import type { Locale } from '@i18n';

export type Page = 'home' | 'download' | 'changelog';
const SEGMENT: Record<Page, string> = { home: '', download: 'download/', changelog: 'changelog/' };

/** A page of the site in a language: English at the root, Chinese under zh/. */
export function href(base: string, locale: Locale, page: Page, hash = ''): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  return root + (locale === 'zh' ? 'zh/' : '') + SEGMENT[page] + hash;
}

/**
 * Where a visit to the English home page goes when the browser reads Chinese; null = stay. A link that chose a
 * language carries ?lang= and is never redirected. Base.astro writes this function's text into the page, so it must
 * not use anything from outside its own body (no imports, no helpers).
 */
export function langRedirect(pathname: string, search: string, navLang: string, base: string): string | null {
  const root = base.charAt(base.length - 1) === '/' ? base : base + '/';
  if (pathname !== root && pathname + '/' !== root) return null;
  if (/(^|[?&])lang=/.test(search)) return null;
  return /^zh(?![a-z])/i.test(navLang.trim()) ? root + 'zh/' : null;
}
