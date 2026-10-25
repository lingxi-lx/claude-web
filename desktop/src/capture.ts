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
  keep?: (shown: DesktopCapturerSource[]) => void,
): Promise<CaptureSource[]> {
  const own = new Set(windows.getAllWindows().map((w) => w.getMediaSourceId()));
  const all = await capturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  const shown = all.filter((s) => !own.has(s.id));
  keep?.(shown);
  return shown.map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen:') ? 'screen' as const : 'window' as const, thumb: s.thumbnail.toDataURL() }));
}

/**
 * The sources each window was shown in our picker (fix E-I4): the getDisplayMedia that follows a pick is answered
 * from here — enumerating again (with thumbnails) while a capture starts is where desktopCapturer crashes.
 */
export class SourceCache<S extends { id: string }> {
  private m = new Map<number, Map<string, S>>();
  set(winId: number, sources: readonly S[]): void { this.m.set(winId, new Map(sources.map((s) => [s.id, s]))); }
  has(winId: number, id: string): boolean { return !!this.m.get(winId)?.has(id); }
  get(winId: number, id: string): S | undefined { return this.m.get(winId)?.get(id); }
  drop(winId: number): void { this.m.delete(winId); }
}

/** Runs the jobs given to it one after another (one desktopCapturer enumeration at a time). */
export function oneAtATime() {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const r = chain.then(job, job);
    chain = r.catch(() => undefined);
    return r;
  };
}

/**
 * What a getDisplayMedia gets: the pick its window made a moment ago, asked by that window's top frame (fix E-I5: an
 * iframe in it cannot take the pick, which stays for the top frame), from what that window was listed; else nothing.
 */
export function displayMediaGrant<S extends { id: string }, F>(o: {
  senderId: number | undefined; fromMainFrame: boolean; picks: PendingPicks; sources: SourceCache<S>; guestFrame: (webContentsId: number) => F | undefined;
}): { video: S | F } | Record<string, never> {
  if (o.senderId === undefined || !o.fromMainFrame) return {};
  const p = o.picks.take(o.senderId);
  if (!p) return {};
  if (p.kind === 'guest') { const f = o.guestFrame(p.webContentsId); return f ? { video: f } : {}; }
  const s = o.sources.get(o.senderId, p.id);
  return s ? { video: s } : {};
}
