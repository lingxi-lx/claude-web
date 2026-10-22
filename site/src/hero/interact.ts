// The scene's small interactions (spec §5): guests turn to the pointer; hovering (tapping) a guest shows what it does;
// ← / → go from guest to guest; hovering "Allow" previews (api's dark monitor lights up); a download button prints a
// receipt at the counter; ↑↑↓↓←→←→BA opens a debug panel; S / the button turns the synthesised sound on.
import { hitTest, sceneSize, toFloor, type Actor, type World } from './engine';
import { Demo, GUESTS, POSTER_MS } from './demo';
import { faceToward, nearest } from './gaze';
import { konamiDetector } from './konami';
import { Sound } from './sound';
import type { Hero } from './main';

type Texts = Record<string, string>;

function doingText(x: Actor, t: Texts): string {
  switch (x.doing) {
    case 'work': return t.work;
    case 'game': return t.game;
    case 'activity': case 'toActivity': return t[x.activity ?? 'stand'] ?? t.stand;
    case 'toDesk': case 'checkin': return t.checkin;
    case 'toCheckout': case 'checkout': return t.checkout;
    case 'leave': return t.leave;
    default: return t.other;
  }
}

const editable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function installInteract(hero: Hero): void {
  const root = hero.root;
  const tip = root.querySelector<HTMLElement>('.scene-tip');
  const texts: Texts = JSON.parse(tip?.dataset.doing ?? '{}');
  let preview = false;
  let pinned: { key: string; x: number; y: number } | null = null;

  /** Client (CSS) px → the floor under it, through the middle layer's parallax. */
  function floorAt(cx: number, cy: number): { u: number; v: number; px: number; py: number } {
    const r = root.getBoundingClientRect();
    const px = (cx - r.left) * hero.dpr, py = (cy - r.top) * hero.dpr;
    const sz = sceneSize(hero.demo.world.map);
    const off = hero.renderer.offsets[1];
    const x = (px - hero.view.x) / hero.view.scale - off.x - sz.ox;
    const y = (py - hero.view.y) / hero.view.scale - off.y - sz.oy;
    return { ...toFloor(x, y), px, py };
  }
  const midView = () => ({ ...hero.view, x: hero.view.x + hero.renderer.offsets[1].x * hero.view.scale, y: hero.view.y + hero.renderer.offsets[1].y * hero.view.scale });

  // guests look at the pointer; api's monitor stays dark while it waits for you, lit while "Allow" is hovered
  hero.tweaks.push((w: World) => {
    let actors = w.actors;
    if (hero.demo.needsYou()) actors = actors.map((a) => (a.key === GUESTS.api && a.doing === 'work' ? { ...a, screen: preview ? 'code' : 'off' } : a));
    let admin = w.admin;
    if (hero.client && hero.profile.parallax) {
      const f = floorAt(hero.client.x, hero.client.y);
      const standing = [...actors.filter((a) => !a.hidden && (a.pose === 'stand' || a.pose === 'eat')), ...(admin.pose === 'stand' ? [admin] : [])];
      const near = new Set(nearest(standing, f, 3).map((a) => a.key));
      actors = actors.map((a) => (near.has(a.key) ? { ...a, facing: faceToward(a, f) } : a));
      if (near.has('admin')) admin = { ...admin, facing: faceToward(admin, f) };
    }
    return actors === w.actors && admin === w.admin ? w : { ...w, actors, admin };
  });

  function tipFor(key: string): string {
    const x = key === 'admin' ? hero.demo.world.admin : hero.demo.world.actors.find((a) => a.key === key);
    if (!x) return '';
    const a = hero.demo.snapshot().tasks.find((t) => t.id === x.taskId)?.agents[0];
    return [x.name, doingText(x, texts), a?.lastSummary ?? ''].filter(Boolean).join('\n');
  }
  function showTip(key: string | null, x = 0, y = 0) {
    hero.hover = key ?? undefined;
    if (!tip) return;
    const text = key ? tipFor(key) : '';
    tip.hidden = !text;
    if (!text) return;
    tip.textContent = text;
    tip.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 14)}px)`;
  }

  // hover (mouse) and tap (touch) a guest
  hero.onFrame.push(() => {
    if (pinned) { showTip(pinned.key, pinned.x, pinned.y); return; }
    if (!hero.client) { if (hero.hover) showTip(null); return; }
    const f = floorAt(hero.client.x, hero.client.y);
    const hit = hitTest(hero.demo.world, midView(), f.px, f.py);
    const r = root.getBoundingClientRect();
    showTip(hit && hit.kind !== 'machine' ? hit.key : null, hero.client.x - r.left, hero.client.y - r.top);
  });
  root.addEventListener('click', (e) => {
    if ((e as PointerEvent).pointerType === 'mouse' || (e.target as HTMLElement).closest('button, a, input, .ov')) return;
    const f = floorAt(e.clientX, e.clientY);
    const hit = hitTest(hero.demo.world, midView(), f.px, f.py);
    const r = root.getBoundingClientRect();
    pinned = hit && hit.kind !== 'machine' && pinned?.key !== hit.key ? { key: hit.key, x: e.clientX - r.left, y: e.clientY - r.top } : null;
    if (!pinned) showTip(null);
  });

  // ← / → from guest to guest (the camera follows); Konami
  const konami = konamiDetector();
  let cycle = -1;
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || editable(e.target)) return;
    if (konami(e.key)) { const d = root.querySelector<HTMLElement>('[data-debug]'); if (d) d.hidden = !d.hidden; return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const r = root.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight) return;
    const guests = hero.demo.world.actors.filter((a) => !a.hidden).sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
    if (!guests.length) return;
    cycle = (cycle + (e.key === 'ArrowRight' ? 1 : -1) + guests.length) % guests.length;
    const g = guests[cycle];
    hero.lookAt({ u: g.u + 0.5, v: g.v + 0.5, h: 8, zoom: 2.2 });
    pinned = { key: g.key, x: r.width * 0.64, y: r.height * 0.52 };
  });

  // "Allow" previews
  const allow = root.querySelector<HTMLElement>('[data-decide="allow"]');
  allow?.addEventListener('pointerenter', () => { preview = true; });
  allow?.addEventListener('pointerleave', () => { preview = false; });
  allow?.addEventListener('focus', () => { preview = true; });
  allow?.addEventListener('blur', () => { preview = false; });

  // a download prints a receipt at the counter; the download itself goes on as usual
  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-key-action="download"]')) {
    a.addEventListener('click', () => {
      const os = document.documentElement.dataset.os === 'mac' ? 'macOS' : 'Windows';
      const w = hero.demo.world, now = hero.demo.now();
      w.receipts = [{ key: `download-${now}`, name: `Claude Web · ${os}`, seat: 0, ms: 0, fee: 0, kind: 'ok', at: now }, ...w.receipts];
      w.dings = [...w.dings, now];
    });
  }

  // the debug panel
  const panel = root.querySelector<HTMLElement>('[data-debug]');
  panel?.querySelector<HTMLInputElement>('[data-speed]')?.addEventListener('input', (e) => { hero.speed = Number((e.target as HTMLInputElement).value) || 1; });
  panel?.querySelector<HTMLButtonElement>('[data-reseed]')?.addEventListener('click', () => {
    const seed = Number(panel.querySelector<HTMLInputElement>('[data-seed]')?.value) || 7;
    hero.demo = new Demo(seed);
    hero.demo.seek(POSTER_MS);
  });
  const fps = panel?.querySelector<HTMLOutputElement>('[data-fps]');
  let frames = 0, since = performance.now();
  hero.onFrame.push(() => {
    frames++;
    const now = performance.now();
    if (now - since >= 1000) { if (fps && !panel!.hidden) fps.value = `${frames} fps`; frames = 0; since = now; }
  });

  // sound
  const sound = new Sound();
  const btn = root.querySelector<HTMLButtonElement>('.scene-sound');
  btn?.addEventListener('click', () => {
    const on = sound.toggle();
    btn.setAttribute('aria-pressed', String(on));
    const label = btn.querySelector('[data-sound-label]');
    if (label) label.textContent = (on ? btn.dataset.on : btn.dataset.off) ?? '';
  });
  hero.onFrame.push(() => sound.frame(hero.demo.world, performance.now()));
}
