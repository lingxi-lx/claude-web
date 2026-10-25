import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ALLOW_TTL_MS, FILE_PAGE_CSP, FileGuard, SERVE_TTL_MS, fileKey, assetAllowed, assetInside, fileRequestAllowed, isHomeOrRoot, pathInside, serveFile } from './file-guard';

const PAGE = 'file:///C:/w/my%20page.html';

describe('fileRequestAllowed', () => {
  const allow = new Set([PAGE]);
  it('a tab\'s top frame on an address the app opened loads', () => {
    expect(fileRequestAllowed({ url: PAGE, resourceType: 'mainFrame' }, allow)).toBe(true);
    expect(fileRequestAllowed({ url: `${PAGE}#part`, resourceType: 'mainFrame' }, allow)).toBe(true);
  });
  it('a top frame on any other file does not', () => {
    expect(fileRequestAllowed({ url: 'file:///C:/w/other.html', resourceType: 'mainFrame' }, allow)).toBe(false);
    expect(fileRequestAllowed({ url: 'file://host/share/x.html', resourceType: 'mainFrame' }, new Set(['file://host/share/x.html']))).toBe(false);
  });
  it('nothing a page asks for from file: loads — not even the page itself as a frame', () => {
    for (const resourceType of ['xhr', 'subFrame', 'script', 'image', 'stylesheet', 'media', 'font', 'object', 'other']) {
      expect(fileRequestAllowed({ url: 'file:///C:/Users/me/.ssh/id_ed25519', resourceType }, allow), resourceType).toBe(false);
      expect(fileRequestAllowed({ url: PAGE, resourceType }, allow), resourceType).toBe(false);
    }
  });
  it('http(s) is not this guard\'s business', () => {
    for (const resourceType of ['mainFrame', 'xhr', 'subFrame', 'script', 'image']) {
      expect(fileRequestAllowed({ url: 'https://example.com/a.js', resourceType }, new Set())).toBe(true);
      expect(fileRequestAllowed({ url: 'http://localhost:5173/', resourceType }, new Set())).toBe(true);
    }
  });
});

describe('fileKey', () => {
  it('one key however the address is spelled; only file:///', () => {
    expect(fileKey('file:///C:/w/my%20page.html#x')).toBe(PAGE);
    expect(fileKey('file:///C:/w/my page.html')).toBe(PAGE);
    expect(fileKey('file:///home/me/a.html')).toBe('file:///home/me/a.html');
    expect(fileKey('file://host/share/a.html')).toBeNull();
    expect(fileKey('https://a.b/')).toBeNull();
    expect(fileKey('not a url')).toBeNull();
  });
});

describe('FileGuard', () => {
  it('an address the app said it opens is taken by the first tab; that tab may reload it, nothing else', () => {
    const g = new FileGuard();
    const now = 1000;
    expect(g.allowed({ url: PAGE, resourceType: 'mainFrame', webContentsId: 1 }, now)).toBe(false);
    expect(g.allowOnce(PAGE, now)).toBe(true);
    expect(g.allowed({ url: PAGE, resourceType: 'mainFrame', webContentsId: 1 }, now + 10)).toBe(true);
    // taken: another tab cannot load it on the strength of the same allowance
    expect(g.allowed({ url: PAGE, resourceType: 'mainFrame', webContentsId: 2 }, now + 20)).toBe(false);
    // the same tab again (reload, back / forward)
    expect(g.allowed({ url: PAGE, resourceType: 'mainFrame', webContentsId: 1 }, now + 30)).toBe(true);
    // the page sends its own tab to another file, or fetches one
    expect(g.allowed({ url: 'file:///C:/w/other.html', resourceType: 'mainFrame', webContentsId: 1 }, now + 40)).toBe(false);
    expect(g.allowed({ url: 'file:///C:/secret.txt', resourceType: 'xhr', webContentsId: 1 }, now + 50)).toBe(false);
    g.forget(1);
    expect(g.allowed({ url: PAGE, resourceType: 'mainFrame', webContentsId: 1 }, now + 60)).toBe(false);
  });

  it('an allowance runs out; only file:/// addresses can be allowed', () => {
    const g = new FileGuard();
    expect(g.allowOnce(PAGE, 0)).toBe(true);
    expect(g.allowed({ url: PAGE, resourceType: 'mainFrame', webContentsId: 1 }, ALLOW_TTL_MS + 1)).toBe(false);
    expect(g.allowOnce('https://a.b/', 0)).toBe(false);
    expect(g.allowOnce('file://host/x.html', 0)).toBe(false);
    expect(g.allowOnce(42, 0)).toBe(false);
  });

  it('a tab moved on to a newly allowed file may load that one (and no longer the old)', () => {
    const g = new FileGuard();
    g.allowOnce(PAGE, 0);
    expect(g.allowed({ url: PAGE, resourceType: 'mainFrame', webContentsId: 1 }, 1)).toBe(true);
    g.allowOnce('file:///C:/w/b.html', 2);
    expect(g.allowed({ url: 'file:///C:/w/b.html', resourceType: 'mainFrame', webContentsId: 1 }, 3)).toBe(true);
    expect(g.allowed({ url: PAGE, resourceType: 'mainFrame', webContentsId: 1 }, 4)).toBe(false);
  });
});

describe('a local page\'s own styles, scripts and pictures (U6)', () => {
  const SITE = 'file:///C:/w/site/index.html';
  it('assetAllowed: script / style / picture / font / media inside the page\'s folder tree, nothing else', () => {
    for (const t of ['script', 'stylesheet', 'image', 'font', 'media']) {
      expect(assetAllowed({ url: 'file:///C:/w/site/style.css', resourceType: t }, SITE), t).toBe(true);
      expect(assetAllowed({ url: 'file:///C:/w/site/img/a%20b.png', resourceType: t }, SITE), t).toBe(true);
    }
    // what reads a file's contents, a frame, a worker: never
    for (const t of ['xhr', 'fetch', 'subFrame', 'mainFrame', 'object', 'webSocket', 'ping', 'cspReport', 'other', 'worker', 'sharedWorker']) {
      expect(assetAllowed({ url: 'file:///C:/w/site/app.js', resourceType: t }, SITE), t).toBe(false);
    }
    // outside the folder: up a level, a sibling folder with the same prefix, encoded separators, another drive, the page itself
    for (const url of ['file:///C:/w/secret.js', 'file:///C:/w/site/../secret.js', 'file:///C:/w/site/%2e%2e/secret.js', 'file:///C:/w/site-other/x.js', 'file:///C:/w/site/..%5Csecret.js', 'file:///C:/w/site/a%2F..%2F..%2Fx.js', 'file:///D:/w/site/x.js', 'file://host/share/x.js', SITE]) {
      expect(assetAllowed({ url, resourceType: 'script' }, SITE), url).toBe(false);
    }
    expect(assetAllowed({ url: 'file:///C:/w/site/x.js', resourceType: 'script' }, undefined)).toBe(false);
    // a page at the root of a drive gets no folder tree (the whole drive)
    expect(assetAllowed({ url: 'file:///C:/x.js', resourceType: 'script' }, 'file:///C:/index.html')).toBe(false);
  });
  it('FileGuard: the granted tab loads its assets (and they are served, with the policy); another tab does not; fetch still fails', () => {
    const g = new FileGuard();
    g.allowOnce(SITE, 0);
    expect(g.allowed({ url: SITE, resourceType: 'mainFrame', webContentsId: 7 }, 1)).toBe(true);
    expect(g.takeServe(SITE, 2)).toBe(true);
    expect(g.allowed({ url: 'file:///C:/w/site/style.css', resourceType: 'stylesheet', webContentsId: 7 }, 3)).toBe(true);
    expect(g.takeServe('file:///C:/w/site/style.css', 4)).toBe(true);
    expect(g.allowed({ url: 'file:///C:/w/site/data.json', resourceType: 'xhr', webContentsId: 7 }, 5)).toBe(false);
    expect(g.takeServe('file:///C:/w/site/data.json', 6)).toBe(false);
    expect(g.allowed({ url: 'file:///C:/w/site/style.css', resourceType: 'stylesheet', webContentsId: 8 }, 7)).toBe(false);
    expect(g.allowed({ url: 'file:///C:/w/site/app.js', resourceType: 'script', webContentsId: undefined }, 8)).toBe(false);
  });
  it('the guard says which granted page an asset is served for; a top frame has none (round 2)', () => {
    const g = new FileGuard();
    g.allowOnce(SITE, 0);
    g.allowed({ url: SITE, resourceType: 'mainFrame', webContentsId: 7 }, 1);
    expect(g.served(SITE, 2)).toEqual({});
    g.allowed({ url: 'file:///C:/w/site/style.css', resourceType: 'stylesheet', webContentsId: 7 }, 3);
    expect(g.served('file:///C:/w/site/style.css', 4)).toEqual({ root: SITE });
    expect(g.served('file:///C:/w/site/style.css', 5)).toBeNull();
  });
  it('a page in the home folder (or at a drive root) gets no folder tree: only the page itself loads (round 2)', () => {
    const home = 'file:///C:/Users/me/';
    expect(assetAllowed({ url: 'file:///C:/Users/me/a.png', resourceType: 'image' }, 'file:///C:/Users/me/index.html', home)).toBe(false);
    expect(assetAllowed({ url: 'file:///C:/Users/me/Desktop/x.png', resourceType: 'image' }, 'file:///c:/users/ME/index.html', home)).toBe(false);
    expect(assetAllowed({ url: 'file:///C:/Users/me/site/a.png', resourceType: 'image' }, 'file:///C:/Users/me/site/index.html', home)).toBe(true);
    expect(isHomeOrRoot('C:\\Users\\me', 'C:\\Users\\me')).toBe(true);
    expect(isHomeOrRoot('c:\\users\\ME\\', 'C:\\Users\\me')).toBe(process.platform === 'win32');
    expect(isHomeOrRoot(path.parse(process.cwd()).root, 'C:\\Users\\me')).toBe(true);
    expect(isHomeOrRoot(path.join(os.tmpdir(), 'x'), 'C:\\Users\\me')).toBe(false);
  });
});

describe('an asset is served only if its REAL path is inside the page\'s real folder (round 2: links and junctions)', () => {
  const made: string[] = [];
  afterAll(() => { for (const d of made) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* busy */ } });
  const setup = () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-guard-'));
    made.push(base);
    const site = path.join(base, 'site');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(site); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(site, 'index.html'), '<h1>x</h1>');
    fs.writeFileSync(path.join(site, 'style.css'), 'body{}');
    fs.writeFileSync(path.join(outside, 'secret.png'), 'SECRET');
    // a cloned repo's `assets -> somewhere else` (a junction on Windows: no admin rights needed). If the OS refuses to
    // make links here, the link cases are skipped (ctx.skip with a note) — the plain cases still run.
    let linked = true;
    try { fs.symlinkSync(outside, path.join(site, 'assets'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { linked = false; }
    return { base, site, outside, linked };
  };
  const url = (p: string) => pathToFileURL(p).href;
  const NO_LINK = 'the OS refused to create a symlink / junction in the temp folder: link case not checked here';

  it('assetInside: a file next to the page yes; a missing file no; a file elsewhere no; the home folder no', async () => {
    const { site, outside } = setup();
    expect(await assetInside(path.join(site, 'style.css'), site)).toBe(true);
    expect(await assetInside(path.join(site, 'nope.css'), site)).toBe(false);
    expect(await assetInside(path.join(outside, 'secret.png'), site)).toBe(false);
    // the page's own folder IS the home folder: nothing but the page itself (which is no asset)
    expect(await assetInside(path.join(site, 'style.css'), site, site)).toBe(false);
    // a drive / filesystem root: nothing
    expect(await assetInside(path.join(site, 'style.css'), path.parse(site).root)).toBe(false);
  });

  it('assetInside: a file through a junction / symlink inside the folder that points elsewhere is not inside', async (ctx) => {
    const { site, linked } = setup();
    if (!linked) { console.warn(NO_LINK); ctx.skip(); return; }
    // the address is inside the folder; the real file is not
    expect(fs.readFileSync(path.join(site, 'assets', 'secret.png'), 'utf8')).toBe('SECRET');
    expect(await assetInside(path.join(site, 'assets', 'secret.png'), site)).toBe(false);
  });

  it('serveFile: the same-folder asset is served with the policy; a page in the home folder serves no other file', async () => {
    const { site } = setup();
    const page = url(path.join(site, 'index.html'));
    let read = 0;
    const reader = async () => { read++; return new Response('data', { status: 200 }); };
    const ok = await serveFile(url(path.join(site, 'style.css')), { served: () => ({ root: page }) }, reader);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Security-Policy')).toBe(FILE_PAGE_CSP);
    expect(read).toBe(1);
    // the real home folder: a page right in it gets nothing else from it
    const homePage = url(path.join(os.homedir(), 'index.html'));
    const fromHome = await serveFile(url(path.join(os.homedir(), 'whatever.png')), { served: () => ({ root: homePage }) }, reader);
    expect(fromHome.status).toBe(403);
    expect(read).toBe(1);
    expect(assetAllowed({ url: url(path.join(os.homedir(), 'a.png')), resourceType: 'image' }, homePage)).toBe(false);
  });

  it('serveFile: the junction\'s file is 403 and never read', async (ctx) => {
    const { site, linked } = setup();
    if (!linked) { console.warn(NO_LINK); ctx.skip(); return; }
    const page = url(path.join(site, 'index.html'));
    let read = 0;
    const viaLink = await serveFile(url(path.join(site, 'assets', 'secret.png')), { served: () => ({ root: page }) }, async () => { read++; return new Response('SECRET'); });
    expect(viaLink.status).toBe(403);
    expect(read).toBe(0);
  });

  it('pathInside: only at a separator (C:\\proj2 is not inside C:\\proj), case-insensitive on Windows', () => {
    expect(pathInside(String.raw`C:\proj2\x`, String.raw`C:\proj`, true)).toBe(false);
    expect(pathInside(String.raw`C:\proj\x`, String.raw`C:\proj`, true)).toBe(true);
    expect(pathInside(String.raw`c:\PROJ\sub\x.png`, 'C:\\proj\\', true)).toBe(true);
    expect(pathInside(String.raw`C:\proj`, String.raw`C:\proj`, true)).toBe(false);
    expect(pathInside(String.raw`C:\proj\..\other\x`, String.raw`C:\proj`, true)).toBe(false);
    expect(pathInside('/proj2/x', '/proj', false)).toBe(false);
    expect(pathInside('/PROJ/x', '/proj', false)).toBe(false);
    expect(pathInside('/proj/x', '/proj', false)).toBe(true);
  });

  it('serveFile: C:\\proj2\\x for a page in C:\\proj is refused (real paths, prefix-sibling folder)', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-guard-'));
    made.push(base);
    fs.mkdirSync(path.join(base, 'proj')); fs.mkdirSync(path.join(base, 'proj2'));
    fs.writeFileSync(path.join(base, 'proj', 'index.html'), 'x');
    fs.writeFileSync(path.join(base, 'proj2', 'x.png'), 'x');
    const r = await serveFile(url(path.join(base, 'proj2', 'x.png')), { served: () => ({ root: url(path.join(base, 'proj', 'index.html')) }) }, async () => new Response('x'));
    expect(r.status).toBe(403);
  });
});

describe('the file: handler (workers: their requests never reach webRequest)', () => {
  it('serves only a top-frame load webRequest has just let through, once, and not after it runs out', () => {
    const g = new FileGuard();
    // nothing let through: a worker's fetch of any file is refused
    expect(g.takeServe('file:///C:/Users/me/.ssh/id_ed25519', 0)).toBe(false);
    g.allowOnce(PAGE, 0);
    expect(g.allowed({ url: PAGE, resourceType: 'mainFrame', webContentsId: 1 }, 1)).toBe(true);
    expect(g.takeServe(`${PAGE}#x`, 2)).toBe(true);
    expect(g.takeServe(PAGE, 3)).toBe(false); // once
    // a refused request is never served
    expect(g.allowed({ url: 'file:///C:/secret.txt', resourceType: 'xhr', webContentsId: 1 }, 4)).toBe(false);
    expect(g.takeServe('file:///C:/secret.txt', 5)).toBe(false);
    // let through, but served too late
    expect(g.allowed({ url: PAGE, resourceType: 'mainFrame', webContentsId: 1 }, 10)).toBe(true);
    expect(g.takeServe(PAGE, 10 + SERVE_TTL_MS + 1)).toBe(false);
    expect(g.takeServe('https://a.b/', 0)).toBe(false);
  });

  it('the page goes out with a policy that starts no worker, frame or plugin; anything else is 403', async () => {
    const ok = { served: () => ({}) };
    const r = await serveFile(PAGE, ok, async () => new Response('<h1>hi</h1>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Security-Policy')).toBe(FILE_PAGE_CSP);
    expect(FILE_PAGE_CSP).toContain("worker-src 'none'");
    expect(FILE_PAGE_CSP).toContain("frame-src 'none'");
    expect(FILE_PAGE_CSP).toContain("object-src 'none'");
    expect(FILE_PAGE_CSP).toContain("connect-src 'none'");
    expect(r.headers.get('Content-Type')).toBe('text/html');
    expect(await r.text()).toBe('<h1>hi</h1>');
    let read = 0;
    const no = await serveFile('file:///C:/secret.txt', { served: () => null }, async () => { read++; return new Response('secret'); });
    expect(no.status).toBe(403);
    expect(read).toBe(0);
    const gone = await serveFile(PAGE, ok, async () => { throw new Error('ENOENT'); });
    expect(gone.status).toBe(404);
  });
});
