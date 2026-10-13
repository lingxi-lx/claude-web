import { FRAME, poseFrame, type CharacterDef, type Facing, type Pose } from './core/index.js';
import { encodePng } from './png.js';

/** What the model sees after a draft: front, back, the four walking frames, sitting at work, eating — 8 × each. */
export const PREVIEW_CELLS: [Facing, Pose, number][] = [
  ['se', 'stand', 0], ['ne', 'stand', 0], ['se', 'walk', 0], ['se', 'walk', 1], ['se', 'walk', 2], ['se', 'walk', 3], ['se', 'type', 0], ['se', 'eat', 0],
];
export const PREVIEW_SCALE = 8;
const BG = [0x1b, 0x1a, 0x22];
const GAP = 1; // a frame's width of dark between the cells is a pixel of 8

export function previewPng(def: CharacterDef): Buffer {
  const n = PREVIEW_CELLS.length;
  const cw = (FRAME + GAP) * PREVIEW_SCALE;
  const w = cw * n, h = FRAME * PREVIEW_SCALE;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = BG[0]; rgba[i * 4 + 1] = BG[1]; rgba[i * 4 + 2] = BG[2]; rgba[i * 4 + 3] = 255; }
  PREVIEW_CELLS.forEach(([facing, pose, tick], i) => {
    const f = poseFrame(def, facing, pose, tick);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const c = f.px[y * f.w + x];
      if (!c) continue;
      const v = parseInt(c.slice(1), 16);
      for (let yy = 0; yy < PREVIEW_SCALE; yy++) for (let xx = 0; xx < PREVIEW_SCALE; xx++) {
        const p = ((y * PREVIEW_SCALE + yy) * w + i * cw + x * PREVIEW_SCALE + xx) * 4;
        rgba[p] = (v >> 16) & 255; rgba[p + 1] = (v >> 8) & 255; rgba[p + 2] = v & 255;
      }
    }
  });
  return encodePng(w, h, rgba);
}
