// Which standing things go on the front layer (L2, parallax 1.0) and which on the middle one (L1, 0.7). The front is
// the service band by the door: the counter, the admin, the overflow queue, the glass, and guests at the counter —
// all drawn after L1, so they must not stand behind anything of L1 on screen.
import type { CafeMap, ItemTag } from './engine';

export function isFront(t: ItemTag, m: CafeMap): boolean {
  if (t.kind === 'admin' || t.kind === 'queue' || t.kind === 'glass') return true;
  if (t.kind === 'furniture') return t.key === 'counter';
  if (t.kind === 'actor') return t.u < 6 && t.v >= m.admin.v - 2;
  return false;
}
