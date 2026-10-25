import { describe, expect, it } from 'vitest';
import { BROWSER_PARTITIONS, DOWNLOAD_BURST, Downloads, isRisky, browserPartition, cleanCookie, cleanVp, clearBrowsingData, guestKeyOf, importCookies, metricsParams, mobileUserAgent, safeName, uniqueIn } from './guest-tools';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const key = (o: Partial<{ type: string; key: string; code: string; control: boolean; meta: boolean; shift: boolean; alt: boolean }>) =>
  ({ type: 'keyDown', key: '', code: '', control: false, meta: false, shift: false, alt: false, ...o });

describe('the keys a built-in browser page hands to the panel', () => {
  it('Ctrl+F finds; Ctrl + = / - / 0 zoom the page (numpad too)', () => {
    expect(guestKeyOf(key({ key: 'f', code: 'KeyF', control: true }), false)).toBe('find');
    expect(guestKeyOf(key({ key: 'F', code: 'KeyF', control: true }), false)).toBe('find');
    expect(guestKeyOf(key({ key: '=', code: 'Equal', control: true }), false)).toBe('zoomIn');
    expect(guestKeyOf(key({ key: '+', code: 'Equal', control: true, shift: true }), false)).toBe('zoomIn');
    expect(guestKeyOf(key({ key: '+', code: 'NumpadAdd', control: true }), false)).toBe('zoomIn');
    expect(guestKeyOf(key({ key: '-', code: 'Minus', control: true }), false)).toBe('zoomOut');
    expect(guestKeyOf(key({ key: '-', code: 'NumpadSubtract', control: true }), false)).toBe('zoomOut');
    expect(guestKeyOf(key({ key: '0', code: 'Digit0', control: true }), false)).toBe('zoomReset');
    expect(guestKeyOf(key({ key: '0', code: 'Numpad0', control: true }), false)).toBe('zoomReset');
  });
  it('Cmd on a Mac, not Ctrl', () => {
    expect(guestKeyOf(key({ key: 'f', code: 'KeyF', meta: true }), true)).toBe('find');
    expect(guestKeyOf(key({ key: 'f', code: 'KeyF', control: true }), true)).toBeNull();
    expect(guestKeyOf(key({ key: 'f', code: 'KeyF', meta: true }), false)).toBeNull();
  });
  it('anything else stays the page\'s', () => {
    expect(guestKeyOf(key({ key: 'f', code: 'KeyF' }), false)).toBeNull();
    expect(guestKeyOf(key({ key: 'f', code: 'KeyF', control: true, alt: true }), false)).toBeNull();
    expect(guestKeyOf(key({ key: 'F', code: 'KeyF', control: true, shift: true }), false)).toBeNull();
    expect(guestKeyOf(key({ key: 'c', code: 'KeyC', control: true }), false)).toBeNull();
    expect(guestKeyOf(key({ type: 'keyUp', key: 'f', code: 'KeyF', control: true }), false)).toBeNull();
  });
});

describe('viewport emulation', () => {
  it('takes a device the panel sends; refuses nonsense', () => {
    expect(cleanVp(null)).toBeNull();
    expect(cleanVp({ w: 390, h: 844, touch: true, mobile: true })).toEqual({ w: 390, h: 844, touch: true, mobile: true });
    expect(cleanVp({ w: 390.4, h: 844, touch: 1, mobile: 0 })).toEqual({ w: 390, h: 844, touch: true, mobile: false });
    expect(cleanVp({ w: 0, h: 844 })).toBeUndefined();
    expect(cleanVp({ w: 99999, h: 844 })).toBeUndefined();
    expect(cleanVp({ w: '390', h: 844 })).toBeUndefined();
    expect(cleanVp('phone')).toBeUndefined();
    expect(cleanVp(undefined)).toBeUndefined();
  });
  it('a phone or tablet is a mobile screen of its size; the desktop preset a desktop one', () => {
    expect(metricsParams({ w: 390, h: 844, touch: true, mobile: true })).toEqual({
      width: 390, height: 844, deviceScaleFactor: 0, mobile: true, screenWidth: 390, screenHeight: 844, screenOrientation: { type: 'portraitPrimary', angle: 0 },
    });
    expect(metricsParams({ w: 1440, h: 900, touch: false, mobile: false })).toMatchObject({ mobile: false, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  });
  it('a phone says it is an Android phone, a tablet a tablet, both the Chrome the app is', () => {
    const base = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
    const phone = mobileUserAgent(base, { w: 390, h: 844, touch: true, mobile: true })!;
    expect(phone).toMatch(/Android/);
    expect(phone).toMatch(/Chrome\/152\.0\.0\.0 Mobile Safari/);
    const tablet = mobileUserAgent(base, { w: 820, h: 1180, touch: true, mobile: true })!;
    expect(tablet).toMatch(/Android/);
    expect(tablet).not.toMatch(/Mobile/);
    expect(mobileUserAgent(base, { w: 1440, h: 900, touch: false, mobile: false })).toBeNull();
  });
});

describe('download file names', () => {
  it('a name from a web site cannot leave the folder or be a name Windows refuses', () => {
    expect(safeName('report.pdf')).toBe('report.pdf');
    expect(safeName('..\\..\\evil.exe')).toBe('evil.exe');
    expect(safeName('../../etc/passwd')).toBe('passwd');
    expect(safeName('a:b*c?.txt')).toBe('a_b_c_.txt');
    expect(safeName('CON.txt')).toBe('_CON.txt');
    expect(safeName('name. ')).toBe('name');
    expect(safeName('')).toBe('download');
    expect(safeName('...')).toBe('download');
  });
  it('a name already in the folder gets a number', () => {
    const dir = path.join('D:', 'dl');
    const taken = new Set([path.join(dir, 'a.zip'), path.join(dir, 'a (1).zip')]);
    expect(uniqueIn(dir, 'a.zip', (p) => taken.has(p))).toBe(path.join(dir, 'a (2).zip'));
    expect(uniqueIn(dir, 'b.zip', (p) => taken.has(p))).toBe(path.join(dir, 'b.zip'));
    expect(uniqueIn(dir, 'README', (p) => p === path.join(dir, 'README'))).toBe(path.join(dir, 'README (1)'));
  });
});

/** A stand-in for Electron's DownloadItem / Session, enough for the tracker. */
class FakeItem extends EventEmitter {
  savePath = '';
  received = 0;
  constructor(private name: string, private total = 100) { super(); }
  getFilename() { return this.name; }
  setSavePath(p: string) { this.savePath = p; }
  getSavePath() { return this.savePath; }
  getReceivedBytes() { return this.received; }
  getTotalBytes() { return this.total; }
  cancelled = false;
  cancel() { this.cancelled = true; }
}

describe('the downloads tracker', () => {
  const setup = (existing: string[] = []) => {
    const session = new EventEmitter();
    const sent: { to: unknown; ev: Record<string, unknown> }[] = [];
    const host = { isDestroyed: () => false, send: (_ch: string, ev: Record<string, unknown>) => sent.push({ to: host, ev }) };
    const guest = { hostWebContents: host };
    const dir = path.join('D:', 'dl');
    const d = new Downloads(() => dir, (p) => existing.includes(p), 0);
    d.watch(session as never);
    d.watch(session as never); // twice: still one listener
    return { session, sent, guest, dir, d };
  };
  it('saves into the Downloads folder under a name of its own and reports to the window hosting the page', () => {
    const { session, sent, guest, dir, d } = setup([path.join('D:', 'dl', 'a.zip')]);
    expect(session.listenerCount('will-download')).toBe(1);
    const item = new FakeItem('a.zip');
    session.emit('will-download', {}, item, guest);
    expect(item.savePath).toBe(path.join(dir, 'a (1).zip'));
    expect(sent[0].ev).toMatchObject({ name: 'a (1).zip', state: 'progress', received: 0, total: 100 });
    item.received = 40;
    item.emit('updated', {}, 'progressing');
    expect(sent.at(-1)!.ev).toMatchObject({ state: 'progress', received: 40 });
    expect(d.owns(item.savePath)).toBe(false);
    item.received = 100;
    item.emit('done', {}, 'completed');
    expect(sent.at(-1)!.ev).toMatchObject({ state: 'done', received: 100, path: item.savePath });
    expect(d.owns(item.savePath)).toBe(true);
    expect(d.owns(path.join(dir, 'other.exe'))).toBe(false);
    expect(new Set(sent.map((s) => s.ev.id)).size).toBe(1);
  });
  it('two at once with the same name do not get the same file', () => {
    const { session } = setup();
    const a = new FakeItem('x.bin'), b = new FakeItem('x.bin');
    session.emit('will-download', {}, a, { hostWebContents: null });
    session.emit('will-download', {}, b, { hostWebContents: null });
    expect(a.savePath).not.toBe(b.savePath);
  });
  it('a cancelled or failed download is reported so and cannot be opened', () => {
    const { session, sent, guest, d } = setup();
    const item = new FakeItem('y.bin');
    session.emit('will-download', {}, item, guest);
    item.emit('done', {}, 'interrupted');
    expect(sent.at(-1)!.ev.state).toBe('failed');
    const item2 = new FakeItem('z.bin');
    session.emit('will-download', {}, item2, guest);
    item2.emit('done', {}, 'cancelled');
    expect(sent.at(-1)!.ev.state).toBe('cancelled');
    expect(d.owns(item.savePath)).toBe(false);
  });
  // stage B fix wave (S6): a page could download silently and without limit, and 打开 ran whatever came down
  it('a program or script is never opened from the bar (only shown in its folder); the event says so', () => {
    const { session, sent, guest, d } = setup();
    for (const name of ['setup.exe', 'run.BAT', 'x.cmd', 'x.ps1', 'x.lnk', 'x.hta', 'x.url', 'x.vbs', 'x.js', 'x.msi', 'x.scr']) {
      expect(isRisky(name), name).toBe(true);
      const item = new FakeItem(name);
      // a page of its own each (one page is held to DOWNLOAD_BURST)
      session.emit('will-download', {}, item, { hostWebContents: guest.hostWebContents });
      item.emit('done', {}, 'completed');
      expect(sent.at(-1)!.ev).toMatchObject({ state: 'done', risky: true });
      expect(d.owns(item.savePath)).toBe(true);
      expect(d.openable(item.savePath)).toBe(false);
    }
    for (const name of ['a.zip', 'b.pdf', 'c.png', 'README']) expect(isRisky(name), name).toBe(false);
    const ok = new FakeItem('report.pdf');
    session.emit('will-download', {}, ok, guest);
    ok.emit('done', {}, 'completed');
    expect(sent.at(-1)!.ev.risky).toBeUndefined();
    expect(d.openable(ok.savePath)).toBe(true);
    expect(d.openable('C:\elsewhere\report.pdf')).toBe(false);
  });
  it('at most DOWNLOAD_BURST downloads per page in DOWNLOAD_WINDOW_MS: the rest are cancelled and said so', () => {
    const { session, sent, guest } = setup();
    const items = Array.from({ length: DOWNLOAD_BURST + 2 }, (_, i) => new FakeItem(`f${i}.bin`));
    for (const it of items) session.emit('will-download', {}, it, guest);
    expect(items.slice(0, DOWNLOAD_BURST).every((i) => !i.cancelled)).toBe(true);
    expect(items.slice(DOWNLOAD_BURST).every((i) => i.cancelled)).toBe(true);
    expect(sent.filter((s) => s.ev.blocked === true).map((s) => s.ev.state)).toEqual(['cancelled', 'cancelled']);
    // another page is counted on its own
    const other = new FakeItem('o.bin');
    session.emit('will-download', {}, other, { hostWebContents: guest.hostWebContents });
    expect(other.cancelled).toBe(false);
  });
  it('no Downloads folder to be had: left to Electron (it asks), nothing reported, nothing thrown', () => {
    const session = new EventEmitter();
    const sent: unknown[] = [];
    const d = new Downloads(() => { throw new Error("Failed to get 'downloads' path"); }, () => false, 0);
    d.watch(session as never);
    const item = new FakeItem('a.zip');
    expect(() => session.emit('will-download', {}, item, { hostWebContents: { isDestroyed: () => false, send: (...a: unknown[]) => sent.push(a) } })).not.toThrow();
    expect(item.savePath).toBe('');
    expect(sent).toEqual([]);
  });
});

describe('cookies imported from a file, and clearing browsing data', () => {
  it('only the built-in browser\'s own profiles (never the app\'s, never a Gemini login\'s)', () => {
    expect(BROWSER_PARTITIONS).toEqual(['persist:cw-browser', 'persist:cw-agent', 'cw-session']);
    for (const p of BROWSER_PARTITIONS) expect(browserPartition(p)).toBe(p);
    expect(browserPartition('')).toBeNull();
    expect(browserPartition('persist:gemini-1')).toBeNull();
    expect(browserPartition(undefined)).toBeNull();
    expect(browserPartition(['persist:cw-browser'])).toBeNull();
  });
  it('a cookie the page hands over is checked again before it is set', () => {
    const c = { url: 'https://example.com/', name: 'sid', value: 'v', domain: '.example.com', path: '/', secure: true, httpOnly: true, expirationDate: 2_000_000_000 };
    expect(cleanCookie(c)).toEqual(c);
    expect(cleanCookie({ url: 'http://a.com/', name: 'n', value: '' })).toEqual({ url: 'http://a.com/', name: 'n', value: '' });
    // anything that is not a web address, no name, junk types
    expect(cleanCookie({ url: 'file:///C:/x', name: 'n', value: 'v' })).toBeNull();
    expect(cleanCookie({ url: 'javascript:alert(1)', name: 'n', value: 'v' })).toBeNull();
    expect(cleanCookie({ url: 'https://a.com/', name: '', value: 'v' })).toBeNull();
    expect(cleanCookie({ url: 'https://a.com/', name: 'n', value: 3 })).toBeNull();
    expect(cleanCookie({ url: 'https://a.com/', name: 'n', value: 'v'.repeat(5000) })).toBeNull();
    expect(cleanCookie('cookie')).toBeNull();
    expect(cleanCookie(null)).toBeNull();
    // optional fields of the wrong type are dropped, not trusted
    expect(cleanCookie({ url: 'https://a.com/', name: 'n', value: 'v', secure: 'yes', expirationDate: 'soon', domain: 7, path: {} })).toEqual({ url: 'https://a.com/', name: 'n', value: 'v' });
  });
  it('sets each good cookie into the profile, counts what did not go in', async () => {
    const set: unknown[] = [];
    const ses = { cookies: { set: async (d: { name: string }) => { if (d.name === 'refused') throw new Error('bad cookie'); set.push(d); } } };
    const r = await importCookies(ses, [
      { url: 'https://a.com/', name: 'one', value: '1' },
      { url: 'https://a.com/', name: 'refused', value: '2' },
      { url: 'ftp://a.com/', name: 'junk', value: '3' },
      'junk',
    ]);
    expect(r).toEqual({ set: 1, failed: 3 });
    expect(set).toEqual([{ url: 'https://a.com/', name: 'one', value: '1' }]);
    expect(await importCookies(ses, 'not a list')).toEqual({ set: 0, failed: 0 });
  });
  it('no more than 10 000 at once', async () => {
    let n = 0;
    const ses = { cookies: { set: async () => { n++; } } };
    const many = Array.from({ length: 10_050 }, (_, i) => ({ url: 'https://a.com/', name: `c${i}`, value: '' }));
    expect(await importCookies(ses, many)).toEqual({ set: 10_000, failed: 50 });
    expect(n).toBe(10_000);
  });
  it('clearing: the storage (cookies, local storage, caches of pages) and the HTTP cache', async () => {
    const calls: string[] = [];
    await clearBrowsingData({ clearStorageData: async () => { calls.push('storage'); }, clearCache: async () => { calls.push('cache'); } });
    expect(calls.sort()).toEqual(['cache', 'storage']);
  });
});
