import { webContents, type NativeImage, type WebContents } from 'electron';
import { jpegSize } from './jpeg-size';

/** Wider than this a picture of a page is scaled down (a 4K page as it is would be tens of megabytes for a model to read). */
export const MAX_WIDTH = 1280;
/** A page that is not being drawn (hidden, the screen asleep) never answers: the wait ends here. */
export const DRAW_MS = 5000;

/**
 * A picture of a page of the built-in browser, for an Agent's browser_screenshot (web/src/features/browser/guest.ts →
 * `desktop.captureGuest`). `id` is the <webview>'s `getWebContentsId()`. Only a page that the asking window itself
 * hosts is drawn; null when there is no such page or nothing could be drawn (in time).
 */
export async function captureGuest(asker: WebContents, id: unknown): Promise<{ mime: 'image/jpeg'; data: string; width?: number; height?: number } | null> {
  const img = await drawGuest(asker, id);
  if (!img) return null;
  const out = img.getSize().width > MAX_WIDTH ? img.resize({ width: MAX_WIDTH, quality: 'good' }) : img;
  const jpeg = out.toJPEG(72);
  // the picture's own size (on a scaled screen it is not the page's): positions an Agent gives are in this frame
  const size = jpegSize(jpeg);
  return { mime: 'image/jpeg', data: jpeg.toString('base64'), ...(size ?? {}) };
}

/** A page of the built-in browser that the asking window itself hosts (`id`: its webContents id), or undefined. */
export function hostedGuest(asker: WebContents, id: unknown): WebContents | undefined {
  const guest = typeof id === 'number' ? webContents.fromId(id) : undefined;
  return guest && !guest.isDestroyed() && guest.hostWebContents === asker ? guest : undefined;
}

/** The page as it is drawn, full size (the panel's 保存截图 saves this; `captureGuest` scales it for a model). */
export async function drawGuest(asker: WebContents, id: unknown): Promise<NativeImage | null> {
  const guest = hostedGuest(asker, id);
  if (!guest) return null;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((r) => { timer = setTimeout(() => r(null), DRAW_MS); });
  const img = await Promise.race([guest.capturePage().catch(() => null), late]).finally(() => clearTimeout(timer));
  return img && !img.isEmpty() ? img : null;
}
