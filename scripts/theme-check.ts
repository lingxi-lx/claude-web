// Check a built-in character theme while making it (docs/notes/ascii-themes.md):
//   npx tsx scripts/theme-check.ts web/src/themes/builtin/<id>
// The server's draft check (format, all sixteen processes, contrast, offline CSS, code that compiles), then the
// backdrop run here under Node against a stand-in canvas — both scenes, motion reduced, pointer / click / typing, every
// process — for exceptions and the script's own time per frame (drawing itself costs more in the page). Only for the
// themes in this repo: a theme the skill makes is never run outside the page's sandboxed worker.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { checkDraft } from '../server/src/themes/check.ts';
import { PROCESSES } from '../server/src/themes/core/index.ts';

const dir = process.argv[2];
if (!dir) { console.error('usage: npx tsx scripts/theme-check.ts <theme folder>'); process.exit(2); }
const read = (f: string) => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8') : undefined);
const json = JSON.parse(read('theme.json') ?? 'null');
const backdrop = read('backdrop.js');
const css = read('theme.css');
const { pack, errors } = checkDraft({ json, backdrop, css });
for (const e of errors) console.log('PROBLEM', e);
if (!pack || !backdrop) process.exit(1);

// a 2D / WebGL context that accepts anything
const anything: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'measureText' ? (s: string) => ({ width: String(s).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
    : k === 'getImageData' || k === 'createImageData' ? (_x: number, _y: number, w = 1, h = 1) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
      : k === 'canvas' ? fakeCanvas(1, 1)
        : k === Symbol.toPrimitive ? () => 0
          : anything),
  set: () => true,
  apply: () => anything,
  construct: () => anything,
});
function fakeCanvas(width: number, height: number): any {
  return { width, height, getContext: () => anything, transferToImageBitmap: () => anything, convertToBlob: async () => null };
}
(globalThis as any).OffscreenCanvas = function (w: number, h: number) { return fakeCanvas(w, h); };

const load = () => new Function(`"use strict";\n${backdrop.replace(/(^|[^\w$.])export\s+default\s+/, '$1return ')}`)();
const colors = pack.colors;
let worst = 0;
const run = (scene: 'welcome' | 'chat', reduce: boolean) => {
  const m = load();
  const W = 1360, H = 860, dpr = 2;
  const quiet = [{ x: 400, y: 300, w: 560, h: 260 }];
  m.init?.({ canvas: fakeCanvas(W, H), width: W, height: H, dpr, colors, scene, reduce });
  const times: number[] = [];
  const frames = reduce ? 1 : 240;
  for (let i = 0; i < frames; i++) {
    const proc = i < 20 ? 'idle' : PROCESSES[Math.floor(i / 14) % PROCESSES.length];
    if (i === 30) m.event?.({ type: 'click', x: 500, y: 300 });
    if (i === 40) m.event?.({ type: 'type', text: '你好 hello' });
    if (i === 120) m.resize?.({ width: 900, height: 600, dpr: 1 });
    if (i === 140) m.theme?.({ colors });
    const a = performance.now();
    m.frame({ t: i / 30, dt: 1 / 30, mouse: i % 50 < 25 ? { x: (i * 7) % W, y: 300, down: false } : null, process: proc, scene, speed: scene === 'chat' ? pack.chatDim.speed : 1, quiet });
    times.push(performance.now() - a);
  }
  const avg = times.reduce((x, y) => x + y, 0) / times.length;
  const max = Math.max(...times);
  worst = Math.max(worst, avg);
  console.log(`RUN ${scene}${reduce ? ' (reduced)' : ''}: ${frames} frames, avg ${avg.toFixed(2)} ms, max ${max.toFixed(2)} ms`);
};
try {
  run('welcome', false);
  run('chat', false);
  run('welcome', true);
} catch (e: any) {
  console.log('PROBLEM backdrop threw:', e?.stack ?? e);
  process.exit(1);
}
if (worst > 8) console.log(`PROBLEM the script alone takes ${worst.toFixed(1)} ms a frame: aim for under 4 (drawing comes on top)`);
console.log(errors.length ? `${errors.length} problem(s)` : 'OK');
process.exit(errors.length || worst > 8 ? 1 : 0);
