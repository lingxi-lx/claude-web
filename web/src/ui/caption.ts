// The desktop app's own window buttons (minimise / maximise / close) are drawn by the system over the top right of
// the page (Electron titleBarOverlay = the Window Controls Overlay): nothing on the page can be drawn over them or
// clicked there. A menu placed under them looks open but its top rows are dead — keep menus out of that box.

export interface CaptionBox { left: number; top: number; right: number; bottom: number }

interface Wco { visible: boolean; getTitlebarAreaRect(): DOMRect }

// What App.tsx sizes the overlay to (it tells the desktop shell the height): used when the overlay API does not say —
// it reports `visible: false` / width 0 for a while after the window shows, and a menu opened then must not go under
let known: { w: number; h: number } | null = null;
/** CSS pixels of the system buttons on Windows / Linux (App.tsx, the same numbers it gives the desktop shell). */
export function setCaptionSize(s: { w: number; h: number } | null): void { known = s; }

/** The system buttons' box in viewport pixels, or null (a browser, macOS traffic lights on the left). */
export function captionBox(): CaptionBox | null {
  const wco = (navigator as unknown as { windowControlsOverlay?: Wco }).windowControlsOverlay;
  const r = wco?.visible ? wco.getTitlebarAreaRect() : null;
  if (!r || !r.height || !r.width) {
    return known && known.w > 0 && known.h > 0 ? { left: window.innerWidth - known.w, top: 0, right: window.innerWidth, bottom: known.h } : null;
  }
  const right = window.innerWidth;
  // the free title bar area ends where the buttons start (on the right; on the left when the free area does not
  // start at 0, the macOS-like case — those buttons are outside our menus' way, ignored)
  const left = r.x + r.width;
  if (right - left < 1) return null;
  return { left, top: 0, right, bottom: r.y + r.height };
}

/** `top` moved below `box` when a menu at [left, left + w) × [top, top + h) would sit under it. */
export function clearOfCaption(left: number, top: number, w: number, box: CaptionBox | null): number {
  if (!box) return top;
  const overlapsX = left < box.right && left + w > box.left;
  return overlapsX && top < box.bottom ? box.bottom + 4 : top;
}
