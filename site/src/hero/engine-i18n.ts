// The engine's tr() on the site: web/src/features/cafe/* import '@/i18n' and the characters' core imports the server's
// i18n index; site/engine.config.mjs points both here. The page's own language (<html lang>), English from the generated
// table (scripts/engine-en.ts) — never the product's catalogs in the browser.
import { registerEnglish, tIn, type Locale } from '@i18n';
import { ENGINE_EN } from './engine-en.generated';

registerEnglish(ENGINE_EN);

type Params = Parameters<typeof tIn>[2];

export function pageLocale(): Locale {
  const lang: unknown = (globalThis as { document?: { documentElement?: { lang?: string } } }).document?.documentElement?.lang;
  return typeof lang === 'string' && /^zh/i.test(lang) ? 'zh' : 'en';
}

export function tr(zh: string, params?: Params): string {
  return tIn(pageLocale(), zh, params);
}
export const t = tr;
