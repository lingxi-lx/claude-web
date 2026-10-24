// One operation an Agent asked of the built-in browser (spec 2026-10-10-ui-structure §5.2), carried out on a page.
// Pure over `PageHandle` — what a page of the browser can be asked — so the order of things (act, let the page
// settle, read it back) is tested without a browser; guest.ts makes a PageHandle out of a <webview>.
import type { BrowserAnswer, BrowserConsoleEntry, BrowserElement, BrowserNetworkEntry, BrowserOp, BrowserPage, BrowserTabInfo } from '@shared';
import { tr } from '@/i18n';
import { VIEWPORT_IDS, viewportLabel, type ViewportId } from './viewport';
import type { BrowserTab } from './state';

export interface PageHandle {
  /** Load an address and wait for it. Throws with the reason when it cannot be loaded; false = still loading after the wait. */
  navigate(url: string): Promise<boolean>;
  /** Call the page agent (page-agent.js): `__cwAgent[fn](arg)`. */
  call<T>(fn: 'read' | 'find' | 'click' | 'type' | 'scroll' | 'view' | 'point' | 'select', arg: Record<string, unknown>): Promise<T>;
  /** browser_eval: run a script in the page; its result as JSON (cut to EVAL_MAX_CHARS). Throws with the script's error. */
  evaluate(script: string): Promise<string>;
  /** Reload the page and wait for it (at most `ms`): auto-verify.ts. Optional: a page in a test has none. */
  reload?(ms: number): Promise<boolean>;
  /** Where the Agent's mouse is, for the cursor drawn over the page (AgentCursor.tsx). Optional: a page in a test has none. */
  show?(m: CursorMark): void;
  /** Wait while the page is loading (a click may have started a navigation). False: still loading after `ms`. */
  settle(ms: number): Promise<boolean>;
  /** Go back one page. False: there is none. */
  back(): Promise<boolean>;
  /** Press a key in the page (`Enter`, `Tab`, `Escape`, `ArrowDown`, `Control+A`, a character…). */
  key(key: string): Promise<void>;
  /** A picture of the page. `width` / `height`: the picture's own size — the frame positions are given in. */
  capture(): Promise<Picture>;
  /** The size of the last picture taken of this page (null: none yet) and of the page itself, in its own pixels. */
  frame(): Promise<{ picture: { width: number; height: number } | null; view: { width: number; height: number } }>;
  /** One mouse event at a position of the PAGE (its own pixels). */
  mouse(e: MouseAct): Promise<void>;
  /** Type text into whatever has the focus, as the keyboard would. */
  insertText(text: string): Promise<void>;
  /** What the page's DevTools protocol has (the shell: desktop/src/guest-debug.ts). Throws with the shell's reason (DevTools open). */
  debug(op: 'console' | 'network' | 'snapshot'): Promise<unknown>;
  /** Ask the page agent without stopping a page that is loading; undefined when it has not answered within `ms`. */
  peek<T>(fn: 'has', arg: Record<string, unknown>, ms: number): Promise<T | undefined>;
  /** Draw the page as a device, the way the panel's ⋯ → 视口 menu does. */
  viewport(id: ViewportId): Promise<void>;
  url(): string;
  title(): string;
}

/** One step of the Agent's mouse, in the page's own pixels; `width` / `height`: the page's size then. */
export interface CursorMark { kind: 'move' | 'down' | 'up'; x: number; y: number; width: number; height: number }
/** browser_eval: what of a result goes back (the server's 8 KB). */
export const EVAL_MAX_CHARS = 8_192;
/** browser_eval: how long a script (a promise it returns) is waited for. */
export const EVAL_TIMEOUT_MS = 10_000;

/** Ops that change the page: refused while the user has taken over the browser (and asked about by the server). */
export const MUTATING: ReadonlySet<BrowserOp> = new Set<BrowserOp>(['click', 'type', 'key', 'scroll', 'computer', 'hover', 'drag', 'select', 'eval']);
export const TAKEN_OVER = tr('用户接管了浏览器。在用户点「交还」之前，不能在页面上点击、输入或运行脚本（读页面可以）；等用户交还，或者问用户要怎么做。');
/** The server's word for "this tab is on another site than the one I checked" (server/src/web/service.ts SITE_CHANGED). */
export const SITE_CHANGED = 'cw-site-changed:';

/**
 * Whether the window refuses an op before it touches the page: the user has taken over the conversation's browser
 * (a page-changing op, or the server's probe for one); a page-changing op on a local file (never driven); an op
 * checked for another site than the tab's now (the server judges the new one).
 */
export function refusal(op: BrowserOp, args: Record<string, unknown>, o: { takenOver: boolean; url: string }): string | null {
  const probe = op === 'read' && args.probe === true;
  if (o.takenOver && (MUTATING.has(op) || probe)) return TAKEN_OVER;
  if (!MUTATING.has(op)) return null;
  if (/^file:/i.test(o.url)) return tr('不能在本机文件（file:）的页面上点击、输入或运行脚本：这类页面只给你读。');
  const site = typeof args.site === 'string' ? args.site : '';
  if (site && hostOf(o.url) !== site.toLowerCase()) return `${SITE_CHANGED}${o.url}`;
  return null;
}

/** A page's host as the server compares it (site-gate.ts normHost): lower case, no brackets, no trailing dot. */
export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, ''); } catch { return ''; }
}

/**
 * The page-side wrapper browser_eval runs: the script as an expression (`document.title`) or, when it has a
 * `return`, as a function body; a promise is awaited (EVAL_TIMEOUT_MS at most); the result goes back as JSON —
 * undefined, functions, DOM nodes and cycles as words — cut to EVAL_MAX_CHARS. A runtime error is an answer
 * `{ok: false}`; a script that does not parse makes the whole call fail (guest.ts then tries the other form).
 */
export function evalSource(script: string, asBody: boolean): string {
  const body = asBody ? script : `return (\n${script}\n);`;
  return `(async () => {
  const __cwOut = (v) => {
    if (v === undefined) return 'undefined';
    const seen = new WeakSet();
    try {
      const s = JSON.stringify(v, (k, x) => {
        if (typeof x === 'function') return '[function]';
        if (typeof x === 'bigint') return String(x);
        if (typeof Node === 'function' && x instanceof Node) return '[' + (x.nodeName || 'node') + ']';
        if (x && typeof x === 'object') { if (seen.has(x)) return '[circular]'; seen.add(x); }
        return x;
      });
      return s === undefined ? String(v) : s;
    } catch (e) { return String(v); }
  };
  try {
    const __cwRun = async () => {
${body}
    };
    const v = await Promise.race([__cwRun(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ${EVAL_TIMEOUT_MS}))]);
    return { ok: true, value: __cwOut(v).slice(0, ${EVAL_MAX_CHARS}) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 500) };
  }
})()`;
}
/** A script with a `return` of its own is a function body; otherwise it is tried as an expression first. */
export const looksLikeBody = (script: string): boolean => /(^|[;{}\s])return\b/.test(script);

export interface Picture { mime: 'image/jpeg' | 'image/png'; data: string; width?: number; height?: number }
export type MouseButton = 'left' | 'right' | 'middle';
export type MouseAct =
  | { type: 'move'; x: number; y: number; held?: MouseButton; modifiers?: string[] }
  | { type: 'down' | 'up'; x: number; y: number; button: MouseButton; count: number; modifiers?: string[] }
  | { type: 'wheel'; x: number; y: number; dx: number; dy: number; modifiers?: string[] };

/** What `open` reads at once (the server shows 12 000 of it and says how to go on). */
export const OPEN_CHARS = 60_000;
/** After an action the page is a glance (the server's ACTION_CHARS). */
export const GLANCE_CHARS = 6_000;
/** How long an action's effect is given to finish loading. */
export const ACTION_SETTLE_MS = 8_000;
const STILL_LOADING = tr('页面还在加载，下面的内容可能不全（过一会儿用 browser_read 再读）。');

interface Read { page: BrowserPage; length: number }
interface Did { submitted?: boolean; enter?: boolean }
interface Scrolled { moved: number; top: number; max: number; length: number }
interface Point { x: number; y: number; width: number; height: number }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
/** `[kqz12]` — a note names what was acted on by its ref, never by its text: the server shows a note OUTSIDE the
 *  untrusted-content markers, so it carries this side's own words only (no element names, no addresses). */
const at = (ref: unknown) => `[${str(ref).trim().replace(/^\[|\]$/g, '').slice(0, 24)}]`;

export interface OpTimes { pause?: number; settle?: number; computerSettle?: number; poll?: number }

/** What browser_console / browser_network hand on at most (the newest; the server cuts the lines to its own budget). */
export const CONSOLE_MAX = 100;
export const NETWORK_MAX = 100;
/** browser_snapshot's outline, in characters (models pay per token). */
export const SNAPSHOT_CHARS = 12_000;
/** browser_wait: how long by default, at most, and how often the page is asked. */
export const WAIT_DEFAULT_MS = 5_000;
export const WAIT_MAX_MS = 20_000;
const WAIT_POLL_MS = 250;

const cutTo = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
const objects = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object') : []);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** The shell's console log, checked: errors and warnings only when asked; the newest CONSOLE_MAX, each cut. */
export function consoleEntries(raw: unknown, errorsOnly: boolean): BrowserConsoleEntry[] {
  const out: BrowserConsoleEntry[] = [];
  for (const e of objects(raw)) {
    const level = str(e.level) || 'log';
    if (errorsOnly && level !== 'error' && level !== 'warning') continue;
    const url = str(e.url);
    out.push({ level: level.slice(0, 20), text: cutTo(str(e.text), 1000), at: num(e.at) ?? 0, ...(url ? { url: cutTo(url, 500) } : {}) });
  }
  return out.slice(-CONSOLE_MAX);
}

/** The shell's requests, checked: only the failed ones (a failure, or a status of 400 and up) when asked; the newest NETWORK_MAX. */
export function networkEntries(raw: unknown, failedOnly: boolean): BrowserNetworkEntry[] {
  const out: BrowserNetworkEntry[] = [];
  for (const e of objects(raw)) {
    const status = num(e.status);
    const failed = str(e.failed);
    if (failedOnly && !failed && !(status !== undefined && status >= 400)) continue;
    const ms = num(e.ms);
    const type = str(e.type);
    out.push({ method: (str(e.method) || 'GET').slice(0, 20), url: cutTo(str(e.url), 500), ...(status !== undefined ? { status } : {}), ...(ms !== undefined ? { ms } : {}), ...(type ? { type: type.slice(0, 40) } : {}), ...(failed ? { failed: cutTo(failed, 200) } : {}) });
  }
  return out.slice(-NETWORK_MAX);
}

/** One line of the shell's outline (desktop/src/guest-debug.ts `SnapNode`). */
export interface SnapNode { depth: number; role: string; name: string; ref?: string; value?: string; level?: number; states?: string[]; more?: number }

/**
 * The outline as the model reads it: `role "name" [ref] = "value" states`, indented two spaces a level. A name from
 * the page is one line with its quotes escaped (it cannot start a line of its own). Cut at a line to `max` characters.
 */
export function outlineText(nodes: SnapNode[], max = SNAPSHOT_CHARS): { text: string; lines: number; omitted: number } {
  const q = (v: unknown, n: number) => `"${str(v).replace(/\s+/g, ' ').trim().slice(0, n).replace(/"/g, '\\"')}"`;
  const out: string[] = [];
  let size = 0;
  for (const n of nodes) {
    const pad = '  '.repeat(Math.min(12, Math.max(0, Math.floor(Number(n.depth) || 0))));
    let line: string;
    if (n.more) line = `${pad}… ${tr('还有 {n} 个选项', { n: n.more })}`;
    else {
      const role = str(n.role).replace(/\s+/g, '').slice(0, 40) || 'element';
      const name = str(n.name).trim() ? ` ${q(n.name, 120)}` : '';
      const level = typeof n.level === 'number' ? ` (level ${n.level})` : '';
      const ref = n.ref ? ` [${str(n.ref).slice(0, 24)}]` : '';
      const value = n.value ? ` = ${q(n.value, 80)}` : '';
      const states = Array.isArray(n.states) && n.states.length ? ` ${n.states.map((x) => str(x).replace(/\s+/g, '')).join(' ')}` : '';
      line = `${pad}${role}${name}${level}${ref}${value}${states}`;
    }
    if (size + line.length + (out.length ? 1 : 0) > max) break;
    size += line.length + (out.length ? 1 : 0);
    out.push(line);
  }
  return { text: out.join('\n'), lines: out.length, omitted: nodes.length - out.length };
}

/** The tabs of a conversation's Agent as browser_tabs lists them; `active`: the one its tools work in (state.ts agentTab). */
export function agentTabsOf(tabs: BrowserTab[], sessionId: string, current: string | undefined): BrowserTabInfo[] {
  const mine = tabs.filter((t) => t.agent === sessionId);
  const active = mine.some((t) => t.id === current) ? current : mine[0]?.id;
  return mine.map((t) => ({ id: t.id, url: t.src ? t.url : '', title: t.src ? t.title : '', active: t.id === active }));
}

/**
 * Carry out one operation. After anything that may change the page (click, type + submit, a key, back) the page is
 * given a moment, then read back as a glance — the model sees what its action did without asking again.
 */
export async function runOp(page: PageHandle, op: BrowserOp, args: Record<string, unknown>, t: OpTimes = {}): Promise<BrowserAnswer> {
  const pause = t.pause ?? 250;
  const settleMs = t.settle ?? ACTION_SETTLE_MS;
  const glance = async (note: string): Promise<BrowserAnswer> => {
    await sleep(pause);
    const idle = await page.settle(settleMs);
    const r = await page.call<Read>('read', { offset: 0, maxChars: GLANCE_CHARS });
    return { page: r.page, note: idle ? note : `${note}${STILL_LOADING}` };
  };
  switch (op) {
    case 'open': {
      const idle = await page.navigate(str(args.url));
      const r = await page.call<Read>('read', { offset: 0, maxChars: OPEN_CHARS });
      return idle ? { page: r.page } : { page: r.page, note: STILL_LOADING };
    }
    case 'read': {
      const r = await page.call<Read>('read', { offset: Number(args.offset) || 0, maxChars: Number(args.maxChars) || 12_000 });
      return { page: r.page };
    }
    case 'find':
      return page.call<BrowserAnswer>('find', { query: str(args.query) });
    case 'click': {
      const before = page.url();
      await pointAt(page, args.ref, true);
      await page.call<Did>('click', { ref: args.ref });
      const a = await glance(tr('已点击 {at}。', { at: at(args.ref) }));
      return page.url() !== before ? { ...a, note: tr('{note}页面换了地址（见下面的「来源」）。', { note: a.note ?? '' }) } : a;
    }
    case 'type': {
      await pointAt(page, args.ref, false);
      const d = await page.call<Did>('type', { ref: args.ref, text: str(args.text), submit: args.submit === true });
      if (d.enter) await page.key('Enter');
      if (d.submitted || d.enter) return glance(tr('已在 {at} 里输入并提交。', { at: at(args.ref) }));
      return { note: tr('已在 {at} 里输入。', { at: at(args.ref) }) };
    }
    case 'key': {
      const key = str(args.key).trim();
      if (!key) throw new Error(tr('browser_press_key 需要参数 key'));
      await page.key(key);
      return glance(tr('已按 {keyCode}。', { keyCode: parseKey(key).keyCode || tr('键') }));
    }
    case 'scroll': {
      const up = args.direction === 'up';
      const s = await page.call<Scrolled>('scroll', { direction: up ? 'up' : 'down', amount: Number(args.amount) || 1 });
      await sleep(pause);
      if (!s.moved) return { note: up ? tr('已经在页面最上面了。') : tr('已经到页面最下面了。') };
      // a page that loads more as it scrolls grew: the new part starts where the old text ended
      const now = await page.call<Read>('read', { offset: 0, maxChars: 200 });
      const grew = now.length > s.length ? tr('页面多出了内容：用 browser_read {"offset": {sCount}} 读新出现的部分。', { sCount: s.length }) : tr('用 browser_read 读内容（offset 是文字的位置，和滚到哪里无关）。');
      return { note: tr('已向{v}滚动（位置 {top} / {max}）。{grew}', { v: up ? tr('上') : tr('下'), top: s.top, max: s.max, grew }) };
    }
    case 'back': {
      if (!(await page.back())) return { note: tr('没有上一页了。') };
      return glance(tr('已返回上一页。'));
    }
    case 'screenshot': {
      const image = await page.capture();
      return { image, page: { url: page.url(), title: page.title(), text: '' } };
    }
    case 'computer':
      return computer(page, args, pause, t.computerSettle ?? COMPUTER_SETTLE_MS);
    case 'console': {
      const r = (await page.debug('console')) as { entries?: unknown } | undefined;
      return { console: consoleEntries(r?.entries, args.errorsOnly === true), page: { url: page.url(), title: page.title(), text: '' } };
    }
    case 'network': {
      const r = (await page.debug('network')) as { entries?: unknown; earlier?: unknown } | undefined;
      const earlier = Number(r?.earlier) > 0;
      return {
        network: networkEntries(r?.entries, args.failedOnly === true),
        page: { url: page.url(), title: page.title(), text: '' },
        ...(earlier ? { note: tr('网络请求从现在起完整记录；这之前的请求来自页面的资源计时（方法写成「?」的不确定，失败的请求可能不在里面）。要看页面加载时的全部请求，用 browser_open 重新打开这一页再看。') } : {}),
      };
    }
    case 'snapshot': {
      // the page agent first: it gives out the refs the outline carries (and its own list is what is left without the tree)
      const r = await page.call<Read>('read', { offset: 0, maxChars: 200 });
      let nodes: SnapNode[];
      let note = '';
      try {
        const d = (await page.debug('snapshot')) as { nodes?: unknown; truncated?: unknown } | undefined;
        if (!d || !Array.isArray(d.nodes)) throw new Error(tr('内置浏览器没有返回页面结构'));
        nodes = objects(d.nodes) as unknown as SnapNode[];
        if (d.truncated === true) note = tr('页面很大，结构没有列完；要找某个元素用 browser_find。');
      } catch (e) {
        nodes = (r.page.elements ?? []).map((el: BrowserElement) => ({ depth: 0, role: el.role, name: el.name, ref: el.ref, ...(el.value ? { value: el.value } : {}) }));
        note = tr('读不到页面的无障碍树（{why}），下面只列出了可以操作的元素。', { why: String((e as Error)?.message ?? e).slice(0, 200) });
      }
      const o = outlineText(nodes);
      if (o.omitted && !note) note = tr('页面很大，结构没有列完；要找某个元素用 browser_find。');
      return { page: { url: r.page.url, title: r.page.title, text: o.text }, ...(note ? { note } : {}) };
    }
    case 'wait':
      return waitFor(page, args, t.poll ?? WAIT_POLL_MS);
    case 'viewport': {
      const preset = args.preset as ViewportId;
      if (!VIEWPORT_IDS.includes(preset)) throw new Error(tr('browser_viewport 的 preset 只能是：{v}', { v: VIEWPORT_IDS.join('、') }));
      await page.viewport(preset);
      return glance(tr('视口：{label}。', { label: viewportLabel(preset) }));
    }
    case 'hover': {
      const p = await page.call<Point>('point', { ref: args.ref });
      mark(page, 'move', p);
      await page.mouse({ type: 'move', x: p.x, y: p.y });
      return glance(tr('鼠标已移到 {at} 上。', { at: at(args.ref) }));
    }
    case 'drag': {
      const a = await page.call<Point>('point', { ref: args.from });
      // the target where it is now (bringing it into view could move what is dragged off the screen)
      const b = await page.call<Point>('point', { ref: args.to, noScroll: true });
      mark(page, 'move', a);
      await page.mouse({ type: 'move', x: a.x, y: a.y });
      mark(page, 'down', a);
      await page.mouse({ type: 'down', x: a.x, y: a.y, button: 'left', count: 1 });
      const STEPS = 10;
      for (let i = 1; i <= STEPS; i++) {
        const x = Math.round(a.x + ((b.x - a.x) * i) / STEPS);
        const y = Math.round(a.y + ((b.y - a.y) * i) / STEPS);
        mark(page, 'move', { ...b, x, y });
        await page.mouse({ type: 'move', x, y, held: 'left' });
        await sleep(Math.min(pause, 30));
      }
      mark(page, 'up', b);
      await page.mouse({ type: 'up', x: b.x, y: b.y, button: 'left', count: 1 });
      return glance(tr('已把 {from} 拖到 {to}。', { from: at(args.from), to: at(args.to) }));
    }
    case 'select': {
      await pointAt(page, args.ref, true);
      await page.call<{ index: number }>('select', { ref: args.ref, value: str(args.value) });
      return glance(tr('已在 {at} 里选好。', { at: at(args.ref) }));
    }
    case 'eval': {
      const script = str(args.script);
      if (!script.trim()) throw new Error(tr('browser_eval 需要参数 script'));
      const result = await page.evaluate(script);
      return { result, page: { url: page.url(), title: page.title(), text: '' } };
    }
    case 'tabs':
      // the conversation's tabs, not a page: host.ts
      throw new Error('tabs is not an operation on a tab');
    case 'search':
      // a search has a page of its own (search-page.ts): it never comes here
      throw new Error('search is not an operation on a tab');
  }
}

/** Tell the cursor layer where the mouse is (nothing to tell without one). */
function mark(page: PageHandle, kind: CursorMark['kind'], p: Point): void {
  try { page.show?.({ kind, x: p.x, y: p.y, width: p.width, height: p.height }); } catch { /* only a picture */ }
}

/** The cursor goes to an element before it is acted on by ref (a click shows a press). Where it cannot be found, nothing is shown. */
async function pointAt(page: PageHandle, ref: unknown, press: boolean): Promise<void> {
  if (!page.show) return;
  try {
    const p = await page.call<Point>('point', { ref });
    mark(page, 'move', p);
    if (press) mark(page, 'down', p);
  } catch { /* the op itself says what is wrong */ }
}

/**
 * browser_wait: the page agent is asked until the text is on the page / the element is shown — never stopping a page
 * that is loading (a wait is mostly for one). Throws when the time is up, or at once when the element is gone.
 */
async function waitFor(page: PageHandle, args: Record<string, unknown>, poll: number): Promise<BrowserAnswer> {
  const text = str(args.text).trim();
  const ref = str(args.ref).trim().replace(/^\[|\]$/g, '');
  if (!text && !ref) throw new Error(tr('browser_wait 需要参数 text（要等的文字）或 ref（要等的元素）'));
  const timeout = Math.min(WAIT_MAX_MS, Math.max(100, Number(args.timeoutMs) || WAIT_DEFAULT_MS));
  const secs = (ms: number) => Math.round(ms / 100) / 10;
  const start = Date.now();
  const end = start + timeout;
  for (;;) {
    const r = await page.peek<{ found?: boolean; missing?: boolean }>('has', { ...(text ? { text } : {}), ...(ref ? { ref } : {}) }, Math.max(50, end - Date.now()));
    if (r?.found) return { note: ref ? tr('等到了：{at} 出现了（{s} 秒）。', { at: at(ref), s: secs(Date.now() - start) }) : tr('等到了：页面上出现了要等的文字（{s} 秒）。', { s: secs(Date.now() - start) }) };
    if (r?.missing) throw new Error(tr('页面上已经没有 {at} 这个元素了（页面变过）：用 browser_snapshot 或 browser_find 重新找。', { at: at(ref) }));
    if (Date.now() >= end) throw new Error(ref && !text ? tr('等了 {s} 秒，{at} 还没有出现。', { s: secs(timeout), at: at(ref) }) : tr('等了 {s} 秒，页面上还没有出现要等的文字。', { s: secs(timeout) }));
    await sleep(Math.min(poll, Math.max(0, end - Date.now())));
  }
}

/** After a click the page is given this long to finish what it started before its picture is taken. */
export const COMPUTER_SETTLE_MS = 3_000;
/** One wheel notch, in the page's pixels. */
export const WHEEL_NOTCH = 100;
const NEEDS_PICTURE = tr('先截一张图（action: "screenshot"）：位置按截图里的像素来。');

/** `shift`, `ctrl+shift`, `Control+Alt` → the names an input event takes. */
export function parseModifiers(text: unknown): string[] {
  const out = new Set<string>();
  for (const p of str(text).split(/[+\s,]+/)) {
    const k = p.trim().toLowerCase();
    if (k === 'ctrl' || k === 'control') out.add('control');
    else if (k === 'shift') out.add('shift');
    else if (k === 'alt' || k === 'option') out.add('alt');
    else if (k === 'meta' || k === 'cmd' || k === 'command' || k === 'win' || k === 'super') out.add('meta');
  }
  return [...out];
}

/** A position in the last picture → the same place in the page's own pixels. Throws when it is outside the picture. */
export function toView(at: unknown, picture: { width: number; height: number }, view: { width: number; height: number }): { x: number; y: number } {
  const [px, py] = Array.isArray(at) ? (at as number[]) : [NaN, NaN];
  if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error(tr('位置要写成 [x, y]。'));
  if (px < 0 || py < 0 || px > picture.width || py > picture.height) throw new Error(tr('位置 [{px}, {py}] 在截图（{width}×{height}）外面。', { px, py, width: picture.width, height: picture.height }));
  return { x: Math.min(view.width - 1, Math.round((px * view.width) / picture.width)), y: Math.min(view.height - 1, Math.round((py * view.height) / picture.height)) };
}

/**
 * Mouse and keyboard by position (browser_computer). Every action but `screenshot` is carried out, the page is given
 * a moment, and a new picture goes back — the model sees what its action did, and the next positions are given in it.
 */
async function computer(page: PageHandle, args: Record<string, unknown>, pause: number, settleMs: number): Promise<BrowserAnswer> {
  const action = str(args.action);
  const shot = async (note: string): Promise<BrowserAnswer> => ({ image: await page.capture(), page: { url: page.url(), title: page.title(), text: '' }, ...(note ? { note } : {}) });
  if (action === 'screenshot') return shot('');
  const after = async (note: string): Promise<BrowserAnswer> => {
    await sleep(pause);
    await page.settle(settleMs);
    return shot(note);
  };
  if (action === 'wait') {
    await sleep(Math.min(10, Math.max(0.1, Number(args.seconds) || 1)) * 1000);
    return shot(tr('已等待。'));
  }
  if (action === 'type') {
    await page.insertText(str(args.text));
    return after(tr('已输入。'));
  }
  if (action === 'key') {
    const key = str(args.text).trim();
    if (!parseKey(key).keyCode) throw new Error(tr('不认识的按键：{key}', { key: key.slice(0, 40) }));
    await page.key(key);
    return after(tr('已按键。'));
  }
  const f = await page.frame();
  if (!f.picture) throw new Error(NEEDS_PICTURE);
  const at = toView(args.coordinate, f.picture, f.view);
  mark(page, action.endsWith('click') ? 'down' : 'move', { ...at, ...f.view });
  const modifiers = parseModifiers(args.modifiers);
  const mods = modifiers.length ? { modifiers } : {};
  const click = async (button: MouseButton, count: number) => {
    await page.mouse({ type: 'move', ...at, ...mods });
    // a double click is two clicks, the second one counted 2 (what a browser gets from a real mouse)
    for (let n = 1; n <= count; n++) {
      await page.mouse({ type: 'down', ...at, button, count: n, ...mods });
      await page.mouse({ type: 'up', ...at, button, count: n, ...mods });
    }
  };
  switch (action) {
    case 'left_click': await click('left', 1); return after(tr('已点击。'));
    case 'right_click': await click('right', 1); return after(tr('已右键点击。'));
    case 'middle_click': await click('middle', 1); return after(tr('已中键点击。'));
    case 'double_click': await click('left', 2); return after(tr('已双击。'));
    case 'triple_click': await click('left', 3); return after(tr('已三连击。'));
    case 'mouse_move': await page.mouse({ type: 'move', ...at, ...mods }); return after(tr('已移动鼠标。'));
    case 'left_click_drag': {
      const from = toView(args.start, f.picture, f.view);
      await page.mouse({ type: 'move', ...from, ...mods });
      await page.mouse({ type: 'down', ...from, button: 'left', count: 1, ...mods });
      // a drag is seen as one only when the mouse travels: a few steps on the way
      const STEPS = 8;
      for (let i = 1; i <= STEPS; i++) {
        await page.mouse({ type: 'move', x: Math.round(from.x + ((at.x - from.x) * i) / STEPS), y: Math.round(from.y + ((at.y - from.y) * i) / STEPS), held: 'left', ...mods });
        await sleep(Math.min(pause, 20));
      }
      await page.mouse({ type: 'up', ...at, button: 'left', count: 1, ...mods });
      return after(tr('已拖动。'));
    }
    case 'scroll': {
      const n = Math.min(20, Math.max(1, Math.round(Number(args.amount) || 3))) * WHEEL_NOTCH;
      const d = str(args.direction);
      // a wheel turned away from the user (positive) scrolls up / left
      const dx = d === 'left' ? n : d === 'right' ? -n : 0;
      const dy = d === 'up' ? n : d === 'down' ? -n : 0;
      await page.mouse({ type: 'move', ...at, ...mods });
      await page.mouse({ type: 'wheel', ...at, dx, dy, ...mods });
      return after(tr('已滚动。'));
    }
    default:
      throw new Error(tr('不认识的操作：{action}', { action: action.slice(0, 40) }));
  }
}

/** Key names as the tools take them → what the page is sent (Electron's accelerator names), with the modifiers apart. */
export function parseKey(key: string): { keyCode: string; modifiers: string[]; char?: string } {
  const parts = key.split('+').map((p) => p.trim()).filter(Boolean);
  // a lone "+" (or "Control++") is the plus key itself
  const last = key.trim().endsWith('+') ? '+' : parts.pop() ?? '';
  const modifiers: string[] = [];
  for (const m of parts) {
    const k = m.toLowerCase();
    if (k === 'ctrl' || k === 'control') modifiers.push('control');
    else if (k === 'shift') modifiers.push('shift');
    else if (k === 'alt' || k === 'option') modifiers.push('alt');
    else if (k === 'meta' || k === 'cmd' || k === 'command' || k === 'win' || k === 'super') modifiers.push('meta');
  }
  const NAMES: Record<string, string> = {
    enter: 'Enter', return: 'Enter', kpenter: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert',
    arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
    pageup: 'PageUp', pagedown: 'PageDown', pgup: 'PageUp', pgdn: 'PageDown', prior: 'PageUp', next: 'PageDown', home: 'Home', end: 'End', space: 'Space',
  };
  if (Array.from(last).length > 1) {
    // a name, as a page's `key` has it or the way key names are written for a desktop (`Page_Down`, `BackSpace`)
    const named = NAMES[last.toLowerCase().replace(/[_\s-]+/g, '')];
    if (named) return { keyCode: named, modifiers, ...(named === 'Enter' ? { char: '\r' } : named === 'Space' ? { char: ' ' } : {}) };
    if (/^f\d{1,2}$/i.test(last)) return { keyCode: last.toUpperCase(), modifiers };
    // a name nobody knows is not its first letter
    return { keyCode: '', modifiers };
  }
  // one character: typed as itself unless a modifier makes it a shortcut
  const ch = last;
  return { keyCode: ch.length === 1 && /[a-z]/i.test(ch) ? ch.toUpperCase() : ch, modifiers, ...(modifiers.some((m) => m !== 'shift') ? {} : { char: ch }) };
}
