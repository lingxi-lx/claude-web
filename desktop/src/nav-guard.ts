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
 * What a `window.open` / middle click / target=_blank from the app page gets: the app page itself (a new app window
 * from the browser path of features/workbench/windows.ts) → a window; another web page → the system browser; anything
 * else, including other addresses on the app's own origin (`/C:/Users/a/x.html`: a path link resolved against the
 * app), → nothing (2026-10-24 review I2: same origin used to be enough and opened a stray blank window). The app page
 * with a `#hash` is an in-page anchor (a middle click on `#fn-1` in a reply), not a new window — the app never opens
 * its own windows with one (stage B: it opened a second app window).
 */
export function windowOpenAction(target: string, appUrl: string | undefined): 'app-window' | 'external' | 'deny' {
  if (allowNavigation(target, appUrl)) return new URL(target).hash ? 'deny' : 'app-window';
  if (sameOrigin(target, appUrl)) return 'deny';
  return /^https?:/i.test(target) ? 'external' : 'deny';
}

/**
 * What the page may hand the OS through `desktop:openExternal` (stage B): a web page, a mail address, a phone number.
 * Anything else — `file:`, `smb:` (a network share: Windows hands it the user's credentials), `ms-settings:`, an app's
 * own protocol — is the renderer (and what it shows: a reply, a web page) launching things on the computer.
 */
export function externalAllowed(url: string): boolean {
  if (typeof url !== 'string') return false;
  try { return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(url).protocol); } catch { return false; }
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
