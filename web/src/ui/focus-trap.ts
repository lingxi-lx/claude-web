// Tab stays inside a modal box (a dialog that is not dlg.*: AllowedSites): from the last thing that takes the focus
// Tab goes to the first, Shift+Tab from the first to the last, and a focus outside the box comes back in.

const TABBABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where the focus goes from `at` (-1: not in the box) among `count` things, Tab or Shift+Tab; null: let the browser move it. */
export function wrapIndex(at: number, count: number, back: boolean): number | null {
  if (count <= 0) return null;
  if (at < 0) return back ? count - 1 : 0;
  if (back && at === 0) return count - 1;
  if (!back && at === count - 1) return 0;
  return null;
}

/** The modal box's onKeyDown: a Tab that would leave `box` wraps around inside it. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault(): void }, box: HTMLElement | null): void {
  if (e.key !== 'Tab' || !box) return;
  const items = [...box.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => !el.closest('[hidden]'));
  const to = wrapIndex(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey);
  if (to === null) return;
  e.preventDefault();
  items[to].focus();
}
