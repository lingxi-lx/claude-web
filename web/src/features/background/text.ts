// Small text helpers of 后台's drawings (the relation graph): display width with CJK as two, and Enter / Space on a
// focusable SVG node.

const cjk = (ch: string) => (ch.codePointAt(0) ?? 0) >= 0x2e80;

/** How wide a text is, px, at `size` (an estimate: a CJK character is a square, Latin about 0.58 em). */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += cjk(ch) ? size : size * 0.58;
  return w;
}

/** `s` cut to `units` of display width (a CJK character is two), with an ellipsis when it was cut. */
export function clip(s: string, units: number): string {
  let w = 0;
  for (const ch of s) w += cjk(ch) ? 2 : 1;
  if (w <= units) return s;
  let out = '';
  w = 0;
  for (const ch of s) {
    const c = cjk(ch) ? 2 : 1;
    if (w + c + 1 > units) break;
    out += ch;
    w += c;
  }
  return out + '…';
}

/** Enter / Space activate a focusable node that is not a button. */
export function pressKeys(go: () => void) {
  return (e: { key: string; preventDefault(): void }) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  };
}
