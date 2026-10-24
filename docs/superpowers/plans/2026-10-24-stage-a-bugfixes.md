# 阶段 A：修 bug 与小改动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉 spec A1–A6：mac 点文件链接白屏、菜单被裁、网吧滚轮冲突、双击选词、上下文卡（颜色 / 慢 / buffer 数字）、拿掉新对话页动态背景设置。

**Architecture:** 每个修复先抽一个纯函数（可单测）再接到组件 / 主进程上；CSS 根因（mask 裁 fixed 菜单）用 `:has(.menu)` 解；buffer 数字在引擎 fork 里修并发 `2.8.4-cw.7`。

**Tech Stack:** React 18 + zustand（web/）、Electron（desktop/）、vitest、ui-smoke（Electron 驱动脚本 `scripts/ui-smoke.cjs`）、引擎 fork（bun，`C:\Users\YPY\claude-web-engine`）。

Spec: `docs/superpowers/specs/2026-10-24-desktop-parity-design.md` 的 A 部分。

## Global Constraints

- 用户看得见的字全走 `tr('中文')`（web: `import { tr } from '@/i18n'`；desktop: `import { tr } from './i18n.js'`），英文写进旁边的 `en.ts`；加完跑 `node scripts/i18n/extract.mjs --check`。
- 用户看得见的字不出现：会话 / 引擎 / 窗格 / 停靠 / effort / ultracode / ACP；叫「对话」。
- 新 UI 状态存 meta.json（`setSetting`），不用 localStorage。
- zustand 选择器返回稳定引用（不 `?? []`、不 `.filter()`、不 `({…})`）。
- 菜单用 `useAnchoredMenu` / `composer/Popover` / `useDropdown`。
- 文本框 Enter / Escape 先问 `imeComposing()`。
- 仓库 LF；改文件用 Edit / Write；bash 里别 `node -e` 带反引号。
- 跑测试前 `env -u` 掉：`CLAUDE_CODE_ENTRYPOINT CLAUDE_WEB_DIST ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION CLAUDE_WEB_THINKING_DISPLAY CLAUDE_WEB_CONTEXT_WINDOWS CLAUDE_WEB_MODEL_CAPS ELECTRON_RUN_AS_NODE`。下文写作 `$CLEAN`：
  `CLEAN="env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_WEB_DIST -u ANTHROPIC_DEFAULT_OPUS_MODEL -u ANTHROPIC_DEFAULT_SONNET_MODEL -u ANTHROPIC_DEFAULT_HAIKU_MODEL -u CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION -u CLAUDE_WEB_THINKING_DISPLAY -u CLAUDE_WEB_CONTEXT_WINDOWS -u CLAUDE_WEB_MODEL_CAPS -u ELECTRON_RUN_AS_NODE"`
- 提交身份 `ypyik0669`（已是 git user）。不要 `git add -A`：`site/package.json`、`site/package-lock.json` 有用户未决定的改动，不要提交。
- 真机验证用临时 `CLAUDE_WEB_DIR` / HOME，别碰 `~/.claude-web`。

---

### Task 1: 回答里的链接分派（A1 前端）

**Files:**
- Create: `web/src/features/chat/link-route.ts`
- Create: `web/src/features/chat/link-route.test.ts`
- Modify: `web/src/features/chat/Markdown.tsx`（`openLink` 约第 22 行，`a` 组件约第 43–48 行）

**Interfaces:**
- Produces: `routeLink(href: string, cwd: string | undefined): LinkRoute`；`type LinkRoute = { to: 'web'; url: string } | { to: 'file'; path: string; line?: number } | { to: 'external'; url: string } | { to: 'anchor' } | { to: 'none' }`；`followLink(r: LinkRoute, sessionId: string | null | undefined): void`（stage B 会改 `web` 分支）。

- [ ] **Step 1: 写失败的测试**

```ts
// web/src/features/chat/link-route.test.ts
import { describe, expect, it } from 'vitest';
import { routeLink } from './link-route';

describe('routeLink', () => {
  it('web pages', () => {
    expect(routeLink('https://example.com/a?b=1', undefined)).toEqual({ to: 'web', url: 'https://example.com/a?b=1' });
    expect(routeLink('HTTP://x.dev', undefined)).toEqual({ to: 'web', url: 'HTTP://x.dev' });
  });
  it('mail / tel go to the system', () => {
    expect(routeLink('mailto:a@b.c', undefined)).toEqual({ to: 'external', url: 'mailto:a@b.c' });
    expect(routeLink('tel:123', undefined)).toEqual({ to: 'external', url: 'tel:123' });
  });
  it('dangerous or unknown schemes open nothing', () => {
    expect(routeLink('javascript:alert(1)', undefined)).toEqual({ to: 'none' });
    expect(routeLink('data:text/html,<b>x</b>', undefined)).toEqual({ to: 'none' });
    expect(routeLink('vbscript:x', undefined)).toEqual({ to: 'none' });
    expect(routeLink('', undefined)).toEqual({ to: 'none' });
  });
  it('in-page anchors are left to the page', () => {
    expect(routeLink('#fn-1', '/p')).toEqual({ to: 'anchor' });
  });
  it('file:// and absolute paths are files', () => {
    expect(routeLink('file:///C:/Users/a/draft%20preview.html', undefined)).toEqual({ to: 'file', path: 'C:/Users/a/draft preview.html' });
    expect(routeLink('file:///home/a/x.md', undefined)).toEqual({ to: 'file', path: '/home/a/x.md' });
    expect(routeLink('C:\\work\\x.html', undefined)).toEqual({ to: 'file', path: 'C:\\work\\x.html' });
    expect(routeLink('/C:/work/x.html', undefined)).toEqual({ to: 'file', path: 'C:/work/x.html' });
    expect(routeLink('/Users/a/x.svg', undefined)).toEqual({ to: 'file', path: '/Users/a/x.svg' });
  });
  it('relative paths resolve against the conversation folder', () => {
    expect(routeLink('preview.html', 'C:/proj')).toEqual({ to: 'file', path: 'C:/proj/preview.html' });
    expect(routeLink('./out/a.md', 'C:\\proj\\')).toEqual({ to: 'file', path: 'C:/proj/out/a.md' });
    expect(routeLink('../b/c.txt', '/home/u/proj')).toEqual({ to: 'file', path: '/home/u/b/c.txt' });
    expect(routeLink('preview.html', undefined)).toEqual({ to: 'none' });
  });
  it('line numbers: path:12 and #L12', () => {
    expect(routeLink('src/a.ts:12', '/p')).toEqual({ to: 'file', path: '/p/src/a.ts', line: 12 });
    expect(routeLink('src/a.ts#L7', '/p')).toEqual({ to: 'file', path: '/p/src/a.ts', line: 7 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run web/src/features/chat/link-route.test.ts --root web`
Expected: FAIL（`Cannot find module './link-route'`）

- [ ] **Step 3: 实现**

```ts
// web/src/features/chat/link-route.ts
import { useStore } from '@/store';
import { desktop } from '@/desktop';
import { blockRemoteOpen } from '@/features/remote-guard';

/**
 * Where a link in a reply goes (spec 2026-10-24 A1). Every link in a reply is decided here: a page → the browser,
 * a file Claude made → the in-app preview, mail / tel → the system, anything else → nothing. Left to Electron, a
 * relative link resolved against the app's own address and took the whole window off the app (the mac white screen).
 */
export type LinkRoute =
  | { to: 'web'; url: string }
  | { to: 'file'; path: string; line?: number }
  | { to: 'external'; url: string }
  | { to: 'anchor' }
  | { to: 'none' };

const DRIVE = /^[a-zA-Z]:[\\/]/;

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function withLine(path: string): { path: string; line?: number } {
  const hash = /#L(\d+)$/.exec(path);
  if (hash) return { path: path.slice(0, hash.index), line: Number(hash[1]) };
  const colon = /^(.*[^:\\/]):(\d+)$/.exec(path);
  if (colon && !DRIVE.test(path.slice(-3))) return { path: colon[1], line: Number(colon[2]) };
  return { path };
}

function join(base: string, rel: string): string {
  const parts = base.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  for (const seg of rel.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length > 1) parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

function file(path: string): LinkRoute {
  const { path: p, line } = withLine(path);
  return line === undefined ? { to: 'file', path: p } : { to: 'file', path: p, line };
}

export function routeLink(href: string, cwd: string | undefined): LinkRoute {
  const h = href.trim();
  if (!h) return { to: 'none' };
  if (h.startsWith('#')) return { to: 'anchor' };
  if (/^https?:/i.test(h)) return { to: 'web', url: h };
  if (/^(mailto|tel):/i.test(h)) return { to: 'external', url: h };
  if (/^file:/i.test(h)) {
    const p = decode(h.replace(/^file:\/\/(localhost)?/i, ''));
    return file(/^\/[a-zA-Z]:[\\/]/.test(p) ? p.slice(1) : p);
  }
  if (DRIVE.test(h)) return file(decode(h));
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return { to: 'none' };
  if (h.startsWith('/')) { const p = decode(h); return file(/^\/[a-zA-Z]:[\\/]/.test(p) ? p.slice(1) : p); }
  if (!cwd) return { to: 'none' };
  return file(join(cwd, decode(h)));
}

export function openExternal(url: string): void {
  if (desktop) void desktop.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/** Acts on a route. `sessionId`: the conversation the link is in (a remote one's files are on that machine). */
export function followLink(r: LinkRoute, sessionId: string | null | undefined): void {
  if (r.to === 'web' || r.to === 'external') return openExternal(r.url);
  if (r.to !== 'file') return;
  if (blockRemoteOpen(sessionId, r.path)) return;
  useStore.getState().openTile({ id: `d${Date.now().toString(36)}`, kind: 'doc', path: r.path, ...(r.line ? { line: r.line } : {}) }, 'tab');
}
```

注意 `withLine` 里 `colon` 对 `C:/x` 这种只有盘符的不误判：`src/a.ts:12` → line 12；`C:/proj/a.ts`（没有数字结尾）不匹配。若 `vitest` 的 `C:\\work\\x.html` 用例失败，检查 `DRIVE` 分支在 `scheme` 正则之前。

- [ ] **Step 4: 接到 Markdown**

把 `Markdown.tsx` 的 `openLink` 函数删掉，`a` 组件改成：

```tsx
  a({ href, children }) {
    const ctx = usePaneCtx();
    const sid = ctx?.sessionId ?? null;
    const cwd = useStore((s) => (sid ? s.open[sid]?.cwd : undefined));
    return (
      <a
        href={href}
        title={href}
        onClick={(e) => {
          const r = routeLink(href ?? '', cwd);
          if (r.to === 'anchor') return;
          e.preventDefault();
          followLink(r, sid ?? useStore.getState().activeId);
        }}
      >
        {children}
      </a>
    );
  },
```

顶部加 `import { usePaneCtx } from '@/store/paneContext';` 和 `import { followLink, routeLink } from './link-route';`；如果 `desktop` import 不再被用，删掉它。全文搜 `openLink(` 确认没有别处调用（有的话改用 `openExternal`）。

- [ ] **Step 5: 跑测试**

Run: `npx vitest run web/src/features/chat/link-route.test.ts --root web && npx tsc --noEmit -p web`
Expected: PASS，无类型错误

- [ ] **Step 6: Commit**

```bash
git add web/src/features/chat/link-route.ts web/src/features/chat/link-route.test.ts web/src/features/chat/Markdown.tsx
git commit -m "fix: every link in a reply is routed (files open in the app, pages outside); a relative link no longer navigates the window"
```

---

### Task 2: 主窗口不离开应用、崩了自己恢复（A1 桌面）

**Files:**
- Create: `desktop/src/nav-guard.ts`
- Create: `desktop/src/nav-guard.test.ts`
- Modify: `desktop/src/main.ts`（`will-navigate` 约第 250 行；`createWindow` 里加 `did-fail-load` / `render-process-gone`；新函数 `crashUrl` 放在 `splashUrl` 后面约第 189 行）
- Modify: `desktop/src/en.ts`（新字的英文）
- Modify: `web/src/main.tsx`（`recovered` 参数 → toast）
- Modify: `web/src/i18n/en.ts` 或 web 对应英文目录（看 `docs/notes/i18n.md` 哪份目录管 `main.tsx` 的字）

**Interfaces:**
- Produces: `allowNavigation(target: string, appUrl: string | undefined): boolean`；`sameOrigin(a: string, b: string | undefined): boolean`；`class CrashGuard { hit(now?: number): 'reload' | 'stop' }`

- [ ] **Step 1: 写失败的测试**

```ts
// desktop/src/nav-guard.test.ts
import { describe, expect, it } from 'vitest';
import { CrashGuard, allowNavigation, sameOrigin } from './nav-guard';

const APP = 'http://127.0.0.1:3090/?token=abc&win=main';

describe('allowNavigation', () => {
  it('only the app page itself', () => {
    expect(allowNavigation('http://127.0.0.1:3090/?token=abc&win=main', APP)).toBe(true);
    expect(allowNavigation('http://127.0.0.1:3090/', APP)).toBe(true);
    expect(allowNavigation('http://127.0.0.1:3090/index.html?x=1', APP)).toBe(true);
  });
  it('a relative link resolved against the app (the white screen) is refused', () => {
    expect(allowNavigation('http://127.0.0.1:3090/draft-preview.html', APP)).toBe(false);
    expect(allowNavigation('http://127.0.0.1:3090/C:/Users/a/x.html', APP)).toBe(false);
  });
  it('other origins, file:, data: and garbage are refused', () => {
    expect(allowNavigation('http://127.0.0.1:3091/', APP)).toBe(false);
    expect(allowNavigation('https://example.com/', APP)).toBe(false);
    expect(allowNavigation('file:///C:/x.html', APP)).toBe(false);
    expect(allowNavigation('data:text/html,x', APP)).toBe(false);
    expect(allowNavigation('not a url', APP)).toBe(false);
    expect(allowNavigation('http://127.0.0.1:3090/', undefined)).toBe(false);
  });
  it('sameOrigin', () => {
    expect(sameOrigin('http://127.0.0.1:3090/x', APP)).toBe(true);
    expect(sameOrigin('https://example.com', APP)).toBe(false);
    expect(sameOrigin('http://127.0.0.1:3090/x', undefined)).toBe(false);
  });
});

describe('CrashGuard', () => {
  it('reloads twice, stops on the third crash within a minute', () => {
    const g = new CrashGuard(3, 60_000);
    expect(g.hit(0)).toBe('reload');
    expect(g.hit(10_000)).toBe('reload');
    expect(g.hit(20_000)).toBe('stop');
  });
  it('old crashes fall out of the window', () => {
    const g = new CrashGuard(3, 60_000);
    g.hit(0); g.hit(1000);
    expect(g.hit(70_000)).toBe('reload');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run src/nav-guard.test.ts`
Expected: FAIL（找不到模块）

- [ ] **Step 3: 实现 nav-guard**

```ts
// desktop/src/nav-guard.ts
/**
 * The main window never leaves the app page (spec 2026-10-24 A1): a relative link in a reply resolved against the app's
 * own address used to pass the old origin check and load a page that is not there — the window went blank (mac, twice).
 * Links are opened by the page itself (web/src/features/chat/link-route.ts); here only the app page may load.
 */
export function sameOrigin(a: string, b: string | undefined): boolean {
  if (!b) return false;
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

export function allowNavigation(target: string, appUrl: string | undefined): boolean {
  if (!appUrl || !sameOrigin(target, appUrl)) return false;
  const p = new URL(target).pathname;
  return p === '/' || p === '/index.html';
}

/** A renderer that keeps dying is not reloaded for ever: `limit` crashes inside `windowMs` → stop on a notice page. */
export class CrashGuard {
  private hits: number[] = [];
  constructor(private limit = 3, private windowMs = 60_000) {}
  hit(now = Date.now()): 'reload' | 'stop' {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    this.hits.push(now);
    return this.hits.length >= this.limit ? 'stop' : 'reload';
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `cd desktop && npx vitest run src/nav-guard.test.ts`
Expected: PASS

- [ ] **Step 5: 接到 main.ts**

顶部 import：`import { CrashGuard, allowNavigation, sameOrigin } from './nav-guard';`

把 `will-navigate` 换成：

```ts
  win.webContents.on('will-navigate', (e, target) => {
    if (allowNavigation(target, host.info?.url)) return;
    e.preventDefault();
    // a page link that got past the page's own handler still opens outside; anything else (a file, a path on the
    // app's own address) is not a page to show here
    if (/^https?:/i.test(target) && !sameOrigin(target, host.info?.url)) void shell.openExternal(target);
  });
```

在 `splashUrl` 后面加：

```ts
/** What a window shows after its page crashed three times in a minute: no reload loop; the conversations run on in the server. */
function crashUrl(dark: boolean, appUrl: string): string {
  const [bg, fg, mut] = dark ? ['#12110f', '#c4c2be', '#868480'] : ['#f7f6f2', '#47433f', '#7f7b77'];
  const html = `<!doctype html><html lang="${getLocale() === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><title>${APP_NAME}</title><style>`
    + `html,body{height:100%;margin:0;background:${bg};color:${fg};font:14px "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",system-ui,sans-serif}`
    + `body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;-webkit-app-region:drag}`
    + `.s{color:${mut};max-width:420px;text-align:center;line-height:1.6}a{-webkit-app-region:no-drag;color:inherit;border:1px solid ${mut};border-radius:8px;padding:6px 14px;text-decoration:none}`
    + `</style></head><body><div>${tr('页面连续出错')}</div><div class="s">${tr('对话还在后台运行，不受影响。')}</div>`
    + `<a href="${appUrl.replace(/"/g, '&quot;')}">${tr('重新加载')}</a></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
```

注意：crash 页里的「重新加载」是一个指向应用地址的 `<a>`，`will-navigate` 会放行（目标是应用页）。

在 `createWindow` 里（紧挨 `will-navigate` 之后）加：

```ts
  const crashes = new CrashGuard();
  const recover = () => {
    const base = host.info?.url;
    if (!base || win.isDestroyed()) return;
    if (crashes.hit() === 'stop') { void win.loadURL(crashUrl(nativeTheme.shouldUseDarkColors, windowUrl(base, winId))); return; }
    const u = new URL(windowUrl(base, winId));
    u.searchParams.set('recovered', '1');
    void win.loadURL(u.toString());
  };
  win.webContents.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') recover(); });
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    // -3 = ABORTED (a navigation we cancelled ourselves); only the app page's own load counts
    if (isMainFrame && code !== -3 && sameOrigin(url, host.info?.url)) recover();
  });
```

（`nativeTheme` 已在第 1 行 import。若 `createWindow` 里已有名为 `crashes` / `recover` 的变量就换名。）

`desktop/src/en.ts` 加三条：`'页面连续出错': 'The page keeps crashing'`、`'对话还在后台运行，不受影响。': 'Your conversations keep running in the background.'`、`'重新加载': 'Reload'`（按该文件现有格式写；`重新加载` 已存在就不重复）。

- [ ] **Step 6: web 端提示**

在 `web/src/main.tsx` 里 store 建好之后（`createRoot` 之前或之后都可，找到 `useStore` 的 import）加：

```ts
{
  const q = new URLSearchParams(location.search);
  if (q.has('recovered')) {
    q.delete('recovered');
    history.replaceState(history.state, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
    setTimeout(() => useStore.getState().toast(tr('页面出错，已恢复'), true), 1200);
  }
}
```

并按 `docs/notes/i18n.md` 把「页面出错，已恢复」的英文 `The page crashed and was restored` 加进 web 的英文目录。

- [ ] **Step 7: 类型检查 + i18n**

Run: `npx tsc --noEmit -p desktop && npx tsc --noEmit -p web && node scripts/i18n/extract.mjs --check`
Expected: 全部通过

- [ ] **Step 8: 真机验证（Windows 模拟）**

按 `docs/notes/desktop.md` 的办法用临时 `CLAUDE_WEB_DIR` 起开发版桌面（`$CLEAN` 前缀）。在主窗口开发者工具 console 里：
1. `location.assign('/draft-preview.html')` → 窗口不变（还是应用）。
2. `location.assign('file:///C:/Windows/win.ini')` → 窗口不变。
3. 另开 PowerShell：`Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ? CommandLine -match '--type=renderer' | % { Stop-Process -Id $_.ProcessId -Force }` → 窗口自己重新加载并弹「页面出错，已恢复」。连杀三次（一分钟内）→ 出现「页面连续出错」页，点「重新加载」回到应用。
记录结果；mac 没法验证，交付时写明。

- [ ] **Step 9: Commit**

```bash
git add desktop/src/nav-guard.ts desktop/src/nav-guard.test.ts desktop/src/main.ts desktop/src/en.ts web/src/main.tsx web/src/i18n
git commit -m "fix(desktop): the main window only ever shows the app page; a crashed or failed page reloads itself (stops after 3 in a minute)"
```

（`git add web/src/i18n` 只在 Step 6 改了那里时需要；按实际改动的英文目录文件写路径。）

---

### Task 3: 菜单不被裁（A2）

**Files:**
- Modify: `web/src/styles/scroll-fade.css`（文件末尾加一段）
- Modify: `web/src/features/sidebar/menus.tsx:40-46`
- Modify: `web/src/features/sidebar/place.test.ts`（加用例）
- Modify: `scripts/ui-smoke.cjs`（新 phase，见 Task 9 统一加）

- [ ] **Step 1: 加 place 的矮窗口测试**

在 `place.test.ts` 末尾的 `describe` 里加：

```ts
  it('a menu taller than the room on either side is pinned to the top with a max height', () => {
    const spot = placeFixed({ left: 100, top: 300, right: 300, bottom: 328 }, { w: 200, h: 500 }, { vw: 1200, vh: 600 });
    expect(spot.top).toBe(8);
    expect(spot.maxHeight).toBe(584);
  });
```

Run: `npx vitest run web/src/features/sidebar/place.test.ts --root web`
Expected: PASS（现有逻辑已经这样钉；这个测试锁住行为）

- [ ] **Step 2: 钉住时可以滚动**

`menus.tsx` 第 40 行的 `Object.assign(el.style, { position: 'fixed', right: 'auto', bottom: 'auto', maxHeight: '' });` 改成同时清掉 `overflowY`：

```ts
      Object.assign(el.style, { position: 'fixed', right: 'auto', bottom: 'auto', maxHeight: '', overflowY: '', overscrollBehavior: '' });
```

第 46 行改成：

```ts
      if (spot.maxHeight) Object.assign(el.style, { maxHeight: `${spot.maxHeight}px`, overflowY: 'auto', overscrollBehavior: 'contain' });
```

- [ ] **Step 3: mask 不裁开着的菜单**

`scroll-fade.css` 末尾加：

```css
/* a menu drawn in place (position: fixed, inside a row of the list) is clipped to the list's box by the mask — the
   sidebar's ··· menu lost its top under 新对话 (2026-10-24, user screenshot). While a menu is open in a list, no fade. */
@supports (animation-timeline: scroll()) {
  :is(.chat, .welcome, .sb-list, .sb-attn-list, .cmdk .list, .dirmenu-list, .branch-menu .list, .ft-body, .git-body, .rv-git-body, .search-results, .memory-list):has(.menu) {
    -webkit-mask-image: none;
    mask-image: none;
  }
}
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit -p web`
Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add web/src/styles/scroll-fade.css web/src/features/sidebar/menus.tsx web/src/features/sidebar/place.test.ts
git commit -m "fix: a menu opened inside a fading list is no longer cut off (the list's mask clipped it); a pinned menu scrolls"
```

---

### Task 4: 网吧滚轮（A3）

**Files:**
- Create: `web/src/ui/wheel-zoom.ts`
- Create: `web/src/ui/wheel-zoom.test.ts`
- Modify: `web/src/features/cafe/Cafe.tsx`（`at` 约第 132 行；`onWheel` 约第 188–196 行；`<canvas onWheel=…>`）

**Interfaces:**
- Produces: `wheelZoom(scale: number, e: { deltaY: number; shiftKey: boolean }, o: { min: number; max: number; step: number }): number | null`（D 阶段节点图也用）

- [ ] **Step 1: 写失败的测试**

```ts
// web/src/ui/wheel-zoom.test.ts
import { describe, expect, it } from 'vitest';
import { wheelZoom } from './wheel-zoom';

const O = { min: 0.25, max: 8, step: 1.25 };

describe('wheelZoom', () => {
  it('wheel up zooms in, down zooms out', () => {
    expect(wheelZoom(1, { deltaY: -100, shiftKey: false }, O)).toBeCloseTo(1.25);
    expect(wheelZoom(1, { deltaY: 100, shiftKey: false }, O)).toBeCloseTo(0.8);
  });
  it('clamps at the limits', () => {
    expect(wheelZoom(7, { deltaY: -100, shiftKey: false }, O)).toBe(8);
    expect(wheelZoom(0.3, { deltaY: 100, shiftKey: false }, O)).toBe(0.25);
  });
  it('already at a limit and pushing on: the page scrolls (null)', () => {
    expect(wheelZoom(8, { deltaY: -100, shiftKey: false }, O)).toBeNull();
    expect(wheelZoom(0.25, { deltaY: 100, shiftKey: false }, O)).toBeNull();
  });
  it('Shift always leaves the wheel to the page; a sideways-only wheel too', () => {
    expect(wheelZoom(1, { deltaY: -100, shiftKey: true }, O)).toBeNull();
    expect(wheelZoom(1, { deltaY: 0, shiftKey: false }, O)).toBeNull();
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `npx vitest run web/src/ui/wheel-zoom.test.ts --root web`
Expected: FAIL（找不到模块）

- [ ] **Step 3: 实现**

```ts
// web/src/ui/wheel-zoom.ts
/**
 * The wheel over something that zooms (the cafe, a node graph — spec 2026-10-24 A3): it zooms and the page stays put;
 * at the zoom's limit, pushing on scrolls the page instead (nobody gets stuck); Shift always scrolls the page.
 * `null`: leave this wheel to the page. The listener must be non-passive to keep the page still (React's onWheel is passive).
 */
export function wheelZoom(scale: number, e: { deltaY: number; shiftKey: boolean }, o: { min: number; max: number; step: number }): number | null {
  if (e.shiftKey || e.deltaY === 0) return null;
  const next = Math.max(o.min, Math.min(o.max, scale * (e.deltaY < 0 ? o.step : 1 / o.step)));
  return Math.abs(next - scale) < 1e-9 ? null : next;
}
```

- [ ] **Step 4: 跑测试**

Run: `npx vitest run web/src/ui/wheel-zoom.test.ts --root web`
Expected: PASS

- [ ] **Step 5: 接到 Cafe**

1. `at` 的参数类型从 `React.PointerEvent | React.MouseEvent` 改成 `{ clientX: number; clientY: number }`（函数体只用 `clientX` / `clientY`；若用了别的字段，改成从这两个算）。
2. 删掉 `const onWheel = …` 整段和 `<canvas>` 上的 `onWheel={onWheel}`。
3. 加（放在其它 `useEffect` 后面、`if (broken) return null;` 之前）：

```tsx
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  wheel.current = (e: WheelEvent) => {
    const v = viewNow();
    if (!v) return;
    const scale = wheelZoom(v.scale, e, { min: 0.25, max: 8, step: 1.25 });
    if (scale === null) return;
    e.preventDefault();
    const p = at(e);
    const f = scale / v.scale;
    user.current = { scale, x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f };
  };
  useEffect(() => {
    const c = can.current;
    if (!c) return;
    const on = (e: WheelEvent) => wheel.current(e);
    c.addEventListener('wheel', on, { passive: false });
    return () => c.removeEventListener('wheel', on);
  }, [broken]);
```

顶部加 `import { wheelZoom } from '@/ui/wheel-zoom';`。（hooks 必须在 `if (broken) return null` 之前，否则违反 hooks 规则。）

- [ ] **Step 6: 类型检查 + 现有网吧测试**

Run: `npx tsc --noEmit -p web && npx vitest run web/src/features/cafe --root web`
Expected: 通过

- [ ] **Step 7: Commit**

```bash
git add web/src/ui/wheel-zoom.ts web/src/ui/wheel-zoom.test.ts web/src/features/cafe/Cafe.tsx
git commit -m "fix(cafe): the wheel over the cafe only zooms (page scrolls at the zoom limit or with Shift)"
```

---

### Task 5: 双击选词 + 选区菜单的「旁聊」（A4）

**Files:**
- Create: `web/src/features/chat/dblclick-select.ts`
- Create: `web/src/features/chat/dblclick-select.test.ts`
- Modify: `web/src/features/chat/SelectionMenu.tsx`（effect 里 `show` 定义处约第 127 行，监听注册约第 161–167 行；`KEYS` / 菜单项表约第 110、221 行；`case 'quote'` 约第 211 行）
- Modify: `web/src/features/chat/selection-menu.ts`（`SelItem`、`SelContext`、`selectionItems`）
- Modify: `web/src/features/chat/selection-menu.test.ts`
- Modify: `web/src/features/chat/side-chat.ts`、`web/src/features/chat/SideChat.tsx`

**Interfaces:**
- Produces: `wordAt(text: string, offset: number): [number, number] | null`；`refineDoubleClick(e: MouseEvent, root: HTMLElement): boolean`；`openSideChat(sessionId: string, question?: string, draft?: string): void`

- [ ] **Step 1: 先复现现在双击选了什么**

在 ui-smoke 的 `chat-turns` phase 里（种子对话已加载的地方）临时加一段并跑一次（Task 9 会把正式断言放进去）：

```js
const dbl = await js(`(() => { const c = document.querySelector('.pane.focused .msg.assistant .msg-text code:not(pre code)'); if (!c) return 'no inline code'; const r = c.getBoundingClientRect(); const o = { bubbles: true, clientX: r.left + 3, clientY: r.top + r.height / 2, detail: 2 }; c.dispatchEvent(new MouseEvent('dblclick', o)); return { code: c.textContent, sel: getSelection().toString() }; })()`);
log('A4 repro ' + JSON.stringify(dbl));
```

注意合成的 dblclick 不会触发浏览器默认选词；复现「现在选中什么」要用 `wc.sendInputEvent` 发两次真实的 mouseDown/mouseUp（`clickCount: 2`）。ui-smoke 里已有 `click()` 助手，看它是否用 `sendInputEvent`；用同样方式发 `{ type: 'mouseDown', x, y, button: 'left', clickCount: 2 }` + `mouseUp`。把复现结果记进 `docs/notes/phase09-chat.md`（Task 9）。如果复现发现是某个 CSS（如 `user-select: all`）或某个监听器扩大了选区，先修那个根因，再继续下面的步骤。

- [ ] **Step 2: 写 wordAt 的失败测试**

```ts
// web/src/features/chat/dblclick-select.test.ts
import { describe, expect, it } from 'vitest';
import { wordAt } from './dblclick-select';

describe('wordAt', () => {
  it('an English word, with underscores kept together', () => {
    const t = 'the activation_status changed';
    expect(wordAt(t, 6)).toEqual([4, 21]);
  });
  it('a Chinese word, not the whole sentence', () => {
    const t = '说明填了验证码之后';
    const [s, e] = wordAt(t, 0)!;
    expect(t.slice(s, e).length).toBeLessThan(t.length);
    expect(t.slice(s, e).length).toBeGreaterThan(0);
  });
  it('on a space or punctuation: nothing', () => {
    expect(wordAt('a b', 1)).toBeNull();
    expect(wordAt('a，b', 1)).toBeNull();
  });
  it('offset at the very end of the text belongs to the last word', () => {
    expect(wordAt('hello', 5)).toEqual([0, 5]);
  });
});
```

Run: `npx vitest run web/src/features/chat/dblclick-select.test.ts --root web`
Expected: FAIL（找不到模块）

- [ ] **Step 3: 实现**

```ts
// web/src/features/chat/dblclick-select.ts
/**
 * Double-click in a reply selects one thing (spec 2026-10-24 A4, like the official app): an inline code span whole
 * (`activation_status`), else the word under the pointer — Chinese split into words, not the run of characters up to
 * the next punctuation. A triple click (the paragraph) is left alone.
 */
const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;

export function wordAt(text: string, offset: number): [number, number] | null {
  if (!seg) return null;
  for (const s of seg.segment(text)) {
    const start = s.index, end = s.index + s.segment.length;
    if (offset >= start && (offset < end || (offset === end && end === text.length))) return s.isWordLike ? [start, end] : null;
  }
  return null;
}

function caret(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  if (d.caretPositionFromPoint) { const p = d.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null; }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

/** Re-selects after a double click inside `root`'s reply text; true when it changed the selection. */
export function refineDoubleClick(e: MouseEvent, root: HTMLElement): boolean {
  if (e.detail !== 2) return false;
  const target = e.target instanceof Element ? e.target : null;
  if (!target || !root.contains(target) || !target.closest('.msg-text')) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  const code = target.closest('code');
  if (code && !code.closest('pre, .code')) {
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(code);
    sel.addRange(r);
    return true;
  }
  const c = caret(e.clientX, e.clientY);
  if (!c || c.node.nodeType !== Node.TEXT_NODE) return false;
  const data = (c.node as Text).data;
  // the caret sits at a word's end when the pointer is on its right half: try the character before too
  const w = wordAt(data, c.offset) ?? (c.offset > 0 ? wordAt(data, c.offset - 1) : null);
  if (!w) return false;
  sel.setBaseAndExtent(c.node, w[0], c.node, w[1]);
  return true;
}
```

`Intl.Segmenter` 的 `zh` 对 `activation_status` 是否当一个词：若测试显示被 `_` 拆开，在 `wordAt` 里把相邻、中间只隔 `_` 的 word-like 段合并（循环里记住上一段）。以测试为准。

- [ ] **Step 4: 跑测试**

Run: `npx vitest run web/src/features/chat/dblclick-select.test.ts --root web`
Expected: PASS

- [ ] **Step 5: 接到 SelectionMenu**

在 effect 里 `show` 定义之后加：

```ts
    const dbl = (e: MouseEvent) => { if (refineDoubleClick(e, el)) show(); };
```

注册处加 `el.addEventListener('dblclick', dbl);`，清理处加 `el.removeEventListener('dblclick', dbl);`。顶部 `import { refineDoubleClick } from './dblclick-select';`。

- [ ] **Step 6: 「旁聊」菜单项（先改测试）**

`selection-menu.test.ts` 第 6 行附近加一个用例：

```ts
  it('travels with 引用: 旁聊 when the conversation can take a side question', () => {
    expect(selectionItems({ inCode: false, msg: 'assistant', hasText: true, canFork: true, canSide: true })).toEqual([['copy'], ['copyMsg', 'copyMd'], ['quote', 'side'], ['pin', 'fork']]);
    expect(selectionItems({ inCode: false, msg: 'assistant', hasText: true, canFork: true, canSide: false })[2]).toEqual(['quote']);
  });
```

Run: `npx vitest run web/src/features/chat/selection-menu.test.ts --root web` → FAIL。

`selection-menu.ts`：`SelItem` 加 `'side'`；`SelContext` 加 `/** a live conversation of this machine: it can take a side question */ canSide?: boolean;`；`selectionItems` 第三组改成 `['quote', ...(c.canSide ? (['side'] as const) : [])]`。

`SelectionMenu.tsx`：
- 调 `selectionItems({ … })` 的地方加 `canSide`，算法照 `web/src/features/workbench/tiles/ChatTile.tsx` 第 67 行「旁聊」按钮的 `live && !remote`（在 ChatTile 里找 `live` / `remote` 的定义照抄，用 `useStore.getState()` 读）。
- 菜单项表（第 221 行 `quote:` 旁边）加：`side: { icon: 'chat', l: tr('旁聊'), d: tr('带上这段，在旁边问一句，不打断这条对话') },`
- `case 'quote'` 旁边加：`case 'side': return openSideChat(sessionId, undefined, `> ${snap.text.replace(/\n/g, '\n> ')}\n\n`);`
- `import { openSideChat } from './side-chat';`

`side-chat.ts`：`SideChatState` 加 `/** text to put in the card's input line when it opens (a quoted selection); taken once */ draft: string;`，初值 `draft: ''`；`openSideChat(sessionId: string, question?: string, draft?: string)` 里 `setState` 加 `draft: draft ?? ''`。`closeSideChat` 里也 `draft: ''`。

`SideChat.tsx`：在第 17 行聚焦的 effect 旁边加：

```tsx
  useEffect(() => {
    const d = useSideChat.getState().draft;
    if (open && d) { setQ(d); useSideChat.setState({ draft: '' }); }
  }, [open, focusTick]);
```

- [ ] **Step 7: 跑测试 + 类型 + i18n**

Run: `npx vitest run web/src/features/chat --root web && npx tsc --noEmit -p web && node scripts/i18n/extract.mjs --check`
Expected: 通过（i18n 报缺英文时把 `旁聊`（若已有就不用）和「带上这段，在旁边问一句，不打断这条对话」→ `Ask about this on the side, without interrupting the conversation` 加进英文目录）

- [ ] **Step 8: Commit**

```bash
git add web/src/features/chat/dblclick-select.ts web/src/features/chat/dblclick-select.test.ts web/src/features/chat/SelectionMenu.tsx web/src/features/chat/selection-menu.ts web/src/features/chat/selection-menu.test.ts web/src/features/chat/side-chat.ts web/src/features/chat/SideChat.tsx web/src/i18n
git commit -m "feat(chat): double-click selects one word / a whole inline code span; the selection menu gets 旁聊 with the quote filled in"
```

---

### Task 6: 上下文卡的颜色、顺序和缓存（A5 前端）

**Files:**
- Modify: `web/src/features/info/info-model.ts:47-82`
- Modify: `web/src/features/info/info-model.test.ts`（若不存在则 Create）
- Modify: `web/src/features/info/InfoColumn.tsx:160-194`
- Modify: `web/src/features/info/info.css:53-55`

**Interfaces:**
- Produces: `type CtxTone = 'messages' | 'tools' | 'mcp' | 'skills' | 'other'`；`toneOf(name: string): CtxTone`；`CtxBreakdown.used` 元素从 `{ swatch: number }` 改为 `{ tone: CtxTone }`

- [ ] **Step 1: 写失败的测试**

```ts
// 加到 web/src/features/info/info-model.test.ts
import { describe, expect, it } from 'vitest';
import { contextBreakdown, toneOf } from './info-model';

describe('context colours (A5)', () => {
  it('each category always has its own colour; unknown names are grey', () => {
    expect(toneOf('Messages')).toBe('messages');
    expect(toneOf('System tools')).toBe('tools');
    expect(toneOf('[ANT-ONLY] System tools')).toBe('tools');
    expect(toneOf('MCP tools')).toBe('mcp');
    expect(toneOf('Skills')).toBe('skills');
    expect(toneOf('System prompt')).toBe('other');
    expect(toneOf('Something new')).toBe('other');
  });
  it('used categories biggest first; buffer / free / deferred kept apart', () => {
    const b = contextBreakdown({
      rawMaxTokens: 700_000, totalTokens: 520_000,
      categories: [
        { name: 'System prompt', tokens: 8600 },
        { name: 'Messages', tokens: 482_300 },
        { name: 'System tools', tokens: 16_500 },
        { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
        { name: 'Free space', tokens: 89_500, kind: 'free' },
        { name: 'MCP tools (deferred)', tokens: 194_700, kind: 'deferred' },
      ],
    })!;
    expect(b.used.map((c) => c.name)).toEqual(['Messages', 'System tools', 'System prompt']);
    expect(b.used.map((c) => c.tone)).toEqual(['messages', 'tools', 'other']);
    expect(b.buffer.map((c) => c.name)).toEqual(['Autocompact buffer']);
    expect(b.deferred.map((c) => c.name)).toEqual(['MCP tools (deferred)']);
  });
});
```

Run: `npx vitest run web/src/features/info --root web` → FAIL（`toneOf` 不存在）。现有测试里若断言了 `swatch`，同步改成 `tone`。

- [ ] **Step 2: 实现**

`info-model.ts`：
- `CtxBreakdown.used` 的类型改成 `(CtxCategory & { pct: number; tone: CtxTone })[]`。
- 加：

```ts
export type CtxTone = 'messages' | 'tools' | 'mcp' | 'skills' | 'other';
const TONES: Record<string, CtxTone> = { 'Messages': 'messages', 'System tools': 'tools', 'MCP tools': 'mcp', 'Skills': 'skills' };
/** The colour a category keeps in every conversation (the official card's: messages blue, tools orange, MCP teal, skills yellow, the rest grey). */
export function toneOf(name: string): CtxTone {
  return TONES[name.replace(/^\[ANT-ONLY\]\s*/, '')] ?? 'other';
}
```

- `contextBreakdown` 里删 `let swatch = 0;`，`used:` 一行改成：

```ts
    used: cats.filter((c) => c.kind === 'used').sort((a, b) => b.tokens - a.tokens).map((c) => ({ ...c, pct: pct(c.tokens), tone: toneOf(c.name) })),
```

并把函数上方注释里关于 `swatch` 的那句改成「`tone`: a fixed colour per category (toneOf)」。

`info.css`：把 `.sw-0` … `.sw-7` 三行换成：

```css
.ctx { --ctx-messages: var(--blue); --ctx-tools: color-mix(in oklab, var(--red) 55%, var(--yellow)); --ctx-mcp: color-mix(in oklab, var(--green) 55%, var(--blue)); --ctx-skills: var(--yellow); --ctx-other: color-mix(in oklab, var(--fg) 42%, transparent); }
.ctx-t-messages { background: var(--ctx-messages); } .ctx-t-tools { background: var(--ctx-tools); } .ctx-t-mcp { background: var(--ctx-mcp); }
.ctx-t-skills { background: var(--ctx-skills); } .ctx-t-other { background: var(--ctx-other); }
```

先 `grep -rn "sw-[0-7]" web/src` 确认 `.sw-N` 只在上下文卡用；有别处用就保留旧类。

- [ ] **Step 3: 卡片：颜色、缓存、更新中、每轮结束自动刷新**

`InfoColumn.tsx` 的 `ContextCard` 换成：

```tsx
/** The last breakdown per conversation for this run of the app: the card shows it at once, then counts again. */
const ctxCache = new Map<string, { b: CtxBreakdown; at: number }>();

function ContextCard({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s.open[sessionId]?.state);
  const live = state === 'idle' || state === 'running' || state === 'waiting';
  const [data, setData] = useState(() => ctxCache.get(sessionId) ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const load = () => {
    setBusy(true);
    ws.request({ kind: 'session.contextUsage', sessionId, detail: 'full' })
      .then((u: any) => { const b = contextBreakdown(u); if (b) { const d = { b, at: Date.now() }; ctxCache.set(sessionId, d); setData(d); setErr(false); } else setErr(true); })
      .catch(() => setErr(true))
      .finally(() => setBusy(false));
  };
  useEffect(() => { setData(ctxCache.get(sessionId) ?? null); if (live) load(); }, [sessionId, live]);
  // a turn ended (running → idle) while the card is open: count again
  const prev = useRef(state);
  useEffect(() => { if (prev.current === 'running' && state === 'idle') load(); prev.current = state; }, [state]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  if (!data) return <div className="ic-dim">{!live ? tr('对话开着时才有明细') : err ? tr('这个对话的 agent 不提供明细') : tr('加载中…')}</div>;
  const { b } = data;
  const mins = Math.floor((Date.now() - data.at) / 60_000);
  return (
    <div className="ctx">
      <div className="ctx-top"><span>{tr('已用 {p}%', { p: b.percentage })}</span><span className="ic-dim">{fmtTokens(b.total)} / {fmtTokens(b.max)}</span></div>
      <div className="ctx-bar">{b.used.map((c) => <i key={c.name} className={`ctx-t-${c.tone}`} style={{ width: `${c.pct}%` }} />)}{b.buffer.map((c) => <i key={c.name} className="sw-buf" style={{ width: `${c.pct}%` }} />)}</div>
      {b.used.map((c) => (
        <div key={c.name} className="ctx-row"><i className={`ctx-t-${c.tone}`} /><span className="n">{c.name}</span><span className="t">{fmtTokens(c.tokens)}</span><span className="p">{c.pct.toFixed(1)}%</span></div>
      ))}
      {[...b.buffer, ...b.free].map((c) => (
        <div key={c.name} className="ctx-row"><i className={c.kind === 'buffer' ? 'sw-buf' : 'sw-free'} /><span className="n">{c.name}</span><span className="t">{fmtTokens(c.tokens)}</span><span className="p">{c.pct.toFixed(1)}%</span></div>
      ))}
      {b.deferred.map((c) => <div key={c.name} className="ctx-row dim"><i className="sw-free" /><span className="n">{c.name}</span><span className="t">{fmtTokens(c.tokens)}</span><span className="p">—</span></div>)}
      <CtxList title={tr('MCP 工具')} rows={b.mcpTools.map((t) => [t.name.replace(/^mcp__/, ''), t.tokens])} />
      <CtxList title={tr('记忆文件')} rows={b.memoryFiles.map((m) => [basename(m.path), m.tokens])} />
      <CtxList title={tr('自定义子代理')} rows={b.agents.map((a) => [a.name, a.tokens])} />
      <div className="ic-dim ctx-foot">{busy ? tr('更新中…') : mins < 1 ? tr('刚刚更新') : tr('{n} 分钟前更新', { n: mins })} {!busy && <button className="link" data-act="ctx-refresh" onClick={load}>{tr('刷新')}</button>}</div>
    </div>
  );
}
```

（确认 `useRef` 已从 react import。）

- [ ] **Step 4: 跑测试 + 类型 + i18n**

Run: `npx vitest run web/src/features/info --root web && npx tsc --noEmit -p web && node scripts/i18n/extract.mjs --check`
Expected: 通过（「更新中…」→ `Updating…` 加进英文目录）

- [ ] **Step 5: Commit**

```bash
git add web/src/features/info web/src/i18n
git commit -m "fix(info): context categories keep one colour each, biggest first; the card shows the last count at once and refreshes after each turn"
```

---

### Task 7: buffer 数字和实际压缩一致（A5 引擎）

工作目录：`C:\Users\YPY\claude-web-engine`（分支 `claude-web`），先读它的 `CLAUDE-WEB.md` 和本仓库 `docs/notes/engine-providers.md` 的发版流程。

**Files:**
- Modify: `src/utils/analyzeContext.ts`（第 947 行 `contextWindow`、第 1015 行 `autoCompactThreshold`）
- Possibly modify: `src/utils/context.ts`（`getConfiguredContextWindow`，约第 66–86 行）
- Create: `src/utils/__tests__/contextBufferConsistency.test.ts`
- Modify: `CLAUDE-WEB.md`、`package.json`（版本 `2.8.4-cw.7`）

- [ ] **Step 1: 复现：两个名字各解析出多大窗口**

```ts
// src/utils/__tests__/contextBufferConsistency.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { getContextWindowForModel } from '../context'
import { getAutoCompactThreshold } from '../../services/compact/autoCompact'

const saved = process.env.CLAUDE_WEB_CONTEXT_WINDOWS
afterEach(() => {
  if (saved === undefined) delete process.env.CLAUDE_WEB_CONTEXT_WINDOWS
  else process.env.CLAUDE_WEB_CONTEXT_WINDOWS = saved
})

describe('context card buffer = what autocompact really reserves', () => {
  test('a model configured at 1M resolves to 1M under every name form', () => {
    process.env.CLAUDE_WEB_CONTEXT_WINDOWS = JSON.stringify({ 'claude-opus-5-5': 1_000_000 })
    for (const m of ['claude-opus-5-5', 'claude-opus-5-5[1m]', 'anthropic/claude-opus-5-5', 'CLAUDE-OPUS-5-5'])
      expect(getContextWindowForModel(m, [])).toBe(1_000_000)
  })
  test('reserve at 1M is the output reserve plus the large-window buffer, not a third of the window', () => {
    process.env.CLAUDE_WEB_CONTEXT_WINDOWS = JSON.stringify({ 'claude-opus-5-5': 1_000_000 })
    const reserve = 1_000_000 - getAutoCompactThreshold('claude-opus-5-5')
    expect(reserve).toBeLessThanOrEqual(70_000)
    expect(reserve).toBeGreaterThan(13_000)
  })
})
```

Run: `bun test src/utils/__tests__/contextBufferConsistency.test.ts`
记录哪个断言失败：第一个失败 = 查表漏了某种写法；第二个失败 = 阈值本身算错。再加一个临时 `console.log` 打印用户场景下 `analyzeContextUsage` 的 `model` 和 `runtimeModel`（用 `getRuntimeMainLoopModel({ permissionMode: 'default', mainLoopModel: 'claude-opus-5-5' })` 和 `'plan'` 模式各算一次），确认两者为什么不同。

- [ ] **Step 2: 修**

`analyzeContext.ts` 第 1015 行改成和真实压缩同一个函数、同一个模型：

```ts
  const autoCompactThreshold = isAutoCompact ? getAutoCompactThreshold(model) : undefined
```

第 947 行改成窗口也按 `model`（真实压缩用的 `mainLoopModel`）：

```ts
  const contextWindow = getContextWindowForModel(model, getSdkBetas())
```

（`runtimeModel` 继续用于 system prompt 等其它地方；import `getAutoCompactThreshold`，删掉不再用的 `AUTOCOMPACT_BUFFER_TOKENS` import。）

若 Step 1 的第一个测试失败，在 `getConfiguredContextWindow` 里把 `id` 规范化成去掉 `[1m]`、去掉 `provider/` 前缀、小写后再匹配（现有「最长子串」逻辑保留）：

```ts
  const id = model.toLowerCase().replace(/\[1m\]$/i, '').replace(/^[^/]+\//, '')
```

- [ ] **Step 3: 跑引擎测试**

Run: `bun test src/utils/__tests__/contextBufferConsistency.test.ts src/utils/__tests__/configuredContextWindow.test.ts && bun test`
Expected: 新测试 PASS；全量和改前一样（改前先跑一次全量记下已有的失败数）

- [ ] **Step 4: 引擎发版 2.8.4-cw.7**

严格按 `docs/notes/engine-providers.md` 第 5–6 行的流程：fork 里 `package.json` 版本改 `2.8.4-cw.7`，`CLAUDE-WEB.md` 记一句改了什么，`bun run build` + 打包 tgz，提交并 push fork 的 `claude-web` 分支；在本仓库 `gh release create engine-v2.8.4-cw.7 claude-web-engine-2.8.4-cw.7.tgz --repo ypyik0669/claude-web --target main --prerelease --latest=false`；不带登录 `curl -L` 下载核对 sha512；确认 `gh api repos/ypyik0669/claude-web/releases/latest --jq .tag_name` 还是 `v0.3.2`。然后本仓库根 `package.json` 的 `claude-web-engine` 改成 `.../engine-v2.8.4-cw.7/claude-web-engine-2.8.4-cw.7.tgz`，`npm install` 更新 lock。

- [ ] **Step 5: 用新引擎实测**

用临时 `CLAUDE_WEB_DIR` 起 server（`$CLEAN npm start`），开一个配 1M 窗口的对话，展开上下文卡：Autocompact buffer 应约 70k / 7%（700k 的约 50k），不是 333k。官方二进制（`CLAUDE_WEB_RUNTIME=claude`）在同窗口下各取一次，把两个数写进笔记。

- [ ] **Step 6: Commit（本仓库）**

```bash
git add package.json package-lock.json
git commit -m "fix: engine 2.8.4-cw.7 — the context card's autocompact buffer is what autocompact really reserves (was the gap between two windows)"
```

---

### Task 8: 拿掉「新对话页的动态背景」，外观里一个「背景动画」开关（A6）

**Files:**
- Modify: `web/src/features/home/letter-flow.ts:8-12`（`BackdropStyle` / `backdropStyle`）
- Modify: `web/src/features/workbench/Welcome.tsx:32-41`
- Modify: `web/src/features/settings/catalog.ts`（第 22 行 id 列表、第 109 行条目、APPEARANCE 里 `ui.theme` 之后加新条目）
- Modify: `web/src/features/settings/SettingsModal.tsx:62`
- Modify: `web/src/features/settings/catalog.test.ts:97`
- Delete (if unused elsewhere): `web/src/features/home/AsciiField.tsx`、`web/src/features/home/ascii-noise.ts`（及 `styles.css` 里只给它用的规则）
- Test: `web/src/features/home/letter-flow.test.ts`（存在则改，不存在则 Create）

**Interfaces:**
- Produces: `backdropOn(settings: Record<string, unknown>): boolean`

- [ ] **Step 1: 写失败的测试**

```ts
// 加到 web/src/features/home/letter-flow.test.ts
import { describe, expect, it } from 'vitest';
import { backdropOn } from './letter-flow';

describe('背景动画 (A6)', () => {
  it('the new switch wins', () => {
    expect(backdropOn({ 'ui.backdropMotion': false })).toBe(false);
    expect(backdropOn({ 'ui.backdropMotion': true, 'ui.welcomeBackdrop': 'off' })).toBe(true);
  });
  it('unset: the old setting decides (off / false → off; flow / field / unset → on)', () => {
    expect(backdropOn({ 'ui.welcomeBackdrop': 'off' })).toBe(false);
    expect(backdropOn({ 'ui.welcomeBackdrop': false })).toBe(false);
    expect(backdropOn({ 'ui.welcomeBackdrop': 'field' })).toBe(true);
    expect(backdropOn({})).toBe(true);
  });
});
```

Run: `npx vitest run web/src/features/home --root web` → FAIL。

- [ ] **Step 2: 实现**

`letter-flow.ts` 把 `BackdropStyle` / `backdropStyle` 换成：

```ts
/**
 * 背景动画 (外观, spec 2026-10-24 A6 — the user: 「就做动画或者无在外观里面设置就好」): on → the new-conversation page
 * moves (a character theme's own backdrop, 字流 on the classic themes), off → still. Not set yet: the old
 * `ui.welcomeBackdrop` decides ('off' / false was off; 字流 / 字场 were on).
 */
export function backdropOn(settings: Record<string, unknown>): boolean {
  const v = settings['ui.backdropMotion'];
  if (typeof v === 'boolean') return v;
  const old = settings['ui.welcomeBackdrop'];
  return !(old === false || old === 'off');
}
```

`grep -rn "backdropStyle\|BackdropStyle" web/src` 把其余引用都改掉。

`Welcome.tsx`：

```tsx
  // nothing until the settings are in: someone who turned it off would see the default flash for a second
  const moving = useStore((s) => s.metaLoaded && backdropOn(s.settings));
```

渲染部分换成：

```tsx
      {!mobile && moving && ascii?.backdrop && <Backdrop scene="welcome" />}
      {/* keyed by the theme in effect (a system switch too): its colours are read when it starts */}
      {!mobile && moving && !ascii?.backdrop && <LetterFlow key={String(theme)} />}
```

删掉 `AsciiField` 的 import。`backdropOn(s.settings)` 返回 boolean，选择器稳定。

`catalog.ts`：
- 第 22 行 id 联合类型里 `'ui.welcomeBackdrop'` 换成 `'ui.backdropMotion'`。
- 删第 109 行 `ui.welcomeBackdrop` 条目。
- APPEARANCE 数组里 `ui.theme` 条目之后加：

```ts
  { id: 'ui.backdropMotion', block: tr('显示'), label: tr('背景动画'), hint: tr('新对话页的背景会动：字符画主题放它自己的背景，其它主题放飘动的字。关掉就是静止的纯色；系统开了「减少动态效果」时也是静止的。'), keywords: tr('background backdrop animation motion ascii welcome 背景 动画 动态 字符 新对话') },
```

`SettingsModal.tsx` 第 62 行换成：`'ui.backdropMotion': (e) => <Toggle k={e.id} label={e.label} def />,`（确认 `Toggle` 的 `def` 语义是默认开；`ui.backdropInChat` 那行就是这样用的）。

`catalog.test.ts` 第 97 行 `added` 里 `'ui.welcomeBackdrop'` 换成 `'ui.backdropMotion'`；如果有断言新条目所在分区的测试，加一句 `expect(at('ui.backdropMotion')?.section.id).toBe('appearance');`。

- [ ] **Step 3: 删字场**

`grep -rn "AsciiField\|ascii-noise" web/src`：只剩 `AsciiField.tsx` 自己和 `ascii-noise.ts` 互相引用时，删这两个文件和它们的测试，再删 `styles.css` 里只有它用的类（`grep -n "ascii-field" web/src/styles.css`）。有别处用就不删，记在提交说明里。

- [ ] **Step 4: 跑测试 + 类型 + i18n + 文案闸**

Run: `npx vitest run web/src/features/home web/src/features/settings --root web && npx tsc --noEmit -p web && node scripts/i18n/extract.mjs --check`
Expected: 通过（新字「背景动画」和 hint 的英文加进英文目录：`Background animation` / `The new-conversation page's background moves: a character theme plays its own, other themes drifting letters. Off is a still, plain background; it is also still when the system asks for reduced motion.`；删掉的旧字从英文目录里删）

- [ ] **Step 5: Commit**

```bash
git add -u web/src && git add web/src/features/home/letter-flow.test.ts
git commit -m "feat(settings): 外观 → 背景动画 (on / off) replaces 新对话页的动态背景; 字场 is gone"
```

（`git add -u web/src` 只收已跟踪文件的改动和删除；先 `git status` 确认没有带进 `site/`。）

---

### Task 9: ui-smoke 断言、全量测试、笔记

**Files:**
- Modify: `scripts/ui-smoke.cjs`（在 `phase = 'background'` 段的网吧检查之后、`crash-probe` 之前加 `phase = 'parity-a'`）
- Modify: `docs/notes/robustness.md`（A1 / A2）、`docs/notes/cafe.md`（A3）、`docs/notes/chat-input.md`（A4）、`docs/notes/phase09-chat.md` 或 `ui-redesign-2-right-panel.md`（A5 上下文卡所在的那篇）、`docs/notes/ascii-themes.md`（A6）、`docs/notes/engine-providers.md`（cw.7 一行）

- [ ] **Step 1: ui-smoke 段**

```js
        // ---- stage A of 2026-10-24 (spec desktop-parity): menus not clipped, cafe wheel, double click, context colours
        phase = 'parity-a';
        // A3: the wheel over the cafe zooms, the page does not scroll
        {
          const before = await js(`(() => { const p = document.querySelector('.bg-page'); return p ? p.scrollTop : -1; })()`);
          const r = await js(`(() => { const c = document.querySelector('.bg-page .cafe-canvas'); const b = c.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
          for (let i = 0; i < 3; i++) { wc.sendInputEvent({ type: 'mouseWheel', x: r.x, y: r.y, deltaX: 0, deltaY: -120 }); await sleep(80); }
          const after = await js(`document.querySelector('.bg-page').scrollTop`);
          check('A3: the wheel over the cafe leaves the page where it was', before === after, JSON.stringify({ before, after }));
        }
        // A2: a sidebar row's ··· menu in a short window: first and last item reachable (the list's mask clipped it)
        {
          win.setSize(1360, 600);
          await sleep(300);
          await js(`(() => { const l = document.querySelector('.sb-list'); if (l) l.scrollTop = l.scrollHeight / 2; })()`);
          await sleep(200);
          const opened = await js(`(() => { const rows = [...document.querySelectorAll('.sb-list .sb-row.sess')].filter((r) => { const b = r.getBoundingClientRect(); return b.top > 120 && b.bottom < innerHeight - 40; }); const row = rows[0]; if (!row) return false; row.querySelector('.sb-more, [data-act="more"], button[aria-haspopup]')?.click(); return true; })()`);
          await waitFor(`!!document.querySelector('.sb-list .menu, .menu.sess-menu')`, 2000);
          const reach = await js(`(() => { const m = document.querySelector('.sb-list .menu') || document.querySelector('.menu.sess-menu'); if (!m) return null; const items = [...m.querySelectorAll('button')]; const at = (b) => { const r = b.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 6)); return !!h && m.contains(h); }; m.scrollTop = 0; const first = at(items[0]); m.scrollTop = m.scrollHeight; const last = at(items[items.length - 1]); return { first, last, n: items.length }; })()`);
          check('A2: a sidebar menu in a short window — first and last item can be clicked', opened && reach && reach.first && reach.last, JSON.stringify(reach));
          await key('Escape');
          win.setSize(1360, 860);
          await sleep(300);
        }
```

A4 / A5 / A6 断言接在 `chat-turns` phase 里（那里种子对话已打开、有助手消息；A5 需要右侧信息栏，打开方式照该 phase 已有代码）：

```js
        // A4: a real double click on inline code selects the code span whole
        {
          const p = await js(`(() => { const c = document.querySelector('.pane.focused .msg.assistant .msg-text code:not(pre code)'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: Math.round(r.left + 4), y: Math.round(r.top + r.height / 2), text: c.textContent }; })()`);
          if (p) {
            wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
            wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 2 }); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 2 });
            await sleep(300);
            const sel = await js('getSelection().toString()');
            check('A4: double click on inline code selects exactly that code', sel === p.text, JSON.stringify({ sel, code: p.text }));
            const side = await waitFor(`!!document.querySelector('.menu [data-item="side"], .menu [data-id="side"]')`, 1500);
            check('A4: the selection menu offers 旁聊', side);
            await key('Escape');
          } else check('A4: the seeded reply has inline code', false, 'no inline code in the seed');
        }
```

（菜单项的 `data-*` 属性名按 `SelectionMenu.tsx` 实际渲染改；种子回复里没有行内 code 就往种子 transcript 里加一句带 `` `activation_status` `` 的回复，种子文件位置见 ui-smoke 顶部 `SMOKE_SID` 的生成处。）

```js
        // A5: context colours are per category
        {
          const tones = await js(`[...document.querySelectorAll('.ctx .ctx-row > i')].map((i) => i.className).join(',')`);
          check('A5: context rows use the fixed per-category colours', !/\bsw-[0-7]\b/.test(tones), tones);
        }
        // A6: the old setting is gone, 背景动画 is under 外观
        {
          await js('window.__store.getState().openSettings({ section: "appearance" })');
          await sleep(600);
          const rows = await js(`({ motion: !!document.querySelector('.sp [data-entry="ui.backdropMotion"]'), old: !!document.querySelector('[data-entry="ui.welcomeBackdrop"]') })`);
          check('A6: 外观 has 背景动画 and the old backdrop setting is gone', rows.motion && !rows.old, JSON.stringify(rows));
          await js('window.__store.setState({ settingsOpen: null })');
        }
```

- [ ] **Step 2: 全量**

Run（依次）:
```bash
$CLEAN npm run typecheck
$CLEAN npm test
$CLEAN npm run build:all
$CLEAN npm run e2e
$CLEAN node scripts/ui-smoke.cjs
node scripts/i18n/extract.mjs --check
```
Expected: 全部通过。失败就修，别删断言。ui-smoke 原有的 `.bg-graph-svg .bg-node` 等断言这一阶段不受影响。

- [ ] **Step 3: 笔记**

每篇笔记加一小节（日期 2026-10-24），写：现象、根因、做法、怎么验证、坑（mask 裁 fixed 后代；React onWheel 是被动的；合成 dblclick 不触发默认选词；引擎 `model` vs `runtimeModel`）。`engine-providers.md` 版本记录加 cw.7 一行。

- [ ] **Step 4: Commit**

```bash
git add scripts/ui-smoke.cjs docs/notes
git commit -m "test(ui-smoke): stage A checks (menu reach, cafe wheel, double click, context colours, 背景动画); notes"
```

- [ ] **Step 5: 独立验收**

派 `verification` 代理：给它原始需求（用户第 2、3、4、7a、9、10 条）、spec A 部分路径、本计划路径、改过的文件列表、已知缺口（mac 只在 Windows 模拟）。FAIL 就修了再让它复验，直到 PASS；PASS 后自己抽 2–3 条它跑过的命令重跑核对。
