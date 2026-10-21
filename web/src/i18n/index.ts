// The web app's side of the interface language: the server's English texts (shared modules — errors, the catalog —
// reach the page too) and its own, registered on the shared core. Importing this is what fixes the page's language
// (core.ts reads it when it is first imported): every module that calls `tr()` imports it first.
import { HINT_KEY, LANGUAGE_KEY, getLocale, registerEnglish, resolveLanguage } from '@i18n';

export * from '@i18n';

/**
 * The English catalogs, as their own chunk. They are ~420 KB of source and their keys are the Chinese text, so a
 * Chinese page needs none of it — keeping them out of the first-screen bundle is what holds the app under the phone
 * relay's response cap. Must finish before any module that calls `tr()` at the top level runs: main.tsx awaits it
 * before importing boot.tsx.
 */
export async function loadEnglish(): Promise<void> {
  if (getLocale() !== 'en') return;
  const [{ EN_SERVER }, { EN_WEB }] = await Promise.all([
    import('@i18n-en'),
    import('./en'),
  ]);
  registerEnglish(EN_SERVER);
  registerEnglish(EN_WEB);
}

const RELOAD_FLAG = 'cw.langReload';

/** What the language setting asks for on this machine: its choice, else the browser's language. */
export function wantedLanguage(setting: unknown) {
  return resolveLanguage(setting, typeof navigator === 'undefined' ? '' : navigator.language);
}

/** Keep the choice where the next page load can read it before the settings arrive (see core.ts). */
function rememberChoice(setting: unknown): void {
  try {
    if (setting === 'zh' || setting === 'en') localStorage.setItem(HINT_KEY, setting);
    else localStorage.removeItem(HINT_KEY);
  } catch { /* storage blocked */ }
}

/**
 * The settings arrived (or changed): when the language they ask for is not the one this page started in, load it
 * again in the right one — once (a page that cannot get there is left as it is rather than reloaded forever).
 */
export function reconcileLanguage(setting: unknown): void {
  rememberChoice(setting);
  const want = wantedLanguage(setting);
  if (want === getLocale()) { try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ } return; }
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === want) return;
    sessionStorage.setItem(RELOAD_FLAG, want);
  } catch { /* no session storage: reload anyway, once per page load */ }
  location.reload();
}

export { LANGUAGE_KEY };

// the page's own `lang`: spell-check, screen readers and the browser's translation offer read it
if (typeof document !== 'undefined') document.documentElement.lang = getLocale() === 'zh' ? 'zh-CN' : 'en';
