import { describe, expect, it } from 'vitest';
import { parseCookies } from './cookies';

const NOW = Date.UTC(2026, 9, 24); // ms
const FUTURE = Math.floor(NOW / 1000) + 86_400 * 30; // seconds, a month on
const PAST = Math.floor(NOW / 1000) - 86_400;

describe('cookies.txt (Netscape) files', () => {
  it('reads each line; comments and blank lines are skipped, not counted as bad', () => {
    const text = [
      '# Netscape HTTP Cookie File',
      '# https://curl.se/docs/http-cookies.html',
      '',
      `.example.com\tTRUE\t/\tTRUE\t${FUTURE}\tsid\tabc123`,
      `www.example.org\tFALSE\t/app\tFALSE\t0\tlang\tzh`,
    ].join('\n');
    const r = parseCookies(text, NOW);
    expect(r.bad).toBe(0);
    expect(r.ok).toEqual([
      { url: 'https://example.com/', name: 'sid', value: 'abc123', domain: '.example.com', path: '/', secure: true, httpOnly: false, expirationDate: FUTURE },
      // FALSE = this host only: no domain (Electron would widen it to subdomains); expiry 0 = a session cookie
      { url: 'http://www.example.org/app', name: 'lang', value: 'zh', path: '/app', secure: false, httpOnly: false },
    ]);
  });
  it('#HttpOnly_ is a prefix of the domain, not a comment', () => {
    const r = parseCookies(`#HttpOnly_.github.com\tTRUE\t/\tTRUE\t${FUTURE}\tuser_session\txyz`, NOW);
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]).toMatchObject({ domain: '.github.com', httpOnly: true, secure: true, url: 'https://github.com/', name: 'user_session' });
  });
  it('Windows line ends, and a value with an empty last field', () => {
    const r = parseCookies(`.a.com\tTRUE\t/\tFALSE\t0\tempty\t\r\n.a.com\tTRUE\t/\tFALSE\t0\tnovalue\r\n`, NOW);
    expect(r.bad).toBe(0);
    expect(r.ok.map((c) => [c.name, c.value])).toEqual([['empty', ''], ['novalue', '']]);
  });
  it('a line that is not a cookie, a bad domain, an expired cookie: counted as bad', () => {
    const text = [
      'not a cookie line',
      `.ok.com\tTRUE\t/\tFALSE\t${FUTURE}\tgood\t1`,
      `exa mple.com\tTRUE\t/\tFALSE\t0\tx\t1`,
      `.old.com\tTRUE\t/\tFALSE\t${PAST}\tgone\t1`,
      `.ok.com\tTRUE\t/\tFALSE\t0\t\tnoname`,
    ].join('\n');
    const r = parseCookies(text, NOW);
    expect(r.ok.map((c) => c.name)).toEqual(['good']);
    expect(r.bad).toBe(4);
  });
});

describe('JSON exports (Cookie-Editor, EditThisCookie, Playwright / Puppeteer)', () => {
  it('an array, with expirationDate in seconds and hostOnly', () => {
    const r = parseCookies(JSON.stringify([
      { domain: '.example.com', name: 'sid', value: 'v1', path: '/', secure: true, httpOnly: true, expirationDate: FUTURE + 0.5, hostOnly: false, sameSite: 'lax' },
      { domain: 'app.example.com', name: 'pref', value: 'dark', path: '/', secure: false, httpOnly: false, hostOnly: true, session: true },
    ]), NOW);
    expect(r.bad).toBe(0);
    expect(r.ok).toEqual([
      { url: 'https://example.com/', name: 'sid', value: 'v1', domain: '.example.com', path: '/', secure: true, httpOnly: true, expirationDate: FUTURE + 0.5 },
      { url: 'http://app.example.com/', name: 'pref', value: 'dark', path: '/', secure: false, httpOnly: false },
    ]);
  });
  it('{ cookies: [...] } with expires (seconds; -1 = a session cookie; milliseconds and dates too)', () => {
    const r = parseCookies(JSON.stringify({ cookies: [
      { name: 'a', value: '1', domain: '.x.com', path: '/', expires: FUTURE, httpOnly: false, secure: true },
      { name: 'b', value: '2', domain: '.x.com', path: '/', expires: -1 },
      { name: 'c', value: '3', domain: '.x.com', expires: FUTURE * 1000 },
      { name: 'd', value: '4', domain: '.x.com', expires: new Date(FUTURE * 1000).toISOString() },
    ] }), NOW);
    expect(r.bad).toBe(0);
    expect(r.ok.map((c) => [c.name, c.expirationDate])).toEqual([['a', FUTURE], ['b', undefined], ['c', FUTURE], ['d', FUTURE]]);
    expect(r.ok[2].path).toBe('/');
  });
  it('a __Host- cookie is never given a domain', () => {
    const r = parseCookies(JSON.stringify([{ name: '__Host-id', value: 'x', domain: 'site.com', path: '/', secure: true, hostOnly: false }]), NOW);
    expect(r.ok[0].domain).toBeUndefined();
    expect(r.ok[0].url).toBe('https://site.com/');
  });
  it('entries without a name or domain, expired ones and non-objects are bad; a number value is taken as text', () => {
    const r = parseCookies(JSON.stringify([
      { name: 'ok', value: 7, domain: 'a.com' },
      { value: 'x', domain: 'a.com' },
      { name: 'nodomain', value: 'x' },
      { name: 'old', value: 'x', domain: 'a.com', expirationDate: PAST },
      'junk',
      { name: 'slash', value: 'x', domain: 'a.com/evil' },
    ]), NOW);
    expect(r.ok).toEqual([{ url: 'http://a.com/', name: 'ok', value: '7', domain: 'a.com', path: '/', secure: false, httpOnly: false }]);
    expect(r.bad).toBe(5);
  });
  it('JSON that is not a list of cookies, or nothing at all: nothing, one bad', () => {
    expect(parseCookies('{"hello": 1}', NOW)).toEqual({ ok: [], bad: 1 });
    expect(parseCookies('[1, 2', NOW)).toEqual({ ok: [], bad: 1 });
    expect(parseCookies('', NOW)).toEqual({ ok: [], bad: 0 });
    expect(parseCookies('   \n# only a comment\n', NOW)).toEqual({ ok: [], bad: 0 });
  });
  it('a leading byte-order mark does not get in the way', () => {
    expect(parseCookies(`\uFEFF[{"name":"a","value":"1","domain":"a.com"}]`, NOW).ok).toHaveLength(1);
    expect(parseCookies(`\uFEFF.a.com\tTRUE\t/\tFALSE\t0\tn\tv`, NOW).ok).toHaveLength(1);
  });
});
