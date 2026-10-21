/**
 * What the Gemini component insists on (its accountAdd refuses a cookie without SAPISID and names these six): checked
 * here first so a short copy is explained before anything is sent. desktop/src/gemini-login.ts keeps the same list.
 */
export const REQUIRED_COOKIES = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID'] as const;
/** Not refused without it, but the login it carries does not last: worth a warning. */
export const SESSION_COOKIE = '__Secure-1PSIDTS';
/** These live on .google.com, not gemini.google.com: missing them means only the gemini row was copied. */
const PARENT_DOMAIN = new Set(['SID', 'HSID', 'SSID', 'APISID', 'SAPISID']);

/** `accept: …`, and HTTP/2's `:authority: …` — cookie names have no colon, so a cookie line never matches */
const HEADER_LINE = /^:?[A-Za-z0-9-]+\s*:/;

function pairs(cookie: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (!m.has(k)) m.set(k, part.slice(i + 1).trim());
  }
  return m;
}

/**
 * Whatever was pasted → one cookie string per account: `k=v; k=v` lines (one account each), a whole Request Headers
 * block (only its `cookie:` line counts), or a cookie-export JSON array (`[{name, value}]`, one account).
 */
export function parseGeminiInput(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j)) {
        const s = j.filter((x) => x && typeof x.name === 'string').map((x) => `${x.name}=${x.value ?? ''}`).join('; ');
        return s ? [s] : [];
      }
      if (typeof j?.cookie === 'string') return [j.cookie.trim()];
    } catch { /* not JSON after all: treat it as text */ }
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isCookieHeader = (l: string) => /^cookie\s*:/i.test(l);
  // a headers block: only the cookie header counts, whatever else came with it (DevTools can put each value on the
  // line under its name, so a bare value there is no account of its own)
  if (lines.some(isCookieHeader)) {
    const out: string[] = [];
    lines.forEach((l, i) => {
      if (!isCookieHeader(l)) return;
      const v = l.replace(/^cookie\s*:\s*/i, '').trim() || (lines[i + 1] ?? '');
      if (v && !HEADER_LINE.test(v)) out.push(v);
    });
    return out;
  }
  return lines.filter((l) => !HEADER_LINE.test(l));
}

export interface CookieCheck {
  /** required names that are absent or empty */
  missing: string[];
  /** the .google.com ones are gone: the copy came from the gemini.google.com row alone */
  onlyGeminiRow: boolean;
  /** has everything required but not the short-lived session cookie */
  noSession: boolean;
}

export function checkGeminiCookie(cookie: string): CookieCheck {
  const m = pairs(cookie);
  const missing = REQUIRED_COOKIES.filter((k) => !m.get(k));
  return {
    missing,
    onlyGeminiRow: [...PARENT_DOMAIN].every((k) => !m.has(k)),
    noSession: missing.length === 0 && !m.get(SESSION_COOKIE),
  };
}
