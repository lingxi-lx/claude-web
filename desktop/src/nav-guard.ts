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

/**
 * A renderer that keeps dying is not reloaded for ever: `limit` crashes inside `windowMs` → stop on a notice page.
 * Stopping is final: the notice page needs a renderer too, and one that dies on every start would otherwise load it
 * again and again — so every later crash is 'ignore' until `reset()` (the app page loaded again).
 */
export class CrashGuard {
  private hits: number[] = [];
  private done = false;
  constructor(private limit = 3, private windowMs = 60_000) {}
  get stopped(): boolean { return this.done; }
  hit(now = Date.now()): 'reload' | 'stop' | 'ignore' {
    if (this.done) return 'ignore';
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    this.hits.push(now);
    if (this.hits.length < this.limit) return 'reload';
    this.done = true;
    return 'stop';
  }
  reset(): void {
    this.done = false;
    this.hits = [];
  }
}
