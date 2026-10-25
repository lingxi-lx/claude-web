import { describe, expect, it } from 'vitest';
import { PAGE_ZOOMS, applyDownload, downloadPercent, fmtBytes, nextPageZoom, progressOn, screenshotName, type DownloadRow } from './panel-logic';

describe('the loading bar', () => {
  it('a load starts low, grows as the page arrives, and fills when it stops', () => {
    let p = progressOn(undefined, 'start');
    expect(p).toBe(0.1);
    p = progressOn(p, 'navigate');
    expect(p).toBeGreaterThan(0.1);
    const ready = progressOn(p, 'ready');
    expect(ready).toBeGreaterThan(p!);
    expect(progressOn(ready, 'stop')).toBe(1);
  });
  it('never goes back within a load (a late navigate after dom-ready)', () => {
    expect(progressOn(0.8, 'navigate')).toBe(0.8);
  });
  it('a new load after a finished one starts over', () => {
    expect(progressOn(1, 'start')).toBe(0.1);
  });
  it('a navigate with no start seen (an in-page jump) does not show a bar', () => {
    expect(progressOn(undefined, 'navigate')).toBeUndefined();
    expect(progressOn(undefined, 'ready')).toBeUndefined();
  });
});

describe('a tab\'s page zoom', () => {
  it('steps like a browser, both ways, and stops at the ends', () => {
    expect(nextPageZoom(1, 'in')).toBe(1.1);
    expect(nextPageZoom(1, 'out')).toBe(0.9);
    expect(nextPageZoom(undefined, 'in')).toBe(1.1);
    expect(nextPageZoom(PAGE_ZOOMS.at(-1)!, 'in')).toBe(PAGE_ZOOMS.at(-1));
    expect(nextPageZoom(PAGE_ZOOMS[0], 'out')).toBe(PAGE_ZOOMS[0]);
    expect(nextPageZoom(1.75, 'reset')).toBe(1);
  });
  it('a factor between two steps goes to the next one in that direction', () => {
    expect(nextPageZoom(1.05, 'in')).toBe(1.1);
    expect(nextPageZoom(1.05, 'out')).toBe(1);
  });
});

describe('a saved screenshot\'s name', () => {
  it('the page\'s title and when, as a PNG', () => {
    expect(screenshotName('Example Domain', new Date(2026, 9, 24, 9, 5, 7))).toBe('Example Domain 2026-10-24 09.05.07.png');
  });
  it('a long title is cut; no title is the word for it', () => {
    expect(screenshotName('x'.repeat(200), new Date(2026, 0, 1)).length).toBeLessThan(100);
    expect(screenshotName('  ', new Date(2026, 0, 1, 0, 0, 0))).toBe('screenshot 2026-01-01 00.00.00.png');
  });
});

describe('downloads', () => {
  const row = (o: Partial<DownloadRow>): DownloadRow => ({ id: 'd1', name: 'a.zip', state: 'progress', received: 0, total: 100, ...o });
  it('a new download is listed first; its later events update it in place', () => {
    let list = applyDownload([], row({}));
    list = applyDownload(list, row({ id: 'd2', name: 'b.pdf' }));
    expect(list.map((d) => d.id)).toEqual(['d2', 'd1']);
    list = applyDownload(list, row({ received: 50 }));
    expect(list.map((d) => d.id)).toEqual(['d2', 'd1']);
    expect(list[1].received).toBe(50);
    list = applyDownload(list, row({ state: 'done', received: 100, path: 'C:\\Users\\me\\Downloads\\a.zip' }));
    expect(list[1]).toMatchObject({ state: 'done', path: 'C:\\Users\\me\\Downloads\\a.zip' });
  });
  it('keeps the latest few', () => {
    let list: DownloadRow[] = [];
    for (let i = 0; i < 12; i++) list = applyDownload(list, row({ id: `d${i}` }));
    expect(list).toHaveLength(5);
    expect(list[0].id).toBe('d11');
  });
  it('keeps the shell\'s marks: a program (risky — no 打开) and a download it held back (blocked) (S6)', () => {
    let list = applyDownload([], row({ id: 'x', name: 'setup.exe', state: 'done', path: 'C:\\D\\setup.exe', risky: true }));
    expect(list[0]).toMatchObject({ risky: true });
    list = applyDownload(list, row({ id: 'y', state: 'cancelled', blocked: true }));
    expect(list[0]).toMatchObject({ blocked: true });
    expect(applyDownload([], row({ risky: 'yes' as never }))[0].risky).toBeUndefined();
  });
  it('ignores what is not a download event', () => {
    expect(applyDownload([], { id: 1 } as never)).toEqual([]);
    expect(applyDownload([], null as never)).toEqual([]);
  });
  it('percent only when the size is known', () => {
    expect(downloadPercent(row({ received: 25 }))).toBe(25);
    expect(downloadPercent(row({ received: 25, total: 0 }))).toBeNull();
    expect(downloadPercent(row({ received: 300 }))).toBe(100);
  });
  it('sizes read like a browser\'s', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(5.5 * 1024 * 1024)).toBe('5.5 MB');
    expect(fmtBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
});
