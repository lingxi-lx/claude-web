import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { BrowserOp, PermissionMode, PermissionRequestEvent, PermissionResponse } from '../protocol.js';

/**
 * 允许的网站 (stage B, Task 7): before an Agent changes something on a page of the built-in browser — clicks, types,
 * presses keys, scrolls, hovers, drags, picks from a list, or runs a script — the user is asked once per site, on a
 * card of the conversation ("允许一次 / 总是允许这个网站 / 拒绝"). 总是允许 puts the host name in
 * `web.browser.allowedSites`, after which that site is not asked about again. A script (`browser_eval`) is asked about
 * every time, allowed site or not, with its first 400 characters on the card. An ego lite script (`ego_browser`) is a
 * script too: asked every time, its whole text on the card (EGO_SCRIPT_TOOL below).
 *
 * Like 操控电脑 (computer/access.ts) the card is raised by this server, not by the agent's own permission prompt.
 * A conversation in 「完全放开」 (bypassPermissions) is asked nothing — not about sites, not about scripts — and the
 * action runs (the user's decision, 2026-10-26, spec 14.4: full access means no server-raised card at all). Every
 * other mode is asked as above.
 *
 * Reading (open / read / find / snapshot / screenshot / console / network / tabs, wait, back, viewport) is never asked.
 */

export const ALLOWED_SITES_KEY = 'web.browser.allowedSites';
/** The permission card's tool name (web/src/features/chat/permission-dock.ts knows it): not a tool any agent has. */
export const SITE_TOOL = 'browser.site';
/** How long a card waits for the user (shorter than the MCP process's own call timeout: mcp.ts ASK_CALL_TIMEOUT_MS). */
export const SITE_ASK_TIMEOUT_MS = 4 * 60_000;
/** What of a script the card shows. */
export const SCRIPT_PREVIEW_CHARS = 400;

/** Ops that change the page: asked about on a new site. */
export const MUTATING_OPS: ReadonlySet<BrowserOp> = new Set<BrowserOp>(['click', 'type', 'key', 'scroll', 'computer', 'hover', 'drag', 'select', 'eval']);

/** A host as compared: lower case, no trailing dot, no port, no IPv6 brackets. '' when there is none. */
export function normHost(h: string | undefined | null): string {
  let s = String(h ?? '').trim().toLowerCase();
  if (!s) return '';
  // a whole address pasted in: its host
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) { try { s = new URL(s).hostname; } catch { return ''; } }
  if (s.startsWith('[')) { const end = s.indexOf(']'); s = end > 0 ? s.slice(1, end) : s.slice(1); }
  else if (!net.isIPv6(s)) s = s.replace(/:\d*$/, '');
  return s.replace(/\.+$/, '');
}

/** The host of a page's address ('' for one without: about:blank, data:, file:); a blob: page is its origin's. */
export function hostOfUrl(url: string | undefined): string {
  try {
    const u = new URL(String(url ?? ''));
    return u.protocol === 'blob:' ? hostOfUrl(u.pathname) : normHost(u.hostname);
  } catch { return ''; }
}

/**
 * Whether `host` is on the list. An entry is a host name (`example.com`: that host only) or `*.example.com` (the host
 * and every subdomain of it). Ports do not count (a site is its host name). An IP address matches only itself.
 */
export function siteAllowed(host: string, list: readonly unknown[]): boolean {
  const h = normHost(host);
  if (!h || !Array.isArray(list)) return false;
  const ip = net.isIP(h) !== 0;
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().toLowerCase();
    if (t.startsWith('*.')) {
      const base = normHost(t.slice(2));
      if (!base || ip || net.isIP(base)) continue;
      if (h === base || h.endsWith(`.${base}`)) return true;
    } else if (normHost(t) === h) return true;
  }
  return false;
}

/** The list as stored (strings only). */
export function allowedSitesOf(settings: Record<string, unknown>): string[] {
  const v = settings[ALLOWED_SITES_KEY];
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()) : [];
}

/**
 * Must the user be asked before `op` on a page of `host`? Never in 「完全放开」 (bypassPermissions). Otherwise
 * `eval`: every time (a script, whatever the site); `site`: a page-changing op on a site not on the list; `no`.
 */
export function needsAsk(op: BrowserOp, host: string | undefined, o: { list: readonly unknown[]; mode?: PermissionMode }): 'no' | 'site' | 'eval' {
  if (o.mode === 'bypassPermissions') return 'no';
  if (op === 'eval') return 'eval';
  if (!MUTATING_OPS.has(op)) return 'no';
  if (host && siteAllowed(host, o.list)) return 'no';
  return 'site';
}

/**
 * ego lite (ego.ts) goes through this gate too, as a script (`op: 'eval'`, `tool: 'ego_browser'`): asked every time
 * except in 完全放开, by every agent alike, 允许一次 / 拒绝 only, the whole script on the card, titled with the first
 * site the script names (spec 14.1). The card (web permission-dock.ts) knows it by this tool name.
 */
export const EGO_SCRIPT_TOOL = 'ego_browser';

/** The host of the first http(s) address in a script ('' when it names none) — what an ego lite card is titled with. */
export function scriptHost(script: string): string {
  return hostOfUrl(/https?:\/\/[^\s'"`)]+/.exec(String(script ?? ''))?.[0]);
}

/** What the card shows. */
export interface SiteRequest { host: string; op: BrowserOp; tool: string; eval?: boolean; script?: string }
export type SiteAnswer = 'once' | 'always' | 'deny';

interface Waiting { event: PermissionRequestEvent; resolve: (a: SiteAnswer) => void; timer: NodeJS.Timeout }

export interface SiteAskDeps {
  /** is this conversation open in this server? (one that is not cannot be asked: no) */
  knows?: (sessionId: string) => boolean;
  timeoutMs?: number;
}

/** The card's answer → once / always / deny. 总是允许 is `allow` with `updatedInput.allow = 'always'` (never for a script). */
export function siteAnswerOf(r: PermissionResponse, isEval: boolean): SiteAnswer {
  if (r.behavior !== 'allow') return 'deny';
  return !isEval && r.updatedInput?.allow === 'always' ? 'always' : 'once';
}

/** The cards a conversation's browser tools raise, and the answers (the same channel as computer/access.ts). */
export class SiteAsk extends EventEmitter {
  private waiting = new Map<string, Waiting>();

  constructor(private d: SiteAskDeps = {}) {
    super();
  }

  ask(sessionId: string, req: SiteRequest, signal?: AbortSignal): Promise<SiteAnswer> {
    if (!sessionId || (this.d.knows && !this.d.knows(sessionId))) return Promise.resolve('deny');
    if (signal?.aborted) return Promise.resolve('deny');
    const requestId = randomUUID();
    const input: Record<string, unknown> = { host: req.host, op: req.op, tool: req.tool };
    if (req.eval) {
      const script = String(req.script ?? '');
      // an ego lite script runs with the user's sign-ins: the card shows every line of it (at most EGO_MAX_SCRIPT_CHARS)
      input.eval = true; input.script = req.tool === EGO_SCRIPT_TOOL ? script : script.slice(0, SCRIPT_PREVIEW_CHARS); input.scriptLength = script.length;
    }
    const event: PermissionRequestEvent = { requestId, sessionId, toolName: SITE_TOOL, input };
    return new Promise<SiteAnswer>((resolve) => {
      const done = (a: SiteAnswer) => {
        const w = this.waiting.get(requestId);
        if (!w) return;
        this.waiting.delete(requestId);
        clearTimeout(w.timer);
        resolve(a);
        this.emit('permissionResolved', requestId, sessionId);
      };
      const timer = setTimeout(() => done('deny'), this.d.timeoutMs ?? SITE_ASK_TIMEOUT_MS);
      timer.unref?.();
      this.waiting.set(requestId, { event, resolve: done, timer });
      signal?.addEventListener('abort', () => done('deny'), { once: true });
      this.emit('permission', event);
    });
  }

  pendingFor(sessionId: string): PermissionRequestEvent[] {
    return [...this.waiting.values()].filter((w) => w.event.sessionId === sessionId).map((w) => w.event);
  }

  /** A window's answer. False: not one of ours (or answered already). */
  respond(requestId: string, r: PermissionResponse): boolean {
    const w = this.waiting.get(requestId);
    if (!w) return false;
    w.resolve(siteAnswerOf(r, w.event.input.eval === true));
    return true;
  }

  /** The conversation is gone: what it asked is withdrawn. */
  drop(sessionId: string): void {
    for (const w of [...this.waiting.values()]) if (w.event.sessionId === sessionId) w.resolve('deny');
  }
}
