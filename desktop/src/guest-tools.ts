// The built-in browser panel's tools that need the shell (stage B task 3; web features/browser/BrowserPanel.tsx):
// the keys a page hands back to the panel (find, page zoom), a tab drawn as a phone / tablet / desktop (device
// emulation, touch, a mobile user agent), and downloads into the Downloads folder with a bar that reports them.
// Electron is only a type here: main.ts hands in what it has, the tests stand-ins.
import type { DownloadItem, Session, WebContents } from 'electron';
import path from 'node:path';
import { acquire, forgetDebug, holds, release } from './guest-debug';

// ---------- keys ----------

export type GuestKey = 'find' | 'zoomIn' | 'zoomOut' | 'zoomReset';
interface KeyInput { type: string; key: string; code: string; control: boolean; meta: boolean; shift: boolean; alt: boolean }

/**
 * A key pressed in a built-in browser page that belongs to the panel instead: Ctrl/Cmd+F (find in the page) and
 * Ctrl/Cmd + = / - / 0 (that tab's zoom — not the app's: with the focus in a page it is the page that is zoomed, as
 * in a browser; anywhere else the menu's accelerators zoom the app, zoom.ts). null: the page's own key.
 */
export function guestKeyOf(input: KeyInput, mac: boolean): GuestKey | null {
  if (input.type !== 'keyDown' || input.alt) return null;
  if (!(mac ? input.meta && !input.control : input.control && !input.meta)) return null;
  const k = input.key.toLowerCase();
  if ((k === 'f' || input.code === 'KeyF') && !input.shift) return 'find';
  if (k === '=' || k === '+' || input.code === 'Equal' || input.code === 'NumpadAdd') return 'zoomIn';
  if (k === '-' || k === '_' || input.code === 'Minus' || input.code === 'NumpadSubtract') return 'zoomOut';
  if ((k === '0' || input.code === 'Digit0' || input.code === 'Numpad0') && !input.shift) return 'zoomReset';
  return null;
}

// ---------- viewport ----------

export interface Vp { w: number; h: number; touch: boolean; mobile: boolean }
const side = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 200 && n <= 4000 ? Math.round(n) : null);

/** What the panel asks for (web features/browser/viewport.ts): a device, null = back to the panel's size, undefined = refused. */
export function cleanVp(v: unknown): Vp | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const w = side(o.w), h = side(o.h);
  if (w === null || h === null) return undefined;
  return { w, h, touch: !!o.touch, mobile: !!o.mobile };
}

/**
 * The device as the DevTools protocol's `Emulation.setDeviceMetricsOverride` takes it (what DevTools' device mode
 * sends). Not `webContents.enableDeviceEmulation`: in a real run (2026-10-24) a page put back to auto with
 * `disableDeviceEmulation` still laid out at 390×844 in one run of two; touch needs the protocol anyway, so both go there.
 */
export function metricsParams(vp: Vp) {
  return { width: vp.w, height: vp.h, deviceScaleFactor: 0, mobile: vp.mobile, screenWidth: vp.w, screenHeight: vp.h, screenOrientation: vp.w > vp.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } };
}

/** A phone's / tablet's user agent on the Chrome the app is built from (`base`: the cleaned one); null for a desktop. */
export function mobileUserAgent(base: string, vp: Vp): string | null {
  if (!vp.mobile) return null;
  const ver = /Chrome\/([\d.]+)/.exec(base)?.[1] ?? '140.0.0.0';
  return vp.w < 600
    ? `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Mobile Safari/537.36`
    : `Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
}

/** The mobile user agent a page being drawn as a phone / tablet goes by (main.ts's user-agent choice asks). */
const mobileUa = new Map<number, string>();
export const emulatedUa = (guestId: number): string | undefined => mobileUa.get(guestId);
export function forgetGuest(guestId: number): void { mobileUa.delete(guestId); forgetDebug(guestId); }

/**
 * The device's size and touch input (a mouse acts as a finger, `ontouchstart` exists, `(pointer: coarse)`), over the
 * page's DevTools protocol — shared with Claude's console / network reading (guest-debug.ts); null: back to the
 * panel's size, the protocol let go (detached when nothing else needs it).
 */
async function setDevice(guest: WebContents, vp: Vp | null): Promise<void> {
  const d = guest.debugger;
  try {
    if (vp) {
      if (acquire(guest, 'viewport')) return; // DevTools holds it: drawn at the size, without the device
      await d.sendCommand('Emulation.setDeviceMetricsOverride', metricsParams(vp));
      await d.sendCommand('Emulation.setTouchEmulationEnabled', vp.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await d.sendCommand('Emulation.setEmitTouchEventsForMouse', vp.touch ? { enabled: true, configuration: 'mobile' } : { enabled: false });
    } else if (holds(guest.id, 'viewport')) {
      try {
        await d.sendCommand('Emulation.clearDeviceMetricsOverride');
        await d.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
        await d.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: false });
      } finally {
        release(guest, 'viewport');
      }
    }
  } catch { /* the page went away */ }
}

/**
 * Draw a page as `vp` (null: as the panel, as before). The user agent follows (`uaFor(url)`, main.ts's choice — Google's
 * sign-in keeps its own), and a page already there is reloaded so the site sees the device from its first request.
 */
export async function emulate(guest: WebContents, vp: Vp | null, o: { base: string; uaFor: (guestId: number, url: string) => string }): Promise<void> {
  if (guest.isDestroyed()) return;
  await setDevice(guest, vp);
  const ua = vp ? mobileUserAgent(o.base, vp) : null;
  if (ua) mobileUa.set(guest.id, ua);
  else mobileUa.delete(guest.id);
  const url = guest.getURL();
  const want = o.uaFor(guest.id, url);
  if (guest.getUserAgent() === want) return;
  guest.setUserAgent(want);
  if (url && url !== 'about:blank') guest.reload();
}

// ---------- a page stuck in a script ----------

/** How long the end of a stuck page's renderer is waited for before it is loaded again anyway. */
export const GONE_WAIT_MS = 3000;
/** After the reload: a page still crashed this long after is loaded once more. */
export const RECHECK_MS = 4000;
type StuckGuest = Pick<WebContents, 'forcefullyCrashRenderer' | 'reload' | 'isDestroyed' | 'isCrashed' | 'getOSProcessId' | 'once' | 'removeListener'>;

/**
 * A page stuck in a script (browser_eval `while (1) {}`) answers nothing, not even a reload: its renderer is ended and
 * the page loaded again. The reload waits for `render-process-gone`: one that arrives before the end is noticed goes
 * to the dying renderer and is lost with it — the page then stays crashed with no new renderer, and every script run
 * in it after never settles (ui-smoke stage B fix wave A5, intermittent on a busy machine). Refused (false) for a page
 * in the asking window's own process (`hostPid`): ending it would end the app's window.
 */
export function endStuckPage(guest: StuckGuest, hostPid: number): boolean {
  if (guest.isDestroyed()) return false;
  const pid = guest.getOSProcessId();
  if (pid > 0 && pid === hostPid) return false;
  const reload = () => { try { if (!guest.isDestroyed()) guest.reload(); } catch { /* closed meanwhile */ } };
  let reloaded = false;
  const onGone = () => {
    if (reloaded) return;
    reloaded = true;
    clearTimeout(wait);
    guest.removeListener('render-process-gone', onGone);
    // after the event's own handlers (the <webview> tag hears of the crash first)
    setTimeout(() => {
      reload();
      setTimeout(() => { try { if (!guest.isDestroyed() && guest.isCrashed()) reload(); } catch { /* closed */ } }, RECHECK_MS);
    }, 0);
  };
  const wait = setTimeout(onGone, GONE_WAIT_MS);
  guest.once('render-process-gone', onGone);
  try { guest.forcefullyCrashRenderer(); } catch { /* already gone */ }
  return true;
}

// ---------- cookies and browsing data (stage B task 4) ----------

/**
 * The built-in browser's profiles (web features/browser/state.ts): the user's, Claude's separate one, and the one
 * 保留 Cookie → 关掉就清 uses — in memory (no `persist:`), gone when the app quits. Cookie import and clearing take
 * only these: never the app's own session (''), never a Gemini sign-in's profile.
 */
export const BROWSER_PARTITIONS = ['persist:cw-browser', 'persist:cw-agent', 'cw-session'] as const;
/** Local pages (file:) open in this in-memory profile, apart from every login (web state.ts LOCAL_PARTITION); guarded at app ready. */
export const LOCAL_PARTITION = 'cw-local';
export const browserPartition = (p: unknown): string | null => (typeof p === 'string' && (BROWSER_PARTITIONS as readonly string[]).includes(p) ? p : null);

export interface CookieDetails { url: string; name: string; value: string; domain?: string; path?: string; secure?: boolean; httpOnly?: boolean; expirationDate?: number }
const MAX_COOKIES = 10_000;

/**
 * A cookie the panel parsed from the user's file (web features/browser/cookies.ts), checked again here: a web
 * address, a name, a value of cookie size; optional fields of another type are dropped. null: not set.
 */
export function cleanCookie(v: unknown): CookieDetails | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.url !== 'string' || !/^https?:\/\/[^/\s]+/i.test(o.url) || o.url.length > 2048) return null;
  if (typeof o.name !== 'string' || !o.name || o.name.length > 256 || typeof o.value !== 'string' || o.value.length > 4096) return null;
  const c: CookieDetails = { url: o.url, name: o.name, value: o.value };
  if (typeof o.domain === 'string' && o.domain.length <= 255) c.domain = o.domain;
  if (typeof o.path === 'string' && o.path.length <= 1024) c.path = o.path;
  if (typeof o.secure === 'boolean') c.secure = o.secure;
  if (typeof o.httpOnly === 'boolean') c.httpOnly = o.httpOnly;
  if (typeof o.expirationDate === 'number' && Number.isFinite(o.expirationDate) && o.expirationDate > 0) c.expirationDate = o.expirationDate;
  return c;
}

/** 导入 Cookie…: each good cookie set into the profile; `failed` = refused here or by Chromium (values are never logged). */
export async function importCookies(ses: { cookies: { set(d: CookieDetails): Promise<void> } }, list: unknown): Promise<{ set: number; failed: number }> {
  if (!Array.isArray(list)) return { set: 0, failed: 0 };
  let set = 0;
  let failed = Math.max(0, list.length - MAX_COOKIES);
  for (const it of list.slice(0, MAX_COOKIES)) {
    const c = cleanCookie(it);
    if (!c) { failed++; continue; }
    try { await ses.cookies.set(c); set++; } catch { failed++; }
  }
  return { set, failed };
}

/** 清除浏览数据: everything the profile keeps for sites (cookies, storage, service workers…) and its HTTP cache. */
export async function clearBrowsingData(ses: { clearStorageData(): Promise<void>; clearCache(): Promise<void> }): Promise<void> {
  await Promise.all([ses.clearStorageData(), ses.clearCache()]);
}

// ---------- downloads ----------

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** A web site's name for a file, as a name in the Downloads folder: no folders, nothing Windows refuses. */
export function safeName(name: string): string {
  const last = String(name).split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  let n = last.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
  if (!n || /^\.+$/.test(n)) n = 'download';
  if (RESERVED.test(n)) n = `_${n}`;
  return n.slice(0, 200);
}

/** `dir/name`, or `name (1).ext`, `(2)`… when that is taken. */
export function uniqueIn(dir: string, name: string, taken: (p: string) => boolean): string {
  const clean = safeName(name);
  const ext = path.extname(clean);
  const stem = clean.slice(0, clean.length - ext.length) || clean;
  let p = path.join(dir, clean);
  for (let i = 1; taken(p) && i < 10_000; i++) p = path.join(dir, `${stem} (${i})${ext}`);
  return p;
}

/** `risky`: a program or script (isRisky) — the bar only shows it in its folder. `blocked`: cancelled for coming too fast (DOWNLOAD_BURST). */
export interface DownloadEvent { id: string; name: string; state: 'progress' | 'done' | 'failed' | 'cancelled'; received: number; total: number; path?: string; risky?: true; blocked?: true }

/** What Windows (or macOS / Linux) runs when it is opened: never opened from the downloads bar, only shown in its folder. */
const RISKY_EXT = /\.(exe|com|bat|cmd|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|wsc|sct|hta|lnk|url|msi|msp|mst|msix|msixbundle|appx|appxbundle|appinstaller|xll|scr|pif|cpl|reg|jar|appref-ms|application|gadget|msc|scf|inf|iso|img|vhd|vhdx|chm|website|settingcontent-ms|dmg|pkg|app|command|sh)$/i;
export const isRisky = (name: string): boolean => RISKY_EXT.test(String(name).trim());
/** A page may start at most this many downloads in DOWNLOAD_WINDOW_MS; the rest are cancelled. */
export const DOWNLOAD_BURST = 5;
export const DOWNLOAD_WINDOW_MS = 10_000;
type Host = { isDestroyed(): boolean; send(channel: string, ev: DownloadEvent): void };

/**
 * Every download of a built-in browser page goes into the Downloads folder under a name of its own, and the window
 * hosting that page is told how it goes (`desktop:guestDownload`). What it saved is remembered: 打开 / 在文件夹中显示
 * only ever act on a file one of these downloads produced (`owns`).
 */
export class Downloads {
  private watched = new WeakSet<object>();
  private done = new Set<string>();
  private busy = new Set<string>();
  private seq = 0;
  /** each page's recent download starts (rate limit) */
  private starts = new WeakMap<object, number[]>();
  constructor(private dir: () => string, private exists: (p: string) => boolean, private throttleMs = 250) {}

  /** Once per browser profile (the user's, the Agent's — whichever a tab uses). */
  watch(session: Session): void {
    if (this.watched.has(session)) return;
    this.watched.add(session);
    session.on('will-download', (_e, item, wc) => this.take(item, (wc as WebContents | undefined)?.hostWebContents as Host | null | undefined, wc as object | undefined));
  }

  owns(p: unknown): boolean { return typeof p === 'string' && this.done.has(p); }
  /** 打开: one of these downloads, and not a program or script. */
  openable(p: unknown): boolean { return this.owns(p) && !isRisky(path.basename(p as string)); }

  /** Whether `page` may start one more download now (and counts it). */
  private allow(page: object | undefined, now = Date.now()): boolean {
    if (!page) return true;
    const recent = (this.starts.get(page) ?? []).filter((t) => now - t < DOWNLOAD_WINDOW_MS);
    if (recent.length >= DOWNLOAD_BURST) { this.starts.set(page, recent); return false; }
    recent.push(now);
    this.starts.set(page, recent);
    return true;
  }

  private take(item: DownloadItem, host: Host | null | undefined, page?: object): void {
    if (!this.allow(page)) {
      // a page downloading in a burst: the rest are not saved at all, and the bar says why
      const name = safeName(item.getFilename());
      try { item.cancel(); } catch { /* already gone */ }
      if (host && !host.isDestroyed()) host.send('desktop:guestDownload', { id: `dl${++this.seq}`, name, state: 'cancelled', received: 0, total: 0, blocked: true });
      return;
    }
    let file: string;
    // no folder to put it in: Electron's own handling (it asks where), untracked
    try { file = uniqueIn(this.dir(), item.getFilename(), (p) => this.busy.has(p) || this.done.has(p) || this.exists(p)); } catch { return; }
    const id = `dl${++this.seq}`;
    this.busy.add(file);
    item.setSavePath(file);
    const name = path.basename(file);
    const risky = isRisky(name) ? { risky: true as const } : {};
    const send = (state: DownloadEvent['state'], extra: Partial<DownloadEvent> = {}) => {
      if (host && !host.isDestroyed()) host.send('desktop:guestDownload', { id, name, state, received: item.getReceivedBytes(), total: item.getTotalBytes(), ...risky, ...extra });
    };
    let last = 0;
    send('progress');
    item.on('updated', () => {
      const now = Date.now();
      if (now - last < this.throttleMs) return;
      last = now;
      send('progress');
    });
    item.once('done', (_e, state) => {
      this.busy.delete(file);
      if (state === 'completed') { this.done.add(file); send('done', { path: file }); }
      else send(state === 'cancelled' ? 'cancelled' : 'failed');
    });
  }
}
