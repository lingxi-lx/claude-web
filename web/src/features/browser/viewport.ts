// 视口 (stage B task 3): a tab's page drawn at a device's size instead of the panel's — the official desktop's
// responsive / phone / tablet / desktop. The shell makes the page believe it (desktop/src/guest-tools.ts: device
// emulation, touch, a phone's user agent); here the <webview> is given that size and scaled down to fit the panel.
import { tr } from '@/i18n';

export type ViewportId = 'auto' | 'phone' | 'tablet' | 'desktop';
export interface Viewport { w: number; h: number; touch: boolean; mobile: boolean }

/** auto: the page fills the panel, as it always did. */
export const VIEWPORTS: Record<ViewportId, Viewport | null> = {
  auto: null,
  phone: { w: 390, h: 844, touch: true, mobile: true },
  tablet: { w: 820, h: 1180, touch: true, mobile: true },
  desktop: { w: 1440, h: 900, touch: false, mobile: false },
};
export const VIEWPORT_IDS: ViewportId[] = ['auto', 'phone', 'tablet', 'desktop'];

/** The device a tab's choice stands for; null = auto (no choice, or one this build does not know). */
export const viewportOf = (id: ViewportId | undefined): Viewport | null => (id && Object.hasOwn(VIEWPORTS, id) ? VIEWPORTS[id] : null);

/** What the menu calls it (a function: no tr() at module level — see the i18n note). */
export function viewportLabel(id: ViewportId): string {
  const vp = VIEWPORTS[id];
  const name = id === 'phone' ? tr('手机') : id === 'tablet' ? tr('平板') : id === 'desktop' ? tr('桌面') : tr('自适应');
  return vp ? `${name} · ${vp.w}×${vp.h}` : name;
}

/** How much a device's page is scaled to fit the panel's box: 1 when it fits (never enlarged), else the short side's ratio. */
export function fitScale(box: { w: number; h: number }, vp: { w: number; h: number }): number {
  if (!(box.w > 0 && box.h > 0 && vp.w > 0 && vp.h > 0)) return 1;
  return Math.min(1, box.w / vp.w, box.h / vp.h);
}
