/**
 * Double-click in a reply selects one thing (spec 2026-10-24 A4, like the official app): an inline code span whole
 * (`activation_status`, `src/auth/verify.ts` — Chromium alone stops at the `/` and `.`), else the word under the
 * pointer — Chinese split into words (Intl.Segmenter), and without the trailing space Chromium on Windows adds to a
 * double-clicked word. A triple click (the paragraph) is left alone.
 */
const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;

/** The word-like segment `offset` falls in, as [start, end); null on a space / punctuation. The text's very end belongs to its last word. */
export function wordAt(text: string, offset: number): [number, number] | null {
  if (!seg) return null;
  for (const s of seg.segment(text)) {
    const start = s.index, end = s.index + s.segment.length;
    if (offset >= start && (offset < end || (offset === end && end === text.length))) return s.isWordLike ? [start, end] : null;
  }
  return null;
}

function caret(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  if (d.caretPositionFromPoint) { const p = d.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null; }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

/**
 * The character under the pointer: the caret is the nearest boundary, so on a character's right half it sits after
 * it — then the character before the caret is the one whose box holds the point.
 */
function charUnder(node: Text, offset: number, x: number, y: number): number {
  if (offset === 0) return 0;
  const r = document.createRange();
  r.setStart(node, offset - 1);
  r.setEnd(node, offset);
  for (const b of r.getClientRects()) if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return offset - 1;
  return offset;
}

/** Re-selects after a double click inside `root`'s reply text; true when it changed the selection. */
export function refineDoubleClick(e: MouseEvent, root: HTMLElement): boolean {
  if (e.detail !== 2) return false;
  const target = e.target instanceof Element ? e.target : null;
  if (!target || !root.contains(target) || !target.closest('.msg-text')) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  const code = target.closest('code');
  if (code && !code.closest('pre, .code')) {
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(code);
    sel.addRange(r);
    return true;
  }
  const c = caret(e.clientX, e.clientY);
  if (!c || c.node.nodeType !== Node.TEXT_NODE || !target.contains(c.node)) return false;
  const text = c.node as Text;
  const w = wordAt(text.data, charUnder(text, c.offset, e.clientX, e.clientY));
  // on a space or a mark: what the browser chose stays
  if (!w) return false;
  sel.setBaseAndExtent(text, w[0], text, w[1]);
  return true;
}
