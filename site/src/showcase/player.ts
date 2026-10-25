// The theme showcase in the browser (spec §5.1), imported when the section comes within a screen of the viewport.
// Everything it needs is in #sc-data (Showcase.astro); the recordings are in <base>themes/ (site/scripts/fetch-media.ts).
// The interactions, and only these: switch (a button, ← →, 1–9 / 0) at the same second with a circle reveal; drag the
// picture or the timeline to scrub; markers jump; compare (previous theme left, current right, in step); a click,
// space, K or the Pause toggle pauses; ?theme=<id>#themes. A webm that fails is tried once as mp4; a recording that
// fails leaves its poster; a poster that fails, a placeholder.
import { play as playGlyph } from '@web-themes/ticker';
import { posterFile, videoFile } from './clips';
import type { ShowcaseData } from './data';
import { DRAG_SLOP, revealRadius, showcaseKey, timeAfterDrag, timeOnTimeline } from './input';
import { clipFromSearch, searchWithClip } from './params';

const REVEAL_MS = 400;
/** compare: how far the two halves may drift before the left one is put back in step */
const DRIFT = 0.08;

export interface SwitchedDetail { from: string; to: string; prevTime: number; newTime: number }

const once = (el: EventTarget, type: string, fn: () => void) => el.addEventListener(type, fn, { once: true });

export function mountShowcase(root: HTMLElement): void {
  // checked just below; typed non-null so the function declarations further down (hoisted, so not narrowed) compile
  const dataEl = root.querySelector<HTMLScriptElement>('#sc-data');
  const stage = root.querySelector<HTMLElement>('.sc-stage') as HTMLElement;
  const split = root.querySelector<HTMLElement>('.sc-split') as HTMLElement;
  const title = root.querySelector<HTMLElement>('.sc-title') as HTMLElement;
  const timeline = root.querySelector<HTMLElement>('.sc-timeline') as HTMLElement;
  const markers = root.querySelector<HTMLElement>('.sc-markers') as HTMLElement;
  const note = root.querySelector<HTMLElement>('.sc-note') as HTMLElement;
  const compareBtn = root.querySelector<HTMLButtonElement>('.sc-compare') as HTMLButtonElement;
  const playBtn = root.querySelector<HTMLButtonElement>('.sc-play') as HTMLButtonElement;
  const pauseBtn = root.querySelector<HTMLButtonElement>('.sc-pause') as HTMLButtonElement;
  if (root.dataset.mounted || !dataEl || !stage || !split || !title || !timeline || !markers || !note || !compareBtn || !playBtn || !pauseBtn) return;
  root.dataset.mounted = '1';
  const D = JSON.parse(dataEl.textContent ?? '{}') as ShowcaseData;
  const clips = D.clips;
  const picks = [...root.querySelectorAll<HTMLButtonElement>('.sc-pick')];
  const themeCount = clips.filter((c) => !c.describe).length;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const saveData = !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  const ext = document.createElement('video').canPlayType(`video/webm; codecs="${D.webmCodecs}"`) === 'probably' ? 'webm' : 'mp4';
  const srcOf = (id: string, e: 'webm' | 'mp4' = ext) => D.base + videoFile(id, D.locale, e, small);
  const posterOf = (id: string) => D.base + posterFile(id, D.locale);

  let index = Math.max(0, clips.findIndex((c) => c.id === clipFromSearch(location.search)));
  /** compare's left half: the theme shown before this one (never "describe") */
  let prevIndex = index === 0 || index >= themeCount ? themeCount - 1 : index - 1;
  let playing = !reduced;
  let compare = false;
  let visible = false;
  let front: HTMLVideoElement | null = null;
  let back: HTMLVideoElement | null = null;
  let gen = 0;
  let raf = 0;
  const cur = () => clips[index];

  const poster = document.createElement('img');
  poster.className = 'sc-poster';
  poster.alt = '';
  poster.decoding = 'async';
  poster.addEventListener('load', () => stage.removeAttribute('data-missing'));
  poster.addEventListener('error', () => stage.setAttribute('data-missing', ''));
  stage.prepend(poster);

  const videos = new Map<string, HTMLVideoElement>();
  const failed = new Set<string>();
  const park = (v: HTMLVideoElement | null) => { if (!v) return; v.pause(); v.remove(); v.style.clipPath = ''; v.classList.remove('sc-back'); };
  const put = (v: HTMLVideoElement, before: Element) => { if (v.parentElement === stage && v.nextSibling === before) return; stage.insertBefore(v, before); };
  const run = (v: HTMLVideoElement | null) => { if (v && playing && visible) void v.play().catch(() => {}); };

  /** The recording of a clip: 'metadata' for a hover (it only warms up), 'auto' once it is chosen. */
  function videoFor(id: string, preload: 'auto' | 'metadata' = 'auto'): HTMLVideoElement | null {
    if (failed.has(id)) return null;
    const known = videos.get(id);
    if (known) { if (preload === 'auto') known.preload = 'auto'; return known; }
    const v = document.createElement('video');
    v.className = 'sc-video';
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = preload;
    v.setAttribute('aria-hidden', 'true');
    v.dataset.id = id;
    let retried = ext === 'mp4';
    v.addEventListener('error', () => {
      if (!retried) {
        // a webm the browser said it could play but then could not: the same clip as mp4, once, from the same second
        retried = true;
        const at = v.currentTime;
        if (at > 0) once(v, 'loadedmetadata', () => { v.currentTime = at; });
        once(v, 'loadeddata', () => { if (v === front || v === back) run(v); });
        v.src = srcOf(id, 'mp4');
        return;
      }
      failed.add(id);
      videos.delete(id);
      if (front === v) front = null;
      if (back === v) back = null;
      park(v); // its poster stays
    });
    v.src = srcOf(id);
    videos.set(id, v);
    return v;
  }

  function applyClip(): void {
    const c = cur();
    root.dataset.scCurrent = c.id;
    title.textContent = `Claude Web — ${c.title}`;
    picks.forEach((p, i) => p.setAttribute('aria-pressed', String(i === index)));
    note.hidden = !c.describe;
    compareBtn.hidden = small || c.describe;
    timeline.style.setProperty('--sc-p', '0');
    markers.replaceChildren(...c.markers.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sc-marker';
      b.textContent = m.label;
      b.style.left = `${(m.at / c.duration) * 100}%`;
      b.addEventListener('click', () => seek(m.at + 0.01));
      return b;
    }));
    poster.src = posterOf(c.id);
  }

  function start(): void {
    const v = videoFor(cur().id);
    if (!v) return;
    front = v;
    const show = () => { if (front !== v) return; put(v, split); run(v); syncCompare(); };
    if (v.readyState >= 2) show(); else once(v, 'loadeddata', show);
  }

  function switchTo(i: number, from: { x: number; y: number }): void {
    if (i === index || i < 0 || i >= clips.length) return;
    const a = cur();
    const b = clips[i];
    const old = front;
    // both halves halt while the new one seeks, so it starts on exactly the second the old one is on
    if (old) old.pause();
    const t = old && !a.describe && !b.describe ? old.currentTime : 0;
    if (!a.describe) prevIndex = index;
    index = i;
    const my = ++gen;
    applyClip();
    history.replaceState(history.state, '', `${searchWithClip(location.search, b.id)}#themes`);
    const v = old || playing ? videoFor(b.id) : null; // reduced motion and never played: posters only
    if (!v) { park(old); front = null; syncCompare(); return; }
    // the new recording never loads (missing, broken): the old one goes too, so the new theme's poster shows
    const failedNew = () => {
      if (my !== gen) return;
      if (!failed.has(b.id)) { once(v, 'error', failedNew); return; } // retrying as mp4: wait for that one
      if (old && old !== v) park(old);
      front = null;
      syncCompare();
    };
    once(v, 'error', failedNew);
    const seeked = () => {
      if (my !== gen) return;
      put(v, split);
      const detail: SwitchedDetail = { from: a.id, to: b.id, prevTime: old ? old.currentTime : 0, newTime: v.currentTime };
      root.dispatchEvent(new CustomEvent<SwitchedDetail>('showcase:switched', { detail }));
      run(v);
      run(old);
      const done = () => {
        if (my !== gen) { if (v !== front) park(v); return; }
        v.style.clipPath = '';
        if (old && old !== v) park(old);
        front = v;
        syncCompare();
      };
      if (old && !reduced && !compare) {
        const r = stage.getBoundingClientRect();
        const x = from.x - r.left;
        const y = from.y - r.top;
        const R = revealRadius(x, y, r.width, r.height);
        v.animate([{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${R}px at ${x}px ${y}px)` }], { duration: REVEAL_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' }).finished.then(done, done);
      } else done();
    };
    const seekTo = () => {
      if (my !== gen) return;
      if (Math.abs(v.currentTime - t) < 0.001) seeked();
      else { once(v, 'seeked', seeked); v.currentTime = t; }
    };
    if (v.readyState >= 1) seekTo(); else once(v, 'loadedmetadata', seekTo);
  }

  function syncCompare(): void {
    const on = compare && !cur().describe && !small && !!front;
    stage.classList.toggle('comparing', on);
    const want = on ? videoFor(clips[prevIndex].id) : null;
    if (back && back !== want) park(back);
    back = want;
    if (!back || !front) return;
    const b = back;
    const f = front;
    b.classList.add('sc-back');
    put(b, f);
    const align = () => { if (back === b && front === f) { b.currentTime = f.currentTime; if (!f.paused) run(b); } };
    if (b.readyState >= 1) align(); else once(b, 'loadedmetadata', align);
  }

  function setCompare(on: boolean): void {
    compare = on;
    compareBtn.setAttribute('aria-pressed', String(on));
    syncCompare();
  }

  function seek(t: number): void {
    for (const v of [front, back]) if (v) v.currentTime = t;
  }

  function setPlaying(on: boolean): void {
    playing = on;
    root.classList.toggle('sc-paused', !on);
    pauseBtn.setAttribute('aria-pressed', String(!on));
    if (on && !front) { start(); return; }
    for (const v of [front, back]) if (v) { if (on) run(v); else v.pause(); }
  }

  // ---- scrubbing: drag the picture (relative) or the timeline (absolute); a press without a drag on the picture pauses
  let drag: { id: number; x: number; t0: number; moved: boolean; onTimeline: boolean; was: boolean } | null = null;
  function scrub(e: PointerEvent): void {
    if (!drag) return;
    const d = cur().duration;
    if (drag.onTimeline) { const r = timeline.getBoundingClientRect(); seek(timeOnTimeline(e.clientX, r.left, r.width, d)); }
    else seek(timeAfterDrag(drag.t0, e.clientX - drag.x, stage.getBoundingClientRect().width, d));
  }
  function down(e: PointerEvent, onTimeline: boolean): void {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    if (!onTimeline && small) return; // phones: the picture scrolls the page; scrub on the timeline
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, t0: front?.currentTime ?? 0, moved: onTimeline, onTimeline, was: playing };
    if (onTimeline) { for (const v of [front, back]) v?.pause(); scrub(e); }
  }
  function move(e: PointerEvent): void {
    if (compare && e.currentTarget === stage) {
      const r = stage.getBoundingClientRect();
      stage.style.setProperty('--sc-split', `${Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))}%`);
    }
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x) < DRAG_SLOP) return;
      drag.moved = true;
      for (const v of [front, back]) v?.pause();
    }
    scrub(e);
  }
  function up(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, was } = drag;
    drag = null;
    if (!moved) { setPlaying(!playing); return; }
    if (was) setPlaying(true);
  }
  stage.addEventListener('pointerdown', (e) => down(e, false));
  timeline.addEventListener('pointerdown', (e) => down(e, true));
  for (const el of [stage, timeline]) {
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => { drag = null; });
  }

  const centre = () => { const r = stage.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  picks.forEach((p, i) => {
    p.addEventListener('click', (e) => switchTo(i, e.detail > 0 ? { x: e.clientX, y: e.clientY } : centre()));
    // hovering a theme warms up its recording (metadata only: sweeping the row must not pull every clip)
    p.addEventListener('pointerenter', () => { if (!small && !saveData && (playing || front)) videoFor(clips[i].id, 'metadata'); });
  });
  compareBtn.addEventListener('click', () => setCompare(!compare));
  playBtn.addEventListener('click', () => setPlaying(true));
  pauseBtn.addEventListener('click', () => setPlaying(!playing));
  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const t = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === ' ' && t.closest('button')) return; // a focused button's own space
    const m = showcaseKey(e.key, index, clips.length);
    if (!m) return;
    e.preventDefault();
    if (m.kind === 'toggle') { setPlaying(!playing); return; }
    switchTo(m.index, centre());
    picks[m.index]?.focus({ preventScroll: true });
  });

  // ---- the buttons' process animations and the progress line run only while the section is on screen
  let stops: (() => void)[] = [];
  function glyphs(on: boolean): void {
    for (const s of stops) s();
    stops = [];
    if (!on || reduced) return;
    picks.forEach((p, i) => {
      const el = p.querySelector<HTMLElement>('.sc-glyph');
      const g = clips[i].glyph;
      if (el && g.frames.length) stops.push(playGlyph({ el, frames: g.frames, fps: g.fps, once: false }));
    });
  }
  function tick(): void {
    raf = 0;
    if (!visible) return;
    const v = front;
    if (v) {
      timeline.style.setProperty('--sc-p', String(Math.min(1, v.currentTime / cur().duration)));
      if (back && !v.paused && !back.seeking && Math.abs(back.currentTime - v.currentTime) > DRIFT) back.currentTime = v.currentTime;
    }
    raf = requestAnimationFrame(tick);
  }
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    glyphs(visible);
    if (visible) { run(front); run(back); if (!raf) raf = requestAnimationFrame(tick); }
    else { front?.pause(); back?.pause(); }
  }, { threshold: 0.05 }).observe(root);

  // posters: the current one, then the other ten (not on phones or with Save-Data); then the current recording
  // (unless motion is reduced)
  applyClip();
  if (!small && !saveData) for (const c of clips) if (c.id !== cur().id) { const im = new Image(); im.decoding = 'async'; im.src = posterOf(c.id); }
  setPlaying(playing);
}
