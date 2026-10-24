/** Bridge exposed by the Electron preload (desktop/src/preload.ts). Undefined in plain browser mode. */
export interface DesktopBridge {
  version: string;
  platform: string;
  pickDir(): Promise<string | null>;
  /** ☰: the application menu (对话 / 工作台 / 视图 / 前往 / 编辑 / 帮助) as a popup at x, y (page coordinates); older shells lack it */
  showAppMenu?(x: number, y: number): void;
  openPath(p: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  notify(title: string, body: string, sessionId?: string): void;
  setBadge(n: number): void;
  /** bg: the shell ground (new windows start on it); overlay: what the caption buttons are painted on (default bg);
   *  height: how tall the caption buttons' area is — the row they sit over, from the window's top edge */
  setTitleBarColors(bg: string, fg: string, overlay?: string, height?: number): void;
  getLoginItem(): Promise<boolean>;
  setLoginItem(on: boolean): Promise<void>;
  onCommand(cb: (id: string) => void): () => void;
  onFocusSession(cb: (sessionId: string) => void): () => void;
  /** 深链接 (claude-web://): a nudge that one is waiting, and taking it (null when there is none / not the main window) */
  onDeepLink?(cb: () => void): () => void;
  takeDeepLink?(): Promise<{ kind: 'new'; folder?: string; q?: string; peer?: string } | { kind: 'session'; id: string } | null>;
  // multi-window (phase 2); optional so an older preload still type-checks
  windowId?: string;
  newWindow?(): Promise<string>;
  focusWindow?(id: string): Promise<void>;
  listWindows?(): Promise<string[]>;
  // phase 4: updater / launch flags / lifecycle
  updateState?(): Promise<any>;
  checkUpdate?(): Promise<void>;
  downloadUpdate?(): Promise<void>;
  /** false: nothing downloaded to install (the prompt says so) */
  installUpdate?(): Promise<boolean | void>;
  onUpdate?(cb: (s: any) => void): () => void;
  setFlags?(f: Record<string, unknown>): Promise<void>;
  getFlags?(): Promise<Record<string, unknown>>;
  relaunch?(): Promise<void>;
  quit?(): Promise<void>;
  // 界面缩放 (desktop/src/zoom.ts): the shell owns the factor, for every window, and remembers it
  /** the factor this page is drawn at right now */
  getZoom?(): number;
  zoomInfo?(): Promise<ZoomInfo>;
  /** one step in / out, back to 100%, or a factor; answers with what it is now */
  setZoom?(ask: 'in' | 'out' | 'reset' | number): Promise<ZoomInfo>;
  onZoom?(cb: (e: ZoomInfo & { changed: boolean; ask: 'in' | 'out' | 'reset' | 'set' }) => void): () => void;
  // the built-in browser (features/browser): a page of it wants a new window → a new tab here; a picture of a page
  onBrowserPopup?(cb: (p: { url: string }) => void): () => void;
  /** `id`: the <webview>'s `getWebContentsId()`. Null: nothing could be drawn. */
  captureGuest?(id: number): Promise<{ mime: 'image/jpeg' | 'image/png'; data: string; width?: number; height?: number } | null>;
  /** the app opens this `file:///…` page in the built-in browser next: the shell lets that one tab load it, and refuses
   *  every other file: load there (desktop/src/file-guard.ts). False: not a file address it takes. */
  allowFileOnce?(url: string): Promise<boolean>;
  /** 右键菜单 → 引用到输入框 (desktop/src/context-menu.ts): the text that was selected where the menu was opened */
  onQuoteSelection?(cb: (text: string) => void): () => void;
  /** 网关 → Gemini 账号: sign in to Google in a window of its own (`partition`: one from an earlier login, to sign in
   *  again); its cookies once signed in, null when the window was closed first. `proxyServer` is the loopback
   *  host:port the server tunnels to the chosen exit. */
  geminiLogin?(partition?: string, proxyServer?: string): Promise<{ cookie: string; partition: string; userAgent: string } | null>;
  /** the account was deleted: wipe the login that window kept */
  geminiForget?(partition: string): Promise<void>;
  /** keep a signed-in profile alive: load gemini.google.com in a windowless Chrome so Chromium renews its
   *  cookies, and hand the renewed ones back (null when nothing changed or the sign-in is gone) */
  geminiRefresh?(partition: string): Promise<{ cookie: string; userAgent: string } | null>;
}

/** `max`: the largest factor this window's screen can take (the smallest window must still fit it). */
export interface ZoomInfo { zoom: number; max: number; min: number; /** every factor there is, smallest first */ steps?: number[] }

export const desktop: DesktopBridge | undefined = (window as any).desktop;
export const isDesktop = !!desktop;
