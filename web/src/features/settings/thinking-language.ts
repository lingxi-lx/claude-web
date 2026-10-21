// 思考用的语言 (docs/notes/models.md): the setting `ai.thinkingLanguage` (设置 → 模型与智能程度) and a conversation's own
// pick (SessionMeta.thinkingLanguage, the conversation's ··· menu: ThinkingLanguageRow.tsx). The server words the
// instruction (server/src/runtime/thinking-language.ts, same ids); a change restarts the conversation's process once
// it is idle.
import { tr } from '@/i18n';

export const THINKING_LANGUAGE_KEY = 'ai.thinkingLanguage';

/** Each language named in itself (the ids of server/src/runtime/thinking-language.ts). */
export const THINKING_LANGUAGES: readonly { id: string; l: string }[] = [
  { id: 'zh-CN', l: '简体中文' },
  { id: 'zh-TW', l: '繁體中文' },
  { id: 'en', l: 'English' },
  { id: 'ja', l: '日本語' },
  { id: 'ko', l: '한국어' },
  { id: 'fr', l: 'Français' },
  { id: 'de', l: 'Deutsch' },
  { id: 'es', l: 'Español' },
  { id: 'ru', l: 'Русский' },
  { id: 'pt', l: 'Português' },
  { id: 'ar', l: 'العربية' },
];

/** The setting's choices: 不指定 (the default, '') / 跟随界面语言 / each language named in itself. */
export function thinkingLanguageOptions(): { id: string; l: string }[] {
  return [{ id: '', l: tr('不指定') }, { id: 'auto', l: tr('跟随界面语言') }, ...THINKING_LANGUAGES];
}

/** A conversation's choices: '' = what the setting says (named), 'off' = none for this one, then the setting's own. */
export function conversationThinkingOptions(setting: unknown): { id: string; l: string }[] {
  const all = thinkingLanguageOptions();
  const now = all.find((o) => o.id === (typeof setting === 'string' && setting !== 'off' ? setting : ''))?.l ?? tr('不指定');
  return [{ id: '', l: tr('跟随设置（{now}）', { now }) }, { id: 'off', l: tr('不指定') }, ...all.slice(1)];
}
