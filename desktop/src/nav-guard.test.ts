import { describe, expect, it } from 'vitest';
import { CrashGuard, allowNavigation, sameOrigin, windowOpenAction } from './nav-guard';

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

// 2026-10-24 review I2: a middle click on a path link in a reply (`/C:/Users/a/x.html`, resolved against the app)
// opened a window on that address — same origin was enough
describe('windowOpenAction', () => {
  it('the app page (window.open of a new app window) gets a window', () => {
    expect(windowOpenAction('http://127.0.0.1:3090/?token=abc&win=w123', APP)).toBe('app-window');
    expect(windowOpenAction('http://127.0.0.1:3090/index.html?win=w1', APP)).toBe('app-window');
  });
  it('any other address on the app\'s origin is refused', () => {
    expect(windowOpenAction('http://127.0.0.1:3090/C:/Users/a/x.html', APP)).toBe('deny');
    expect(windowOpenAction('http://127.0.0.1:3090/draft-preview.html', APP)).toBe('deny');
  });
  it('other web pages go to the system browser; anything else opens nothing', () => {
    expect(windowOpenAction('https://example.com/a', APP)).toBe('external');
    expect(windowOpenAction('http://127.0.0.1:3091/', APP)).toBe('external');
    expect(windowOpenAction('file:///C:/x.html', APP)).toBe('deny');
    expect(windowOpenAction('javascript:alert(1)', APP)).toBe('deny');
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
  it('after stopping, later crashes are ignored (no page is loaded again) until reset', () => {
    const g = new CrashGuard(3, 60_000);
    g.hit(0); g.hit(1000);
    expect(g.stopped).toBe(false);
    expect(g.hit(2000)).toBe('stop');
    expect(g.stopped).toBe(true);
    expect(g.hit(3000)).toBe('ignore');
    expect(g.hit(200_000)).toBe('ignore'); // the window passing does not resume it either
    g.reset();
    expect(g.stopped).toBe(false);
    expect(g.hit(201_000)).toBe('reload');
    expect(g.hit(202_000)).toBe('reload');
    expect(g.hit(203_000)).toBe('stop');
  });
});
