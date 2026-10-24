import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './Markdown';
import { routeLink } from './link-route';

// the real <Markdown> (react-markdown + its urlTransform + the `a` component) rendered without a DOM; what it imports
// that touches browser globals or the app is stubbed
vi.mock('@/store', () => {
  const state = { open: {}, activeId: null };
  const useStore = Object.assign((sel: (s: unknown) => unknown) => sel(state), { getState: () => state });
  return { useStore };
});
vi.mock('@/store/paneContext', () => ({ usePaneCtx: () => null }));
vi.mock('@/desktop', () => ({ desktop: null }));
vi.mock('@/features/remote-guard', () => ({ blockRemoteOpen: () => false }));
vi.mock('./CodeBlock', () => ({ CodeBlock: () => null }));

const hrefs = (md: string) => [...renderToStaticMarkup(createElement(Markdown, { text: md })).matchAll(/<a href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

// 2026-10-24 review I1: react-markdown's default urlTransform blanked every href that is not http(s) / mailto / … —
// file:///…, C:/… (scheme `C`), C:\… (→ C:%5C…), tel: — so a click on them opened nothing
describe('<Markdown> links keep their href and route', () => {
  it('file:/// and Windows drive paths survive the markdown pipeline and are files', () => {
    const got = hrefs('[a](file:///C:/x.html) [b](C:\\work\\x.html) [c](C:/work/x.html) [d](file:///Users/a/x.md)');
    expect(got).toHaveLength(4);
    for (const h of got) expect(h).not.toBe('');
    expect(got.map((h) => routeLink(h, undefined))).toEqual([
      { to: 'file', path: 'C:/x.html' },
      { to: 'file', path: 'C:\\work\\x.html' },
      { to: 'file', path: 'C:/work/x.html' },
      { to: 'file', path: '/Users/a/x.md' },
    ]);
  });
  it('tel: survives and goes to the system', () => {
    const [h] = hrefs('[call](tel:+123)');
    expect(routeLink(h, undefined)).toEqual({ to: 'external', url: 'tel:+123' });
  });
  it('dangerous schemes are still blanked by the default transform', () => {
    expect(hrefs('[x](javascript:alert(1))')).toEqual(['']);
    expect(hrefs('[x](https://e.com/a)')).toEqual(['https://e.com/a']);
  });
  it('an image src keeps the default transform', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: '![i](file:///C:/x.png)' }));
    expect(html).toContain('<img');
    expect(html).not.toContain('file:');
  });
});
