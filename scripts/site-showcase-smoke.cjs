// The theme showcase in a real browser (spec §9): serves the built site (site/dist, with its recordings in themes/),
// opens the home page in Electron and switches through every clip, asserting each new recording starts within 0.1 s
// of the second the previous one was on, that keys and compare work, that ?theme= picks (or falls back), and that the
// console stays free of errors.
//   cd site && SITE_MEDIA_DIR=.media-local npm run build && cd ..     (stand-ins; or a normal build with real media)
//   env -u ELECTRON_RUN_AS_NODE node scripts/site-showcase-smoke.cjs
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.webm': 'video/webm', '.mp4': 'video/mp4', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

// a static server with byte ranges (a <video> seeks with them)
function serve(dist) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(dist, p);
      if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404).end(); return; }
      const size = fs.statSync(f).size;
      const type = MIME[path.extname(f)] ?? 'application/octet-stream';
      const m = /bytes=(\d*)-(\d*)/.exec(q.headers.range ?? '');
      if (m) {
        const a = m[1] ? Number(m[1]) : size - Number(m[2]);
        const b = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        r.writeHead(206, { 'content-type': type, 'content-range': `bytes ${a}-${b}/${size}`, 'accept-ranges': 'bytes', 'content-length': b - a + 1 });
        fs.createReadStream(f, { start: a, end: b }).pipe(r);
        return;
      }
      r.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
      fs.createReadStream(f).pipe(r);
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

async function driver() {
  const { app, BrowserWindow } = require('electron');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  await app.whenReady();
  const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const wc = win.webContents;
  const errors = [];
  wc.on('console-message', (a, b, c) => {
    const level = typeof a === 'object' && a && 'level' in a ? a.level : b;
    const message = typeof a === 'object' && a && 'message' in a ? a.message : c;
    if (level === 'error' || Number(level) >= 3) errors.push(String(message).slice(0, 400));
  });
  const js = (code) => wc.executeJavaScript(code, true);
  const waitFor = async (code, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await js(code)) return true; } catch { /* navigating */ } await sleep(100); } return false; };
  const current = () => js("document.querySelector('#themes').dataset.scCurrent");
  const press = (keyCode) => { wc.sendInputEvent({ type: 'keyDown', keyCode }); if (/^[0-9]$/.test(keyCode)) wc.sendInputEvent({ type: 'char', keyCode }); wc.sendInputEvent({ type: 'keyUp', keyCode }); };
  const open = async (q) => {
    await win.loadURL(process.env.SMOKE_URL + q);
    if (!(await waitFor("document.querySelector('#themes')?.dataset.mounted === '1'"))) throw new Error(`the showcase did not mount on ${q}`);
  };
  const listen = () => js("window.__sw = []; document.querySelector('#themes').addEventListener('showcase:switched', (e) => window.__sw.push(e.detail)); true");
  const checkSwitch = async (n, to) => {
    if (!(await waitFor(`window.__sw.length > ${n}`, 10000))) throw new Error(`no switch to ${to}`);
    const d = await js(`window.__sw[${n}]`);
    const want = d.to === 'describe' || d.from === 'describe' ? 0 : d.prevTime;
    console.log(`${d.from} -> ${d.to}: ${d.prevTime.toFixed(3)} -> ${d.newTime.toFixed(3)}`);
    if (d.to !== to) throw new Error(`switched to ${d.to}, wanted ${to}`);
    if (Math.abs(d.newTime - want) > 0.1) throw new Error(`${to} started ${Math.abs(d.newTime - want).toFixed(3)} s away from ${want.toFixed(3)}`);
  };

  try {
    await open('/?lang=en&theme=phosphor#themes');
    if (!(await waitFor("(() => { const v = document.querySelector('#themes .sc-stage video'); return !!v && v.currentTime > 1.5; })()", 20000))) throw new Error('the first recording does not play');
    await listen();
    const ids = await js("[...document.querySelectorAll('#themes .sc-pick')].map((b) => b.dataset.id)");
    if (ids.length !== 11) throw new Error(`${ids.length} theme buttons`);
    for (let i = 1; i < ids.length; i++) {
      const n = await js('window.__sw.length');
      await js(`document.querySelector('#themes .sc-pick[data-id="${ids[i]}"]').click()`);
      await checkSwitch(n, ids[i]);
      if ((await current()) !== ids[i]) throw new Error(`data-sc-current is not ${ids[i]}`);
      await sleep(900);
    }
    // keys, with the section focused: describe → (wrap) phosphor → abyss, then 3 = koi
    await js("document.querySelector('#themes').focus(); true");
    for (const [key, want] of [['Right', 'phosphor'], ['Right', 'abyss'], ['3', 'koi']]) {
      const n = await js('window.__sw.length');
      press(key);
      await checkSwitch(n, want);
      await sleep(900);
    }
    // compare: abyss (the one before) on the left, koi on the right, in step
    await js("document.querySelector('#themes .sc-compare').click(); true");
    await sleep(2000);
    const pair = await js("[...document.querySelectorAll('#themes .sc-stage video')].map((v) => ({ id: v.dataset.id, t: v.currentTime, back: v.classList.contains('sc-back') }))");
    const left = pair.find((p) => p.back);
    if (pair.length !== 2 || !left || left.id !== 'abyss') throw new Error(`compare shows ${JSON.stringify(pair)}`);
    if (Math.abs(pair[0].t - pair[1].t) > 0.1) throw new Error(`compare halves ${Math.abs(pair[0].t - pair[1].t).toFixed(3)} s apart`);
    // deep links
    await open('/?lang=en&theme=nope#themes');
    if ((await current()) !== 'phosphor') throw new Error('?theme=nope did not fall back to phosphor');
    await open('/zh/?theme=ink#themes');
    if ((await current()) !== 'ink') throw new Error('?theme=ink was not picked on /zh/');
    await sleep(1500);
    if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`);
    console.log('showcase smoke: ok');
    app.exit(0);
  } catch (e) {
    console.error(`FAIL ${e.message}`);
    app.exit(1);
  }
}

async function runner() {
  const dist = path.join(ROOT, 'site', 'dist');
  for (const f of ['index.html', 'zh/index.html', 'themes/phosphor.en.webp', 'themes/phosphor.en.webm', 'themes/ink.zh.mp4']) {
    if (!fs.existsSync(path.join(dist, f))) { console.error(`missing site/dist/${f}: build the site with its media first (cd site && SITE_MEDIA_DIR=.media-local npm run build)`); process.exit(2); }
  }
  const server = await serve(dist);
  const env = { ...process.env, SMOKE_URL: `http://127.0.0.1:${server.address().port}` };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const code = await new Promise((res) => {
    const p = spawn(electron, [__filename], { env, stdio: 'inherit', windowsHide: true });
    const t = setTimeout(() => { p.kill(); res(-1); }, 180_000);
    p.on('exit', (c) => { clearTimeout(t); res(c); });
  });
  server.close();
  process.exit(code === 0 ? 0 : 1);
}

if (process.versions.electron) driver();
else runner().catch((e) => { console.error(e); process.exit(2); });
