import { describe, expect, it } from 'vitest';
import { thinkingLanguageFor, thinkingLanguagePrompt } from './thinking-language.js';

describe('思考用的语言', () => {
  it('the conversation’s pick wins over the setting; off / unset / unknown = no instruction', () => {
    expect(thinkingLanguageFor(undefined, 'ja', 'zh')?.id).toBe('ja');
    expect(thinkingLanguageFor('', 'ja', 'zh')?.id).toBe('ja');
    expect(thinkingLanguageFor('fr', 'ja', 'zh')?.id).toBe('fr');
    expect(thinkingLanguageFor('off', 'ja', 'zh')).toBeNull();
    expect(thinkingLanguageFor(undefined, undefined, 'zh')).toBeNull();
    expect(thinkingLanguageFor(undefined, '', 'zh')).toBeNull();
    expect(thinkingLanguageFor(undefined, 'off', 'zh')).toBeNull();
    expect(thinkingLanguageFor(undefined, 'klingon', 'zh')).toBeNull();
  });

  it('跟随界面语言 follows the interface language', () => {
    expect(thinkingLanguageFor(undefined, 'auto', 'zh')?.id).toBe('zh-CN');
    expect(thinkingLanguageFor(undefined, 'auto', 'en')?.id).toBe('en');
    expect(thinkingLanguageFor('auto', 'off', 'en')?.id).toBe('en');
  });

  it('the section names the language and leaves the answer to the user’s language', () => {
    const p = thinkingLanguagePrompt(thinkingLanguageFor(undefined, 'ja', 'zh'));
    expect(p).toContain('Think in 日本語 (Japanese)');
    expect(p).toContain("Answer in the user's language");
    expect(thinkingLanguagePrompt(thinkingLanguageFor(undefined, 'en', 'zh'))).toContain('Think in English.');
    expect(thinkingLanguagePrompt(null)).toBe('');
  });
});
