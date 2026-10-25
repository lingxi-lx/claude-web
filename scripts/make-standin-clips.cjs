// Stand-in recordings for building and testing the site's theme showcase before the real ones exist
// (scripts/record-themes.cjs): per clip and language a test pattern on the theme's background, labelled with the clip,
// the language and the running time, encoded like the real ones (fast settings) under the real file names.
//   node scripts/make-standin-clips.cjs [--out site/.media-local]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const media = require('./lib/media-encode.cjs');

const ROOT = path.resolve(__dirname, '..');
const THEMES = ['phosphor', 'abyss', 'koi', 'moon', 'dither', 'orb', 'garden', 'paper', 'letters', 'ink'];
const CLIPS = [...THEMES.map((id) => ({ id, theme: id, seconds: 12 })), { id: 'describe', theme: 'metro', seconds: 15 }];
const i = process.argv.indexOf('--out');
const out = path.resolve(i > 0 ? process.argv[i + 1] : path.join(ROOT, 'site', '.media-local'));

const colorsOf = (theme) => JSON.parse(fs.readFileSync(theme === 'metro'
  ? path.join(ROOT, 'scripts', 'lib', 'fixtures', 'theme-metro', 'theme.json')
  : path.join(ROOT, 'web', 'src', 'themes', 'builtin', theme, 'theme.json'), 'utf8')).colors;
const hex = (h) => `0x${h.slice(1, 7)}`;
// drawtext without fontconfig on Windows: name the font file (":" escaped for the filter graph)
const font = process.platform === 'win32' ? "fontfile='C\\:/Windows/Fonts/arial.ttf':" : '';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-standin-'));
try {
  for (const clip of CLIPS) for (const lang of ['en', 'zh']) {
    const c = colorsOf(clip.theme);
    const master = path.join(tmp, `${clip.id}.${lang}.mp4`);
    const graph = `[0][1]overlay=x=(W-w)/2:y=(H-h)/2+120,drawbox=x=0:y=0:w=iw:h=72:color=${hex(c['bg-2'])}:t=fill,`
      + `drawtext=${font}text='${clip.id} ${lang}':fontsize=96:fontcolor=${hex(c.accent)}:x=(w-tw)/2:y=220,`
      + `drawtext=${font}text='%{pts\\:hms}':fontsize=72:fontcolor=${hex(c.fg)}:x=(w-tw)/2:y=360`;
    media.ff(['-f', 'lavfi', '-i', `color=c=${hex(c.bg)}:s=2560x1600:r=30:d=${clip.seconds}`, '-f', 'lavfi', '-i', `testsrc2=s=960x600:r=30:d=${clip.seconds}`,
      '-filter_complex', graph, '-t', String(clip.seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', master]);
    media.report(media.encodeClip(master, out, clip.id, lang, { fast: true }));
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`stand-ins in ${out}`);
