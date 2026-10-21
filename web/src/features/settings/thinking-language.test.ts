import { describe, expect, it } from 'vitest';
import { conversationThinkingOptions, thinkingLanguageOptions } from './thinking-language';

describe('思考用的语言 options', () => {
  it('the setting: 不指定 first (the default), then 跟随界面语言 and each language in itself', () => {
    const o = thinkingLanguageOptions();
    expect(o.slice(0, 2)).toEqual([{ id: '', l: '不指定' }, { id: 'auto', l: '跟随界面语言' }]);
    expect(o.map((x) => x.l)).toEqual(['不指定', '跟随界面语言', '简体中文', '繁體中文', 'English', '日本語', '한국어', 'Français', 'Deutsch', 'Español', 'Русский', 'Português', 'العربية']);
  });

  it('a conversation: follow the setting (named), or its own — 不指定 there is "none for this one"', () => {
    expect(conversationThinkingOptions('ja').slice(0, 3)).toEqual([{ id: '', l: '跟随设置（日本語）' }, { id: 'off', l: '不指定' }, { id: 'auto', l: '跟随界面语言' }]);
    expect(conversationThinkingOptions(undefined)[0].l).toBe('跟随设置（不指定）');
    expect(conversationThinkingOptions('off')[0].l).toBe('跟随设置（不指定）');
  });
});
