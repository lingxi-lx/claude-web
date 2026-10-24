// A tab of the built-in browser as something an operation can be carried out on (ops.ts `PageHandle`): the tab's
// <webview>, driven through the tag's own methods. Desktop app only — elsewhere there is no page to drive and the
// server reads pages itself.
import { desktop } from '@/desktop';
import agentSrc from './page-agent.js?raw';
import { parseKey, type MouseAct, type PageHandle, type Picture } from './ops';
import { viewportOf, type ViewportId } from './viewport';
import { guestOf, patchTab, tabOf, waitGuest, type WebviewEl } from './state';
import { loadable } from './url';
import type { PickedEl } from './annotate-model';
import { tr } from '@/i18n';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** How long a page is given to load before it is read as it is. */
export const LOAD_MS = 20_000;

/** Wait until the page has stopped loading and stayed so for a moment. False: still loading after `ms`. */
async function idle(el: WebviewEl, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  let calm = 0;
  for (;;) {
    let loading = true;
    try { loading = el.isLoading(); } catch { /* being re-attached: counts as loading */ }
    calm = loading ? 0 : calm + 1;
    if (calm >= 2) return true;
    if (Date.now() >= end) return false;
    await sleep(120);
  }
}

/** How much longer a page that is still loading is waited for when something has to be asked of it. */
export const ASK_WAIT_MS = 3_000;

/**
 * A script runs in a page only once its main frame has stopped loading (Electron holds it until then). A page that
 * never does — a picture that does not arrive, a connection kept open — would leave every read waiting until the
 * server gives up on it: it is given a little longer, then its loading is stopped and it is read as it is.
 */
async function askable(el: WebviewEl): Promise<void> {
  const loading = () => { try { return el.isLoadingMainFrame ? el.isLoadingMainFrame() : el.isLoading(); } catch { return false; } };
  for (const end = Date.now() + ASK_WAIT_MS; loading() && Date.now() < end;) await sleep(100);
  if (!loading()) return;
  try { el.stop(); } catch { /* being re-attached */ }
  await sleep(80);
}

/** The device the shell draws each tab's page as, as last told (tab id → choice): told again only when it changes. */
const emulated = new Map<string, ViewportId>();

/**
 * The shell draws the tab's page as the device its 视口 says (BrowserPanel's ⋯ menu, an Agent's browser_viewport):
 * resolves once the shell has (it reloads the page itself when the user agent changes with it).
 */
export async function applyViewport(tabId: string): Promise<void> {
  const el = guestOf(tabId);
  const want = tabOf(tabId)?.viewport ?? 'auto';
  if (!el || !desktop?.guestEmulate || (emulated.get(tabId) ?? 'auto') === want) return;
  emulated.set(tabId, want);
  try { await desktop.guestEmulate(el.getWebContentsId(), viewportOf(want)); } catch { emulated.delete(tabId); }
}
/** The page is gone, or a new one needs the device said again. */
export const forgetViewport = (tabId: string): void => { emulated.delete(tabId); };

/** The size of the last picture taken of each tab's page: the frame an Agent's positions are given in. */
const pictures = new Map<string, { width: number; height: number }>();

async function capture(el: WebviewEl): Promise<Picture> {
  // the shell does it (it can scale and re-encode); a window without the shell's bridge falls back to the tag's own
  if (desktop?.captureGuest) {
    const img = await desktop.captureGuest(el.getWebContentsId());
    if (img?.data) return img;
    throw new Error(tr('这个页面现在截不了图（它没有被画出来：窗口最小化了，或者屏幕关着）。'));
  }
  const late = new Promise<undefined>((r) => setTimeout(() => r(undefined), 5000));
  const shot = await Promise.race([el.capturePage?.().catch(() => undefined), late]);
  const url = shot && !shot.isEmpty?.() ? shot.toDataURL() : '';
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(url);
  if (!m) throw new Error(tr('这个页面现在截不了图。'));
  const size = shot?.getSize?.();
  return { mime: m[1] as 'image/png' | 'image/jpeg', data: m[2], ...(size?.width && size.height ? { width: size.width, height: size.height } : {}) };
}

/**
 * The page of a tab. The tab's <webview> exists once the tab has an address (a new tab has none): `navigate` on such
 * a tab gives it one, which mounts the page.
 */
export function pageOf(tabId: string): PageHandle {
  const need = async (): Promise<WebviewEl> => {
    const el = guestOf(tabId) ?? (await waitGuest(tabId, 8000));
    if (!el) throw new Error(tabOf(tabId) ? tr('内置浏览器的这个标签页还没准备好。') : tr('这个标签页已经关掉了：用 browser_open 重新打开网址。'));
    return el;
  };
  const call = async <T>(fn: string, arg: Record<string, unknown>): Promise<T> => {
    const el = await need();
    await askable(el);
    // the agent script answers {ok, value} | {ok: false, error}: a throw inside the page would otherwise arrive as
    // Electron's own wording
    const r = await el.executeJavaScript<{ ok: boolean; value?: T; error?: string }>(
      `${agentSrc}\n;(() => { try { return { ok: true, value: window.__cwAgent[${JSON.stringify(fn)}](${JSON.stringify(arg)}) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`,
    );
    if (!r || !r.ok) throw new Error(r?.error || tr('页面没有回应这个操作。'));
    return r.value as T;
  };
  return {
    async navigate(url) {
      if (!loadable(url)) throw new Error(tr('内置浏览器只打开 http / https 的地址：{url}', { url: url.slice(0, 200) }));
      const tab = tabOf(tabId);
      if (!tab) throw new Error(tr('这个标签页已经关掉了：用 browser_open 重新打开网址。'));
      if (!tab.src) {
        // a new tab: giving it an address is what creates its page
        patchTab(tabId, { src: url, url, loading: true, error: undefined });
      } else {
        const had = await need();
        patchTab(tabId, { error: undefined });
        // rejects when the load fails (and with ERR_ABORTED when the page redirects itself or starts a download)
        void had.loadURL(url).catch(() => {});
      }
      const el = await need();
      await sleep(150);
      const done = await idle(el, LOAD_MS);
      const err = tabOf(tabId)?.error;
      if (err) throw new Error(tr('打不开 {url}：{err}', { url, err }));
      // what the page builds after `load` (most sites) gets a moment
      await sleep(300);
      return done;
    },
    call: call as PageHandle['call'],
    async settle(ms) {
      return idle(await need(), ms);
    },
    async back() {
      const el = await need();
      if (!el.canGoBack()) return false;
      el.goBack();
      return true;
    },
    async key(key) {
      const el = await need();
      const k = parseKey(key);
      if (!k.keyCode) throw new Error(tr('不认识的按键：{key}', { key }));
      const mods = k.modifiers.length ? { modifiers: k.modifiers } : {};
      await el.sendInputEvent({ type: 'keyDown', keyCode: k.keyCode, ...mods });
      if (k.char !== undefined) await el.sendInputEvent({ type: 'char', keyCode: k.char, ...mods });
      await el.sendInputEvent({ type: 'keyUp', keyCode: k.keyCode, ...mods });
    },
    async capture() {
      const p = await capture(await need());
      if (p.width && p.height) pictures.set(tabId, { width: p.width, height: p.height }); else pictures.delete(tabId);
      return p;
    },
    async frame() {
      const view = await call<{ width: number; height: number }>('view', {});
      return { picture: pictures.get(tabId) ?? null, view };
    },
    async mouse(e: MouseAct) {
      const el = await need();
      const mods = e.modifiers?.length ? e.modifiers : [];
      if (e.type === 'move') await el.sendInputEvent({ type: 'mouseMove', x: e.x, y: e.y, ...(e.held ? { button: e.held, modifiers: [...mods, `${e.held}ButtonDown`] } : mods.length ? { modifiers: mods } : {}) });
      else if (e.type === 'wheel') await el.sendInputEvent({ type: 'mouseWheel', x: e.x, y: e.y, deltaX: e.dx, deltaY: e.dy, canScroll: true, ...(mods.length ? { modifiers: mods } : {}) });
      else await el.sendInputEvent({ type: e.type === 'down' ? 'mouseDown' : 'mouseUp', x: e.x, y: e.y, button: e.button, clickCount: e.count, ...(mods.length ? { modifiers: mods } : {}) });
    },
    async insertText(text: string) {
      const el = await need();
      if (!el.insertText) throw new Error(tr('这个页面现在不能输入文字。'));
      await el.insertText(text);
    },
    async debug(op) {
      const el = await need();
      if (!desktop?.guestDebug) throw new Error(tr('这个版本的桌面版读不了页面的调试信息：更新桌面版后再试。'));
      const r = await desktop.guestDebug(el.getWebContentsId(), { op });
      if (r && typeof r === 'object' && typeof (r as { error?: unknown }).error === 'string') throw new Error((r as { error: string }).error);
      return r;
    },
    async peek<T>(fn: 'has', arg: Record<string, unknown>, ms: number): Promise<T | undefined> {
      // no askable(): a wait must not stop a page that is loading — the answer just comes once it can (or not in time)
      const el = await need();
      const asked = el.executeJavaScript<{ ok: boolean; value?: T }>(
        `${agentSrc}
;(() => { try { return { ok: true, value: window.__cwAgent[${JSON.stringify(fn)}](${JSON.stringify(arg)}) }; } catch (e) { return { ok: false }; } })()`,
      ).then((r) => (r?.ok ? r.value : undefined), () => undefined);
      return Promise.race([asked, sleep(ms).then(() => undefined)]);
    },
    async viewport(id: ViewportId) {
      await need();
      if (!desktop?.guestEmulate) throw new Error(tr('这个版本的桌面版不能切换视口：更新桌面版后再试。'));
      // what the panel's ⋯ → 视口 menu does: the tab remembers the choice, and the shell is told
      patchTab(tabId, { viewport: id === 'auto' ? undefined : id });
      await applyViewport(tabId);
    },
    url() {
      try { return guestOf(tabId)?.getURL() || tabOf(tabId)?.url || ''; } catch { return tabOf(tabId)?.url ?? ''; }
    },
    title() {
      try { return guestOf(tabId)?.getTitle() || tabOf(tabId)?.title || ''; } catch { return tabOf(tabId)?.title ?? ''; }
    },
  };
}

/** What 选元素 in a page comes back with: the element, Esc pressed in the page, or nothing (stopped, page gone). */
export type PickAnswer = PickedEl | { cancel: 'esc' } | null;

/**
 * 标注 · 选元素: the user points at an element in the tab's page and clicks it (page-agent.js `pick`), which keeps a
 * box numbered `n` on it. Waits for as long as the user takes; null when picking was stopped or the page went away.
 */
export async function pickIn(tabId: string, n: number): Promise<PickAnswer> {
  const el = guestOf(tabId);
  if (!el) return null;
  try {
    const r = await el.executeJavaScript<PickAnswer>(`${agentSrc}\n;window.__cwAgent.pick(${JSON.stringify({ n })})`);
    if (!r || typeof r !== 'object') return null;
    if ('cancel' in r) return { cancel: 'esc' };
    return typeof r.selector === 'string' && typeof r.html === 'string' && r.rect && r.styles ? r : null;
  } catch { return null; }
}

/** Stop picking in the tab's page; `clear`: also take the numbered boxes off it. */
export function stopPicking(tabId: string, clear: boolean): Promise<void> {
  const el = guestOf(tabId);
  if (!el) return Promise.resolve();
  return el.executeJavaScript(`${agentSrc}\n;window.__cwAgent.${clear ? 'unpick' : 'pickStop'}()`).then(() => {}, () => {});
}

/** Selected text of a tab's page (for 「发给对话」); '' when there is none or the page cannot be asked. */
export async function selectionOf(tabId: string): Promise<string> {
  const el = guestOf(tabId);
  if (!el) return '';
  try {
    return String((await el.executeJavaScript<string>(`${agentSrc}\n;window.__cwAgent.selection()`)) ?? '');
  } catch { return ''; }
}
