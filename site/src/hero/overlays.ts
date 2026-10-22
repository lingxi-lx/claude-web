// The chapters drive the scene (spec §4.3): the one crossing the middle of the viewport sets the camera, the demo phase
// it needs, the scene's aria-label, and which card hangs over the scene; the cards are real buttons.
import { onPage, sceneSize } from './engine';
import { CHAPTERS, chapterById, HERO_LOOK, type ChapterSpec } from './chapters';
import { GUESTS } from './demo';
import type { Hero } from './main';

const $ = <T extends Element>(root: ParentNode, sel: string) => root.querySelector<T>(sel);
const RESULT_MS = 2500;

export function installChapters(hero: Hero): { active(): string | null } {
  const root = hero.root;
  const label = $<HTMLElement>(root, '[data-scene-label-el]');
  const heroAlt = label?.getAttribute('aria-label') ?? '';
  const cards = new Map([...root.querySelectorAll<HTMLElement>('[data-overlay]')].map((el) => [el.dataset.overlay!, el]));
  let active: ChapterSpec | null = null;
  let resultUntil = 0;

  function show(spec: ChapterSpec | null, section: HTMLElement | null) {
    active = spec;
    hero.lookAt(spec?.look ?? HERO_LOOK);
    if (spec) root.dataset.chapter = spec.id; else delete root.dataset.chapter;
    label?.setAttribute('aria-label', section?.dataset.sceneLabel ?? heroAlt);
    if (spec?.jump && (!spec.ok.includes(hero.demo.phase()) || (spec.id === 'permission' && !hero.demo.needsYou()))) hero.demo.jumpTo(spec.jump);
    for (const [id, el] of cards) el.hidden = id !== spec?.id;
  }

  // the section crossing the middle line of the viewport is the active one
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      show(el.dataset.chapter ? chapterById(el.dataset.chapter) ?? null : null, el.dataset.chapter ? el : null);
    }
  }, { rootMargin: '-50% 0px -50% 0px' });
  const hs = document.querySelector('[data-hero]');
  if (hs) io.observe(hs);
  for (const s of document.querySelectorAll('section.chapter[data-chapter]')) io.observe(s);

  // hang the active card over its guest (or over the camera's point)
  hero.onFrame.push(() => {
    if (!active) return;
    const el = cards.get(active.id);
    if (!el) return;
    if (active.id === 'permission') el.hidden = !hero.demo.needsYou() && performance.now() > resultUntil;
    if (el.hidden) return;
    const w = hero.demo.world;
    const sz = sceneSize(w.map);
    const who = active.focus ? w.actors.find((a) => a.key === GUESTS[active!.focus!]) : undefined;
    const p = who ? onPage(hero.view, sz, who.u + 0.5, who.v + 0.5, 34) : onPage(hero.view, sz, active.look.u, active.look.v, (active.look.h ?? 0) + 20);
    const x = p.x / hero.dpr, y = p.y / hero.dpr;
    const r = root.getBoundingClientRect();
    const cx = Math.max(8, Math.min(r.width - el.offsetWidth - 8, x - el.offsetWidth / 2));
    const cy = Math.max(64, Math.min(r.height - el.offsetHeight - 8, y - el.offsetHeight - 12));
    el.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
  });

  // the cards' buttons
  const toggle = (btn: HTMLElement | null, panel: HTMLElement | null) => btn?.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    if (panel) panel.hidden = !open;
  });
  toggle($(root, '[data-turn]'), $(root, '[data-timeline]'));
  toggle($(root, '[data-file]'), $(root, '[data-diff]'));
  $<HTMLButtonElement>(root, '[data-run]')?.addEventListener('click', () => { const o = $<HTMLElement>(root, '[data-out]'); if (o) o.hidden = false; });
  const result = $<HTMLElement>(root, '[data-result]');
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-decide]')) {
    b.addEventListener('click', () => {
      const allow = b.dataset.decide === 'allow';
      hero.demo.decide(allow);
      const text = (allow ? result?.dataset.allowed : result?.dataset.denied) ?? '';
      if (result) result.textContent = text;
      resultUntil = performance.now() + RESULT_MS;
      const api = hero.demo.world.actors.find((a) => a.key === GUESTS.api);
      if (api) api.bubble = { text, until: hero.demo.now() + RESULT_MS };
    });
  }
  return { active: () => active?.id ?? null };
}

export { CHAPTERS };
