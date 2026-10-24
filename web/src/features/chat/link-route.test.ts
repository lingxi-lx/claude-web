import { describe, expect, it, vi } from 'vitest';
import { routeLink } from './link-route';

// routeLink is pure; followLink's imports (the store touches browser globals at import time) are not needed here
vi.mock('@/store', () => ({ useStore: { getState: () => ({}) } }));
vi.mock('@/desktop', () => ({ desktop: null }));
vi.mock('@/features/remote-guard', () => ({ blockRemoteOpen: () => false }));

describe('routeLink', () => {
  it('web pages', () => {
    expect(routeLink('https://example.com/a?b=1', undefined)).toEqual({ to: 'web', url: 'https://example.com/a?b=1' });
    expect(routeLink('HTTP://x.dev', undefined)).toEqual({ to: 'web', url: 'HTTP://x.dev' });
  });
  it('mail / tel go to the system', () => {
    expect(routeLink('mailto:a@b.c', undefined)).toEqual({ to: 'external', url: 'mailto:a@b.c' });
    expect(routeLink('tel:123', undefined)).toEqual({ to: 'external', url: 'tel:123' });
  });
  it('dangerous or unknown schemes open nothing', () => {
    expect(routeLink('javascript:alert(1)', undefined)).toEqual({ to: 'none' });
    expect(routeLink('data:text/html,<b>x</b>', undefined)).toEqual({ to: 'none' });
    expect(routeLink('vbscript:x', undefined)).toEqual({ to: 'none' });
    expect(routeLink('', undefined)).toEqual({ to: 'none' });
  });
  it('in-page anchors are left to the page', () => {
    expect(routeLink('#fn-1', '/p')).toEqual({ to: 'anchor' });
  });
  it('file:// and absolute paths are files', () => {
    expect(routeLink('file:///C:/Users/a/draft%20preview.html', undefined)).toEqual({ to: 'file', path: 'C:/Users/a/draft preview.html' });
    expect(routeLink('file:///home/a/x.md', undefined)).toEqual({ to: 'file', path: '/home/a/x.md' });
    expect(routeLink('C:\\work\\x.html', undefined)).toEqual({ to: 'file', path: 'C:\\work\\x.html' });
    expect(routeLink('/C:/work/x.html', undefined)).toEqual({ to: 'file', path: 'C:/work/x.html' });
    expect(routeLink('/Users/a/x.svg', undefined)).toEqual({ to: 'file', path: '/Users/a/x.svg' });
  });
  it('relative paths resolve against the conversation folder', () => {
    expect(routeLink('preview.html', 'C:/proj')).toEqual({ to: 'file', path: 'C:/proj/preview.html' });
    expect(routeLink('./out/a.md', 'C:\\proj\\')).toEqual({ to: 'file', path: 'C:/proj/out/a.md' });
    expect(routeLink('../b/c.txt', '/home/u/proj')).toEqual({ to: 'file', path: '/home/u/b/c.txt' });
    expect(routeLink('preview.html', undefined)).toEqual({ to: 'none' });
  });
  it('line numbers: path:12 and #L12', () => {
    expect(routeLink('src/a.ts:12', '/p')).toEqual({ to: 'file', path: '/p/src/a.ts', line: 12 });
    expect(routeLink('src/a.ts#L7', '/p')).toEqual({ to: 'file', path: '/p/src/a.ts', line: 7 });
  });
});
