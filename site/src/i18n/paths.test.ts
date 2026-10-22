import { describe, expect, it } from 'vitest';
import { localeOf } from '@i18n';
import { href, langRedirect } from './paths';

const BASE = '/claude-web/';

describe('href', () => {
  it('puts Chinese under zh/ and keeps the trailing slash', () => {
    expect(href(BASE, 'en', 'home')).toBe('/claude-web/');
    expect(href(BASE, 'zh', 'home')).toBe('/claude-web/zh/');
    expect(href(BASE, 'en', 'download')).toBe('/claude-web/download/');
    expect(href(BASE, 'zh', 'changelog')).toBe('/claude-web/zh/changelog/');
    expect(href(BASE, 'en', 'download', '#source')).toBe('/claude-web/download/#source');
  });
  it('takes a base without its slash too', () => {
    expect(href('/claude-web', 'zh', 'download')).toBe('/claude-web/zh/download/');
  });
  it('works at the domain root (the real site: base "/")', () => {
    expect(href('/', 'en', 'home')).toBe('/');
    expect(href('/', 'zh', 'download', '#source')).toBe('/zh/download/#source');
    expect(langRedirect('/', '', 'zh-CN', '/')).toBe('/zh/');
    expect(langRedirect('/zh/', '', 'zh-CN', '/')).toBeNull();
    expect(langRedirect('/download/', '', 'zh-CN', '/')).toBeNull();
  });
});

describe('langRedirect', () => {
  it('sends a Chinese browser from the English home page to /zh/', () => {
    expect(langRedirect('/claude-web/', '', 'zh-CN', BASE)).toBe('/claude-web/zh/');
    expect(langRedirect('/claude-web', '', 'zh', BASE)).toBe('/claude-web/zh/');
    expect(langRedirect('/claude-web/', '', 'zh-Hant-TW', BASE)).toBe('/claude-web/zh/');
  });
  it('stays for other languages, other pages, and a chosen language', () => {
    expect(langRedirect('/claude-web/', '', 'en-US', BASE)).toBeNull();
    expect(langRedirect('/claude-web/', '', '', BASE)).toBeNull();
    expect(langRedirect('/claude-web/download/', '', 'zh-CN', BASE)).toBeNull();
    expect(langRedirect('/claude-web/', '?lang=en', 'zh-CN', BASE)).toBeNull();
    expect(langRedirect('/claude-web/', '?x=1&lang=en', 'zh-CN', BASE)).toBeNull();
  });
  it('reads a language tag the way the app does (localeOf)', () => {
    for (const tag of ['zh', 'zh-CN', 'ZH-tw', 'zhx', 'en', 'fr-FR', 'zh_CN']) {
      expect(langRedirect(BASE, '', tag, BASE) !== null, tag).toBe(localeOf(tag) === 'zh');
    }
  });
  it('still works as text: Base.astro writes it inline into the page', () => {
    const inline = new Function(`return (${langRedirect.toString()})`)() as typeof langRedirect;
    expect(inline('/claude-web/', '', 'zh-CN', BASE)).toBe('/claude-web/zh/');
    expect(inline('/claude-web/', '?lang=en', 'zh-CN', BASE)).toBeNull();
  });
});
