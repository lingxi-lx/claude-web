// ffmpeg for the site's theme recordings (scripts/record-themes.cjs, scripts/make-standin-clips.cjs): from one master
// video, per clip and language, the five files the showcase plays (spec §5.2) —
//   <id>.<lang>.webm / .mp4 (1280×800) and <id>.<lang>-sm.webm / -sm.mp4 (720×450), <id>.<lang>.webp (the poster, 7 s in).
// webm is AV1 when this ffmpeg has an AV1 encoder (libsvtav1, else libaom-av1), else VP9; mp4 is H.264 for Safari.
// Keyframes every 15 frames so scrubbing and switching (a seek to the same second) are quick.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'] });

let picked = null;
function webmEncoder() {
  if (picked) return picked;
  const list = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { windowsHide: true, encoding: 'utf8' });
  for (const need of ['libx264', 'libwebp']) if (!new RegExp(`\\b${need}\\b`).test(list)) throw new Error(`this ffmpeg has no ${need}`);
  // libaom-av1 is skipped on purpose: ~1.5–2 h for the 22 clips on this machine; VP9 plays everywhere the site targets.
  picked = /\blibsvtav1\b/.test(list) ? 'libsvtav1' : 'libvpx-vp9';
  return picked;
}

const WEBM = {
  libsvtav1: ['-c:v', 'libsvtav1', '-preset', '6', '-crf', '38', '-g', '15'],
  'libaom-av1': ['-c:v', 'libaom-av1', '-cpu-used', '5', '-row-mt', '1', '-crf', '36', '-b:v', '0', '-g', '15', '-keyint_min', '15'],
  'libvpx-vp9': ['-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-crf', '38', '-b:v', '0', '-g', '15'],
};
const WEBM_FAST = ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '40', '-b:v', '0', '-g', '15'];
const MP4 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-g', '15', '-movflags', '+faststart'];
const MP4_FAST = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-g', '15', '-movflags', '+faststart'];
const SIZES = [['', '1280:800'], ['-sm', '720:450']];

/** opts.fast: VP9 realtime / x264 ultrafast (stand-ins); the real recordings use the defaults */
function encodeClip(master, outDir, id, lang, opts = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const webmArgs = opts.fast ? WEBM_FAST : WEBM[webmEncoder()];
  const mp4Args = opts.fast ? MP4_FAST : MP4;
  const files = [];
  for (const [suffix, size] of SIZES) {
    const vf = `scale=${size}:flags=lanczos,format=yuv420p`;
    const webm = path.join(outDir, `${id}.${lang}${suffix}.webm`);
    ff(['-i', master, '-an', '-vf', vf, ...webmArgs, webm]);
    const mp4 = path.join(outDir, `${id}.${lang}${suffix}.mp4`);
    ff(['-i', master, '-an', '-vf', vf, ...mp4Args, mp4]);
    files.push(webm, mp4);
  }
  const poster = path.join(outDir, `${id}.${lang}.webp`);
  ff(['-ss', '7', '-i', master, '-frames:v', '1', '-vf', 'scale=1280:800:flags=lanczos', '-c:v', 'libwebp', '-quality', '72', poster]);
  files.push(poster);
  return files;
}

const LARGE_LIMIT = 1.5 * 1024 * 1024;
const POSTER_LIMIT = 80 * 1024;
function report(files) {
  for (const f of files) {
    const n = fs.statSync(f).size;
    const name = path.basename(f);
    const big = /\.(webm|mp4)$/.test(name) && !name.includes('-sm.') && n > LARGE_LIMIT;
    const fat = name.endsWith('.webp') && n > POSTER_LIMIT;
    console.log(`${name.padEnd(28)} ${(n / 1024).toFixed(0).padStart(6)} KB${big ? '  WARNING: over 1.5 MB' : ''}${fat ? '  WARNING: poster over 80 KB' : ''}`);
  }
}

/** the codecs string for <video>'s canPlayType: AV1 main 8-bit level 4.0 (1280×800 at 30 fps), or VP9 */
function webmCodecs(file) {
  const c = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], { windowsHide: true, encoding: 'utf8' }).trim();
  if (c === 'av1') return 'av01.0.08M.08';
  if (c === 'vp9') return 'vp9';
  throw new Error(`${file}: unexpected webm codec ${c}`);
}

module.exports = { ff, webmEncoder, encodeClip, report, webmCodecs };
