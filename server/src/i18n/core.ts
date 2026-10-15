/**
 * The interface's two languages. The source text of every string is its Chinese (中文原文 = the key): `t('已选 {n} 项',
 * { n })` returns itself in 中文, and the entry of the English catalog under that same key in English. A string with
 * no English entry yet shows its Chinese (i18n/coverage.test.ts keeps that from happening). One module shared by the
 * server, the web app and the desktop shell (the web app reaches it through `@i18n`).
 *
 * Placeholders: `{name}` is replaced from `params` (a name `params` does not have stays as written, so a literal
 * brace in a text is safe). English plurals in the English text: `{n?one:many}` — `one` when n is 1, `many` otherwise
 * (`{n} {n?conversation:conversations}`). The language is fixed for the life of a page / process: switching it
 * reloads the page (module-level `t()` calls — labels in tables — are read once).
 */
export type Locale = 'zh' | 'en';
export const LOCALES: readonly Locale[] = ['zh', 'en'];
/** The setting `ui.language` in meta.json: follow the machine, or one of the two. */
export type LanguageSetting = 'auto' | Locale;
export const LANGUAGE_KEY = 'ui.language';

type Params = Record<string, string | number | boolean | null | undefined>;

const catalog: Record<string, string> = Object.create(null);
let current: Locale = 'zh';

/** 'zh-CN' / 'zh-Hant' / 'zh' → zh; any other tag (and nothing at all) → en. */
export function localeOf(tag: string | null | undefined): Locale {
  return tag && /^zh(?![a-z])/i.test(tag.trim()) ? 'zh' : 'en';
}

/** The language a setting asks for on a machine whose own language is `system`. */
export function resolveLanguage(setting: unknown, system: string | null | undefined): Locale {
  return setting === 'zh' || setting === 'en' ? setting : localeOf(system);
}

export function getLocale(): Locale {
  return current;
}
export function setLocale(l: Locale): void {
  current = l;
}

/** Add English texts (key = the Chinese source). Later calls win. */
export function registerEnglish(entries: Record<string, string>): void {
  Object.assign(catalog, entries);
}
export function englishOf(zh: string): string | undefined {
  return catalog[zh];
}
export function englishCatalogSize(): number {
  return Object.keys(catalog).length;
}

function plural(text: string, params: Params): string {
  return text.replace(/\{(\w+)\?([^:{}]*):([^{}]*)\}/g, (all, name: string, one: string, many: string) => {
    const v = params[name];
    return v === undefined ? all : Number(v) === 1 ? one : many;
  });
}

/** Fill `{name}` placeholders (and English plurals). Exported for texts that are built outside `t()`. */
export function fmt(text: string, params?: Params): string {
  if (!params) return text;
  return plural(text, params).replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name] ?? '') : all));
}

/** The text in the page's / process's language. */
export function t(zh: string, params?: Params): string {
  const s = current === 'en' ? catalog[zh] ?? zh : zh;
  return params ? fmt(s, params) : s;
}

/** The same text in a given language (a server answering in the language of the one it speaks for). */
export function tIn(locale: Locale, zh: string, params?: Params): string {
  const s = locale === 'en' ? catalog[zh] ?? zh : zh;
  return params ? fmt(s, params) : s;
}

// ---- where the language starts out ----------------------------------------------------------------------------

/**
 * The browser: the `<meta name="cw-lang">` the server writes into the page when the user chose a language, else the
 * last one chosen on this origin (a hint kept in localStorage, so a page served without the meta — the phone's
 * offline copy, the dev server — starts right), else the browser's own. Runs when this module is first imported, so
 * module-level `t()` calls in the app see it.
 */
export const HINT_KEY = 'cw.lang';
function startingLocale(): Locale | null {
  const g = globalThis as any;
  if (!g.document || !g.navigator) return null;
  try {
    const meta = g.document.querySelector?.('meta[name="cw-lang"]')?.getAttribute('content');
    if (meta === 'zh' || meta === 'en') return meta;
  } catch { /* no DOM to ask */ }
  try {
    const hint = g.localStorage?.getItem(HINT_KEY);
    if (hint === 'zh' || hint === 'en') return hint;
  } catch { /* storage blocked */ }
  return localeOf(g.navigator.language);
}
const start = startingLocale();
if (start) current = start;

/** The name the app code calls it by (`t` is too often a local variable). */
export const tr = t;

/**
 * A text whose English is not what the same Chinese says elsewhere (「项目」 is 「Projects」 as the sidebar's heading and
 * 「Project」 as a field's label): the English is written next to it instead of in the catalog.
 */
export function trAs(zh: string, en: string, params?: Params): string {
  return fmt(current === 'en' ? en : zh, params);
}

/** The locale tag for dates and numbers shown to the user (`toLocaleString(dateLocale())`). */
export const dateLocale = (): string => (current === 'zh' ? 'zh-CN' : 'en-US');
