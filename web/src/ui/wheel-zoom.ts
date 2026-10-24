/**
 * The wheel over something that zooms (the cafe, a node graph — spec 2026-10-24 A3): it zooms and the page stays put;
 * at the zoom's limit, pushing on scrolls the page instead (nobody gets stuck); Shift always scrolls the page.
 * `null`: leave this wheel to the page. The listener must be non-passive to keep the page still (React's onWheel is passive).
 */
export function wheelZoom(scale: number, e: { deltaY: number; shiftKey: boolean }, o: { min: number; max: number; step: number }): number | null {
  if (e.shiftKey || e.deltaY === 0) return null;
  const next = Math.max(o.min, Math.min(o.max, scale * (e.deltaY < 0 ? o.step : 1 / o.step)));
  return Math.abs(next - scale) < 1e-9 ? null : next;
}
