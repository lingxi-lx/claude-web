import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/data' }, session: { fromPartition: () => ({}) } }));
vi.mock('./i18n.js', () => ({ tr: (s: string) => s }));

const { browserCandidates, googleCookies, isPartition, loginReady, newPartition, profileDir, REQUIRED_COOKIES } = await import('./gemini-login');

const all = REQUIRED_COOKIES.map((name) => ({ name, value: 'v', domain: '.google.com' }));

describe('gemini login', () => {
  it('is ready only with every required cookie, none empty', () => {
    expect(loginReady(all)).toBe(true);
    expect(loginReady(all.filter((c) => c.name !== 'SAPISID'))).toBe(false);
    expect(loginReady(all.map((c) => (c.name === 'SID' ? { ...c, value: '' } : c)))).toBe(false);
    expect(loginReady([])).toBe(false);
  });

  it('joins the Google cookies, the gemini domain winning a name, others left out', () => {
    const list = [
      { name: 'SID', value: 'a', domain: '.google.com' },
      { name: 'SID', value: 'b', domain: 'gemini.google.com' },
      { name: 'NID', value: 'x', domain: '.google.com' },
      { name: 'OTHER', value: 'y', domain: '.example.com' },
      { name: 'EMPTY', value: '', domain: '.google.com' },
    ];
    expect(googleCookies(list)).toBe('SID=b; NID=x');
  });

  it('only reuses partitions it made', () => {
    expect(isPartition(newPartition())).toBe(true);
    expect(isPartition('persist:browser')).toBe(false);
    expect(isPartition('persist:gemini-../x')).toBe(false);
    expect(isPartition(undefined)).toBe(false);
  });

  it('keeps each login in a profile of its own', () => {
    expect(profileDir(path.join('/data'), 'persist:gemini-0123456789abcdef')).toBe(path.join('/data', 'gemini-browser', 'gemini-0123456789abcdef'));
  });

  it('looks for Chrome first, then Edge', () => {
    const win = browserCandidates('win32', { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' });
    expect(win[0]).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(win.some((p) => p.endsWith('msedge.exe'))).toBe(true);
    expect(browserCandidates('linux', {})).toContain('google-chrome');
    expect(browserCandidates('darwin', { HOME: '/Users/u' })[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });
});
