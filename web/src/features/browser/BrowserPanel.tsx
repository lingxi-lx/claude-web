import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useScopedSession, useStore } from '@/store';
import { desktop } from '@/desktop';
import { clsx } from '@/util';
import { Icon } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import { Popover } from '@/features/composer/Popover';
import { selectionOf } from './guest';
import { COOKIES_KEY, COOKIE_MODES, browsingPartitions, closeTab, cookieModeText, cookiesMode, ensureTab, firstPage, frontTab, guestElOf, guestOf, guestReady, hasWebview, newTab, openUrl, patchTab, setGuest, tabOf, tabOfGuest, useBrowser, type BrowserTab, type WebviewEl } from './state';
import { parseCookies } from './cookies';
import { AllowedSites } from './AllowedSites';
import { dlg } from '@/ui/dialog';
import { RECENT_KEY, addressToUrl, frameSandbox, loadable, pushRecent, readRecent, siteHue, siteLetter, siteOf } from './url';
import { VIEWPORT_IDS, fitScale, viewportLabel, viewportOf, type ViewportId } from './viewport';
import { nextPageZoom, progressOn, screenshotName, type LoadEvent } from './panel-logic';
import { fileUrl } from './auto-open';
import { FindBar } from './FindBar';
import { DownloadsBar, useDownloadEvents } from './Downloads';
import { Annotate, type AnnotateTool } from './Annotate';
import './browser.css';
import { tr } from '@/i18n';
import { ws } from '@/ws/client';
import { sessionPeer } from '@/features/peers';

/** A site's letter on its own colour: what stands for a page that has no icon of ours to show. */
function SiteMark({ url, size = 16 }: { url: string; size?: number }) {
  return <span className="bw-mark" style={{ width: size, height: size, fontSize: Math.round(size * 0.58), ['--h' as string]: siteHue(url) }} aria-hidden>{siteLetter(url)}</span>;
}

const tabName = (t: BrowserTab) => t.title || (t.url ? siteOf(t.url) : tr('新标签页'));

/** Send the page in a tab somewhere else: back, forward, again — whatever the page element offers. */
function drive(tabId: string, fn: 'goBack' | 'goForward' | 'reload' | 'stop') {
  try { guestOf(tabId)?.[fn](); } catch { /* the page is being replaced */ }
}

/** Give a tab an address: a new tab gets its page, a tab with a page is told to load. */
function go(tab: BrowserTab, input: string): boolean {
  const url = addressToUrl(input);
  if (!url || !loadable(url)) return false;
  if (!tab.src) { patchTab(tab.id, { src: url, url, loading: true, error: undefined, partition: firstPage(tab) }); return true; }
  patchTab(tab.id, { url, error: undefined });
  const el = guestOf(tab.id);
  if (el) void el.loadURL(url).catch(() => {});
  else patchTab(tab.id, { frameUrl: url });
  return true;
}

/** The loading bar moves on (panel-logic.ts); once full it fades away a moment later. */
function progress(tabId: string, ev: LoadEvent) {
  patchTab(tabId, { progress: progressOn(tabOf(tabId)?.progress, ev) });
  if (ev === 'stop') setTimeout(() => { const t = tabOf(tabId); if (t && !t.loading && t.progress === 1) patchTab(tabId, { progress: undefined }); }, 320);
}

/** A tab's page zoom: one step in / out, or back to 100% — that tab's page only, not the app (zoom.ts is the app's). */
function zoomTab(tabId: string, ask: 'in' | 'out' | 'reset') {
  const z = nextPageZoom(tabOf(tabId)?.zoom, ask);
  patchTab(tabId, { zoom: z });
  try { guestOf(tabId)?.setZoomFactor?.(z); } catch { /* not attached */ }
}

/** The device the shell draws each tab's page as, as last told (tab id → choice): told again only when it changes. */
const emulated = new Map<string, ViewportId>();
function applyViewport(tabId: string) {
  const el = guestOf(tabId);
  const want = tabOf(tabId)?.viewport ?? 'auto';
  if (!el || !desktop?.guestEmulate || (emulated.get(tabId) ?? 'auto') === want) return;
  emulated.set(tabId, want);
  try { void desktop.guestEmulate(el.getWebContentsId(), viewportOf(want)).catch(() => emulated.delete(tabId)); } catch { emulated.delete(tabId); }
}

/** The size of an element's box, followed while `on` (a device's page is scaled to fit it). */
function useBox(ref: React.RefObject<HTMLElement | null>, on: boolean) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const measure = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, on]);
  return box;
}

function recordVisit(url: string, title: string) {
  const st = useStore.getState();
  const next = pushRecent(readRecent(st.settings[RECENT_KEY]), { url, title, at: Date.now() });
  if (next) void st.setSetting(RECENT_KEY, next);
}

/**
 * `allowpopups` on the <webview>: without it the page's own window.open (and every link that opens a new window) is
 * blocked inside the page and nothing happens; with it the desktop shell is asked, which opens no window and hands
 * the address back as a new tab (desktop/src/main.ts). Written as a string: the attribute only has to be present,
 * and React drops a boolean on an attribute it does not know.
 */
const ALLOW_POPUPS = { allowpopups: 'true' } as unknown as { allowpopups?: boolean };

/**
 * One tab's page. Desktop: a real `<webview>` in the tab's browser profile, created with the tab's first address and
 * never given another `src` (it would reload) — it moves on by being told to load. Elsewhere: an `<iframe>`, which
 * only shows sites that allow being embedded.
 *
 * A tab that is not in front stays laid out (hidden, same size): an Agent may be working in it, and a page with no
 * size cannot be read by position or drawn.
 */
function TabView({ tab, front }: { tab: BrowserTab; front: boolean }) {
  const ref = useRef<WebviewEl | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const webview = hasWebview();
  const vp = webview ? viewportOf(tab.viewport) : null;
  const box = useBox(view, !!vp);
  useEffect(() => {
    const el = ref.current;
    if (!el || !webview) return;
    const id = tab.id;
    setGuest(id, el);
    const sync = () => {
      try { patchTab(id, { url: el.getURL() || tab.src, title: el.getTitle(), back: el.canGoBack(), fwd: el.canGoForward() }); } catch { /* not attached yet */ }
    };
    const onReady = () => {
      guestReady(id);
      sync();
      progress(id, 'ready');
      // the tab's own zoom and device, said again to each new page (Chromium keeps zoom per site, and a new renderer
      // after a cross-site navigation starts without the device)
      const t = tabOf(id);
      try { if (t?.zoom && t.zoom !== 1) el.setZoomFactor?.(t.zoom); } catch { /* not attached */ }
      if (t?.viewport && t.viewport !== 'auto') emulated.delete(id);
      applyViewport(id);
    };
    const onStart = () => { patchTab(id, { loading: true, error: undefined }); progress(id, 'start'); };
    const onStop = () => {
      patchTab(id, { loading: false });
      progress(id, 'stop');
      sync();
      // the user's own browsing is what 最近打开 lists (not what an Agent looked up)
      try { if (!tab.agent) recordVisit(el.getURL(), el.getTitle()); } catch { /* not attached */ }
    };
    // a page that arrives after all is no failure: the shell cancels a load and starts it again with another user
    // agent (desktop/src/main.ts, Google's sign-in), and the cancelled one reports -2. A load that really fails
    // never reaches did-navigate.
    const onNavigate = () => { patchTab(id, { error: undefined }); progress(id, 'navigate'); sync(); };
    const onTitle = (e: Event) => patchTab(id, { title: String((e as unknown as { title?: string }).title ?? '').slice(0, 200) });
    const onFail = (e: Event) => {
      const f = e as unknown as { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      // -3: the load was replaced by another (a redirect in script, a download) — not a failure to show
      if (f.isMainFrame === false || f.errorCode === -3) return;
      patchTab(id, { loading: false, progress: undefined, error: `${f.errorDescription || tr('加载失败')}（${f.errorCode ?? '?'}）` });
    };
    el.addEventListener('dom-ready', onReady);
    el.addEventListener('did-start-loading', onStart);
    el.addEventListener('did-stop-loading', onStop);
    el.addEventListener('did-navigate', onNavigate);
    el.addEventListener('did-navigate-in-page', sync);
    el.addEventListener('page-title-updated', onTitle);
    el.addEventListener('did-fail-load', onFail);
    return () => {
      el.removeEventListener('dom-ready', onReady);
      el.removeEventListener('did-start-loading', onStart);
      el.removeEventListener('did-stop-loading', onStop);
      el.removeEventListener('did-navigate', onNavigate);
      el.removeEventListener('did-navigate-in-page', sync);
      el.removeEventListener('page-title-updated', onTitle);
      el.removeEventListener('did-fail-load', onFail);
      setGuest(id, null);
      emulated.delete(id);
    };
  }, [tab.id, webview, !!tab.src]);
  // the menu's 视口 changed: the shell draws the page as that device (or as the panel again)
  useEffect(() => { if (webview && tab.src) applyViewport(tab.id); }, [tab.viewport, tab.id, webview, !!tab.src]);

  if (!tab.src) return <div className="bw-view" data-tab={tab.id} hidden={!front}><NewTabPage tab={tab} front={front} /></div>;
  // a device: the page at the device's size, centred, scaled down to fit the panel. Only the element's style
  // changes — moving it into another parent would make a new page
  const scale = vp ? fitScale(box, vp) : 1;
  const sized = vp ? { width: vp.w, height: vp.h, flex: 'none', transform: scale < 1 ? `scale(${scale})` : undefined } : undefined;
  return (
    <div ref={view} className={clsx('bw-view page', !front && 'back', vp && 'vp')} data-tab={tab.id} data-viewport={tab.viewport && tab.viewport !== 'auto' ? tab.viewport : undefined} aria-hidden={!front}>
      {webview ? (
        // No `allowpopups`: the tag reads the attribute's PRESENCE, so `allowpopups="false"` would turn popups ON.
        // A page's new windows arrive as new tabs here (desktop/src/main.ts → `desktop.onBrowserPopup`).
        <webview ref={ref as unknown as React.Ref<HTMLWebViewElement>} src={tab.src} partition={tab.partition} style={sized} {...ALLOW_POPUPS} />
      ) : (
        <>
          <iframe src={tab.frameUrl ?? tab.src} title={tabName(tab)} sandbox={frameSandbox(tab.frameUrl ?? tab.src, location.origin)} />
          <div className="bw-hint">{tr('网页版里只能显示允许被嵌入的网站，其它的是空白：点右上角 ··· 在系统浏览器打开。完整的浏览器在桌面版里。')}</div>
        </>
      )}
      {tab.error && (
        <div className="bw-error" role="alert">
          <span className="tile-ic tint-warn"><Icon name="alert" size={18} /></span>
          <b>{tr('打不开这个页面')}</b>
          <span className="why">{siteOf(tab.url)} · {tab.error}</span>
          <button className="btn sm" onClick={() => { patchTab(tab.id, { error: undefined }); drive(tab.id, 'reload'); }}>{tr('再试一次')}</button>
        </div>
      )}
    </div>
  );
}

/** A new tab's own page: one box for both searching and going somewhere, then the sites opened lately. */
function NewTabPage({ tab, front }: { tab: BrowserTab; front: boolean }) {
  const recent = useStore((s) => s.settings[RECENT_KEY]);
  const [q, setQ] = useState('');
  const box = useRef<HTMLInputElement>(null);
  const sites = readRecent(recent).slice(0, 8);
  // the box takes the keyboard when the user opens a new tab — not when the panel merely mounts under something else
  const wasFront = useRef(false);
  useEffect(() => {
    if (front && !wasFront.current && document.activeElement?.closest('.bw')) box.current?.focus({ preventScroll: true });
    wasFront.current = front;
  }, [front]);
  return (
    <div className="bw-newtab">
      <span className="hero-ic tint-info"><Icon name="web" size={26} /></span>
      <form className="bw-search" onSubmit={(e) => { e.preventDefault(); go(tab, q); }}>
        <Icon name="search" size={16} />
        <input ref={box} value={q} spellCheck={false} placeholder={tr('搜索，或者输入网址')} aria-label={tr('搜索，或者输入网址')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && imeComposing(e.nativeEvent)) e.preventDefault(); }} />
      </form>
      <LaunchList tab={tab} front={front} />
      {sites.length > 0 && (
        <div className="bw-recent" data-id="recent">
          <div className="bw-h">{tr('最近打开')}</div>
          <div className="bw-sites">
            {sites.map((r) => (
              <button key={r.url} className="bw-site" title={r.url} onClick={() => go(tab, r.url)}>
                <SiteMark url={r.url} size={32} />
                <span className="tx"><span className="n">{siteOf(r.url)}</span><span className="d">{r.title || r.url}</span></span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="bw-tip"><Icon name="sparkle" size={13} />{tr('Agent 也用这个浏览器：在对话里让它「搜一下……」或者「打开这个网址看看」，它打开的页面会出现在这里。')}</p>
    </div>
  );
}

interface LaunchItem { name: string; port: number; command: string; url?: string }

/**
 * The project's dev servers (phase 6 §7, as the official browser's empty page): what `.claude/launch.json` in the
 * conversation's folder lists, each with ▶ — it starts (or is already running) and opens here. Asked again each time
 * the page comes to the front; a conversation on another machine has its files there, so nothing is listed.
 */
function LaunchList({ tab, front }: { tab: BrowserTab; front: boolean }) {
  const active = useScopedSession();
  const sessions = useStore((s) => s.sessions);
  const cwd = active && !sessionPeer(active.sessionId, sessions) ? active.cwd : undefined;
  const [list, setList] = useState<{ configs: LaunchItem[]; error?: string } | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!cwd || !front) return;
    let live = true;
    ws.request<{ configs: LaunchItem[]; error?: string } | null>({ kind: 'preview.list', cwd }).then((r) => { if (live) setList(r); }, () => { if (live) setList(null); });
    return () => { live = false; };
  }, [cwd, front]);
  if (!cwd) return null;
  const start = async (c: LaunchItem) => {
    if (c.url) { go(tab, c.url); return; }
    setBusy(c.name);
    try {
      const r = await ws.request<{ url: string }>({ kind: 'preview.start', cwd, name: c.name });
      go(tab, r.url);
    } catch (e) {
      useStore.getState().toast(tr('{name} 没启动：{e}', { name: c.name, e: (e as Error).message }));
    }
    setBusy(null);
  };
  const configs = list?.configs ?? [];
  const shown = all ? configs : configs.slice(0, 4);
  return (
    <div className="bw-recent bw-launch" data-id="launch">
      {configs.length > 0 && <div className="bw-h">{tr('开发服务器')}</div>}
      {shown.map((c) => (
        <div key={c.name} className="bw-srv" data-srv={c.name} title={c.command}>
          <span className={clsx('dot', c.url && 'on')} aria-hidden />
          <span className="n">{c.name}</span>
          {/* what ▶ runs is said before it runs: a cloned project's launch.json is someone else's command */}
          <span className="p">{c.url ? c.url.replace(/^https?:\/\//, '') : `${c.command} · :${c.port}`}</span>
          <button className="icon-btn" disabled={busy === c.name} title={c.url ? tr('打开') : tr('启动并打开')} aria-label={c.url ? tr('打开 {name}', { name: c.name }) : tr('启动 {name}', { name: c.name })} onClick={() => void start(c)}>
            {busy === c.name ? <span className="spinner" /> : <Icon name={c.url ? 'external' : 'play'} size={14} />}
          </button>
        </div>
      ))}
      {configs.length > 4 && !all && <button className="link bw-all" onClick={() => setAll(true)}>{tr('查看全部（{n}）', { n: configs.length })}</button>}
      {list?.error && <p className="bw-tip err">{tr('.claude/launch.json 读不了：{e}', { e: list.error })}</p>}
      <p className="bw-tip"><Icon name="play" size={13} />{tr('启动一个开发服务器来预览你的应用，或者在上面输入网址。这个列表在项目的 .claude/launch.json 里改。')}</p>
    </div>
  );
}

function AddressBar({ tab, onAnnotate }: { tab: BrowserTab; onAnnotate: () => void }) {
  const active = useScopedSession();
  const toast = useStore((s) => s.toast);
  const [addr, setAddr] = useState(tab.url);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sites, setSites] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // the field follows the page unless it is being typed in
  useEffect(() => { if (!editing) setAddr(tab.url); }, [tab.url, tab.id, editing]);
  const closeMenu = useCallback((refocus: boolean) => { setMenu(false); if (refocus) more.current?.focus(); }, []);
  const hasPage = !!tab.src;
  const submit = () => { if (go(tab, addr)) { setEditing(false); field.current?.blur(); } };

  /** Hand the page to the conversation in front: its address, and what is selected on it. */
  const toChat = async () => {
    if (!active?.sessionId) return toast(tr('先打开一个对话，再把页面发给它'));
    const picked = await selectionOf(tab.id);
    const st = useStore.getState();
    const cur = st.open[active.sessionId]?.draft ?? '';
    const lines = [tr('页面：{v}{url}', { v: tab.title ? `${tab.title} ` : '', url: tab.url }), ...(picked ? [tr("选中的内容：\n{picked}", { picked })] : [])];
    st.setDraft(active.sessionId, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${lines.join('\n')}\n`);
    toast(picked ? tr('页面地址和选中的内容已放进输入框') : tr('页面地址已放进输入框'), true);
  };
  const external = () => (desktop ? void desktop.openExternal(tab.url) : window.open(tab.url, '_blank', 'noopener,noreferrer'));

  return (
    <div className="bw-bar">
      <button className="icon-btn xs" disabled={!tab.back} title={tr('后退')} aria-label={tr('后退')} onClick={() => drive(tab.id, 'goBack')}><Icon name="chevronLeft" size={15} /></button>
      <button className="icon-btn xs" disabled={!tab.fwd} title={tr('前进')} aria-label={tr('前进')} onClick={() => drive(tab.id, 'goForward')}><Icon name="chevronRight" size={15} /></button>
      {tab.loading
        ? <button className="icon-btn xs" title={tr('停止加载')} aria-label={tr('停止加载')} onClick={() => drive(tab.id, 'stop')}><Icon name="close" size={14} /></button>
        : <button className="icon-btn xs" disabled={!hasPage} title={tr('重新加载')} aria-label={tr('重新加载')} onClick={() => drive(tab.id, 'reload')}><Icon name="refresh" size={14} /></button>}
      <div className={clsx('bw-addr', editing && 'on')}>
        <Icon name={/^https:/i.test(tab.url) ? 'lock' : 'web'} size={13} />
        <input
          ref={field}
          value={addr}
          spellCheck={false}
          placeholder={tr('搜索，或者输入网址')}
          aria-label={tr('地址')}
          data-id="address"
          onFocus={(e) => { setEditing(true); e.currentTarget.select(); }}
          onBlur={() => setEditing(false)}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => {
            if (imeComposing(e.nativeEvent)) return;
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.stopPropagation(); setAddr(tab.url); e.currentTarget.blur(); }
          }}
        />
        {tab.zoom !== undefined && Math.abs(tab.zoom - 1) > 0.001 && (
          <button className="bw-zoom" data-id="zoom" title={tr('这个标签页的缩放：点一下还原到 100%')} onClick={() => zoomTab(tab.id, 'reset')}>{Math.round(tab.zoom * 100)}%</button>
        )}
      </div>
      <button className="icon-btn xs" disabled={!hasPage} title={hasWebview() ? tr('选元素、画标注，然后发给 Claude') : tr('在页面上画标注')} aria-label={tr('标注这个页面')} data-id="annotate-btn" onClick={onAnnotate}><Icon name="pick" size={14} /></button>
      <button className="icon-btn xs" disabled={!hasPage} title={tr('把这个页面的地址（和选中的文字）放进对话的输入框')} aria-label={tr('发给对话')} data-id="to-chat" onClick={() => void toChat()}><Icon name="quote" size={14} /></button>
      <button className="icon-btn xs" title={tr('新标签页')} aria-label={tr('新标签页')} data-id="new-tab" onClick={() => newTab()}><Icon name="plus" size={15} /></button>
      <button ref={more} className={clsx('icon-btn xs', menu && 'active')} title={tr('更多')} aria-label={tr('更多')} aria-haspopup="menu" aria-expanded={menu} data-id="more" onClick={() => setMenu(!menu)}><Icon name="more" size={15} /></button>
      {menu && (
        <Popover anchor={more} onClose={closeMenu} prefer="down" align="right" className="bw-menu" label={tr('这个页面')}>
          <PageMenu tab={tab} close={closeMenu} external={external} onSites={() => setSites(true)} />
        </Popover>
      )}
      {sites && <AllowedSites onClose={() => { setSites(false); more.current?.focus(); }} />}
      {tab.progress !== undefined && <span className={clsx('bw-progress', tab.progress >= 1 && 'done')} data-id="progress" aria-hidden style={{ transform: `scaleX(${tab.progress})` }} />}
    </div>
  );
}

/** 打开本地 HTML 文件… is there: the desktop app, whose shell has the open dialog and lets the app open a file: page. */
const canPickHtml = () => hasWebview() && !!desktop?.pickHtmlFile && !!desktop.allowFileOnce;

/** 打开本地 HTML 文件…: the system's open dialog, then the file in a tab — once the shell has let that tab load it (file-guard.ts). */
async function openLocalHtml() {
  const toast = useStore.getState().toast;
  const path = await desktop?.pickHtmlFile?.().catch(() => null);
  if (!path) return;
  const url = fileUrl(path);
  const ok = await desktop?.allowFileOnce?.(url).catch(() => false);
  if (!ok) return toast(tr('打不开这个文件'));
  openUrl(url);
}

/** 保存截图: the page as it is drawn, as a PNG where the user says (the shell's save dialog: dlg has no file picker). */
async function saveShot(tab: BrowserTab) {
  const toast = useStore.getState().toast;
  const el = guestOf(tab.id);
  if (!el || !desktop?.saveScreenshot) return toast(tr('页面还没加载好'));
  let r: string | null | false;
  try { r = await desktop.saveScreenshot(el.getWebContentsId(), screenshotName(tab.title || siteOf(tab.url), new Date())); } catch { r = false; }
  if (r === null) return;
  if (r === false) return toast(tr('没能保存截图'));
  toast(tr('截图已保存：{path}', { path: r }), true);
}

/** A file the user picks with the system's open dialog (dlg has no file picker); null when they cancel. Read in this page only. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.addEventListener('change', () => resolve(inp.files?.[0] ?? null), { once: true });
    inp.addEventListener('cancel', () => resolve(null), { once: true });
    inp.click();
  });
}

const MAX_COOKIE_FILE = 5 * 1024 * 1024;

/**
 * 导入 Cookie…: a cookies.txt or an extension's JSON export, parsed here (cookies.ts) and handed straight to the shell,
 * into the profile this tab's page is in (or would be made in). The values go nowhere else — not to the server.
 */
async function importCookieFile(tab: BrowserTab) {
  const toast = useStore.getState().toast;
  if (!desktop?.importCookies) return;
  const file = await pickFile('.txt,.json,text/plain,application/json');
  if (!file) return;
  if (file.size > MAX_COOKIE_FILE) return toast(tr('这个文件太大，不像是 Cookie 文件'));
  let text: string;
  try { text = await file.text(); } catch { return toast(tr('读不了这个文件')); }
  const { ok, bad } = parseCookies(text);
  if (!ok.length) return toast(tr('这个文件里没有能导入的 Cookie（支持 cookies.txt 和浏览器扩展导出的 JSON）'));
  const r = await desktop.importCookies(firstPage(tab), ok).catch(() => false as const);
  if (!r) return toast(tr('没能导入 Cookie'));
  const skipped = bad + r.failed;
  toast(skipped
    ? tr('导入了 {n} 条 Cookie，{m} 条没能导入。重新加载页面就能用上。', { n: r.set, m: skipped })
    : tr('导入了 {n} 条 Cookie。重新加载页面就能用上。', { n: r.set }), r.set > 0);
}

/** 清除浏览数据: after asking, every profile the current 保留 Cookie uses (and any an open tab still uses) is emptied. */
async function clearBrowsingData() {
  const st = useStore.getState();
  if (!desktop?.clearBrowsingData) return;
  const ok = await dlg.confirm(tr('清除内置浏览器的浏览数据？'), {
    message: tr('Cookie（网站的登录状态）、网站存在本机的数据和缓存都会删掉：你和 Claude 在内置浏览器里登录过的网站都要重新登录。不影响电脑上的其它浏览器。'),
    okLabel: tr('清除'), danger: true, focusCancel: true,
  });
  if (!ok) return;
  const done = await Promise.all(browsingPartitions(cookiesMode(st.settings)).map((p) => desktop!.clearBrowsingData!(p).catch(() => false)));
  st.toast(done.every(Boolean) ? tr('浏览数据已清除') : tr('没能清除全部浏览数据'), done.every(Boolean));
}

/** The menu's three switches: absent = on. */
const SWITCHES = [
  { act: 'open-links', key: 'web.browser.openLinks', icon: 'link', label: () => tr('在内置浏览器打开链接') },
  { act: 'open-files', key: 'web.browser.openFiles', icon: 'files', label: () => tr('自动打开 Claude 写的文件') },
  { act: 'auto-verify', key: 'web.browser.autoVerify', icon: 'checkCircle', label: () => tr('自动检查改动') },
] as const;

function SwitchRow({ act, setting, icon, label }: { act: string; setting: string; icon: Parameters<typeof Icon>[0]['name']; label: string }) {
  const on = useStore((s) => s.settings[setting]) !== false;
  const setSetting = useStore((s) => s.setSetting);
  return (
    <button type="button" data-mi role="menuitemcheckbox" aria-checked={on} className={clsx('cm-it', on && 'on')} data-act={act} onClick={() => void setSetting(setting, !on)}>
      <span className="cm-ck"><Icon name={icon} size={14} /></span>
      <span className="cm-tx"><span className="cm-l">{label}</span></span>
      <span className={clsx('toggle sm', on && 'on')} aria-hidden />
    </button>
  );
}

/** The ⋯ menu: what can be done with the page, 视口 › and 保留 Cookie › (views of their own, like the + menu's 连接器 ›), the switches. */
function PageMenu({ tab, close, external, onSites }: { tab: BrowserTab; close: (refocus: boolean) => void; external: () => void; onSites: () => void }) {
  const [view, setView] = useState<'main' | 'viewport' | 'cookies'>('main');
  const toast = useStore((s) => s.toast);
  const setSetting = useStore((s) => s.setSetting);
  const storedMode = useStore((s) => s.settings[COOKIES_KEY]);
  const oldIsolated = useStore((s) => s.settings['web.browser.isolated']);
  const mode = cookiesMode({ [COOKIES_KEY]: storedMode, 'web.browser.isolated': oldIsolated });
  const box = useRef<HTMLDivElement>(null);
  // a view switched under the keyboard: its checked row (else its first) takes the focus
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const rows = [...(box.current?.querySelectorAll<HTMLElement>('[data-mi]:not(:disabled)') ?? [])];
    (rows.find((b) => b.getAttribute('aria-checked') === 'true') ?? rows[0])?.focus({ preventScroll: true });
  }, [view]);
  const hasPage = !!tab.src;
  const live = hasWebview() && hasPage;
  const row = (id: string, icon: Parameters<typeof Icon>[0]['name'], label: string, act: () => void, after?: React.ReactNode) => (
    <button type="button" data-mi role="menuitem" className="cm-it" data-act={id} onClick={act}>
      <span className="cm-ck"><Icon name={icon} size={14} /></span><span className="cm-tx"><span className="cm-l">{label}</span></span>{after}
    </button>
  );
  if (view === 'viewport') {
    const cur = tab.viewport ?? 'auto';
    return (
      <div ref={box} className="cm-ref" data-id="viewport-menu">
        <div className="cm-ref-head">
          <button type="button" data-mi className="icon-btn xs" aria-label={tr('返回')} onClick={() => setView('main')}><Icon name="chevronRight" size={12} className="flip" /></button>
          <span className="cm-l">{tr('视口')}</span>
        </div>
        {VIEWPORT_IDS.map((id) => (
          <button key={id} type="button" data-mi role="menuitemradio" aria-checked={cur === id} className={clsx('cm-it', cur === id && 'on')} data-vp={id}
            onClick={() => { close(false); patchTab(tab.id, { viewport: id === 'auto' ? undefined : id }); }}>
            <span className="cm-ck">{cur === id && <Icon name="check" size={14} />}</span>
            <span className="cm-tx"><span className="cm-l">{viewportLabel(id)}</span></span>
          </button>
        ))}
      </div>
    );
  }
  if (view === 'cookies') {
    return (
      <div ref={box} className="cm-ref" data-id="cookies-menu">
        <div className="cm-ref-head">
          <button type="button" data-mi className="icon-btn xs" aria-label={tr('返回')} onClick={() => setView('main')}><Icon name="chevronRight" size={12} className="flip" /></button>
          <span className="cm-l">{tr('保留 Cookie')}</span>
        </div>
        {COOKIE_MODES.map((id) => {
          const t = cookieModeText(id);
          return (
            <button key={id} type="button" data-mi role="menuitemradio" aria-checked={mode === id} className={clsx('cm-it', mode === id && 'on')} data-cookies={id}
              onClick={() => { close(false); if (id !== mode) void setSetting(COOKIES_KEY, id); }}>
              <span className="cm-ck">{mode === id && <Icon name="check" size={14} />}</span>
              <span className="cm-tx"><span className="cm-l">{t.label}</span><span className="cm-d">{t.desc}</span></span>
            </button>
          );
        })}
        <div className="cm-sub">{tr('已经打开的页面还用原来的，之后新开的页面用新的设置。')}</div>
      </div>
    );
  }
  const browser = hasWebview();
  return (
    <div ref={box} className="cm-ref">
      {hasPage && row('external', 'external', tr('在系统浏览器打开'), () => { close(false); external(); })}
      {hasPage && row('copy-url', 'copy', tr('复制地址'), () => { close(false); void navigator.clipboard?.writeText(tab.url).then(() => toast(tr('已复制地址'), true), () => toast(tr('没能复制'))); })}
      {live && desktop?.saveScreenshot && row('screenshot', 'image', tr('保存截图'), () => { close(false); void saveShot(tab); })}
      {live && desktop?.guestEmulate && row('viewport', 'device', tr('视口'), () => setView('viewport'),
        <span className="cm-r">{tab.viewport && tab.viewport !== 'auto' ? viewportLabel(tab.viewport).split(' · ')[0] : ''} <Icon name="chevronRight" size={12} /></span>)}
      {canPickHtml() && row('open-html', 'folder', tr('打开本地 HTML 文件…'), () => { close(false); void openLocalHtml(); })}
      {live && row('devtools', 'bash', tr('开发者工具'), () => { close(false); try { guestOf(tab.id)?.openDevTools?.(); } catch { /* not attached */ } })}
      {(hasPage || canPickHtml()) && <div className="menu-sep" />}
      {SWITCHES.map((s) => <SwitchRow key={s.act} act={s.act} setting={s.key} icon={s.icon} label={s.label()} />)}
      {row('allowed-sites', 'shield', tr('管理允许的网站…'), () => { close(false); onSites(); })}
      {browser && (
        <>
          <div className="menu-sep" />
          <div className="cm-h">Cookie</div>
          {desktop?.importCookies && row('import-cookies', 'attach', tr('导入 Cookie…'), () => { close(false); void importCookieFile(tab); })}
          {row('cookies', 'database', tr('保留 Cookie'), () => setView('cookies'), <span className="cm-r">{cookieModeText(mode).label} <Icon name="chevronRight" size={12} /></span>)}
          {desktop?.clearBrowsingData && row('clear-data', 'trash', tr('清除浏览数据'), () => { close(false); void clearBrowsingData(); })}
        </>
      )}
    </div>
  );
}

/** Whose Agent works in this tab — and, while it does, that it is doing so. */
function AgentStrip({ tab }: { tab: BrowserTab }) {
  const title = useStore((s) => s.sessions.find((x) => x.sessionId === tab.agent)?.title);
  const loadHistory = useStore((s) => s.loadHistory);
  return (
    <div className={clsx('bw-agent', tab.busy && 'busy')} data-id="agent-strip">
      <Icon name="sparkle" size={13} />
      <span className="t">{tab.busy ? tr('Agent 正在操作这个页面') : tr('Agent 打开的页面')}{title ? ` · ${title}` : ''}</span>
      <span className="grow" />
      {tab.agent && <button className="link" onClick={() => void loadHistory(tab.agent!)}>{tr('看对话')}</button>}
    </div>
  );
}

/**
 * 浏览器 — the right panel's fifth fixed tab (spec 2026-10-10-ui-structure §4): the address bar, the page, and a row
 * of tabs once there is more than one. The user browses here; an Agent's web tools work here too, each conversation
 * in a tab of its own (host.ts), marked as the Agent's.
 */
export function BrowserPanel({ visible }: { visible: boolean }) {
  const tabs = useBrowser((s) => s.tabs);
  const activeId = useBrowser((s) => s.active);
  useLayoutEffect(() => { ensureTab(); }, []);
  // a page's own new windows open as tabs here
  useEffect(() => desktop?.onBrowserPopup?.((p) => { if (p?.url && loadable(p.url)) newTab({ url: p.url }); }), []);
  useDownloadEvents();
  // 在页面中查找: which tab it searches; `n` changes each time it is asked for again (the field takes the focus back)
  const [find, setFind] = useState<{ tabId: string; n: number } | null>(null);
  const openFind = useCallback((tabId: string) => {
    if (!guestOf(tabId)) return;
    frontTab(tabId);
    setFind((f) => ({ tabId, n: (f?.n ?? 0) + 1 }));
  }, []);
  // the keys pressed in a page come from the shell (desktop/src/guest-tools.ts): find, or that tab's zoom
  useEffect(() => desktop?.onGuestKey?.((e) => {
    const tabId = typeof e?.id === 'number' ? tabOfGuest(e.id) : undefined;
    if (!tabId) return;
    if (e.key === 'find') openFind(tabId);
    else zoomTab(tabId, e.key === 'zoomIn' ? 'in' : e.key === 'zoomOut' ? 'out' : 'reset');
  }), [openFind]);
  // 标注: which tab's page it is on (one at a time; it stays while another tab is in front), and the tool the address
  // bar's button asked for — `n` changes on each press
  const [ann, setAnn] = useState<{ tabId: string; start: AnnotateTool; n: number } | null>(null);
  const annCount = useRef(0);
  const tab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const annTab = ann ? tabs.find((t) => t.id === ann.tabId && t.src) : undefined;
  const annotate = useCallback(async (tabId: string) => {
    const start: AnnotateTool = hasWebview() ? 'pick' : 'pen';
    if (ann && ann.tabId !== tabId && annCount.current > 0 && tabs.some((t) => t.id === ann.tabId)) {
      // the marks on the other tab's page go first (asked about like closing them)
      const ok = await dlg.confirm(tr('丢掉标注？'), { message: tr('另一个标签页上还有标注，开始新的会清掉它们。'), okLabel: tr('丢掉'), danger: true, focusCancel: true });
      if (!ok) return;
    }
    setAnn((a) => ({ tabId, start, n: a && a.tabId === tabId ? a.n + 1 : 0 }));
  }, [ann, tabs]);
  if (!tab) return <div className="bw" />;
  const findOn = find && find.tabId === tab.id && !!tab.src ? find : null;
  return (
    <div className="bw" data-visible={visible || undefined}
      // Ctrl/Cmd+F with the focus in the panel (not in the page — that one the shell sends): this page, not the
      // conversation's find (ChatView listens on window: stopping it here keeps it from opening too)
      onKeyDown={(e) => {
        if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey && !e.altKey) || !tab.src || !guestOf(tab.id)) return;
        e.preventDefault();
        e.stopPropagation();
        openFind(tab.id);
      }}>
      {tabs.length > 1 && (
        <div className="bw-tabs" role="tablist" aria-label={tr('浏览器的标签页')}>
          {tabs.map((t) => (
            <div key={t.id} role="tab" tabIndex={0} aria-selected={t.id === tab.id} className={clsx('bw-tab', t.id === tab.id && 'on', t.agent && 'agent')} data-tab={t.id} title={`${tabName(t)}${t.agent ? tr("\nAgent 打开的页面") : ''}`}
              onClick={() => frontTab(t.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); frontTab(t.id); } }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }}>
              {t.loading ? <span className="spinner" aria-hidden /> : t.agent ? <span className="bw-bot" aria-hidden><Icon name="sparkle" size={12} /></span> : t.url ? <SiteMark url={t.url} /> : <Icon name="web" size={13} />}
              <span className="t">{tabName(t)}</span>
              <button className="x" title={tr('关闭标签页')} aria-label={tr('关闭 {tabName}', { tabName: tabName(t) })} onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}><Icon name="close" size={11} /></button>
            </div>
          ))}
        </div>
      )}
      <AddressBar tab={tab} onAnnotate={() => void annotate(tab.id)} />
      {findOn && <FindBar key={findOn.tabId} tabId={findOn.tabId} focusKey={findOn.n} onClose={() => { setFind(null); guestElOf(findOn.tabId)?.focus(); }} />}
      {tab.agent && <AgentStrip tab={tab} />}
      <div className="bw-body">
        {tabs.map((t) => <TabView key={t.id} tab={t} front={t.id === tab.id} />)}
        {annTab && ann && (
          <Annotate key={annTab.id} tab={annTab} front={annTab.id === tab.id} start={ann.start} startKey={ann.n}
            onCount={(n) => { annCount.current = n; }} onClose={() => { annCount.current = 0; setAnn(null); }} />
        )}
      </div>
      <DownloadsBar />
    </div>
  );
}
