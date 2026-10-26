import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/store', () => ({ useStore: () => undefined }));
vi.mock('@/ws/client', () => ({ ws: { request: async () => ({}) } }));
import { ALLOWED_SITES_AUTO_KEY, AllowedSitesList, readSites, withoutSite } from './AllowedSites';

describe('允许的网站: the sites 完全放开 added are marked', () => {
  it('the key is the server\'s (site-gate.ts ALLOWED_SITES_AUTO_KEY)', () => {
    expect(ALLOWED_SITES_AUTO_KEY).toBe('web.browser.allowedSitesAuto');
  });

  it('a site 完全放开 added carries the label; one the user chose does not; every row has its remove button', () => {
    const h = renderToStaticMarkup(<AllowedSitesList sites={['mine.example', 'shop.example']} auto={['shop.example', 'gone.example']} onRemove={() => {}} />);
    const mine = /<li[^>]*data-site="mine\.example"[^>]*>(.*?)<\/li>/.exec(h)?.[1] ?? '';
    const shop = /<li[^>]*data-site="shop\.example"[^>]*>(.*?)<\/li>/.exec(h)?.[1] ?? '';
    expect(shop).toContain('完全放开时自动加入');
    expect(h).toMatch(/<li[^>]*data-site="shop\.example"[^>]*data-auto="true"/);
    expect(mine).not.toContain('完全放开时自动加入');
    expect(mine).toContain('<button');
    expect(shop).toContain('<button');
    // a mark for a site that is not on the list is no row
    expect(h).not.toContain('gone.example');
  });

  it('removing a site takes it off the list and its mark off too (the rest untouched); no marks left is no key', () => {
    expect(withoutSite(['a.example', 'shop.example', 'b.example'], ['shop.example', 'b.example'], 'shop.example')).toEqual({ sites: ['a.example', 'b.example'], auto: ['b.example'] });
    expect(withoutSite(['a.example', 'shop.example'], ['shop.example'], 'shop.example')).toEqual({ sites: ['a.example'], auto: undefined });
    expect(withoutSite(['a.example'], [], 'a.example')).toEqual({ sites: [], auto: undefined });
  });

  it('old data (a plain list, no marks) reads as before', () => {
    expect(readSites([' A.example ', 'a.example', 3, ''])).toEqual(['a.example']);
    const h = renderToStaticMarkup(<AllowedSitesList sites={['a.example']} auto={readSites(undefined)} onRemove={() => {}} />);
    expect(h).toContain('a.example');
    expect(h).not.toContain('data-auto');
  });
});
