// What a page on this machine (`file:///…`) may load in the built-in browser (stage B task 2, review fix). A page Claude
// wrote opens there by itself when its turn ends (web features/browser/auto-open.ts). Electron's file:// pages keep
// Chromium's extra file privileges (the GrantFileProtocolExtraPrivileges fuse is on by default): such a page could
// fetch() any other file — ~/.claude/.credentials.json, ~/.ssh — and send it anywhere, and merely Edit-ing a cloned
// repository's index.html would run its scripts with that, no click. So in the built-in browser's profiles a file:
// request is only ever the top frame of a tab the app itself opened on that very file: nothing the page asks for
// from file: (fetch, script, picture, style, frame) loads, and the page cannot take its tab to another file.
// A page's own pictures and styles next to it do not load either — the app's doc preview shows those.
import type { Session } from 'electron';

/** How long an address the app is about to open stays allowed before its tab asks for it. */
export const ALLOW_TTL_MS = 15_000;

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

/**
 * The addresses the app has said it is about to open (`allowOnce`, from its own page over IPC), each taken by the
 * first tab that loads it; from then on that tab may load that one file again (reload, back / forward), nothing else.
 */
export class FileGuard {
  private pending = new Map<string, number>();
  private granted = new Map<number, string>();

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
    const ok = fileRequestAllowed(req, allow);
    if (ok && key && fresh && key !== mine) {
      this.pending.delete(key);
      if (req.webContentsId !== undefined) this.granted.set(req.webContentsId, key);
    }
    return ok;
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
}
