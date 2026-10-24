// The menu that shows up when text in the conversation is selected (2026-10-20, user request: 「不想右键」 — like the
// Claude panel in VS Code). SelectionMenu.tsx reads the selection and the DOM; what it offers and where it goes is here.

export type SelItem = 'copy' | 'copyCode' | 'copyMsg' | 'copyMd' | 'quote' | 'side' | 'pin' | 'fork';

/** What the selection is in. `msg`: the one message it lies inside (null: it spans several, or none we know). */
export interface SelContext {
  inCode: boolean;
  msg: 'user' | 'assistant' | null;
  /** a reply with text: it can be copied whole and pinned (a reply that is only thinking copied as "") */
  hasText: boolean;
  /** the message can be forked from (a user message, or a reply with its uuid) */
  canFork: boolean;
  /** a live conversation of this machine: it can take a side question */
  canSide?: boolean;
}

/** The rows, in groups (a separator between groups); a group with nothing in it is left out. */
export function selectionItems(c: SelContext): SelItem[][] {
  const groups: SelItem[][] = [
    ['copy', ...(c.inCode ? (['copyCode'] as const) : [])],
    // a user message is its own Markdown: one row
    c.msg === 'assistant' ? (c.hasText ? ['copyMsg', 'copyMd'] : []) : c.msg === 'user' ? ['copyMsg'] : [],
    // 旁聊 (spec 2026-10-24 A4): the side chat opens with the selection quoted in its input
    ['quote', ...(c.canSide ? (['side'] as const) : [])],
    [...(c.msg === 'assistant' && c.hasText ? (['pin'] as const) : []), ...(c.msg && c.canFork ? (['fork'] as const) : [])],
  ];
  return groups.filter((g) => g.length > 0);
}

/** Ctrl+Shift+L (⌘⇧L): 引用到输入框 while text in the conversation is selected. */
export function isQuoteKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l';
}

export interface Rect { top: number; bottom: number; left: number; right: number }

const GAP = 6;
const MARGIN = 8;

/**
 * Where the menu goes (fixed coordinates of its top-left corner): next to where the selection ends, off the selected
 * text. `end` = the line box the selection's focus is on; `bounds` = the whole selection; `forward` = the focus is at
 * the end (dragged down / right). Forward: below the end line, else above the whole selection; backward: above the
 * start line, else below the whole selection; neither fits: whichever side has more room, kept inside the window
 * (then it may cover part of a very tall selection). Horizontally it starts at the focus, pushed back inside.
 */
export function placeSelectionMenu(end: Rect, bounds: Rect, forward: boolean, size: { w: number; h: number }, view: { vw: number; vh: number }): { left: number; top: number } {
  const { w, h } = size;
  const { vw, vh } = view;
  const below = forward ? end.bottom + GAP : bounds.bottom + GAP;
  const above = (forward ? bounds.top : end.top) - GAP - h;
  const fitsBelow = below + h <= vh - MARGIN;
  const fitsAbove = above >= MARGIN;
  let top: number;
  if (forward ? fitsBelow : !fitsAbove && fitsBelow) top = below;
  else if (fitsAbove) top = above;
  else top = vh - (forward ? end.bottom : bounds.bottom) >= (forward ? bounds.top : end.top) ? below : above;
  top = clamp(top, MARGIN, vh - MARGIN - h);
  const x = forward ? end.right : end.left - w;
  const left = clamp(x, MARGIN, vw - MARGIN - w);
  return { left: Math.round(left), top: Math.round(top) };
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(hi, Math.max(lo, v));
}
