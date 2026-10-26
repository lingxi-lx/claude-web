import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const m = vi.hoisted(() => {
  const state: { settings: Record<string, unknown> } = { settings: {} };
  const useStore = Object.assign(() => undefined, { setState: (f: (s: typeof state) => Partial<typeof state>) => Object.assign(state, f(state)) });
  const sent: unknown[] = [];
  let reply: unknown = {};
  return { state, useStore, sent, setReply: (r: unknown) => { reply = r; }, request: async (r: unknown) => { sent.push(r); return reply; } };
});
vi.mock('@/store', () => ({ useStore: m.useStore }));
vi.mock('@/ws/client', () => ({ ws: { request: m.request } }));
import { ALLOWED_SITES_AUTO_KEY, ALLOWED_SITES_KEY, AllowedSitesList, readSites, removeAllowedSite } from './AllowedSites';

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

  it('removing a site asks the server to (one entry, done there with its mark), and the store takes the lists it answers', async () => {
    m.state.settings = { [ALLOWED_SITES_KEY]: ['a.example', 'shop.example'], [ALLOWED_SITES_AUTO_KEY]: ['shop.example'], other: 1 };
    m.setReply({ sites: ['a.example', 'new.example'], auto: ['new.example'] });
    await removeAllowedSite('shop.example');
    expect(m.sent.at(-1)).toEqual({ kind: 'web.allowedSites.remove', host: 'shop.example' });
    expect(m.state.settings).toEqual({ [ALLOWED_SITES_KEY]: ['a.example', 'new.example'], [ALLOWED_SITES_AUTO_KEY]: ['new.example'], other: 1 });
    // no marks left: no key
    m.setReply({ sites: ['a.example'], auto: [] });
    await removeAllowedSite('new.example');
    expect(m.state.settings[ALLOWED_SITES_AUTO_KEY]).toBeUndefined();
  });

  it('old data (a plain list, no marks) reads as before', () => {
    expect(readSites([' A.example ', 'a.example', 3, ''])).toEqual(['a.example']);
    const h = renderToStaticMarkup(<AllowedSitesList sites={['a.example']} auto={readSites(undefined)} onRemove={() => {}} />);
    expect(h).toContain('a.example');
    expect(h).not.toContain('data-auto');
  });
});
