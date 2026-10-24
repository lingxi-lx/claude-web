/**
 * The main window never leaves the app page (spec 2026-10-24 A1): a relative link in a reply resolved against the app's
 * own address used to pass the old origin check and load a page that is not there — the window went blank (mac, twice).
 * Links are opened by the page itself (web/src/features/chat/link-route.ts); here only the app page may load.
 */
export function sameOrigin(a: string, b: string | undefined): boolean {
  if (!b) return false;
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

export function allowNavigation(target: string, appUrl: string | undefined): boolean {
  if (!appUrl || !sameOrigin(target, appUrl)) return false;
  const p = new URL(target).pathname;
  return p === '/' || p === '/index.html';
}

/** A renderer that keeps dying is not reloaded for ever: `limit` crashes inside `windowMs` → stop on a notice page. */
export class CrashGuard {
  private hits: number[] = [];
  constructor(private limit = 3, private windowMs = 60_000) {}
  hit(now = Date.now()): 'reload' | 'stop' {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    this.hits.push(now);
    return this.hits.length >= this.limit ? 'stop' : 'reload';
  }
}
