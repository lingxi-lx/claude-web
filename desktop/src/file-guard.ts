// What a page on this machine (`file:///…`) may load in the built-in browser (stage B task 2, review fix). A page Claude
// wrote opens there by itself when its turn ends (web features/browser/auto-open.ts). Electron's file:// pages keep
// Chromium's extra file privileges (the GrantFileProtocolExtraPrivileges fuse is on by default): such a page could
// fetch() any other file — ~/.claude/.credentials.json, ~/.ssh — and send it anywhere, and merely Edit-ing a cloned
// repository's index.html would run its scripts with that, no click. So in the built-in browser's profiles a file:
// request is only ever the top frame of a tab the app itself opened on that very file, and the page cannot take its
// tab to another file. What the page asks for from file: is refused — fetch / XMLHttpRequest, frames, objects — but
// its own scripts, styles, pictures, fonts and media inside its folder tree (stage B fix wave U6, `assetAllowed`):
// Claude's index.html + style.css + app.js shows as written, and still no script can read a file's contents.
//
// Workers (stage B task 9, found by the real-Electron check): a blob: dedicated Worker or a SharedWorker started by
// such a page fetched — and read with a synchronous XMLHttpRequest — any file, and those requests never reach
// `webRequest` at all. So the guard also serves the file: scheme itself in these profiles (`protocol.handle`): only
// the top-frame load `webRequest` has just let through is served, with a Content-Security-Policy that lets the page
// start no worker, frame or plugin; whatever else reaches the handler is refused.
import { net, type Session } from 'electron';

/** How long an address the app is about to open stays allowed before its tab asks for it. */
export const ALLOW_TTL_MS = 15_000;
/** How long a top-frame load `webRequest` let through waits for the file: handler to serve it. */
export const SERVE_TTL_MS = 10_000;
/** What a file: page served by the guard may not do: start a worker (dedicated / shared / service), a frame, a plugin. */
export const FILE_PAGE_CSP = "worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'";

/** One key per file address (`file:///C:/a%20b/x.html`, the `#…` cut off); null for anything that is not `file:///…`. */
export function fileKey(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'file:' || u.host !== '' || !/^\/[^/\\]/.test(u.pathname)) return null;
  u.hash = '';
  return u.href;
}

export interface FileRequest { url: string; resourceType: string; webContentsId?: number }

/**
 * The decision: anything not file: is not this guard's business; a file: request loads only as a tab's top frame,
 * and only an address in `allow`.
 */
export function fileRequestAllowed(req: FileRequest, allow: ReadonlySet<string>): boolean {
  if (!/^file:/i.test(req.url)) return true;
  if (req.resourceType !== 'mainFrame') return false;
  const key = fileKey(req.url);
  return !!key && allow.has(key);
}

/** What a granted page may load from its own folder (U6): never xhr / fetch (they read contents), frames, objects, workers. */
const ASSET_TYPES = new Set(['script', 'stylesheet', 'image', 'font', 'media']);

/**
 * A local page's own style, script, picture, font or media (stage B fix wave U6): a file inside the folder tree of the
 * page its tab was granted (`granted`, a fileKey), never the page itself, never across an encoded separator, never
 * for a page at a drive's root (its tree is the whole drive). Scripts still cannot read any file's contents (fetch /
 * xhr stay refused, FILE_PAGE_CSP starts no worker); a picture or script elsewhere stays out.
 */
export function assetAllowed(req: FileRequest, granted: string | undefined): boolean {
  if (!granted || !ASSET_TYPES.has(req.resourceType)) return false;
  if (/%2f|%5c|\\/i.test(req.url.replace(/^file:\/\/\//i, ''))) return false;
  const key = fileKey(req.url);
  if (!key || key === granted) return false;
  const dir = granted.slice(0, granted.lastIndexOf('/') + 1);
  // file:///C:/ or file:/// — a root has no folder of its own
  if (/^file:\/\/\/([A-Za-z]:\/)?$/i.test(dir)) return false;
  const path = key.split(/[?#]/)[0];
  return path.startsWith(dir) && path.length > dir.length;
}

/**
 * The addresses the app has said it is about to open (`allowOnce`, from its own page over IPC), each taken by the
 * first tab that loads it; from then on that tab may load that one file again (reload, back / forward), nothing else.
 */
export class FileGuard {
  private pending = new Map<string, number>();
  private granted = new Map<number, string>();
  /** top-frame loads `allowed` let through, until the file: handler serves them (`takeServe`) */
  private passed = new Map<string, number>();

  allowOnce(url: unknown, now = Date.now()): boolean {
    const key = typeof url === 'string' ? fileKey(url) : null;
    if (!key) return false;
    for (const [k, at] of this.pending) if (at <= now) this.pending.delete(k);
    this.pending.set(key, now + ALLOW_TTL_MS);
    return true;
  }

  allowed(req: FileRequest, now = Date.now()): boolean {
    const key = fileKey(req.url);
    const mine = req.webContentsId !== undefined ? this.granted.get(req.webContentsId) : undefined;
    const fresh = key !== null && (this.pending.get(key) ?? 0) > now;
    const allow = new Set<string>();
    if (mine) allow.add(mine);
    if (fresh) allow.add(key);
    // the granted page's own styles / scripts / pictures (assetAllowed); everything else as a top frame only
    if (req.resourceType !== 'mainFrame') {
      const ok = /^file:/i.test(req.url) ? assetAllowed(req, mine) : true;
      if (ok && key) this.pass(key, now);
      return ok;
    }
    const ok = fileRequestAllowed(req, allow);
    if (ok && key && fresh && key !== mine) {
      this.pending.delete(key);
      if (req.webContentsId !== undefined) this.granted.set(req.webContentsId, key);
    }
    if (ok && key) this.pass(key, now);
    return ok;
  }

  private pass(key: string, now: number): void {
    for (const [k, at] of this.passed) if (at <= now) this.passed.delete(k);
    this.passed.set(key, now + SERVE_TTL_MS);
  }

  /**
   * The file: handler asks whether to serve `url`: only a top-frame load `allowed` has just let through, once. A
   * request `webRequest` never saw (a worker's) is refused.
   */
  takeServe(url: string, now = Date.now()): boolean {
    const key = fileKey(url);
    if (!key) return false;
    const at = this.passed.get(key);
    if (at === undefined) return false;
    this.passed.delete(key);
    return at > now;
  }

  /** A tab's page is gone. */
  forget(webContentsId: number): void {
    this.granted.delete(webContentsId);
  }
}

const guarded = new WeakSet<Session>();

/**
 * Puts the guard on a browser profile (once per session). Only file: requests are looked at — the filter keeps every
 * web request off this path. `session.webRequest` holds one onBeforeRequest listener per session: nothing else of
 * ours sets one on the built-in browser's profiles.
 */
export function guardSession(ses: Session, guard: FileGuard): void {
  if (guarded.has(ses)) return;
  guarded.add(ses);
  ses.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (d, cb) => {
    cb({ cancel: !guard.allowed({ url: d.url, resourceType: d.resourceType, webContentsId: d.webContentsId }) });
  });
  ses.protocol.handle('file', (req) => serveFile(req.url, guard));
}

/** The guard's file: handler: the page `webRequest` let through, read from disk, with FILE_PAGE_CSP; anything else 403. */
export async function serveFile(url: string, guard: Pick<FileGuard, 'takeServe'>, read: (url: string) => Promise<Response> = (u) => net.fetch(u, { bypassCustomProtocolHandlers: true })): Promise<Response> {
  if (!guard.takeServe(url)) return new Response(null, { status: 403 });
  let r: Response;
  try { r = await read(url); } catch { return new Response(null, { status: 404 }); }
  const headers = new Headers(r.headers);
  headers.set('Content-Security-Policy', FILE_PAGE_CSP);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
}
