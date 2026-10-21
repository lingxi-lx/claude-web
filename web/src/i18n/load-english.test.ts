import { afterEach, describe, expect, it } from 'vitest';
import { englishOf, getLocale, setLocale } from '@i18n';
import { loadEnglish } from './index';

afterEach(() => setLocale('zh'));

describe('loadEnglish (the catalogs are their own chunk)', () => {
  it('a Chinese page loads nothing and every text stays its Chinese source', async () => {
    setLocale('zh');
    await loadEnglish();
    expect(getLocale()).toBe('zh');
    // nothing was registered: an English lookup has no entry
    expect(englishOf('设置')).toBeUndefined();
  });

  it('an English page registers both catalogs before it resolves', async () => {
    setLocale('en');
    await loadEnglish();
    expect(getLocale()).toBe('en');
    expect(englishOf('设置')).toBeTruthy();
    // the server's catalog too (shared modules: errors, the model catalog)
    expect(englishOf('请求体过大')).toBeTruthy();
  });

  it('loading twice is harmless', async () => {
    setLocale('en');
    await loadEnglish();
    const once = englishOf('设置');
    await loadEnglish();
    expect(englishOf('设置')).toBe(once);
  });
});
