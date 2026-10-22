// The site's side of the shared i18n core (server/src/i18n/core.ts): the key of every text is its Chinese, the English
// is in ./en.ts. Both languages are built in one process, so nothing here reads or sets the core's current language:
// each page makes the `tr` of its own locale.
import { localeOf, registerEnglish, tIn, type Locale } from '@i18n';
import { EN_SITE } from './en';

registerEnglish(EN_SITE);

export type { Locale };
export { localeOf };
export const LOCALES: readonly Locale[] = ['en', 'zh'];

export function makeTr(locale: Locale): (zh: string, params?: Record<string, string | number>) => string {
  return (zh, params) => tIn(locale, zh, params);
}

export const otherLocale = (l: Locale): Locale => (l === 'zh' ? 'en' : 'zh');
