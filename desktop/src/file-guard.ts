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
//
// Real paths (stage B hardening round 2): comparing addresses is not enough — a cloned repository's `assets` may be a
// symlink / Windows junction to anywhere. So the handler serves an asset only if the file's REAL path (fs.realpath) is
// inside the granted page's REAL folder (`assetInside`), and a page whose folder is the home folder or a drive root
// gets no folder tree at all (only the page itself). FILE_PAGE_CSP also says connect-src 'none'.
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { net, type Session } from 'electron';

/** How long an address the app is about to open stays allowed before its tab asks for it. */
export const ALLOW_TTL_MS = 15_000;
/** How long a top-frame load `webRequest` let through waits for the file: handler to serve it. */
export const SERVE_TTL_MS = 10_000;
/** What a file: page served by the guard may not do: start a worker (dedicated / shared / service), a frame, a plugin, connect anywhere (fetch / xhr / WebSocket / EventSource / beacon). */
export const FILE_PAGE_CSP = "worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'";

const WIN = process.platform === 'win32';

/**
 * `child` is inside folder `parent` (both absolute paths): case-insensitive on Windows, and only at a separator —
 * `C:\proj2\x` is not inside `C:\proj`; the folder itself is not "inside" it.
 */
export function pathInside(child: string, parent: string, win = WIN): boolean {
  const p = win ? path.win32 : path.posix;
  let c = p.resolve(child);
  let d = p.resolve(parent);
  if (win) { c = c.toLowerCase(); d = d.toLowerCase(); }
  const prefix = d.endsWith(p.sep) ? d : d + p.sep;
  return c.length > prefix.length && c.startsWith(prefix);
}

/** `dir` is the home folder or a drive / filesystem root: its tree is too much to hand a page (case-insensitive on Windows). */
export function isHomeOrRoot(dir: string, home: string = os.homedir(), win = WIN): boolean {
  const p = win ? path.win32 : path.posix;
  let d = p.resolve(dir);
  let h = p.resolve(home);
  if (p.parse(d).root === d) return true;
  if (win) { d = d.toLowerCase(); h = h.toLowerCase(); }
  return d === h;
}

/** The home folder as a fileKey folder address (`file:///C:/Users/me/`). */
function homeUrl(): string {
  const href = pathToFileURL(os.homedir()).href;
  return href.endsWith('/') ? href : `${href}/`;
}

/** Real folders of granted pages (fs.realpath), cached per folder; a failure is not cached. */
const realFolders = new Map<string, Promise<string>>();
function realFolder(dir: string): Promise<string> {
  let p = realFolders.get(dir);
  if (!p) {
    if (realFolders.size >= 64) realFolders.clear();
    p = fsp.realpath(dir);
    realFolders.set(dir, p);
    p.catch(() => { if (realFolders.get(dir) === p) realFolders.delete(dir); });
  }
  return p;
}

/**
 * The real-path check the file: handler makes for an asset (round 2): `file`'s real path is inside `dir`'s real path,
 * and neither `dir` nor its real path is the home folder or a root. A missing file, or one reached through a link /
 * junction to elsewhere, is not inside.
 */
export async function assetInside(file: string, dir: string, home: string = os.homedir()): Promise<boolean> {
  if (isHomeOrRoot(dir, home)) return false;
  let realDir: string;
  let realFile: string;
  try {
    [realDir, realFile] = await Promise.all([realFolder(dir), fsp.realpath(file)]);
  } catch { return false; }
  if (isHomeOrRoot(realDir, home)) return false;
  try { if (isHomeOrRoot(realDir, await fsp.realpath(home))) return false; } catch { /* no home: nothing to compare */ }
  return pathInside(realFile, realDir);
}

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
export function assetAllowed(req: FileRequest, granted: string | undefined, home: string = homeUrl()): boolean {
  if (!granted || !ASSET_TYPES.has(req.resourceType)) return false;
  if (/%2f|%5c|\\/i.test(req.url.replace(/^file:\/\/\//i, ''))) return false;
  const key = fileKey(req.url);
  if (!key || key === granted) return false;
  const dir = granted.slice(0, granted.lastIndexOf('/') + 1);
  // file:///C:/ or file:/// — a root has no folder of its own
  if (/^file:\/\/\/([A-Za-z]:\/)?$/i.test(dir)) return false;
  // a page right in the home folder: its tree is the whole profile (~/.ssh, ~/.claude) — only the page itself (round 2)
  const homeDir = fileKey(home.endsWith('/') ? home : `${home}/`);
  if (homeDir && (WIN ? dir.toLowerCase() === homeDir.toLowerCase() : dir === homeDir)) return false;
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
  /** loads `allowed` let through (an asset with the granted page it is for), until the file: handler serves them (`served`) */
  private passed = new Map<string, { at: number; root?: string }>();

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
      if (ok && key) this.pass(key, now, mine);
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

  private pass(key: string, now: number, root?: string): void {
    for (const [k, p] of this.passed) if (p.at <= now) this.passed.delete(k);
    this.passed.set(key, root ? { at: now + SERVE_TTL_MS, root } : { at: now + SERVE_TTL_MS });
  }

  /**
   * The file: handler asks whether to serve `url`: only a load `allowed` has just let through, once — `{}` for a top
   * frame, `{ root }` (the granted page) for an asset, whose real path the handler then checks; null otherwise. A
   * request `webRequest` never saw (a worker's) is refused.
   */
  served(url: string, now = Date.now()): { root?: string } | null {
    const key = fileKey(url);
    if (!key) return null;
    const p = this.passed.get(key);
    if (p === undefined) return null;
    this.passed.delete(key);
    if (p.at <= now) return null;
    return p.root ? { root: p.root } : {};
  }

  /** `served` as a yes / no. */
  takeServe(url: string, now = Date.now()): boolean {
    return this.served(url, now) !== null;
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

/**
 * The guard's file: handler: the page `webRequest` let through, or one of its assets whose real path is inside the
 * page's real folder (`assetInside`), read from disk, with FILE_PAGE_CSP; anything else 403.
 */
export async function serveFile(url: string, guard: Pick<FileGuard, 'served'>, read: (url: string) => Promise<Response> = (u) => net.fetch(u, { bypassCustomProtocolHandlers: true })): Promise<Response> {
  const s = guard.served(url);
  if (!s) return new Response(null, { status: 403 });
  if (s.root) {
    let file: string;
    let dir: string;
    try {
      const key = fileKey(url);
      if (!key) return new Response(null, { status: 403 });
      const u = new URL(key);
      u.search = '';
      file = fileURLToPath(u);
      dir = path.dirname(fileURLToPath(s.root));
    } catch { return new Response(null, { status: 403 }); }
    if (!(await assetInside(file, dir))) return new Response(null, { status: 403 });
  }
  let r: Response;
  try { r = await read(url); } catch { return new Response(null, { status: 404 }); }
  const headers = new Headers(r.headers);
  headers.set('Content-Security-Policy', FILE_PAGE_CSP);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
}
