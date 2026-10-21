// 思考用的语言 (2026-10-19, user request after the DeepSeek Harness plugin dsh-thinking-language): the model is asked
// to think in a language of the user's choosing — pure prompt text, a section appended to the system prompt. The
// answer still follows the user's own language. Global setting `ai.thinkingLanguage`, per conversation
// SessionMeta.thinkingLanguage; see docs/notes/models.md 「思考用的语言」.
import type { Locale } from '../i18n/index.js';

export const THINKING_LANGUAGE_KEY = 'ai.thinkingLanguage';

/**
 * The languages, each named in itself + the English name the instruction uses. The settings window has the same ids
 * (web/src/features/settings/thinking-language.ts).
 */
export const THINKING_LANGUAGES: readonly { id: string; name: string; english: string }[] = [
  { id: 'zh-CN', name: '简体中文', english: 'Simplified Chinese' },
  { id: 'zh-TW', name: '繁體中文', english: 'Traditional Chinese' },
  { id: 'en', name: 'English', english: 'English' },
  { id: 'ja', name: '日本語', english: 'Japanese' },
  { id: 'ko', name: '한국어', english: 'Korean' },
  { id: 'fr', name: 'Français', english: 'French' },
  { id: 'de', name: 'Deutsch', english: 'German' },
  { id: 'es', name: 'Español', english: 'Spanish' },
  { id: 'ru', name: 'Русский', english: 'Russian' },
  { id: 'pt', name: 'Português', english: 'Portuguese' },
  { id: 'ar', name: 'العربية', english: 'Arabic' },
];

/** The interface language → the language 跟随界面语言 asks for. */
const BY_LOCALE: Record<Locale, string> = { zh: 'zh-CN', en: 'en' };

/**
 * The language a conversation thinks in (a THINKING_LANGUAGES entry), or null for no instruction.
 * `own`: the conversation's pick ('' / undefined = the setting, 'off' = none here); `global`: the setting
 * ('' / 'off' / unset = 不指定); 'auto' follows the interface language; an unknown id is no instruction.
 */
export function thinkingLanguageFor(own: unknown, global: unknown, locale: Locale) {
  const pick = typeof own === 'string' && own ? own : typeof global === 'string' ? global : '';
  if (!pick || pick === 'off') return null;
  const id = pick === 'auto' ? BY_LOCALE[locale] : pick;
  return THINKING_LANGUAGES.find((l) => l.id === id) ?? null;
}

/**
 * The short reminder that goes with every prompt and tool result (SDK hooks, as a system reminder the chat does not
 * show) — what the reference plugin does each step. The system-prompt section alone was not enough: Opus 5.5 under
 * Claude Code's long prompt kept thinking in English (2026-10-20, 48 of 57 thinking blocks after the pick).
 * Appended to the newest message only, so the cached prefix stays.
 */
export function thinkingLanguageReminder(lang: { name: string; english: string } | null): string {
  if (!lang) return '';
  const label = lang.name === lang.english ? lang.name : `${lang.name} (${lang.english})`;
  return `[Thinking language] The user wants your reasoning/thinking process written in ${label}. Continue your entire chain-of-thought in ${lang.english}. Your final answer follows the user's own language.`;
}

/** The system-prompt section for that language ('' = none). Stable text: the prompt cache keeps its prefix. */
export function thinkingLanguagePrompt(lang: { name: string; english: string } | null): string {
  if (!lang) return '';
  const label = lang.name === lang.english ? lang.name : `${lang.name} (${lang.english})`;
  return [
    '# Thinking language',
    `The user configured the language of your thinking/reasoning process: ${label}. Write your entire internal reasoning — chain-of-thought, analysis, planning, and deliberation — in ${lang.english}. Keep code, identifiers, file paths, and technical terms as they are. Your final answer to the user follows the user's own language; this setting never changes the final answer language.`,
  ].join('\n');
}
