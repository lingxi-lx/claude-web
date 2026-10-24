/**
 * The wheel over something that zooms (the cafe, a node graph — spec 2026-10-24 A3): it zooms and the page stays put;
 * at the zoom's limit, pushing on scrolls the page instead (nobody gets stuck); Shift always scrolls the page.
 * `null`: leave this wheel to the page. The listener must be non-passive to keep the page still (React's onWheel is passive).
 * A wheel notch (100 px or more) zooms one `step`, a smaller delta that part of one: a mac trackpad sends dozens of
 * small events per swipe, and a full step for each ran away (2026-10-24 review M4). A line-mode wheel (`deltaMode` 1,
 * Firefox) counts a line as 40 px, a page-mode one a full step.
 */
export function wheelZoom(scale: number, e: { deltaY: number; deltaMode?: number; shiftKey: boolean }, o: { min: number; max: number; step: number }): number | null {
  if (e.shiftKey || e.deltaY === 0) return null;
  const px = Math.abs(e.deltaY) * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 100 : 1);
  const f = o.step ** Math.min(1, px / 100);
  const next = Math.max(o.min, Math.min(o.max, scale * (e.deltaY < 0 ? f : 1 / f)));
  return Math.abs(next - scale) < 1e-9 ? null : next;
}
