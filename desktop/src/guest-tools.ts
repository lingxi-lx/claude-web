// The built-in browser panel's tools that need the shell (stage B task 3; web features/browser/BrowserPanel.tsx):
// the keys a page hands back to the panel (find, page zoom), a tab drawn as a phone / tablet / desktop (device
// emulation, touch, a mobile user agent), and downloads into the Downloads folder with a bar that reports them.
// Electron is only a type here: main.ts hands in what it has, the tests stand-ins.
import type { DownloadItem, Session, WebContents } from 'electron';
import path from 'node:path';

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
/** The pages whose debugger we attached for the device (and so detach again). */
const attached = new Set<number>();
export const emulatedUa = (guestId: number): string | undefined => mobileUa.get(guestId);
export function forgetGuest(guestId: number): void { mobileUa.delete(guestId); attached.delete(guestId); }

/**
 * The device's size and touch input (a mouse acts as a finger, `ontouchstart` exists, `(pointer: coarse)`), over the
 * page's DevTools protocol; null: back to the panel's size, the debugger detached again if we attached it.
 */
async function setDevice(guest: WebContents, vp: Vp | null): Promise<void> {
  const d = guest.debugger;
  try {
    if (vp) {
      if (!d.isAttached()) { d.attach('1.3'); attached.add(guest.id); }
      await d.sendCommand('Emulation.setDeviceMetricsOverride', metricsParams(vp));
      await d.sendCommand('Emulation.setTouchEmulationEnabled', vp.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await d.sendCommand('Emulation.setEmitTouchEventsForMouse', vp.touch ? { enabled: true, configuration: 'mobile' } : { enabled: false });
    } else if (d.isAttached()) {
      await d.sendCommand('Emulation.clearDeviceMetricsOverride');
      await d.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
      await d.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: false });
      if (attached.delete(guest.id)) d.detach();
    }
  } catch { /* the page went away, or another debugger holds it */ }
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

export interface DownloadEvent { id: string; name: string; state: 'progress' | 'done' | 'failed' | 'cancelled'; received: number; total: number; path?: string }
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
  constructor(private dir: () => string, private exists: (p: string) => boolean, private throttleMs = 250) {}

  /** Once per browser profile (the user's, the Agent's — whichever a tab uses). */
  watch(session: Session): void {
    if (this.watched.has(session)) return;
    this.watched.add(session);
    session.on('will-download', (_e, item, wc) => this.take(item, (wc as WebContents | undefined)?.hostWebContents as Host | null | undefined));
  }

  owns(p: unknown): boolean { return typeof p === 'string' && this.done.has(p); }

  private take(item: DownloadItem, host: Host | null | undefined): void {
    let file: string;
    // no folder to put it in: Electron's own handling (it asks where), untracked
    try { file = uniqueIn(this.dir(), item.getFilename(), (p) => this.busy.has(p) || this.done.has(p) || this.exists(p)); } catch { return; }
    const id = `dl${++this.seq}`;
    this.busy.add(file);
    item.setSavePath(file);
    const name = path.basename(file);
    const send = (state: DownloadEvent['state'], extra: Partial<DownloadEvent> = {}) => {
      if (host && !host.isDestroyed()) host.send('desktop:guestDownload', { id, name, state, received: item.getReceivedBytes(), total: item.getTotalBytes(), ...extra });
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
