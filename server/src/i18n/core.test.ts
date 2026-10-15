import { afterEach, describe, expect, it } from 'vitest';
import { englishOf, fmt, getLocale, localeOf, registerEnglish, resolveLanguage, setLocale, t, tIn } from './core.js';

describe('i18n core', () => {
  afterEach(() => setLocale('zh'));

  it('中文 is the key: zh returns it, en returns the catalog entry, a missing entry falls back to the Chinese', () => {
    registerEnglish({ '确定': 'OK', '已选 {n} 项': '{n} {n?item:items} selected' });
    expect(t('确定')).toBe('确定');
    setLocale('en');
    expect(t('确定')).toBe('OK');
    expect(t('没有翻译')).toBe('没有翻译');
    expect(englishOf('确定')).toBe('OK');
  });

  it('placeholders and plurals; an unknown {name} stays', () => {
    registerEnglish({ '已选 {n} 项': '{n} {n?item:items} selected' });
    expect(t('已选 {n} 项', { n: 3 })).toBe('已选 3 项');
    setLocale('en');
    expect(t('已选 {n} 项', { n: 1 })).toBe('1 item selected');
    expect(t('已选 {n} 项', { n: 0 })).toBe('0 items selected');
    expect(fmt('{"a":1} {x}', { y: 1 })).toBe('{"a":1} {x}');
    expect(tIn('zh', '已选 {n} 项', { n: 2 })).toBe('已选 2 项');
    expect(getLocale()).toBe('en');
  });

  it('which language a tag / setting means', () => {
    expect(['zh-CN', 'zh-Hant-TW', 'zh', 'ZH-cn'].map(localeOf)).toEqual(['zh', 'zh', 'zh', 'zh']);
    expect(['en-US', 'ja-JP', 'zhuang', '', undefined, null].map((x) => localeOf(x as any))).toEqual(['en', 'en', 'en', 'en', 'en', 'en']);
    expect(resolveLanguage('auto', 'zh-CN')).toBe('zh');
    expect(resolveLanguage(undefined, 'en-US')).toBe('en');
    expect(resolveLanguage('zh', 'en-US')).toBe('zh');
    expect(resolveLanguage('en', 'zh-CN')).toBe('en');
  });
});

import { withLanguage } from './boot.js';
describe('withLanguage', () => {
  const html = '<!doctype html>\n<html lang="zh-CN">\n  <head>\n    <meta charset="UTF-8" />\n    <title>x</title>';
  it('writes a chosen language into the page; nothing chosen leaves it alone', () => {
    expect(withLanguage(html, 'en')).toContain('<html lang="en"');
    expect(withLanguage(html, 'en')).toContain('<meta name="cw-lang" content="en" />');
    expect(withLanguage(html, 'zh')).toContain('<html lang="zh-CN"');
    expect(withLanguage(html, 'auto')).toBe(html);
    expect(withLanguage(html, undefined)).toBe(html);
  });
});
