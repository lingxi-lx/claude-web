// A built-in browser page's DevTools protocol, shared (stage B task 6): the viewport presets (guest-tools.ts) and
// Claude's browser_console / browser_network / browser_snapshot all need `guest.debugger`, and a page has ONE. So it
// is attached once, for a set of users, and detached when the last one lets go — the viewport going back to auto
// never takes the console log away, and the log never keeps a device size the user turned off. While Claude reads
// them, the page's console messages and requests are kept (the last 200 of each) until the page goes away.
// Electron is only a type here: main.ts hands in the page, the tests stand-ins.
import type { WebContents } from 'electron';
import { tr } from './i18n';

export type DebugUser = 'viewport' | 'capture' | 'snapshot';
/** How many console messages and requests are kept per page. */
export const RING = 200;

export interface ConsoleEntry { level: string; text: string; at: number; url?: string }
export interface NetEntry { method: string; url: string; status?: number; ms?: number; type?: string; failed?: string }

const TEXT_MAX = 2_000;
const URL_MAX = 2_000;
/** Requests on their way are remembered by id until they end; a page that never ends them cannot grow this past a bound. */
const OPEN_MAX = 500;

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
const push = <T>(ring: T[], v: T) => { ring.push(v); if (ring.length > RING) ring.splice(0, ring.length - RING); };

/** A console argument as the console would print it. */
function argText(a: any): string {
  if (!a || typeof a !== 'object') return String(a);
  if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value) ?? String(a.value);
  if (typeof a.unserializableValue === 'string') return a.unserializableValue;
  if (typeof a.description === 'string') return a.description;
  return String(a.type ?? '');
}

/** The console messages and requests of one page, from the protocol's events. Pure: the tests feed it events. */
export class PageLog {
  console: ConsoleEntry[] = [];
  network: NetEntry[] = [];
  /** How many requests at the front came from the page's resource timing (from before the log started); told once. */
  earlier = 0;
  earlierTold = false;
  private open = new Map<string, { entry: NetEntry; start: number }>();

  onEvent(method: string, p: any, now = Date.now()): void {
    if (!p || typeof p !== 'object') return;
    const when = (t: unknown) => (typeof t === 'number' && t > 1e12 ? t : now);
    switch (method) {
      case 'Runtime.consoleAPICalled': {
        const level = p.type === 'warning' ? 'warning' : p.type === 'assert' ? 'error' : String(p.type ?? 'log');
        const url = p.stackTrace?.callFrames?.[0]?.url;
        if (typeof url === 'string' && url.startsWith('node:electron/')) return; // Electron's own (its security warning when unpackaged), not the page's
        push(this.console, { level, text: cut((Array.isArray(p.args) ? p.args : []).map(argText).join(' '), TEXT_MAX), at: when(p.timestamp), ...(typeof url === 'string' && url ? { url: cut(url, URL_MAX) } : {}) });
        return;
      }
      case 'Runtime.exceptionThrown': {
        const d = p.exceptionDetails ?? {};
        const text = typeof d.exception?.description === 'string' ? d.exception.description : String(d.text ?? 'Uncaught');
        push(this.console, { level: 'error', text: cut(text, TEXT_MAX), at: when(p.timestamp), ...(typeof d.url === 'string' && d.url ? { url: cut(d.url, URL_MAX) } : {}) });
        return;
      }
      case 'Log.entryAdded': {
        const e = p.entry ?? {};
        if (e.source === 'console-api') return; // Runtime.consoleAPICalled has it already
        const level = e.level === 'verbose' ? 'debug' : String(e.level ?? 'info');
        push(this.console, { level, text: cut(String(e.text ?? ''), TEXT_MAX), at: when(e.timestamp), ...(typeof e.url === 'string' && e.url ? { url: cut(e.url, URL_MAX) } : {}) });
        return;
      }
      case 'Network.requestWillBeSent': {
        const id = String(p.requestId ?? '');
        const prev = this.open.get(id);
        if (prev && p.redirectResponse) { // the same id goes on to the redirect's target: the hop ends here
          prev.entry.status = Number(p.redirectResponse.status) || undefined;
          this.finish(id, p.timestamp);
        }
        const entry: NetEntry = { method: String(p.request?.method ?? 'GET'), url: cut(String(p.request?.url ?? ''), URL_MAX), ...(typeof p.type === 'string' ? { type: p.type } : {}) };
        push(this.network, entry);
        if (this.open.size >= OPEN_MAX) this.open.delete(this.open.keys().next().value as string);
        this.open.set(id, { entry, start: typeof p.timestamp === 'number' ? p.timestamp : 0 });
        return;
      }
      case 'Network.responseReceived': {
        const o = this.open.get(String(p.requestId ?? ''));
        if (!o) return;
        if (typeof p.response?.status === 'number') o.entry.status = p.response.status;
        if (typeof p.type === 'string') o.entry.type = p.type;
        return;
      }
      case 'Network.loadingFinished':
        this.finish(String(p.requestId ?? ''), p.timestamp);
        return;
      case 'Network.loadingFailed': {
        const o = this.open.get(String(p.requestId ?? ''));
        if (!o) return;
        o.entry.failed = cut(p.canceled ? 'canceled' : p.blockedReason ? `blocked: ${p.blockedReason}` : String(p.errorText ?? 'failed'), 300);
        this.finish(String(p.requestId ?? ''), p.timestamp);
        return;
      }
    }
  }

  private finish(id: string, ts: unknown): void {
    const o = this.open.get(id);
    if (!o) return;
    this.open.delete(id);
    if (typeof ts === 'number' && o.start > 0 && ts >= o.start) o.entry.ms = Math.round((ts - o.start) * 1000);
  }
}

interface Shared {
  users: Set<DebugUser>;
  /** We attached it (and so detach it). */
  ours: boolean;
  log: PageLog | null;
  off: () => void;
}
const shared = new Map<number, Shared>();

export const NO_DEBUGGER = () => tr('读不了这个页面的调试信息：它开着开发者工具（DevTools），或者被别的调试器占着。关掉开发者工具再试。');

/** `user` needs the page's protocol: attached if nobody had it. An error to show when it cannot be (DevTools open). */
export function acquire(guest: WebContents, user: DebugUser): string | null {
  let s = shared.get(guest.id);
  if (!s) {
    const d = guest.debugger;
    let ours = false;
    if (!d.isAttached()) {
      try { d.attach('1.3'); } catch { return NO_DEBUGGER(); }
      ours = true;
    }
    const entry: Shared = { users: new Set(), ours, log: null, off: () => {} };
    const onMessage = (_e: unknown, method: string, params: unknown) => entry.log?.onEvent(method, params);
    // detached under us (the page crashed, or the protocol was taken away): the next user attaches again
    const onDetach = () => { if (shared.get(guest.id) === entry) { entry.off(); shared.delete(guest.id); } };
    d.on('message', onMessage);
    d.on('detach', onDetach);
    entry.off = () => { d.removeListener('message', onMessage); d.removeListener('detach', onDetach); };
    shared.set(guest.id, entry);
    s = entry;
  }
  s.users.add(user);
  return null;
}

export const holds = (guestId: number, user: DebugUser): boolean => !!shared.get(guestId)?.users.has(user);

/** `user` is done: the protocol is detached when nobody else needs it (only if we were the ones who attached it). */
export function release(guest: WebContents, user: DebugUser): void {
  const s = shared.get(guest.id);
  if (!s || !s.users.delete(user)) return;
  if (user === 'capture') s.log = null;
  if (s.users.size) return;
  s.off();
  shared.delete(guest.id);
  if (s.ours && !guest.isDestroyed()) { try { if (guest.debugger.isAttached()) guest.debugger.detach(); } catch { /* already gone */ } }
}

/** The page went away: nothing of it is kept. */
export function forgetDebug(guestId: number): void {
  const s = shared.get(guestId);
  if (!s) return;
  s.off();
  shared.delete(guestId);
}

/** The console and requests of the page are being kept (from now on); `fresh`: they only just started to be. */
async function startCapture(guest: WebContents): Promise<{ log: PageLog; fresh: boolean } | string> {
  const err = acquire(guest, 'capture');
  if (err) return err;
  const s = shared.get(guest.id)!;
  if (s.log) return { log: s.log, fresh: false };
  const log = new PageLog();
  s.log = log;
  try {
    // Runtime.enable hands over the console messages the page logged before; Log.enable the browser's own lines
    await guest.debugger.sendCommand('Runtime.enable');
    await guest.debugger.sendCommand('Log.enable');
    await guest.debugger.sendCommand('Network.enable', { maxPostDataSize: 0 });
  } catch (e) {
    release(guest, 'capture');
    return tr('读不了这个页面的调试信息：{why}', { why: String((e as Error)?.message ?? e).slice(0, 200) });
  }
  // the requests made before now are not handed over: the page's resource timing has them (address, time, status)
  let earlier: NetEntry[] = [];
  try {
    const r = (await guest.debugger.sendCommand('Runtime.evaluate', { expression: EARLIER_JS, returnByValue: true })) as { result?: { value?: unknown } };
    earlier = earlierRequests(r?.result?.value);
  } catch { /* none to be had */ }
  await new Promise((r) => setTimeout(r, 80)); // the messages handed over arrive as events
  // a request already in the log (still on its way when it started) is not listed twice
  const live = new Set(log.network.map((n) => n.url));
  earlier = earlier.filter((e) => !live.has(e.url));
  log.network.unshift(...earlier);
  if (log.network.length > RING) log.network.splice(0, log.network.length - RING);
  log.earlier = earlier.length;
  return { log, fresh: true };
}

/** The requests the page made before the log started, from its resource timing: address, time, and the status if the page gives it. */
const EARLIER_JS = `(() => { try { return performance.getEntriesByType('navigation').concat(performance.getEntriesByType('resource')).slice(-${RING}).map((e) => ({ url: String(e.name), type: String(e.initiatorType || ''), ms: Math.round(e.duration), status: e.responseStatus || 0 })); } catch (e) { return []; } })()`;

export function earlierRequests(list: unknown): NetEntry[] {
  if (!Array.isArray(list)) return [];
  const out: NetEntry[] = [];
  for (const e of list.slice(-RING)) {
    if (!e || typeof e !== 'object' || typeof e.url !== 'string' || !e.url) continue;
    const type = typeof e.type === 'string' ? e.type : '';
    const sure = ['navigation', 'img', 'image', 'script', 'link', 'css', 'iframe', 'video', 'audio', 'track'].includes(type); // these are always GET
    out.push({ method: sure ? 'GET' : '?', url: cut(e.url, URL_MAX), ...(type ? { type } : {}), ...(typeof e.ms === 'number' && e.ms >= 0 ? { ms: e.ms } : {}), ...(typeof e.status === 'number' && e.status > 0 ? { status: e.status } : {}) });
  }
  return out;
}

// ---------- the page's structure (browser_snapshot) ----------

export interface AXNodeLike {
  nodeId: string; ignored?: boolean; role?: { value?: unknown }; name?: { value?: unknown }; value?: { value?: unknown };
  properties?: { name: string; value?: { value?: unknown } }[]; childIds?: string[]; parentId?: string; backendDOMNodeId?: number;
}
/** One line of the outline. `more`: that many further options were left out here. */
export interface SnapNode { depth: number; role: string; name: string; ref?: string; value?: string; level?: number; states?: string[]; more?: number }

/** Roles Claude can act on: these get a ref (the page agent's, the one browser_click takes). */
const INTERACTIVE = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'listbox', 'ComboBoxSelect', 'ComboBoxMenuButton', 'PopUpButton', 'TextField']);
/** Landmarks and structure: shown when they are there (the named-only ones only with a name). */
const STRUCTURE = new Set(['heading', 'main', 'navigation', 'banner', 'contentinfo', 'complementary', 'search', 'dialog', 'alertdialog', 'alert']);
const NAMED_ONLY = new Set(['form', 'region', 'img', 'image', 'figure', 'table', 'article']);
const VALUED = new Set(['textbox', 'searchbox', 'combobox', 'slider', 'spinbutton', 'ComboBoxSelect', 'TextField']);
/** Options shown under one parent at most (a country list has hundreds). */
const OPTIONS_MAX = 25;
export const SNAPSHOT_LINES = 400;
const DEPTH_MAX = 12;

const flat = (v: unknown, max: number) => (typeof v === 'string' || typeof v === 'number' ? cut(String(v).replace(/\s+/g, ' ').trim(), max) : '');

function statesOf(n: AXNodeLike): { level?: number; states: string[] } {
  const states: string[] = [];
  let level: number | undefined;
  for (const p of n.properties ?? []) {
    const v = p.value?.value;
    if (p.name === 'level' && typeof v === 'number') level = v;
    else if (p.name === 'checked') { if (v === 'true' || v === true) states.push('checked'); else if (v === 'mixed') states.push('mixed'); }
    else if (p.name === 'expanded') states.push(v === true || v === 'true' ? 'expanded' : 'collapsed');
    else if ((p.name === 'disabled' || p.name === 'selected' || p.name === 'pressed' || p.name === 'focused') && (v === true || v === 'true')) states.push(p.name);
  }
  return { level, states };
}

/**
 * The accessibility tree, pressed into an outline: landmarks, headings, named images / forms / regions, and every
 * element one can act on, indented by how they nest; the rest (generic boxes, static text) only passes its children on.
 * The interactive lines carry their DOM node (`backendId`) so a ref can be put on them.
 */
export function axOutline(nodes: AXNodeLike[], max = SNAPSHOT_LINES): { nodes: (SnapNode & { backendId?: number })[]; truncated: boolean } {
  const byId = new Map<string, AXNodeLike>();
  for (const n of nodes) if (n && typeof n.nodeId === 'string') byId.set(n.nodeId, n);
  const root = nodes.find((n) => n && !n.parentId) ?? nodes[0];
  const out: (SnapNode & { backendId?: number })[] = [];
  if (!root) return { nodes: out, truncated: false };
  const seen = new Set<string>();
  let truncated = false;
  const walk = (n: AXNodeLike, depth: number): void => {
    if (truncated || seen.has(n.nodeId)) return;
    seen.add(n.nodeId);
    const role = flat(n.role?.value, 40);
    const name = flat(n.name?.value, 120);
    const keep = !n.ignored && (INTERACTIVE.has(role) || STRUCTURE.has(role) || (NAMED_ONLY.has(role) && !!name));
    let childDepth = depth;
    if (keep) {
      if (out.length >= max) { truncated = true; return; }
      const { level, states } = statesOf(n);
      const value = VALUED.has(role) ? flat(n.value?.value, 80) : '';
      out.push({ depth: Math.min(depth, DEPTH_MAX), role, name, ...(value ? { value } : {}), ...(level !== undefined ? { level } : {}), ...(states.length ? { states } : {}), ...(INTERACTIVE.has(role) && typeof n.backendDOMNodeId === 'number' ? { backendId: n.backendDOMNodeId } : {}) });
      childDepth = depth + 1;
    }
    let options = 0;
    let skipped = 0;
    for (const id of n.childIds ?? []) {
      const c = byId.get(id);
      if (!c) continue;
      if (!c.ignored && flat(c.role?.value, 40) === 'option' && ++options > OPTIONS_MAX) { skipped++; seen.add(c.nodeId); continue; }
      walk(c, childDepth);
    }
    if (skipped && !truncated) out.push({ depth: Math.min(childDepth, DEPTH_MAX), role: 'option', name: '', more: skipped });
  };
  walk(root, 0);
  return { nodes: out, truncated };
}

const REF_JS = 'function () { var a = window.__cwAgent; var out = []; for (var i = 0; i < arguments.length; i++) { try { out.push(a && a.refFor ? String(a.refFor(arguments[i]) || "") : ""); } catch (e) { out.push(""); } } return out; }';
/** Refs to put on the outline at most (each is a round trip to the page). */
const REFS_MAX = 300;

/** The outline of the page, with the page agent's refs on what can be acted on. */
async function snapshot(guest: WebContents): Promise<{ nodes: SnapNode[]; truncated: boolean } | { error: string }> {
  const err = acquire(guest, 'snapshot');
  if (err) return { error: err };
  const d = guest.debugger;
  try {
    const tree = (await d.sendCommand('Accessibility.getFullAXTree')) as { nodes?: AXNodeLike[] };
    const { nodes, truncated } = axOutline(Array.isArray(tree?.nodes) ? tree.nodes : []);
    const want = nodes.filter((n) => n.backendId !== undefined).slice(0, REFS_MAX);
    if (want.length) {
      try {
        await d.sendCommand('DOM.enable').catch(() => {});
        const objs = await Promise.all(want.map((n) => d.sendCommand('DOM.resolveNode', { backendNodeId: n.backendId, objectGroup: 'cw-snap' }).then((r: any) => r?.object?.objectId as string | undefined, () => undefined)));
        const ids = objs.filter((o): o is string => !!o);
        if (ids.length) {
          const r = (await d.sendCommand('Runtime.callFunctionOn', { objectId: ids[0], functionDeclaration: REF_JS, arguments: ids.map((objectId) => ({ objectId })), returnByValue: true })) as { result?: { value?: unknown } };
          const refs = Array.isArray(r?.result?.value) ? (r.result.value as unknown[]) : [];
          let k = 0;
          want.forEach((n, i) => { if (!objs[i]) return; const ref = refs[k++]; if (typeof ref === 'string' && /^[a-z0-9]{1,16}$/i.test(ref)) n.ref = ref; });
        }
      } finally {
        await d.sendCommand('Runtime.releaseObjectGroup', { objectGroup: 'cw-snap' }).catch(() => {});
      }
    }
    return { nodes: nodes.map(({ backendId: _b, ...n }) => n), truncated };
  } catch (e) {
    return { error: tr('读不了页面结构：{why}', { why: String((e as Error)?.message ?? e).slice(0, 200) }) };
  } finally {
    release(guest, 'snapshot');
  }
}

/** The panel asks (desktop:browser:debug): Claude's browser_console / browser_network / browser_snapshot. */
export async function guestDebug(guest: WebContents, q: unknown): Promise<unknown> {
  const op = q && typeof q === 'object' ? (q as { op?: unknown }).op : undefined;
  if (guest.isDestroyed()) return { error: tr('页面已经关掉了') };
  if (op === 'snapshot') return snapshot(guest);
  if (op !== 'console' && op !== 'network') return { error: `unknown op ${String(op)}` };
  const c = await startCapture(guest);
  if (typeof c === 'string') return { error: c };
  if (op === 'console') return { entries: c.log.console.slice(), fresh: c.fresh };
  // the first look at the requests says where the earlier ones came from
  const earlier = c.log.earlierTold ? 0 : c.log.earlier;
  c.log.earlierTold = true;
  return { entries: c.log.network.slice(), fresh: c.fresh, earlier };
}
