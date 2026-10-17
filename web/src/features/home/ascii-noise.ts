// The maths of the new-conversation page's backdrop (AsciiField.tsx): pure, so node tests can import it.

/** 3D value noise in [0, 1): smooth, cheap, and the same everywhere for the same seed. */
export function makeNoise(seed = 1) {
  const perm = new Uint8Array(512);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = Float32Array.from({ length: 256 }, () => rnd());
  const at = (x: number, y: number, z: number) => vals[perm[(perm[(perm[x & 255] + y) & 511] + z) & 511]];
  const fade = (t: number) => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return (x: number, y: number, z: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
    const a = lerp(lerp(at(xi, yi, zi), at(xi + 1, yi, zi), u), lerp(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), u), v);
    const b = lerp(lerp(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), u), lerp(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), u), v);
    return lerp(a, b, w);
  };
}

/**
 * How much a click's ripple lights a cell `dist` px from where it happened, `age` ms after (0 = not at all): a small
 * bright disc at first that opens into a ring travelling outwards and fading — the official app's new-conversation
 * page does this on every click.
 */
export const RIPPLE_MS = 1300;
export const RIPPLE_REACH = 320;
export function rippleLevel(dist: number, age: number): number {
  if (age < 0 || age >= RIPPLE_MS) return 0;
  const p = age / RIPPLE_MS;
  const radius = RIPPLE_REACH * (1 - (1 - p) ** 2.2);
  const band = 34 + 26 * p;
  const off = Math.abs(dist - radius);
  // the disc it starts as: everything inside the ring while it is still small
  const inside = dist < radius && radius < 60 ? 1 : 0;
  const ring = Math.max(inside, 1 - off / band);
  if (ring <= 0) return 0;
  return ring * (1 - p) ** 0.9;
}

/** The field's own level, much quieter than before: wide soft bands drifting on a diagonal, cut so there are gaps. */
export function bandLevel(noise: (x: number, y: number, z: number) => number, cx: number, cy: number, t: number): number {
  // a diagonal frame: the bands lean like the official page's streaks
  const u = (cx + cy * 1.6) * 0.022, v = (cy * 1.0 - cx * 0.35) * 0.05;
  const n = 0.7 * noise(u, v, t * 0.07) + 0.3 * noise(cx * 0.09 + 17, cy * 0.16 + 31, t * 0.18);
  const cut = 0.46;
  return n <= cut ? 0 : Math.min(1, (n - cut) / (1 - cut));
}
