import { describe, expect, it } from 'vitest';
import { localeOf } from '@i18n';
import { href, langRedirect } from './paths';

const BASE = '/claude-web/';
const ORIGIN = 'https://psycioxyxs.my';
const loc = (pathname: string, search = '', hash = '') => ({ pathname, search, hash, origin: ORIGIN });

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
    expect(langRedirect(loc('/'), 'zh-CN', '', '/')).toBe('/zh/');
    expect(langRedirect(loc('/zh/'), 'zh-CN', '', '/')).toBeNull();
    expect(langRedirect(loc('/download/'), 'zh-CN', '', '/')).toBeNull();
  });
});

describe('langRedirect', () => {
  it('sends a Chinese browser from the English home page to /zh/', () => {
    expect(langRedirect(loc('/claude-web/'), 'zh-CN', '', BASE)).toBe('/claude-web/zh/');
    expect(langRedirect(loc('/claude-web'), 'zh', '', BASE)).toBe('/claude-web/zh/');
    expect(langRedirect(loc('/claude-web/'), 'zh-Hant-TW', '', BASE)).toBe('/claude-web/zh/');
  });
  it('stays for other languages, other pages, and a chosen language', () => {
    expect(langRedirect(loc('/claude-web/'), 'en-US', '', BASE)).toBeNull();
    expect(langRedirect(loc('/claude-web/'), '', '', BASE)).toBeNull();
    expect(langRedirect(loc('/claude-web/download/'), 'zh-CN', '', BASE)).toBeNull();
    expect(langRedirect(loc('/claude-web/', '?lang=en'), 'zh-CN', '', BASE)).toBeNull();
    expect(langRedirect(loc('/claude-web/', '?x=1&lang=en'), 'zh-CN', '', BASE)).toBeNull();
  });
  it('never redirects a click from inside the site (same-origin referrer)', () => {
    expect(langRedirect(loc('/'), 'zh-CN', `${ORIGIN}/download/`, '/')).toBeNull();
    expect(langRedirect(loc('/'), 'zh-CN', ORIGIN, '/')).toBeNull();
    expect(langRedirect(loc('/', '', '#features'), 'zh-CN', `${ORIGIN}/?lang=en`, '/')).toBeNull();
  });
  it('redirects a visit from outside the site or with no referrer', () => {
    expect(langRedirect(loc('/'), 'zh-CN', 'https://www.google.com/', '/')).toBe('/zh/');
    expect(langRedirect(loc('/'), 'zh-CN', '', '/')).toBe('/zh/');
    // a look-alike host is not this site
    expect(langRedirect(loc('/'), 'zh-CN', 'https://psycioxyxs.my.example.com/', '/')).toBe('/zh/');
  });
  it('keeps the #anchor', () => {
    expect(langRedirect(loc('/', '', '#install'), 'zh-CN', '', '/')).toBe('/zh/#install');
    expect(langRedirect(loc('/claude-web/', '', '#features'), 'zh-CN', '', BASE)).toBe('/claude-web/zh/#features');
  });
  it('reads a language tag the way the app does (localeOf)', () => {
    for (const tag of ['zh', 'zh-CN', 'ZH-tw', 'zhx', 'en', 'fr-FR', 'zh_CN']) {
      expect(langRedirect(loc(BASE), tag, '', BASE) !== null, tag).toBe(localeOf(tag) === 'zh');
    }
  });
  it('still works as text: Base.astro writes it inline into the page', () => {
    const inline = new Function(`return (${langRedirect.toString()})`)() as typeof langRedirect;
    expect(inline(loc('/claude-web/'), 'zh-CN', '', BASE)).toBe('/claude-web/zh/');
    expect(inline(loc('/claude-web/', '?lang=en'), 'zh-CN', '', BASE)).toBeNull();
    expect(inline(loc('/claude-web/'), 'zh-CN', `${ORIGIN}/claude-web/download/`, BASE)).toBeNull();
    expect(inline(loc('/claude-web/', '', '#install'), 'zh-CN', 'https://www.google.com/', BASE)).toBe('/claude-web/zh/#install');
  });
});
