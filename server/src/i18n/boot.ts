// The server process's language: what the user chose (`ui.language` in meta.json), else the machine's. Read from the file
// before the server's modules load (init.ts is its first import), so module-level `tr()` calls see it; a change in the
// settings later sets it again (ws/hub.ts) for what is built from then on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LANGUAGE_KEY, resolveLanguage, setLocale, type Locale } from './core.js';

/** The machine's language tag: what the desktop shell says (the Electron app's), else Node's own (the OS's). */
export function systemLanguage(): string {
  const given = process.env.CLAUDE_WEB_SYSTEM_LANG;
  if (given) return given;
  try {
    const l = Intl.DateTimeFormat().resolvedOptions().locale;
    if (l) return l;
  } catch { /* no Intl */ }
  return process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
}

function metaFile(): string {
  return path.join(process.env.CLAUDE_WEB_DIR ?? path.join(os.homedir(), '.claude-web'), 'meta.json');
}

/** `ui.language` as stored ('auto' | 'zh' | 'en' | nothing), without loading the store. */
export function storedLanguage(file = metaFile()): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))?.settings?.[LANGUAGE_KEY];
  } catch {
    return undefined;
  }
}

/** Set the process's language from the setting (`undefined` = read it from meta.json). */
export function applyLanguage(setting?: unknown): Locale {
  const l = resolveLanguage(setting === undefined ? storedLanguage() : setting, systemLanguage());
  setLocale(l);
  return l;
}

/**
 * The app's page with the language the user chose written into it (`<meta name="cw-lang">`, read by core.ts before
 * anything else runs): a page loaded from the server starts right, without a flash of the other language. Nothing
 * chosen ('auto'): the page is left alone — the browser's own language decides there.
 */
export function withLanguage(html: string, setting: unknown): string {
  if (setting !== 'zh' && setting !== 'en') return html;
  const meta = `<meta name="cw-lang" content="${setting}" />`;
  const lang = setting === 'zh' ? 'zh-CN' : 'en';
  return html.replace(/<html lang="[^"]*"/, `<html lang="${lang}"`).replace(/(<meta charset="[^"]*"\s*\/?>)/i, `$1\n    ${meta}`);
}
