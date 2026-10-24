import { describe, expect, it } from 'vitest';
import { Downloads, cleanVp, guestKeyOf, metricsParams, mobileUserAgent, safeName, uniqueIn } from './guest-tools';
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
