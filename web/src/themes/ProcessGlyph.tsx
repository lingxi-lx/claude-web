import { useLayoutEffect, useMemo, useRef } from 'react';
import { clsx } from '@/util';
import { useActivePack } from './apply';
import { animFor } from '@themes';
import type { Process, ThemePack } from '@themes';
import { frameHtml } from './render';
import { play } from './ticker';

const reduced = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.dataset.reduceMotion === '1';

/**
 * What a process looks like while it runs (spec 2026-10-22 §2–3), drawn from the active character theme's frames
 * (the default ones under a classic theme). `inline`: the 16px slot at the start of a step row; `stage`: up to two
 * rows of fourteen cells, the status tab over the composer. `done` / `fail` play their ending once, then `onEnd`
 * hands the slot back (the step's own icon). Motion reduced: the first frame, still; an ending ends at once.
 */
export function ProcessGlyph({ process, size = 'inline', phase = 'loop', onEnd, className, pack: given }: { process: Process; size?: 'inline' | 'stage'; phase?: 'loop' | 'done' | 'fail'; onEnd?: () => void; className?: string; /** another theme's frames (设置 → 外观's cards) instead of the one in use */ pack?: ThemePack | null }) {
  const active = useActivePack();
  const pack = given === undefined ? active : given;
  const ref = useRef<HTMLSpanElement>(null);
  const end = useRef(onEnd);
  end.current = onEnd;
  const clip = useMemo(() => {
    const a = animFor(pack, process);
    if (size === 'inline') {
      const il = a.inline!;
      const seq = phase === 'loop' ? il.loop : il[phase];
      return { frames: (seq ?? []).map((x) => frameHtml([x], a.color)), fps: il.fps ?? a.fps };
    }
    const seq = phase === 'loop' ? a.loop : a[phase];
    return { frames: (seq ?? []).map((f) => frameHtml(f, a.color)), fps: a.fps };
  }, [pack, process, size, phase]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const once = phase !== 'loop';
    if (!clip.frames.length || (once && reduced())) {
      el.innerHTML = clip.frames[clip.frames.length - 1] ?? '';
      if (once) end.current?.();
      return;
    }
    if (reduced()) { el.innerHTML = clip.frames[0]; return; }
    return play({ el, frames: clip.frames, fps: clip.fps, once, onEnd: () => end.current?.() });
  }, [clip, phase]);

  return <span ref={ref} className={clsx('pg', size, className)} data-process={process} aria-hidden />;
}
