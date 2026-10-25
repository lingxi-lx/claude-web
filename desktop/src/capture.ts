// 录屏 (spec E3): what a window may record. The page picks a source in our own picker (desktop:capture:choose); the
// main process remembers that pick for 10 s, and the next getDisplayMedia of that window gets exactly it — any other
// getDisplayMedia (no pick, a pick of another window, an old one) is refused.
import type { BrowserWindow as BW, DesktopCapturerSource } from 'electron';

export type CapturePick = { kind: 'source'; id: string } | { kind: 'guest'; webContentsId: number };

export class PendingPicks {
  private m = new Map<number, { p: CapturePick; at: number }>();
  constructor(private ttlMs = 10_000) {}
  set(senderId: number, p: CapturePick, now = Date.now()): void { this.m.set(senderId, { p, at: now }); }
  /** the window's pick, once; past 10 s it is gone */
  take(senderId: number, now = Date.now()): CapturePick | undefined {
    const hit = this.m.get(senderId);
    this.m.delete(senderId);
    if (!hit || now - hit.at > this.ttlMs) return undefined;
    return hit.p;
  }
}

export type CaptureSource = { id: string; name: string; kind: 'screen' | 'window'; thumb: string };

/** Screens and windows, without this app's own windows (recording ourselves records the picker). */
export async function listSources(
  capturer: { getSources(o: { types: ('screen' | 'window')[]; thumbnailSize: { width: number; height: number } }): Promise<DesktopCapturerSource[]> },
  windows: typeof BW,
): Promise<CaptureSource[]> {
  const own = new Set(windows.getAllWindows().map((w) => w.getMediaSourceId()));
  const all = await capturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  return all
    .filter((s) => !own.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen:') ? 'screen' as const : 'window' as const, thumb: s.thumbnail.toDataURL() }));
}
