// This window as the built-in browser an Agent's web tools work in (spec 2026-10-10-ui-structure §5.2): it tells the
// server (`browser.host`), gets each operation as a `browser.command` event, carries it out in a tab of the right
// panel's browser, and answers with `browser.result`. Desktop app only; with no such window the server reads pages
// itself and says what needs the desktop app.
import type { BrowserAnswer, BrowserCommand, ServerEvent } from '@shared';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { showPanel } from '@/features/workbench/right-panel';
import { agentTabsOf, refusal, runOp } from './ops';
import { pageOf } from './guest';
import { searchPage } from './search-page';
import { agentCurrentOf, agentTab, closeTab, cookiesMode, frontTab, guestElOf, hasWebview, newTab, partitionsFor, patchTab, setAgentCurrent, setPartitionSource, tabOf, takenOverBy, useBrowser } from './state';
import { loadable } from './url';
import { tr } from '@/i18n';

// the user's new pages are made in the profile 保留 Cookie gives them (state.ts cannot read the settings itself)
setPartitionSource(() => partitionsFor(cookiesMode(useStore.getState().settings)).user);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A page with no size cannot be clicked or drawn: the right panel was put away. Bring the browser back for it. */
async function onScreen(tabId: string): Promise<void> {
  const laidOut = () => { const el = guestElOf(tabId); return !!el && el.offsetWidth > 0 && el.offsetHeight > 0; };
  if (!tabOf(tabId)?.src || laidOut()) return;
  showPanel('browser');
  frontTab(tabId);
  for (let i = 0; i < 30 && !laidOut(); i++) await sleep(50);
}

/** A picture is of what is drawn: the tab comes to the front of the browser, the browser to the front of the right panel. */
async function inFront(tabId: string): Promise<void> {
  const drawn = () => { const el = guestElOf(tabId); return !!el && el.offsetWidth > 0 && getComputedStyle(el).visibility === 'visible'; };
  if (!drawn()) {
    showPanel('browser');
    frontTab(tabId);
    for (let i = 0; i < 30 && !drawn(); i++) await sleep(50);
  }
  // two frames and a moment: what was just shown has to be painted before it can be pictured
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  await sleep(150);
}

/** One operation, in the tab this conversation's Agent works in (its first `open` makes the tab and shows the browser). */
export async function carryOut(c: BrowserCommand): Promise<BrowserAnswer> {
  // 保留 Cookie: Claude's pages are in the profile the mode gives it (an open tab keeps the one it was made in)
  const agentPartition = partitionsFor(cookiesMode(useStore.getState().settings)).agent;
  // a search has a page of its own, off screen: it must not replace what the conversation has open
  if (c.op === 'search') return { search: await searchPage(String(c.args?.url ?? ''), agentPartition) };
  if (c.op === 'tabs') return tabsOp(c, agentPartition);
  let tab = agentTab(c.sessionId);
  if (!tab) {
    if (c.op !== 'open') throw new Error(tr('这个对话还没有打开网页：先用 browser_open 打开一个网址。'));
    const id = newTab({ agent: c.sessionId, partition: agentPartition });
    // the Agent's own tab is new: the browser comes to the front once, so what it does is seen
    showPanel('browser');
    tab = tabOf(id)!;
  }
  // 接管 / a file: page / the tab moved to another site than the server checked: refused before the page is touched
  const why = refusal(c.op, c.args ?? {}, { takenOver: takenOverBy(useBrowser.getState().tabs, c.sessionId), url: pageOf(tab.id).url() || tab.url });
  if (why) throw new Error(why);
  // a tab opened by browser_tabs "new" without an address has no page yet
  if (!tab.src && c.op !== 'open') throw new Error(tr('这个标签还没有打开网页：先用 browser_open 打开一个网址。'));
  return inTab(tab.id, c.op, c.args ?? {});
}

async function inTab(id: string, op: BrowserCommand['op'], args: Record<string, unknown>): Promise<BrowserAnswer> {
  await onScreen(id);
  // mouse and keyboard by position go by what is drawn, and answer with a picture of it
  if (op === 'screenshot' || op === 'computer' || op === 'hover' || op === 'drag') await inFront(id);
  patchTab(id, { busy: true });
  try {
    return await runOp(pageOf(id), op, args);
  } finally {
    patchTab(id, { busy: false });
  }
}

/**
 * browser_tabs: the tabs this conversation's Agent opened — never the user's own, nor another conversation's. `list`,
 * `switch` the one its tools work in, open a `new` one (http / https only), `close` one (default: the current one).
 */
async function tabsOp(c: BrowserCommand, partition: string): Promise<BrowserAnswer> {
  const sid = c.sessionId;
  const a = c.args ?? {};
  const list = () => agentTabsOf(useBrowser.getState().tabs, sid, agentTab(sid)?.id);
  const mine = (id: unknown) => {
    const t = typeof id === 'string' ? tabOf(id) : undefined;
    if (!t || t.agent !== sid) throw new Error(tr('没有这个标签：browser_tabs 只管这个对话里你打开的标签（用 {"action": "list"} 看有哪些）。'));
    return t;
  };
  // the user is looking at this conversation's tabs: a switch is shown, else what they look at stays
  const watching = () => { const on = useBrowser.getState().active; return !!on && tabOf(on)?.agent === sid; };
  switch (a.action) {
    case 'list':
      return { tabs: list() };
    case 'switch': {
      const t = mine(a.id);
      setAgentCurrent(sid, t.id);
      if (watching()) frontTab(t.id);
      return { tabs: list(), note: tr('现在用标签 [{id}]。', { id: t.id }) };
    }
    case 'new': {
      const url = typeof a.url === 'string' ? a.url.trim() : '';
      if (url && !(/^https?:\/\//i.test(url) && loadable(url))) throw new Error(tr('内置浏览器只打开 http / https 的地址：{url}', { url: url.slice(0, 200) }));
      const id = newTab({ agent: sid, partition });
      showPanel('browser');
      setAgentCurrent(sid, id);
      if (!url) return { tabs: list(), note: tr('新开了标签 [{id}]，之后的浏览器工具都在它里面；用 browser_open 打开网址。', { id }) };
      const r = await inTab(id, 'open', { url });
      return { ...r, tabs: list(), note: `${tr('新开了标签 [{id}]，之后的浏览器工具都在它里面。', { id })}${r.note ?? ''}` };
    }
    case 'close': {
      const t = a.id === undefined ? agentTab(sid) : mine(a.id);
      if (!t) throw new Error(tr('这个对话还没有打开标签。'));
      closeTab(t.id);
      if (agentCurrentOf(sid) === t.id) setAgentCurrent(sid, undefined);
      return { tabs: list(), note: tr('已关掉标签 [{id}]。', { id: t.id }) };
    }
    default:
      throw new Error(tr('browser_tabs 的 action 只能是：{v}', { v: 'list、switch、new、close' }));
  }
}

/** One operation at a time per conversation, in the order they were asked. */
const queues = new Map<string, Promise<void>>();

function take(c: BrowserCommand): void {
  const run = async () => {
    let msg: { ok: true; answer: BrowserAnswer } | { ok: false; error: string };
    try {
      msg = { ok: true, answer: await carryOut(c) };
    } catch (e) {
      msg = { ok: false, error: String((e as Error)?.message ?? e).slice(0, 2000) };
    }
    // the server may have given up on it (30 s) or the connection may be gone: nothing more to do then
    await ws.request({ kind: 'browser.result', id: c.id, ...msg }).catch(() => {});
  };
  // searches belong to no conversation and have pages of their own (search-page.ts reads several at once)
  if (c.op === 'search') { void run(); return; }
  const next = (queues.get(c.sessionId) ?? Promise.resolve()).then(run, run);
  queues.set(c.sessionId, next);
  void next.finally(() => { if (queues.get(c.sessionId) === next) queues.delete(c.sessionId); });
}

/**
 * Installed once by App. The window that was used last is the one the server sends the operations to: it says so
 * again whenever it gets the focus, and after every reconnect.
 */
export function installBrowserHost(): () => void {
  if (!hasWebview()) return () => {};
  const announce = () => { if (useStore.getState().connected) void ws.request({ kind: 'browser.host', on: true }).catch(() => {}); };
  const offEvents = ws.on((e: ServerEvent) => { if (e.kind === 'browser.command' && e.command) take(e.command); });
  const offStore = useStore.subscribe((s, p) => { if (s.connected && !p.connected) announce(); });
  window.addEventListener('focus', announce);
  announce();
  return () => { offEvents(); offStore(); window.removeEventListener('focus', announce); };
}

// for scripts/browser-smoke.cjs: drive an operation without a server in between, and look at the tabs
(window as unknown as { __cwBrowser?: unknown }).__cwBrowser = { carryOut, state: useBrowser, canHost: hasWebview };
