// Cuts Fusion Pixel Font (OFL, github.com/TakWolf/fusion-pixel-font) down to the titles' characters:
// site/public/fonts/pixel-{en,zh}.woff2, its OFL.txt, and src/fonts.generated.json (what each subset holds).
//   npm run fonts --prefix site      (runs through tsx: copy.ts needs the tsconfig paths)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';
import { displayText } from '../src/fonts.ts';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = '2026.10.16';
const ZIP = `fusion-pixel-font-12px-proportional-ttf-v${RELEASE}.zip`;
const URL_ = `https://github.com/TakWolf/fusion-pixel-font/releases/download/${RELEASE}/${ZIP}`;
const SRC = { en: 'fusion-pixel-12px-proportional-latin.ttf', zh: 'fusion-pixel-12px-proportional-zh_hans.ttf' } as const;

const cache = path.join(os.tmpdir(), 'fusion-pixel-font');
fs.mkdirSync(cache, { recursive: true });
const zip = path.join(cache, ZIP);
if (!fs.existsSync(zip)) {
  console.log(`downloading ${URL_}`);
  const r = await fetch(URL_);
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
}
const want = ['OFL.txt', SRC.en, SRC.zh];
if (!want.every((f) => fs.existsSync(path.join(cache, f)))) {
  // Windows 10+ and macOS ship bsdtar, which reads zip; Git Bash has unzip
  let x = spawnSync('tar', ['-xf', zip, '-C', cache, ...want], { stdio: 'inherit', windowsHide: true });
  if (x.status !== 0) x = spawnSync('unzip', ['-o', zip, ...want, '-d', cache], { stdio: 'inherit', windowsHide: true });
  if (x.status !== 0) throw new Error('could not unpack the font zip (needs tar or unzip)');
}

const out = path.join(SITE, 'public/fonts');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(cache, 'OFL.txt'), path.join(out, 'OFL.txt'));
const held: Record<string, string> = {};
for (const locale of ['en', 'zh'] as const) {
  const text = displayText(locale);
  const buf = await subsetFont(fs.readFileSync(path.join(cache, SRC[locale])), text, { targetFormat: 'woff2' });
  fs.writeFileSync(path.join(out, `pixel-${locale}.woff2`), buf);
  held[locale] = text;
  console.log(`pixel-${locale}.woff2: ${text.length} characters, ${(buf.length / 1024).toFixed(1)} KB`);
}
fs.writeFileSync(path.join(SITE, 'src/fonts.generated.json'), `${JSON.stringify(held, null, 2)}\n`);
