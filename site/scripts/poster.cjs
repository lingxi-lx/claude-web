// The hero's poster (the first paint, and what T2 visitors see): the built site in the repo's Electron with ?poster=1
// — the scene frozen at 20 s of the demo day at its fixed seed — captured without the page around it.
// Then the share images: the poster cut to 1200×630 with the product name.
//   npm run build --prefix site && env -u ELECTRON_RUN_AS_NODE node site/scripts/poster.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const SITE = path.resolve(__dirname, '..');
const ROOT = path.resolve(SITE, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// everything but the scene's canvases: copy, header, cards, the page's own grain / vignette / gradient,
// and the previous poster itself (once Home.astro uses it, it would otherwise get captured again)
const HIDE = `.site-header, .hero, .chapters, .stats, .install, .site-footer, .scene-overlays, .scene-sound, .scene-tip, .scene-debug, .skip, .scene-poster { visibility: hidden !important; }
body::before, body::after, .stage-scene::after { display: none !important; }
html { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }`;

async function driver() {
  const { app, BrowserWindow } = require('electron');
  const E = process.env;
  await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 900, useContentSize: true, show: false, webPreferences: { offscreen: true, contextIsolation: true } });
  win.webContents.setFrameRate(30);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  for (const [lang, page] of [['en', '/?lang=en&poster=1'], ['zh', '/zh/?poster=1']]) {
    await win.loadURL(E.POSTER_URL + page);
    const end = Date.now() + 20_000;
    while (Date.now() < end && !(await js('document.documentElement.dataset.posterReady === "1"').catch(() => false))) await sleep(150);
    if (!(await js('document.documentElement.dataset.posterReady === "1"'))) { console.error(`${lang}: the scene never drew`); app.exit(1); return; }
    await sleep(600);
    // the inserted sheet can be lost if the page settles late (seen on the first load): verify, and retry
    const hidden = 'getComputedStyle(document.querySelector(".hero")).visibility === "hidden"';
    for (let i = 0; i < 10 && !(await js(hidden)); i++) { await win.webContents.insertCSS(HIDE); await sleep(600); }
    if (!(await js(hidden))) { console.error(`${lang}: could not hide the page`); app.exit(1); return; }
    // offscreen windows only repaint on invalidation; without this capturePage can return a frame from before the hide
    win.webContents.invalidate();
    await sleep(600);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(E.POSTER_TMP, `${lang}.png`), img.resize({ width: 1440, height: 900 }).toPNG());
    console.log('captured', lang);
  }
  app.exit(0);
}

const ffEscape = (p) => p.replaceAll('\\', '/').replace(/^([A-Za-z]):/, '$1\\:');

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) { console.error('ffmpeg failed:', args.join(' ')); process.exit(1); }
}

async function launch() {
  const { serve } = require('./lib/serve.cjs');
  const dist = path.join(SITE, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('build the site first: npm run build --prefix site'); process.exit(2); }
  const font = path.join(os.tmpdir(), 'fusion-pixel-font', 'fusion-pixel-12px-proportional-latin.ttf');
  if (!fs.existsSync(font)) { console.error('run npm run fonts --prefix site once first (it unpacks the pixel font)'); process.exit(2); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-poster-'));
  const srv = await serve(dist);
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const env = { ...process.env, POSTER_URL: srv.url, POSTER_TMP: tmp, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
  delete env.ELECTRON_RUN_AS_NODE;
  const code = await new Promise((resolve) => spawn(electron, [__filename], { env, stdio: 'inherit', windowsHide: true }).on('exit', resolve));
  srv.close();
  if (code !== 0) process.exit(code ?? 1);
  fs.mkdirSync(path.join(SITE, 'public/poster'), { recursive: true });
  for (const lang of ['en', 'zh']) {
    const png = path.join(tmp, `${lang}.png`);
    const webp = path.join(SITE, 'public/poster', `${lang}.webp`);
    ffmpeg(['-i', png, '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', webp]);
    ffmpeg(['-i', png, '-vf', `scale=1200:630:force_original_aspect_ratio=increase:flags=neighbor,crop=1200:630,drawbox=x=0:y=ih-150:w=iw:h=150:color=black@0.6:t=fill,drawtext=fontfile='${ffEscape(font)}':text='Claude Web':fontsize=96:fontcolor=0xff6ad0:x=56:y=h-128`, '-frames:v', '1', path.join(SITE, 'public/og', `${lang}.png`)]);
    console.log(`poster/${lang}.webp ${(fs.statSync(webp).size / 1024).toFixed(0)} KB, og/${lang}.png`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (process.versions.electron) driver().catch((e) => { console.error(e); process.exit(2); });
else launch();
