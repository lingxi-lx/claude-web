import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newPublishId, isPublishId, expiresAt, isExpired, resolveInside, localRefs, snapshotFiles, inlineHtml, PUBLISH_HEADERS } from './core.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-pub-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('publish core', () => {
  it('ids are 128-bit random hex', () => {
    const a = newPublishId(), b = newPublishId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(isPublishId(a)).toBe(true);
    expect(isPublishId('../x')).toBe(false);
    expect(isPublishId(a.slice(1))).toBe(false);
  });

  it('expiry: 1 day, 7 days, never', () => {
    const now = 1_000_000;
    expect(expiresAt('1d', now)).toBe(now + 86_400_000);
    expect(expiresAt('7d', now)).toBe(now + 7 * 86_400_000);
    expect(expiresAt('never', now)).toBeNull();
    expect(isExpired({ expiresAt: now - 1 }, now)).toBe(true);
    expect(isExpired({ expiresAt: now + 1 }, now)).toBe(false);
    expect(isExpired({ expiresAt: null }, now)).toBe(false);
  });

  it('headers: sandboxed without same-origin, nosniff', () => {
    expect(PUBLISH_HEADERS['Content-Security-Policy']).toBe('sandbox allow-scripts allow-popups');
    expect(PUBLISH_HEADERS['Content-Security-Policy']).not.toContain('same-origin');
    expect(PUBLISH_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });

  it('resolveInside refuses traversal, absolute paths, NUL and symlinks out', () => {
    const root = path.join(dir, 'snap'); fs.mkdirSync(path.join(root, 'img'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), 'x');
    fs.writeFileSync(path.join(root, 'img', 'a.png'), 'x');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'x');
    expect(resolveInside(root, 'index.html')).toBe(fs.realpathSync(path.join(root, 'index.html')));
    expect(resolveInside(root, 'img/a.png')).toBe(fs.realpathSync(path.join(root, 'img', 'a.png')));
    for (const bad of ['../secret.txt', 'img/../../secret.txt', '..%2fsecret.txt', '%2e%2e/secret.txt', '/etc/passwd', 'C:/Windows/win.ini', 'C:\\Windows\\win.ini', 'img\\..\\..\\secret.txt', 'a\u0000b', '%00', 'nope.html']) {
      expect(resolveInside(root, bad), bad).toBeNull();
    }
    let linked = true;
    try { fs.symlinkSync(path.join(dir, 'secret.txt'), path.join(root, 'link.txt'), 'file'); } catch { linked = false; } // Windows without developer mode
    if (linked) expect(resolveInside(root, 'link.txt')).toBeNull();
    let junction = true;
    try { fs.symlinkSync(dir, path.join(root, 'up'), 'junction'); } catch { junction = false; }
    if (junction) expect(resolveInside(root, 'up/secret.txt')).toBeNull();
  });

  it('finds the local files a page refers to, only inside its folder', () => {
    const html = '<link rel="stylesheet" href="style.css"><script src="./js/app.js"></script><img src="img/a.png"><img src="https://x.test/b.png"><a href="#top">t</a><img src="data:image/png;base64,AA"><img src="../outside.png"><a href="//cdn.test/x.js">c</a><img src="pic.png?v=2">';
    expect(localRefs(html)).toEqual(['style.css', './js/app.js', 'img/a.png', '../outside.png', 'pic.png']);
    fs.writeFileSync(path.join(dir, 'page.html'), html);
    fs.writeFileSync(path.join(dir, 'style.css'), 'body{}');
    fs.mkdirSync(path.join(dir, 'js')); fs.writeFileSync(path.join(dir, 'js', 'app.js'), '1');
    fs.mkdirSync(path.join(dir, 'img')); fs.writeFileSync(path.join(dir, 'img', 'a.png'), 'png');
    expect(snapshotFiles(path.join(dir, 'page.html')).sort()).toEqual(['img/a.png', 'js/app.js', 'page.html', 'style.css']);
  });

  it('inlines local css, scripts and pictures into one page', () => {
    fs.writeFileSync(path.join(dir, 'page.html'), '<html><head><link rel="stylesheet" href="style.css"></head><body><img src="a.png" alt="x"><script src="app.js"></script><img src="https://x.test/b.png"></body></html>');
    fs.writeFileSync(path.join(dir, 'style.css'), 'body{color:red}');
    fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dir, 'a.png'), Buffer.from([137, 80, 78, 71]));
    const out = inlineHtml(path.join(dir, 'page.html'));
    expect(out).toContain('<style>body{color:red}</style>');
    expect(out).toContain('<script>console.log(1)</script>');
    expect(out).toContain('src="data:image/png;base64,iVBORw=="');
    expect(out).toContain('https://x.test/b.png');
    expect(out).not.toContain('href="style.css"');
  });
});
