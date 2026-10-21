/**
 * A Gemini account is added by signing in to Google — in this computer's own Chrome (or Edge), not in a window of
 * ours: Google refuses sign-in from an embedded browser ("This browser or app may not be secure"). Two steps, because
 * Google's risk check also recognizes a Chrome that some automation is driving — an open --remote-debugging-port got
 * the sign-in rejected even in the real Chrome, and a DevTools pipe is the same risk in another coat:
 *
 * 1. Sign in with no debugging channel at all — a plain Chrome window on a profile of its own (one per account, shared
 *    with nothing, so no other browser rotates the login away), opened at Google's sign-in.
 * 2. The user closes that window. A windowless (--headless=new) Chrome then opens the same profile, reads its cookies
 *    through --remote-debugging-pipe and closes — it only ever shows about:blank, never a Google page, so nothing on
 *    Google's side can see a debugging channel.
 *
 * Done when the component's six cookies are all there. Closed before signing in = null.
 */
import { app, session } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { tr } from './i18n.js';

/** What the Gemini component refuses to take a cookie without (web/src/features/gateway/gemini-cookie.ts keeps the same list). */
export const REQUIRED_COOKIES = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID'];
const GEMINI = 'https://gemini.google.com';
const SIGN_IN = `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(`${GEMINI}/app`)}`;
const PARTITION = /^persist:gemini-[a-f0-9]{8,32}$/;
/** A request to Chrome that is never answered (it went away mid-question) must not hang the sign-in. */
const SEND_MS = 10_000;
/** Chrome takes a moment to answer its first pipe request; longer than this and it never started. */
const START_MS = 20_000;
/** Nobody finishes a Google login after this: close the window and answer with nothing. */
const GIVE_UP_MS = 10 * 60_000;

export interface GeminiLogin {
  cookie: string;
  /** where this Google login lives: hand it back to sign in again without typing the password */
  partition: string;
  userAgent: string;
}

interface Cookie { name: string; value: string; domain: string; path?: string }

export const isPartition = (p: unknown): p is string => typeof p === 'string' && PARTITION.test(p);
export const newPartition = (): string => `persist:gemini-${crypto.randomBytes(8).toString('hex')}`;

/** Its own Chrome profile directory (never the user's own profile: that one is in use, and its cookies are theirs). */
export const profileDir = (base: string, partition: string): string =>
  path.join(base, 'gemini-browser', partition.replace(/^persist:/, ''));

/** Chrome first, then Edge; on Linux the commands are looked up on PATH. */
export function browserCandidates(platform: NodeJS.Platform, env: Record<string, string | undefined>): string[] {
  const under = (dir: string | undefined, ...rest: string[]) => (dir ? [path.join(dir, ...rest)] : []);
  if (platform === 'win32') {
    return [
      ...under(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ...under(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ...under(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ...under(env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ...under(env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${env.HOME ?? ''}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
}

function onPath(name: string): boolean {
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of exts) if (dir && fs.existsSync(path.join(dir, name + ext))) return true;
  }
  return false;
}

export function findBrowser(platform: NodeJS.Platform = process.platform, env = process.env as Record<string, string | undefined>): string | null {
  for (const c of browserCandidates(platform, env)) {
    if (c.includes('/') || c.includes('\\') ? fs.existsSync(c) : onPath(c)) return c;
  }
  return null;
}

/** Signed in, as far as the component cares: its six cookies are all there with values. */
export function loginReady(cookies: Cookie[]): boolean {
  const have = new Set(cookies.filter((c) => c.value).map((c) => c.name));
  return REQUIRED_COOKIES.every((n) => have.has(n));
}

/** Every Google cookie a request to gemini.google.com carries, the more specific domain winning a name. */
export function googleCookies(cookies: Cookie[]): string {
  const mine = (c: Cookie) => c.domain.replace(/^\./, '');
  const rank = (c: Cookie) => (mine(c) === 'gemini.google.com' ? 0 : 1);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cookies.filter((c) => ['google.com', 'gemini.google.com'].includes(mine(c))).sort((a, b) => rank(a) - rank(b))) {
    if (!c.value || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(`${c.name}=${c.value}`);
  }
  return out.join('; ');
}

/** Just enough of Chrome's debugging protocol: request / answer over the pipe Chrome hands us on stdio fd 3/4. */
class Cdp {
  private id = 0;
  private waiting = new Map<number, { ok(v: any): void; no(e: Error): void }>();
  closed = false;
  private constructor(private write: (chunk: string) => void, readable: NodeJS.ReadableStream, proc: ChildProcess) {
    let buf = '';
    readable.on('data', (d: Buffer | string) => {
      // Chrome frames pipe messages with a NUL byte, unlike the newline some docs assume
      buf += d.toString('utf8');
      let at: number;
      while ((at = buf.indexOf('\0')) >= 0) {
        const m = JSON.parse(buf.slice(0, at));
        buf = buf.slice(at + 1);
        const w = m.id ? this.waiting.get(m.id) : undefined;
        if (!w) return;
        this.waiting.delete(m.id);
        if (m.error) w.no(new Error(m.error.message ?? 'CDP error'));
        else w.ok(m.result);
      }
    });
    // the browser went away (the window was closed): nothing queued will ever be answered
    const gone = () => {
      this.closed = true;
      for (const w of this.waiting.values()) w.no(new Error('CDP closed'));
      this.waiting.clear();
    };
    readable.on('close', gone);
    readable.on('error', gone);
    // an unhandled EPIPE on the write side would take the whole process down
    const writable = proc.stdio[3];
    if (writable && 'on' in writable) writable.on('error', gone);
  }

  /** The pipe lives on stdio slots 3 (we write) and 4 (Chrome writes) — requested via stdio: [...,'pipe','pipe']. */
  static over(proc: ChildProcess): Cdp | null {
    const stdin = proc.stdio[3];
    const stdout = proc.stdio[4];
    if (!stdin || !stdout || !('write' in stdin) || !('on' in stdout)) return null;
    return new Cdp((chunk) => (stdin as NodeJS.WritableStream).write(chunk), stdout as NodeJS.ReadableStream, proc);
  }

  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error('CDP closed'));
    const id = ++this.id;
    return new Promise<T>((ok, no) => {
      const timer = setTimeout(() => { this.waiting.delete(id); no(new Error('CDP timeout')); }, SEND_MS);
      this.waiting.set(id, {
        ok: (v) => { clearTimeout(timer); ok(v); },
        no: (e) => { clearTimeout(timer); no(e); },
      });
      try { this.write(JSON.stringify({ id, method, params }) + '\0'); } catch (e) {
        this.waiting.delete(id);
        clearTimeout(timer);
        no(e as Error);
      }
    });
  }

  /** A pipe has nothing to close politely: ending our stdin side tells Chrome we are done. */
  close(): void {
    this.closed = true;
    for (const w of this.waiting.values()) w.no(new Error('CDP closed'));
    this.waiting.clear();
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function stop(p: ChildProcess): Promise<void> {
  if (p.exitCode !== null) return;
  await Promise.race([new Promise<void>((r) => p.once('exit', () => r())), delay(3000)]);
  if (p.exitCode === null) { try { p.kill(); } catch { /* already gone */ } }
}

/** Thrown when a sign-in is already open (its result must not go to another account). */
export const BUSY = 'gemini-login-busy';
let running = false;

/**
 * Opens Chrome on the given account's own profile (or a new one), at Google's sign-in; answers with Gemini's cookies
 * once signed in and closes Chrome, or null when the window was closed first.
 */
export async function geminiLogin(ask: unknown, proxyServer?: string): Promise<GeminiLogin | null> {
  if (running) throw new Error(BUSY);
  running = true;
  try { return await signIn(ask, proxyServer); } finally { running = false; }
}

/**
 * Step 1: a plain Chrome window — no debugging channel of any kind — at Google's sign-in. Answers once it is closed
 * (signed in, or not: step 2 finds out), 'timeout' when nobody closed it, 'failed' when it would not start.
 * `proxyServer` is a loopback `host:port` the server tunnels to the chosen residential exit (Chrome cannot carry
 * proxy credentials itself), so the sign-in leaves from the same IP the requests later use.
 */
async function loginWindow(bin: string, dir: string, url: string, proxyServer?: string): Promise<'closed' | 'timeout' | 'failed'> {
  // windowsHide would hide Chrome's own window the first time it is shown: this one has to be seen
  let proc: ChildProcess;
  try {
    proc = spawn(bin, [
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      // Device Bound Session Credentials: Chrome would bind the Google session to this device and only
      // refresh __Secure-1PSIDTS with a signed device token the component cannot produce — its keepalive
      // then fails and the login dies after ~30 minutes (sidecar rotate.go says so outright). Without the
      // binding Google refreshes it the ordinary way.
      '--disable-features=DeviceBoundSessions',
      '--window-size=560,800',
      ...(proxyServer ? [`--proxy-server=http://${proxyServer}`] : []),
      url,
    ], { stdio: 'ignore', windowsHide: false });
  } catch {
    // Windows throws here when the file exists but is not a program (a damaged install)
    return 'failed';
  }
  // most spawn failures are reported later instead; without a listener that error takes the process down
  let spawnError: Error | null = null;
  proc.on('error', (e) => { spawnError = e; });
  const closed = await new Promise<boolean>((ok) => {
    const timer = setTimeout(() => ok(false), GIVE_UP_MS);
    proc.once('exit', () => { clearTimeout(timer); ok(true); });
  });
  if (!closed) { await stop(proc); return 'timeout'; }
  return spawnError ? 'failed' : 'closed';
}

/**
 * Step 2: a windowless Chrome on that profile, DevTools over a stdio pipe, nothing but about:blank open — read the
 * cookies the sign-in left. Null when the profile does not hold a usable login (or Chrome would not start).
 */
async function readCookies(
  bin: string,
  dir: string,
  opts: { url?: string; settleMs?: number } = {},
): Promise<{ cookie: string; userAgent: string } | null> {
  let proc: ChildProcess;
  try {
    proc = spawn(bin, [
      `--user-data-dir=${dir}`,
      '--headless=new',
      '--remote-debugging-pipe',
      '--no-first-run',
      '--no-default-browser-check',
      opts.url ?? 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch {
    return null;
  }
  let spawnError: Error | null = null;
  proc.on('error', (e) => { spawnError = e; });
  const cdp = Cdp.over(proc);
  try {
    if (!cdp) return null;
    const startAt = Date.now() + START_MS;
    let userAgent = '';
    while (Date.now() < startAt && !userAgent) {
      try {
        ({ userAgent } = await cdp.send<{ userAgent: string }>('Browser.getVersion'));
      } catch (e) {
        if ((e as Error).message === 'CDP timeout') continue; // slow start: ask again
        return null; // the pipe died: Chrome never started, or went away
      }
    }
    if (!userAgent || spawnError) return null;
    // headless announces itself in the UA; the component must see the plain Chrome string
    userAgent = userAgent.replace('HeadlessChrome/', 'Chrome/');
    // on a real page let Chrome finish loading it: loading gemini.google.com is what makes Chromium renew
    // __Secure-1PSIDTS by itself (the component cannot — its own rotate is refused)
    if (opts.settleMs) await delay(opts.settleMs);
    const { cookies } = await cdp.send<{ cookies: Cookie[] }>('Storage.getCookies');
    if (!loginReady(cookies)) return null;
    return { cookie: googleCookies(cookies), userAgent };
  } catch {
    return null;
  } finally {
    if (cdp && !cdp.closed) await cdp.send('Browser.close').catch(() => {});
    cdp?.close();
    await stop(proc);
  }
}

/** The cookie each profile gave us last time — a refresh that yields the same bytes has nothing new to offer. */
const lastRefresh = new Map<string, string>();

/**
 * Keep a signed-in profile alive without the user: load gemini.google.com in a windowless Chrome on that profile
 * for a few seconds. Chromium itself renews __Secure-1PSIDTS while it is on the page (the sidecar's own rotate is
 * refused, which is why a session dies after a while), then the renewed cookies are read back. Null when the
 * profile is gone, a sign-in window owns it, or the cookies did not change (nothing to write, or a dead login).
 */
export async function geminiRefresh(partition: unknown): Promise<{ cookie: string; userAgent: string } | null> {
  if (!isPartition(partition)) return null;
  if (running) return null; // a sign-in window owns this profile; two Chromes cannot share it
  const bin = findBrowser();
  if (!bin) return null;
  const dir = profileDir(app.getPath('userData'), partition);
  if (!fs.existsSync(dir)) return null;
  running = true;
  try {
    const got = await readCookies(bin, dir, { url: `${GEMINI}/app`, settleMs: 9000 });
    if (!got) return null;
    if (lastRefresh.get(partition) === got.cookie) return null; // nothing new: leave the component alone
    lastRefresh.set(partition, got.cookie);
    return got;
  } finally {
    running = false;
  }
}

async function signIn(ask: unknown, proxyServer?: string): Promise<GeminiLogin | null> {
  const bin = findBrowser();
  if (!bin) throw new Error(tr('没找到 Chrome 或 Edge，可以改用粘贴 cookie'));
  const partition = isPartition(ask) ? ask : newPartition();
  const dir = profileDir(app.getPath('userData'), partition);
  await fs.promises.mkdir(dir, { recursive: true });

  const end = await loginWindow(bin, dir, isPartition(ask) ? `${GEMINI}/app` : SIGN_IN, proxyServer);
  if (end === 'failed') throw new Error(tr('Chrome 没能启动，可以改用粘贴 cookie'));
  if (end === 'timeout') return null; // nothing was typed in ten minutes

  // Chrome may still be flushing its profile as the window closes: give it a moment, then read (twice at most)
  await delay(400);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await delay(1200);
    const got = await readCookies(bin, dir);
    if (got) return { ...got, partition };
  }
  return null; // the window was closed without finishing the sign-in
}

/** The account was deleted: so is the Chrome profile (and the store an older version kept) its login lived in. */
export async function geminiForget(partition: unknown): Promise<void> {
  if (!isPartition(partition)) return;
  await fs.promises.rm(profileDir(app.getPath('userData'), partition), { recursive: true, force: true }).catch(() => {});
  await session.fromPartition(partition).clearStorageData().catch(() => {});
}
