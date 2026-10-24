// 导入 Cookie… (stage B task 4): a file the user exported from another browser — a Netscape cookies.txt (curl, the
// "Get cookies.txt" extensions, yt-dlp) or the JSON of Cookie-Editor / EditThisCookie / Playwright / Puppeteer — read
// into one shape that the desktop shell sets into a built-in browser profile (desktop/src/guest-tools.ts
// `importCookies`, which checks each again). Parsed here in the page and handed straight to the shell: cookie values
// are never logged and never go to the server. Nothing is read from another browser's own files.

/** One cookie as Electron's `cookies.set` takes it (`domain` absent: that host only; `expirationDate` absent: a session cookie). */
export interface ImportedCookie {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  /** seconds since 1970 */
  expirationDate?: number;
}

/** A cookie's domain: a host name (a leading dot = its subdomains too), nothing that could make another URL. */
const DOMAIN = /^\.?[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$/i;
const MAX_VALUE = 4096;

/** Seconds, from whatever an exporter wrote: seconds, milliseconds, a date string; undefined = a session cookie. */
function seconds(v: unknown): number | undefined {
  if (typeof v === 'string' && v.trim()) {
    if (/^-?\d+(\.\d+)?$/.test(v.trim())) return seconds(Number(v));
    const t = Date.parse(v);
    return Number.isFinite(t) ? t / 1000 : undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
  return v > 1e11 ? v / 1000 : v; // a number this big is milliseconds (1e11 s is the year 5138)
}

interface Raw { domain: string; hostOnly: boolean; path: string; secure: boolean; httpOnly: boolean; name: string; value: string; expires?: number }

/** The shape both formats end in, or null for one that cannot be set. */
function finish(r: Raw, nowSec: number): ImportedCookie | null {
  const domain = r.domain.trim();
  if (!r.name || /[\s;=]/.test(r.name) || !DOMAIN.test(domain) || r.value.length > MAX_VALUE) return null;
  if (r.expires !== undefined && r.expires <= nowSec) return null;
  const host = domain.replace(/^\./, '').toLowerCase();
  const path = r.path.startsWith('/') ? r.path : '/';
  const c: ImportedCookie = { url: `${r.secure ? 'https' : 'http'}://${host}${path}`, name: r.name, value: r.value };
  // a __Host- cookie may not have a domain (Chromium refuses it with one)
  if (!r.hostOnly && !r.name.startsWith('__Host-')) c.domain = domain;
  c.path = path;
  c.secure = r.secure;
  c.httpOnly = r.httpOnly;
  if (r.expires !== undefined) c.expirationDate = r.expires;
  return c;
}

function fromNetscape(text: string, nowSec: number): { ok: ImportedCookie[]; bad: number } {
  const ok: ImportedCookie[] = [];
  let bad = 0;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) { httpOnly = true; line = line.slice('#HttpOnly_'.length); } else if (line.startsWith('#')) continue;
    const f = line.split('\t');
    // domain, include subdomains, path, secure, expiry, name, value (some exporters drop an empty value's tab)
    if (f.length < 6) { bad++; continue; }
    const [domain, sub, path, secure, expiry, name] = f;
    const value = f.slice(6).join('\t');
    const bool = (s: string) => s.trim().toUpperCase() === 'TRUE';
    const c = finish({ domain, hostOnly: !bool(sub), path, secure: bool(secure), httpOnly, name, value, expires: seconds(expiry) }, nowSec);
    if (c) ok.push(c); else bad++;
  }
  return { ok, bad };
}

function fromJson(data: unknown, nowSec: number): { ok: ImportedCookie[]; bad: number } {
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { cookies?: unknown }).cookies) ? (data as { cookies: unknown[] }).cookies : null;
  if (!list) return { ok: [], bad: 1 };
  const ok: ImportedCookie[] = [];
  let bad = 0;
  for (const it of list) {
    if (!it || typeof it !== 'object') { bad++; continue; }
    const o = it as Record<string, unknown>;
    const value = typeof o.value === 'string' ? o.value : typeof o.value === 'number' || typeof o.value === 'boolean' ? String(o.value) : null;
    if (typeof o.name !== 'string' || typeof o.domain !== 'string' || value === null) { bad++; continue; }
    const session = o.session === true;
    const c = finish({
      domain: o.domain,
      hostOnly: o.hostOnly === true,
      path: typeof o.path === 'string' ? o.path : '/',
      secure: o.secure === true,
      httpOnly: o.httpOnly === true,
      name: o.name,
      value,
      expires: session ? undefined : seconds(o.expirationDate ?? o.expires ?? o.expiry),
    }, nowSec);
    if (c) ok.push(c); else bad++;
  }
  return { ok, bad };
}

/**
 * A cookies file's text → the cookies in it, and how many entries could not be used (a line that is no cookie, a bad
 * domain, one already expired). Comments and blank lines are not counted. `now` is for the tests.
 */
export function parseCookies(text: string, now = Date.now()): { ok: ImportedCookie[]; bad: number } {
  const t = String(text ?? '').replace(/^\uFEFF/, '');
  const nowSec = now / 1000;
  if (/^\s*[[{]/.test(t)) {
    let data: unknown;
    try { data = JSON.parse(t); } catch { return { ok: [], bad: 1 }; }
    return fromJson(data, nowSec);
  }
  return fromNetscape(t, nowSec);
}
