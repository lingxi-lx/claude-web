// The hero's live scene (lazily imported by entry.ts): the demo day stepped every frame, drawn by the layered renderer,
// the camera eased to whatever the chapters ask. Later parts plug in through hero.tweaks / hero.onFrame.
import { BUILTIN, resolveCharacter, sceneSize, type Look, type View, type World } from './engine';
import { Demo, POSTER_MS } from './demo';
import { AGENT_NIGHT } from './palette';
import { LayeredCanvas } from './Scene';
import { anchorFor, cameraView, CAMERA_MS, easeView, HERO_LOOK, type ChapterLook } from './chapters';
import { pointerNorm } from './motion';
import type { TierProfile } from './tier';

export interface HeroOptions { profile: TierProfile; poster: boolean }
export interface Hero {
  root: HTMLElement;
  demo: Demo;
  renderer: LayeredCanvas;
  profile: TierProfile;
  poster: boolean;
  /** Device pixels per CSS pixel of the canvases. */
  dpr: number;
  /** The camera of the last frame (device px). */
  view: View;
  /** The pointer over the stage, -1…1 (null: elsewhere, or no mouse). */
  pointer: { x: number; y: number } | null;
  /** The same in client (CSS) px. */
  client: { x: number; y: number } | null;
  /** The actor key under the pointer (its seat tag lights up). */
  hover: string | undefined;
  /** Demo speed (the debug panel). */
  speed: number;
  still: boolean;
  tweaks: ((w: World, now: number) => World)[];
  onFrame: ((dtMs: number) => void)[];
  lookAt(look: ChapterLook): void;
  look(): Look;
  start(): void;
  stop(): void;
}

const chars = new Map(BUILTIN.map((c) => [c.id, c]));
const BOOT_STEP_MS = 120;

/** Monitors switch on one by one when the scene takes over from the poster. */
function booting(w: World, elapsed: number): World {
  return { ...w, actors: w.actors.map((a) => (a.seat && elapsed < a.seat * BOOT_STEP_MS ? { ...a, screen: 'off' as const } : a)) };
}

export function startHero(root: HTMLElement, opts: HeroOptions): Hero {
  const demo = new Demo();
  demo.seek(POSTER_MS);
  const renderer = new LayeredCanvas({ parallax: opts.profile.parallax });
  renderer.mount(root);
  let camFrom: View | null = null, camTo: ChapterLook = HERO_LOOK, camAt = 0;
  let raf = 0, last = 0, lastDraw = 0, bootAt = 0, running = false, onScreen = true;

  const hero: Hero = {
    root, demo, renderer, profile: opts.profile, poster: opts.poster, dpr: 1, view: { scale: 1, x: 0, y: 0 },
    pointer: null, client: null, hover: undefined, speed: 1, still: opts.poster, tweaks: [], onFrame: [],
    lookAt(look) {
      if (look === camTo) return;
      camFrom = { ...hero.view };
      camTo = look;
      camAt = performance.now();
    },
    look: () => ({
      now: hero.demo.now(), agentColors: AGENT_NIGHT, chars, rate: 5, session: hero.demo.snapshot(), hover: hero.hover, still: hero.still, mainBusy: true, title: '',
      who: (x) => resolveCharacter(undefined, x.key === 'admin' ? { admin: true } : { type: x.type, name: x.name }, (id) => chars.has(id)),
    }),
    start() { if (running || hero.still) return; running = true; last = 0; raf = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(raf); },
  };

  function draw(t: number) {
    const dt = last ? Math.min(250, t - last) : 16;
    last = t;
    if (!hero.still) hero.demo.advance(dt * hero.speed, false);
    const { w: cw, h: ch, dpr } = renderer.size(root);
    hero.dpr = dpr;
    const sz = sceneSize(hero.demo.world.map);
    const target = cameraView(camTo, sz, cw, ch, anchorFor(cw / dpr));
    hero.view = camFrom ? easeView(camFrom, target, (t - camAt) / CAMERA_MS) : target;
    if (camFrom && t - camAt >= CAMERA_MS) camFrom = null;
    let w = hero.demo.world;
    if (!bootAt) bootAt = t;
    if (!hero.still) w = booting(w, t - bootAt);
    for (const f of hero.tweaks) w = f(w, hero.demo.now());
    renderer.frame({ world: w, view: hero.view, pointer: hero.pointer, look: hero.look(), dtMs: dt, cw, ch });
    for (const f of hero.onFrame) f(dt);
    root.dataset.live = '1';
  }

  function tick(t: number) {
    raf = requestAnimationFrame(tick);
    if (t - lastDraw < 1000 / opts.profile.maxFps - 1) return;
    lastDraw = t;
    draw(t);
  }

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = root.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    hero.pointer = inside ? pointerNorm(e.clientX, e.clientY, r) : null;
    hero.client = inside ? { x: e.clientX, y: e.clientY } : null;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { hero.pointer = null; hero.client = null; });

  // no frames while the tab is hidden or the stage is scrolled away
  const sync = () => (onScreen && !document.hidden ? hero.start() : hero.stop());
  document.addEventListener('visibilitychange', sync);
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }).observe(document.getElementById('stage') ?? root);

  if (hero.still) {
    draw(performance.now());
    document.fonts.ready.then(() => {
      draw(performance.now());
      document.documentElement.dataset.posterReady = '1';
    });
  } else sync();
  return hero;
}
