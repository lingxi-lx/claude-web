// The layered picture of the café (spec §4.2): four canvases at the room's native size — L0 the room, L1 what stands
// behind, L2 the front (counter, admin, door side, glass), L3 the light alone — composited onto the page canvas with
// per-layer parallax and nearest-neighbour upscaling; the labels go on a canvas of their own at the page's resolution.
import { darken, drawGlows, drawItems, drawRoom, labels, sceneSize, type Look, type SceneSize, type View, type World } from './engine';
import { isFront } from './layers';
import { approach, LAYER_FACTORS, parallaxOffset } from './motion';

/** A box on the page canvas (device px) where no label may be drawn: the hero's copy. */
export interface Keepout { x: number; y: number; w: number; h: number }
export interface FrameInput { world: World; view: View; pointer: { x: number; y: number } | null; look: Look; dtMs: number; cw: number; ch: number; keepout?: Keepout | null }

/** How far (device px) the labels fade back in past the keep-out box's right and top edges. */
export const KEEPOUT_FADE = 32;

/** Erase the labels over the copy: solid inside the box, fading out over KEEPOUT_FADE past its right and top edges. */
export function clearKeepout(c: CanvasRenderingContext2D, k: Keepout): void {
  if (k.w <= 0 || k.h <= 0) return;
  c.save();
  c.globalCompositeOperation = 'destination-out';
  const right = c.createLinearGradient(k.x + k.w, 0, k.x + k.w + KEEPOUT_FADE, 0);
  right.addColorStop(0, 'rgba(0,0,0,1)');
  right.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = 'rgba(0,0,0,1)';
  c.fillRect(k.x, k.y, k.w, k.h);
  c.fillStyle = right;
  c.fillRect(k.x + k.w, k.y, KEEPOUT_FADE, k.h);
  const top = c.createLinearGradient(0, k.y, 0, k.y - KEEPOUT_FADE);
  top.addColorStop(0, 'rgba(0,0,0,1)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = top;
  c.fillRect(k.x, k.y - KEEPOUT_FADE, k.w, KEEPOUT_FADE);
  c.restore();
}

/** The seam for another renderer (a real 3D one later, spec §7): tier.ts picks, main.ts drives. */
export interface SceneRenderer {
  mount(el: HTMLElement): void;
  frame(f: FrameInput): void;
  unmount(): void;
}

function canvas(cls?: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  if (cls) { c.className = cls; c.setAttribute('aria-hidden', 'true'); }
  return c;
}
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d')!;

export class LayeredCanvas implements SceneRenderer {
  readonly paint = canvas('scene-paint');
  readonly ui = canvas('scene-ui');
  readonly layers = [canvas(), canvas(), canvas(), canvas()];
  readonly offsets = LAYER_FACTORS.map(() => ({ x: 0, y: 0 }));
  glowRect = { x: 0, y: 0, w: 1, h: 1 };
  private readonly pre = canvas();

  constructor(private readonly opts: { parallax: boolean }) {}

  mount(el: HTMLElement) { el.append(this.paint, this.ui); }
  unmount() { this.paint.remove(); this.ui.remove(); }

  /** The page canvases follow the element's size (device pixels, at most 2× CSS). */
  size(el: HTMLElement): { w: number; h: number; dpr: number } {
    const r = el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    for (const c of [this.paint, this.ui]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return { w, h, dpr };
  }

  private fit(sz: SceneSize) {
    for (const c of [...this.layers, this.pre]) if (c.width !== sz.w || c.height !== sz.h) { c.width = sz.w; c.height = sz.h; }
  }

  /** Darken a layer of standing things: multiply would paint its transparent area, so its alpha comes back from a copy. */
  private shade(c: CanvasRenderingContext2D, sz: SceneSize) {
    const p = ctx2d(this.pre);
    p.clearRect(0, 0, sz.w, sz.h);
    p.drawImage(c.canvas, 0, 0);
    darken(c, sz);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(this.pre, 0, 0);
    c.globalCompositeOperation = 'source-over';
  }

  frame(f: FrameInput) {
    const { world: w, view, look } = f;
    const sz = sceneSize(w.map);
    this.fit(sz);
    const [l0, l1, l2, l3] = this.layers.map(ctx2d);
    l0.clearRect(0, 0, sz.w, sz.h);
    drawRoom(l0, w, sz, look);
    darken(l0, sz);
    for (const [c, front] of [[l1, false], [l2, true]] as const) {
      c.clearRect(0, 0, sz.w, sz.h);
      drawItems(c, w, sz, look, (t) => isFront(t, w.map) === front);
      this.shade(c, sz);
    }
    l3.clearRect(0, 0, sz.w, sz.h);
    drawGlows(l3, w, sz, look);

    LAYER_FACTORS.forEach((k, i) => {
      const target = this.opts.parallax && f.pointer ? parallaxOffset(f.pointer, k) : { x: 0, y: 0 };
      const o = this.offsets[i];
      o.x = approach(o.x, target.x, f.dtMs);
      o.y = approach(o.y, target.y, f.dtMs);
    });

    const out = ctx2d(this.paint);
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = 'source-over';
    out.globalAlpha = 1;
    out.fillStyle = '#08070b';
    out.fillRect(0, 0, f.cw, f.ch);
    out.imageSmoothingEnabled = false;
    const W = Math.round(sz.w * view.scale), H = Math.round(sz.h * view.scale);
    const at = (i: number) => ({ x: Math.round(view.x + this.offsets[i].x * view.scale), y: Math.round(view.y + this.offsets[i].y * view.scale) });
    for (let i = 0; i < 3; i++) { const p = at(i); out.drawImage(this.layers[i], p.x, p.y, W, H); }
    // the light breathes a little with the pointer's distance from the centre
    const breath = f.pointer ? Math.min(1, Math.hypot(f.pointer.x, f.pointer.y) / Math.SQRT2) : 0;
    const g = at(3);
    out.globalCompositeOperation = 'lighter';
    out.globalAlpha = 0.9 + 0.1 * breath;
    out.drawImage(this.layers[3], g.x, g.y, W, H);
    out.globalAlpha = 1;
    out.globalCompositeOperation = 'source-over';
    this.glowRect = { x: g.x, y: g.y, w: W, h: H };

    const ui = ctx2d(this.ui);
    ui.setTransform(1, 0, 0, 1, 0, 0);
    ui.clearRect(0, 0, f.cw, f.ch);
    labels(ui, w, view, sz, look);
    // a safety net under the hero's camera: no door pill, bubble or seat tag over the title and its lines
    if (f.keepout) clearKeepout(ui, f.keepout);
  }
}
