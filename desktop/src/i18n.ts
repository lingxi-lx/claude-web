// The desktop shell's side of the interface language (its own small copy: this build's rootDir is desktop/src, so it
// cannot import server/src/i18n). Same rules as server/src/i18n/core.ts: the Chinese text is the key, `{name}`
// placeholders, English plurals `{n?one:many}`. The language: `ui.language` in meta.json, else the machine's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EN_DESKTOP } from './en';

export type Locale = 'zh' | 'en';
type Params = Record<string, string | number | boolean | null | undefined>;

export const localeOf = (tag: string | null | undefined): Locale => (tag && /^zh(?![a-z])/i.test(tag.trim()) ? 'zh' : 'en');

function stored(): unknown {
  try {
    const file = path.join(process.env.CLAUDE_WEB_DIR ?? path.join(os.homedir(), '.claude-web'), 'meta.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'))?.settings?.['ui.language'];
  } catch {
    return undefined;
  }
}

let current: Locale = 'zh';
/** Decide the language (call once at start, after `app` is ready: `systemTag` is `app.getLocale()`). */
export function initLanguage(systemTag: string): Locale {
  const s = stored();
  current = s === 'zh' || s === 'en' ? s : localeOf(systemTag);
  return current;
}
export const getLocale = (): Locale => current;

export function tr(zh: string, params?: Params): string {
  let s = current === 'en' ? EN_DESKTOP[zh] ?? zh : zh;
  if (params) {
    s = s.replace(/\{(\w+)\?([^:{}]*):([^{}]*)\}/g, (all, n: string, one: string, many: string) => (params[n] === undefined ? all : Number(params[n]) === 1 ? one : many));
    s = s.replace(/\{(\w+)\}/g, (all, n: string) => (n in params ? String(params[n] ?? '') : all));
  }
  return s;
}
