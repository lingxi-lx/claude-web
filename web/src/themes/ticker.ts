// One clock for every process animation on the page: a glyph registers its element and its frames (as HTML), and the
// clock writes the element only when that glyph's frame number changes. No React render per frame.

export interface Run {
  el: HTMLElement;
  frames: string[];
  fps: number;
  /** play once, then hold the last frame and call onEnd (a `done` / `fail` ending) */
  once: boolean;
  onEnd?: () => void;
  t0: number;
  shown: number;
  ended?: boolean;
}

const runs = new Set<Run>();
let timer: ReturnType<typeof setInterval> | null = null;
/** how long the last frame of an ending stays before the glyph hands over */
const HOLD_MS = 260;

function tick() {
  const now = performance.now();
  for (const r of runs) {
    const n = Math.floor(((now - r.t0) * r.fps) / 1000);
    let i: number;
    if (r.once) {
      i = Math.min(n, r.frames.length - 1);
      if (!r.ended && now - r.t0 >= (r.frames.length * 1000) / r.fps + HOLD_MS) { r.ended = true; r.onEnd?.(); }
    } else i = n % r.frames.length;
    if (i !== r.shown) { r.shown = i; r.el.innerHTML = r.frames[i]; }
  }
}

export function play(r: Omit<Run, 't0' | 'shown'>): () => void {
  const run: Run = { ...r, t0: performance.now(), shown: 0 };
  run.el.innerHTML = run.frames[0] ?? '';
  runs.add(run);
  if (!timer) timer = setInterval(tick, 1000 / 30);
  return () => {
    runs.delete(run);
    if (!runs.size && timer) { clearInterval(timer); timer = null; }
  };
}
