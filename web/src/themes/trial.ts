// The theme skill's trial runs (spec 2026-10-22 §5): the server hands a draft to this window (`themes.trial`); it runs
// the draft's backdrop in the same sandboxed worker a theme runs in — CSP without network, the watchdog's limits —
// on an OffscreenCanvas for 3 seconds, draws the result and the sixteen process animations on one picture, and
// answers with the PNG, the errors and the frame times (`themes.trialResult`).
// And the user's saved themes: loaded at start, again on `themes.changed`, handed to the registry.
import type { ServerEvent } from '@shared';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { PROCESSES, animFor, parsePack, type ThemePack } from '@themes';
import { setUserThemes, type UserThemeSource } from './registry';
import { backdropWorker, sandboxReady } from './worker-url';
import { applyUiSettings } from '@/features/settings/ui-settings';

const W = 960, H = 540, RUN_MS = 3000;

/** the welcome column, scaled into the trial canvas: the backdrop sees it as `quiet` */
const QUIET = [{ x: W * 0.25, y: H * 0.36, w: W * 0.5, h: H * 0.28 }];

interface Run { png?: string; errors: string[]; avgMs?: number; maxMs?: number; note?: string }

function runBackdrop(pack: ThemePack, canvas: OffscreenCanvas, colors: Record<string, string>): Promise<{ errors: string[]; avgMs?: number; maxMs?: number; bitmap?: ImageBitmap }> {
  return new Promise((resolve) => {
    const w = backdropWorker();
    const errors: string[] = [];
    const avgs: number[] = [];
    let done = false;
    let bitmap: ImageBitmap | undefined;
    const finish = (extra?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(late);
      w.terminate();
      if (extra) errors.push(extra);
      const real = avgs.filter((a) => a > 0);
      resolve({ errors, bitmap, ...(real.length ? { avgMs: real.reduce((a, b) => a + b, 0) / real.length, maxMs: Math.max(...real) } : {}) });
    };
    w.onmessage = (e: MessageEvent<{ type: string; avgMs?: number; message?: string; bitmap?: ImageBitmap | null }>) => {
      if (e.data.type === 'stats' && typeof e.data.avgMs === 'number') avgs.push(e.data.avgMs);
      if (e.data.type === 'error') { errors.push(String(e.data.message).slice(0, 800)); finish(); }
      if (e.data.type === 'snapshot') { bitmap = e.data.bitmap ?? undefined; finish(); }
    };
    w.onerror = (e) => { errors.push(e.message || 'worker error'); finish(); };
    // after the run: a picture of it; a worker stuck in its own loop never answers, and is taken down a second later
    const timer = setTimeout(() => w.postMessage({ type: 'snapshot' }), RUN_MS);
    const late = setTimeout(() => finish('the backdrop did not answer (stuck in a loop?)'), RUN_MS + 1500);
    void sandboxReady(w).then((sandboxed) => {
      if (!done) w.postMessage({ type: 'init', canvas, source: pack.backdrop ?? '', width: W, height: H, dpr: 1, colors, scene: 'welcome', speed: 1, reduce: false, trusted: false, sandboxed }, [canvas]);
    });
    w.postMessage({ type: 'quiet', rects: QUIET });
    // a little life: the pointer passes, a click, some typing, and Claude thinking
    w.postMessage({ type: 'pointer', x: W * 0.7, y: H * 0.3 });
    setTimeout(() => !done && w.postMessage({ type: 'process', process: 'think' }), 800);
    setTimeout(() => !done && w.postMessage({ type: 'pointer', x: W * 0.3, y: H * 0.7, click: true }), 1200);
    setTimeout(() => !done && w.postMessage({ type: 'type', text: 'hello ascii' }), 1600);
    setTimeout(() => !done && w.postMessage({ type: 'data', data: { projects: [{ name: 'web', count: 30, size: 1, recent: true, live: true }, { name: 'api', count: 8, size: 0.6, recent: false, live: false }, { name: 'docs', count: 2, size: 0.3, recent: true, live: false }] } }), 200);
  });
}

/** The picture: the backdrop on top, a grid of the sixteen processes (frame 0, the middle frame, the ending) below. */
async function picture(pack: ThemePack, back: ImageBitmap | undefined, colors: Record<string, string>): Promise<string> {
  const GRID_H = 300;
  const c = new OffscreenCanvas(W, H + GRID_H);
  const g = c.getContext('2d')!;
  g.fillStyle = colors.bg || '#000';
  g.fillRect(0, 0, W, H + GRID_H);
  if (back) g.drawImage(back, 0, 0, W, H);
  // the welcome column the backdrop should keep quiet
  g.strokeStyle = colors['fg-3'] || '#888';
  g.setLineDash([4, 4]);
  for (const q of QUIET) g.strokeRect(q.x, q.y, q.w, q.h);
  g.setLineDash([]);
  g.fillStyle = colors['bg-1'] || '#111';
  g.fillRect(0, H, W, GRID_H);
  g.font = '11px ui-monospace, Consolas, monospace';
  g.textBaseline = 'top';
  const cols = 4, cw = W / cols, ch = GRID_H / 4;
  PROCESSES.forEach((p, i) => {
    const a = animFor(pack, p);
    const x = (i % cols) * cw + 10, y = H + Math.floor(i / cols) * ch + 8;
    g.fillStyle = pack.broken[p] ? (colors.red || '#f55') : (colors['fg-2'] || '#aaa');
    g.fillText(p + (pack.broken[p] ? ' ✗' : pack.processes[p] ? '' : ' (default)'), x, y);
    const frames = [a.loop[0], a.loop[Math.floor(a.loop.length / 2)], (a.done ?? a.loop)[(a.done ?? a.loop).length - 1]];
    frames.forEach((f, k) => f.forEach((row, r) => {
      let cx = x + k * 78;
      for (const chr of row) {
        g.fillStyle = a.color?.[chr] ? (colors[a.color[chr]] || colors.accent) : (colors['accent-text'] || '#fff');
        g.fillText(chr, cx, y + 16 + r * 12);
        cx += g.measureText(chr).width;
      }
    }));
  });
  const blob = await c.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function trial(source: UserThemeSource): Promise<Run> {
  let json: unknown;
  try { json = JSON.parse(source.json); } catch { return { errors: ['theme.json is not JSON'] }; }
  const { pack } = parsePack(json, { backdrop: source.backdrop, css: source.css });
  if (!pack) return { errors: ['theme.json did not parse into a theme'] };
  if (typeof OffscreenCanvas !== 'function') return { errors: [], note: 'This window cannot run a trial (no OffscreenCanvas).' };
  const colors = { ...pack.colors };
  // the worker gets this canvas and draws into it; it sends a copy back at the end (`snapshot`)
  const { bitmap, ...run } = await runBackdrop(pack, new OffscreenCanvas(W, H), colors);
  let png: string | undefined;
  try { png = await picture(pack, bitmap, colors); } catch (e) { run.errors.push(`picture: ${(e as Error).message}`); }
  bitmap?.close();
  return { ...run, png };
}

export function installThemes(): () => void {
  const load = () => {
    void ws.request({ kind: 'themes.list' }).then((l: unknown) => {
      setUserThemes(Array.isArray(l) ? (l as UserThemeSource[]) : []);
      // a user theme in use is put on again (its CSS may have changed)
      applyUiSettings(useStore.getState().settings);
    }).catch(() => {});
  };
  const announce = () => { if (useStore.getState().connected) void ws.request({ kind: 'themes.trialHost', on: true }).catch(() => {}); };
  const off = ws.on((e: ServerEvent) => {
    if (e.kind === 'themes.changed') load();
    if (e.kind === 'themes.trial') {
      const { id, source } = e;
      void trial(source).catch((err) => ({ errors: [String(err?.message ?? err)] } as Run)).then((r) => ws.request({ kind: 'themes.trialResult', id, ...r }).catch(() => {}));
    }
  });
  const offStore = useStore.subscribe((s, p) => { if (s.connected && !p.connected) { load(); announce(); } });
  window.addEventListener('focus', announce);
  load();
  announce();
  return () => { off(); offStore(); window.removeEventListener('focus', announce); };
}
