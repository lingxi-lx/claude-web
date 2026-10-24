import { describe, expect, it } from 'vitest';
import { CrashGuard, allowNavigation, sameOrigin } from './nav-guard';

const APP = 'http://127.0.0.1:3090/?token=abc&win=main';

describe('allowNavigation', () => {
  it('only the app page itself', () => {
    expect(allowNavigation('http://127.0.0.1:3090/?token=abc&win=main', APP)).toBe(true);
    expect(allowNavigation('http://127.0.0.1:3090/', APP)).toBe(true);
    expect(allowNavigation('http://127.0.0.1:3090/index.html?x=1', APP)).toBe(true);
  });
  it('a relative link resolved against the app (the white screen) is refused', () => {
    expect(allowNavigation('http://127.0.0.1:3090/draft-preview.html', APP)).toBe(false);
    expect(allowNavigation('http://127.0.0.1:3090/C:/Users/a/x.html', APP)).toBe(false);
  });
  it('other origins, file:, data: and garbage are refused', () => {
    expect(allowNavigation('http://127.0.0.1:3091/', APP)).toBe(false);
    expect(allowNavigation('https://example.com/', APP)).toBe(false);
    expect(allowNavigation('file:///C:/x.html', APP)).toBe(false);
    expect(allowNavigation('data:text/html,x', APP)).toBe(false);
    expect(allowNavigation('not a url', APP)).toBe(false);
    expect(allowNavigation('http://127.0.0.1:3090/', undefined)).toBe(false);
  });
  it('sameOrigin', () => {
    expect(sameOrigin('http://127.0.0.1:3090/x', APP)).toBe(true);
    expect(sameOrigin('https://example.com', APP)).toBe(false);
    expect(sameOrigin('http://127.0.0.1:3090/x', undefined)).toBe(false);
  });
});

describe('CrashGuard', () => {
  it('reloads twice, stops on the third crash within a minute', () => {
    const g = new CrashGuard(3, 60_000);
    expect(g.hit(0)).toBe('reload');
    expect(g.hit(10_000)).toBe('reload');
    expect(g.hit(20_000)).toBe('stop');
  });
  it('old crashes fall out of the window', () => {
    const g = new CrashGuard(3, 60_000);
    g.hit(0); g.hit(1000);
    expect(g.hit(70_000)).toBe('reload');
  });
});
