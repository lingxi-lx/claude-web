import { describe, expect, it } from 'vitest';
import { CrashGuard, allowNavigation, externalAllowed, sameOrigin, windowOpenAction } from './nav-guard';

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
  // stage B task 1: a middle click on an in-page `#anchor` in a reply opened a second app window
  it('the app page with only a #hash added (an in-page anchor) is refused', () => {
    expect(windowOpenAction('http://127.0.0.1:3090/?token=a#x', APP)).toBe('deny');
    expect(windowOpenAction('http://127.0.0.1:3090/?token=abc&win=main#fn-1', APP)).toBe('deny');
    expect(windowOpenAction('http://127.0.0.1:3090/index.html?win=w1#top', APP)).toBe('deny');
    // a bare `#` is no hash at all (URL.hash is '') — still the app page
    expect(windowOpenAction('http://127.0.0.1:3090/?win=w2', APP)).toBe('app-window');
  });
});

// stage B task 1: the renderer's desktop.openExternal used to hand any scheme to the OS (file:, smb:, ms-settings:…)
describe('externalAllowed', () => {
  it('web pages, mail and phone numbers', () => {
    expect(externalAllowed('https://a.b')).toBe(true);
    expect(externalAllowed('http://a.b/x?y=1')).toBe(true);
    expect(externalAllowed('HTTPS://A.B')).toBe(true);
    expect(externalAllowed('mailto:x@y')).toBe(true);
    expect(externalAllowed('tel:1')).toBe(true);
  });
  it('anything else is refused', () => {
    expect(externalAllowed('file:///C:/x')).toBe(false);
    expect(externalAllowed('smb://h/s')).toBe(false);
    expect(externalAllowed('javascript:1')).toBe(false);
    expect(externalAllowed('ms-settings:')).toBe(false);
    expect(externalAllowed('\\\\host\\share')).toBe(false);
    expect(externalAllowed('C:\\Windows\\notepad.exe')).toBe(false);
    expect(externalAllowed('not a url')).toBe(false);
    expect(externalAllowed('')).toBe(false);
    expect(externalAllowed(undefined as unknown as string)).toBe(false);
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
