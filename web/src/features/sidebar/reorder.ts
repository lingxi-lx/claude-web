// Projects in the order the user puts them (2026-10-14 user report: they could not be moved, and a new one landed at
// the bottom). Pure: the sidebar's drag and the project menu's 上移 / 下移 both come here.

/** `ids` with `id` moved to `to` (an index into the list as it was; clamped). */
export function moveTo(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const out = ids.filter((x) => x !== id);
  const at = Math.max(0, Math.min(out.length, to > from ? to - 1 : to));
  out.splice(at, 0, id);
  return out;
}

/** Dropping `id` on `target`: before it in the upper half of its header, after it in the lower half. */
export function dropOrder(ids: readonly string[], id: string, target: string, after: boolean): string[] {
  const t = ids.indexOf(target);
  if (t < 0 || id === target) return [...ids];
  return moveTo(ids, id, after ? t + 1 : t);
}
