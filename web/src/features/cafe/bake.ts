// Character frames as small canvases, made once and kept (by character, colour, facing, pose and frame).
import { poseFrame, tinted, type CharacterDef, type Facing, type Pose } from '@characters';

type Can = HTMLCanvasElement | OffscreenCanvas;
const cache = new Map<string, Can>();
const MAX = 2000;

function canvas(w: number, h: number): Can {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** One frame of `def` (the octopus in `tint` when given), as a canvas the size of the frame. */
export function bakeCharacter(def: CharacterDef, tint: string | undefined, facing: Facing, pose: Pose, tick: number): Can {
  const k = `${def.id}|${def.draft ? 'd' : ''}|${tint ?? ''}|${facing}|${pose}|${tick}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const f = poseFrame(tinted(def, tint), facing, pose, tick);
  const c = canvas(f.w, f.h);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | null;
  if (ctx) {
    const img = ctx.createImageData(f.w, f.h);
    f.px.forEach((col, i) => {
      if (!col) return;
      const n = parseInt(col.slice(1), 16);
      img.data[i * 4] = (n >> 16) & 255;
      img.data[i * 4 + 1] = (n >> 8) & 255;
      img.data[i * 4 + 2] = n & 255;
      img.data[i * 4 + 3] = 255;
    });
    ctx.putImageData(img, 0, 0);
  }
  if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
  cache.set(k, c);
  return c;
}

/** A character was redrawn (a new draft): its frames go. */
export function forgetCharacter(id: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${id}|`)) cache.delete(k);
}
