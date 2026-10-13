import { FRAME, GRID, type CharacterDef, type Facing, type Frame, type Pose } from './types.js';

/**
 * One pose frame of a character, made from its two pictures (spec §4): the picture for the facing (front for se / sw,
 * back for ne / nw; sw and nw mirrored), on a 26 × 26 frame with a pixel of room all round, then the pose:
 * - walk: 4 ticks — on 1 the left half of the legs is lifted a row and the body bobs up, on 3 the right half;
 * - sit: the legs rows are hidden (behind the chair);
 * - type / game: sitting, a 2 × 2 hand at each hand point, going up and down (game twice as fast);
 * - eat: sitting, a noodle bowl at the first hand, nodding;
 * - blink: standing with the eye pixels in the skin colour (only from the front).
 */
export const BOWL = '#f2efe6';
export const BOWL_RIM = '#e94e3c';

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

/** The darkest colour of the palette: the hands. */
export function darkest(def: CharacterDef): string {
  return Object.values(def.palette).reduce((a, b) => (luminance(b) < luminance(a) ? b : a));
}

/** The colour used most on the front, not counting the eyes' colours: the skin a blink paints the eyes with. */
export function skin(def: CharacterDef): string {
  const eye = new Set(def.rig.eyes.map(([x, y]) => [...def.front[y]][x]));
  const count = new Map<string, number>();
  for (const r of def.front) for (const ch of r) if (ch !== '.' && !eye.has(ch)) count.set(ch, (count.get(ch) ?? 0) + 1);
  let best = '', n = -1;
  for (const [ch, k] of count) if (k > n) { best = ch; n = k; }
  return def.palette[best] ?? darkest(def);
}

export function poseFrame(def: CharacterDef, facing: Facing, pose: Pose, tick: number): Frame {
  const back = facing === 'ne' || facing === 'nw';
  const mirror = facing === 'sw' || facing === 'nw';
  const rows = (back ? def.back : def.front).map((r) => [...r]);
  // the picture as colours, in picture coordinates
  const pic: (string | null)[][] = rows.map((r) => r.map((ch) => (ch === '.' ? null : def.palette[ch] ?? null)));
  const legs = def.rig.legs;
  const seated = pose === 'sit' || pose === 'type' || pose === 'game' || pose === 'eat';
  if (pose === 'blink' && !back) {
    const c = skin(def);
    for (const [x, y] of def.rig.eyes) pic[y][x] = c;
  }
  if (seated) for (let y = legs; y < GRID; y++) pic[y].fill(null);
  let bob = 0;
  if (pose === 'walk') {
    const t = ((tick % 4) + 4) % 4;
    if (t === 1 || t === 3) {
      bob = -1;
      const left = t === 1;
      for (let x = 0; x < GRID; x++) {
        if ((x < GRID / 2) !== left) continue;
        // lifted a row: a leg pixel goes up (over the body's lowest row there), the bottom row empties
        for (let y = legs; y < GRID; y++) if (pic[y][x] || y > legs) pic[y - 1][x] = pic[y][x] ?? (y - 1 >= legs ? null : pic[y - 1][x]);
        pic[GRID - 1][x] = null;
      }
    }
  }
  if (pose === 'eat' && (((tick % 2) + 2) % 2) === 1) bob = 1;
  const px: (string | null)[] = new Array(FRAME * FRAME).fill(null);
  const put = (x: number, y: number, c: string | null) => {
    if (c === null || x < 0 || y < 0 || x >= FRAME || y >= FRAME) return;
    px[y * FRAME + x] = c;
  };
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const c = pic[y][x];
    if (c) put(x + 1, y + 1 + bob, c);
  }
  // hands and the bowl, in picture coordinates (mirrored later with the rest)
  if (pose === 'type' || pose === 'game') {
    const phase = pose === 'game' ? tick : tick >> 1;
    const down = ((phase % 2) + 2) % 2;
    const c = darkest(def);
    def.rig.hands.forEach(([hx, hy], i) => {
      const dy = i % 2 === 0 ? down : 1 - down;
      for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) put(hx + xx + 1, hy + yy + 1 + dy, c);
    });
  }
  if (pose === 'eat') {
    const [hx, hy] = def.rig.hands[0];
    for (let xx = -1; xx <= 1; xx++) { put(hx + xx + 1, hy + 1 + bob, BOWL_RIM); put(hx + xx + 1, hy + 2 + bob, BOWL); }
  }
  if (mirror) {
    for (let y = 0; y < FRAME; y++) {
      const row = px.slice(y * FRAME, (y + 1) * FRAME).reverse();
      for (let x = 0; x < FRAME; x++) px[y * FRAME + x] = row[x];
    }
  }
  return { w: FRAME, h: FRAME, px };
}
