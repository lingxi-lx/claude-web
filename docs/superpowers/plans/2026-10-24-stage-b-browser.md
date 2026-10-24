# 阶段 B：内置浏览器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 内置浏览器做到 Claude 桌面版 / Codex app 的程度：回答里的链接和 Claude 写的文件自动在里面打开；标签栏 / 地址栏 / ⋯ 菜单补齐（视口、截图、Cookie、允许的网站、下载、页内查找、缩放）；页面标注发给 Claude；Claude 能看控制台 / 网络 / 页面结构，能悬停、拖动、选下拉、执行脚本，操作时看得见、能接管；改了前端自动检查预览。

**Architecture:** 前端浏览器在 `web/src/features/browser/`（桌面版 `<webview>`，纯网页版 `<iframe>`）；主进程能力（CDP 调试、设备模拟、下载、Cookie、清数据）经 `desktop/src/preload.ts` 新 IPC，放在新文件 `desktop/src/guest-tools.ts`；Claude 的工具在 `server/src/web/mcp.ts`，经 `browser.command` 派给托管浏览器的窗口（`host.ts` → `ops.ts`）；会改页面的操作在服务端过「允许的网站」闸（照 `server/src/computer/access.ts` 的问用户方式）。

**Tech Stack:** Electron webview + `webContents.debugger`（CDP）、React + zustand、vitest、ui-smoke（Electron）、e2e。

Spec: `docs/superpowers/specs/2026-10-24-desktop-parity-design.md` 的「B」一节，以及文末「阶段 A 完成后留给后面的」前三条。

## Global Constraints

- 用户看得见的字全走 `tr('中文')`，英文用仓库工具加进目录（`docs/notes/i18n.md`）；加完 `node scripts/i18n/extract.mjs --check`。不出现：会话 / 引擎 / 窗格 / 停靠 / effort / ultracode / ACP。
- 新设置存 meta.json（`settings.set`），不用 localStorage。zustand 选择器返回稳定引用。菜单用 `composer/Popover` / `useAnchoredMenu`；对话框用 `dlg.*`；文本框 Enter / Escape 先问 `imeComposing()`。
- 停靠面板 / 右侧面板不卸载，只 `hidden`（webview、表单状态）。
- 新加带 `sessionId` 的请求进 `server/src/federation/rewrite.ts`。子进程 `windowsHide: true`。
- 设置键（本阶段新加）：`web.browser.openLinks`（默认 true）、`web.browser.openFiles`（默认 true）、`web.browser.autoVerify`（默认 true）、`web.browser.cookies`（`'shared' | 'separate' | 'session'`，没设时读旧的 `web.browser.isolated`：true → separate，否则 shared）、`web.browser.allowedSites`（`string[]`，主机名，`*.example.com` 表示含子域）。
- 视口预设：自适应 / 手机 390×844 / 平板 820×1180 / 桌面 1440×900。
- 标注：outerHTML 截到 2KB 以内；附件名「页面标注 · N 处」。
- `browser_wait` 最长 20 秒。`browser_eval` 每次都要用户批准（允许的网站也一样）；权限模式是全部允许时会改东西的操作都不问；只读（open / read / find / snapshot / screenshot / console / network / tabs）不问。
- 纯网页版：只有 open / read（服务端抓取）；会改页面的工具回「需要桌面版」。
- 不从 Chrome 直接读 Cookie（只从文件导入）。不改用户的系统浏览器数据。
- 测试命令前 `env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_WEB_DIST -u ANTHROPIC_DEFAULT_OPUS_MODEL -u ANTHROPIC_DEFAULT_SONNET_MODEL -u ANTHROPIC_DEFAULT_HAIKU_MODEL -u CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION -u CLAUDE_WEB_THINKING_DISPLAY -u CLAUDE_WEB_CONTEXT_WINDOWS -u CLAUDE_WEB_MODEL_CAPS -u ELECTRON_RUN_AS_NODE -u CLAUDE_CODE_AUTO_COMPACT_WINDOW`（下文 `$CLEAN`）。
- 不要 `git add -A`（`site/package.json`、`site/package-lock.json` 是用户的未提交改动）。真机用临时 `CLAUDE_WEB_DIR` / HOME，别碰用户的 `~/.claude-web`；用户装着的 Claude Web 在跑，别用它的数据目录起开发版。

现有锚点（写计划时核对过）：`web/src/features/browser/BrowserPanel.tsx`（345 行；`drive()` 第 24 行已支持 `stop`，地址栏第 257–283 行，⋯ 菜单第 284–290 行已有：系统浏览器打开 / 复制地址 / 开发者工具）、`state.ts`（`newTab` 第 41 行、`openUrl` 第 84 行、`agentTab` 第 73 行、分区常量第 31–32 行）、`host.ts`（`carryOut`）、`ops.ts`（`runOp`）、`guest.ts`（`pageOf`）、`page-agent.js`；`web/src/features/workbench/right-panel.ts:40` `openInBrowser(url)`；`web/src/features/chat/link-route.ts` `followLink`（`web` 分支现在调 `openExternal`）；`web/src/store/index.ts:741` `onTurnEnd`；`desktop/src/main.ts`（`will-attach-webview` ~293、`did-attach-webview` ~302、`desktop:openExternal` ~786）、`desktop/src/browser-capture.ts`、`desktop/src/preload.ts`；`server/src/web/mcp.ts`（工具表）、`server/src/protocol.ts:268–281`（`BrowserOp`、`BrowserCommand`、`BrowserAnswer`）；`server/src/computer/access.ts` + `chat/PermissionCards.tsx:138`（问用户授权的现成样子）；`server/src/files/service.ts`（`open` / `stat`）。

---

### Task 1: 链接进内置浏览器 + 阶段 A 留下的三条安全项

**Files:**
- Modify: `web/src/features/chat/link-route.ts`（`followLink` 加 `opts: { external?: boolean }`；`web` → `openInBrowser`，设置关或 `external` → 系统浏览器）
- Modify: `web/src/features/chat/Markdown.tsx`（`onClick` 里 Ctrl / Cmd 按着 → `external: true`；`onAuxClick` 中键对 `#锚点` 也 `preventDefault`）
- Modify: `desktop/src/main.ts`（`desktop:openExternal` 只放行 `http:` `https:` `mailto:` `tel:`；`setWindowOpenHandler` 对只差 `#hash` 的同源地址返回 deny）
- Modify: `desktop/src/nav-guard.ts`（导出 `externalAllowed(url): boolean`；`windowOpenAction` 对同一页面的 `#hash` 地址 → deny）
- Modify: `server/src/files/service.ts`（`open` / `stat` 和其它读写入口在动文件前拒绝 `\\host`、`//host` 开头的路径，报「不支持网络路径」）
- Test: `link-route.test.ts`、`desktop/src/nav-guard.test.ts`、`server/src/files/service.test.ts`

**Interfaces:**
- Produces: `followLink(r: LinkRoute, sessionId: string | null | undefined, opts?: { external?: boolean }): void`；`externalAllowed(url: string): boolean`；`isUncPath(p: string): boolean`（files/service.ts 导出）。

规则：`web.browser.openLinks` 不是 `false` 且是桌面版（`desktop` 存在）→ `openInBrowser(url)`；纯网页版 → `window.open(url, '_blank', 'noopener,noreferrer')`（很多站不让嵌入 iframe）；设置关 / Ctrl·Cmd → 系统浏览器。

- [ ] **Step 1: 失败测试**
  - link-route：设置开 + 桌面 → 调 `openInBrowser`（mock `@/features/workbench/right-panel`）；`external: true` → `openExternal`；设置 false → `openExternal`；纯网页版 → `window.open`。
  - nav-guard：`externalAllowed('https://a.b')`、`'mailto:x@y'`、`'tel:1'` → true；`'file:///C:/x'`、`'smb://h/s'`、`'javascript:1'`、`'ms-settings:'` → false；`windowOpenAction('http://127.0.0.1:3090/?token=a#x', app)` → deny。
  - files service：`isUncPath('\\\\host\\s')`、`'//host/s'`、`'\\\\?\\UNC\\host\\s'` → true；`'C:\\a'`、`'/home/a'` → false；`open('\\\\host\\s\\a.txt')` 拒绝且没调到 `fs`。
- [ ] **Step 2: 确认失败** — `cd web && $CLEAN npx vitest run src/features/chat/link-route.test.ts`；`cd desktop && $CLEAN npx vitest run src/nav-guard.test.ts`；`cd server && $CLEAN npx vitest run src/files`
- [ ] **Step 3: 实现**（`desktop:openExternal` 不放行时只写日志、不打开）
- [ ] **Step 4: 跑测试 + 三个 typecheck**
- [ ] **Step 5: Commit** — `git commit -m "feat(browser): reply links open in the built-in browser (Ctrl/Cmd: system browser); openExternal allows only http(s)/mailto/tel; the server refuses network paths"`

---

### Task 2: 自动打开 Claude 写的文件

**Files:**
- Create: `web/src/features/browser/auto-open.ts`（纯函数 + 一个 `onTurnEndAutoOpen(sessionId)`）
- Create: `web/src/features/browser/auto-open.test.ts`
- Modify: `web/src/store/index.ts`（`onTurnEnd` 末尾调 `onTurnEndAutoOpen`，用动态 import 或直接 import，别造循环依赖）

**Interfaces:**
- Produces: `lastPreviewable(items: readonly ConvItem[]): string | undefined`（这一轮——从最后一个用户消息之后——成功的 `Write` / `NotebookEdit` / `Edit` 工具调用里，最后一个路径后缀是 `.html .htm .md .svg .pdf .png .jpg .jpeg .gif .webp` 的文件路径）。

规则：`web.browser.openFiles !== false`；这一轮出错（`lastResult.isError`）不打开；对话是别的机器的（`parsePeerId`）不打开；同一路径这次运行里已经自动打开过就不再开；打开方式：`.html/.htm` → `openInBrowser('file:///' + 路径)`（桌面版；纯网页版用 doc tile），其它 → doc tile（`openTile({ kind: 'doc', path })`，和 link-route 的文件分支一样）。工具项的形状看 `web/src/model/conversation.ts`（工具名、input.file_path / notebook_path、结果是否出错）。

- [ ] **Step 1: 失败测试**（用 conversation reducer 造几条 items：一轮里写了 a.ts、b.html、c.md → `c.md`；写失败的不算；上一轮的不算；没有可预览的 → undefined）
- [ ] **Step 2–4: 确认失败 → 实现 → 通过** — `cd web && $CLEAN npx vitest run src/features/browser/auto-open.test.ts`；`npx tsc --noEmit -p web`
- [ ] **Step 5: Commit** — `git commit -m "feat(browser): the last previewable file Claude wrote in a turn opens when the turn ends"`

---

### Task 3: 面板：进度条、页内查找、每标签缩放、下载条、视口、保存截图、打开本地 HTML

**Files:**
- Create: `desktop/src/guest-tools.ts`（主进程：按 webContentsId 找 guest；设备模拟；下载事件；保存截图走现有 `browser-capture.ts`）
- Modify: `desktop/src/main.ts`（注册 IPC；`did-attach-webview` 时给 guest 的 session 挂一次 `will-download`，转成 `desktop:guestDownload` 事件发给宿主窗口）
- Modify: `desktop/src/preload.ts`（暴露 `guestEmulate(id, preset)`、`onGuestDownload(cb)`、`openDownload(path)`、`showDownload(path)`）
- Create: `web/src/features/browser/viewport.ts` + `viewport.test.ts`（预设表、`fitScale(box, preset)`）
- Create: `web/src/features/browser/Downloads.tsx`、`FindBar.tsx`
- Modify: `web/src/features/browser/BrowserPanel.tsx`（地址栏下细进度条；Ctrl+F 打开 FindBar（`webview.findInPage` / `stopFindInPage`）；Ctrl ± / 0 对当前 webview `setZoomFactor`（焦点在浏览器面板里时，别抢界面缩放的快捷键）；⋯ 菜单加「保存截图」（captureGuest → `dlg` 选位置 → 服务端写文件，或桌面 IPC 写）、「打开本地 HTML 文件…」（`dlg` 选文件 → `file:///` 打开）、「视口 ›」子菜单）
- Modify: `web/src/features/browser/state.ts`（`BrowserTab` 加 `progress?: number`、`zoom?: number`、`viewport?: ViewportId`）
- Test: `viewport.test.ts`、BrowserPanel 相关纯函数测试

**Interfaces:**
- Produces: `type ViewportId = 'auto' | 'phone' | 'tablet' | 'desktop'`；`VIEWPORTS: Record<ViewportId, { w: number; h: number; touch: boolean; mobile: boolean } | null>`（auto = null）；`fitScale(box: {w,h}, vp: {w,h}): number`（≤ 1）；preload `guestEmulate(webContentsId: number, vp: { w; h; touch; mobile } | null): Promise<void>`（主进程 `enableDeviceEmulation` / `disableDeviceEmulation` + 手机 / 平板时 `setUserAgent` 为移动 UA，自适应时恢复）。

- [ ] **Step 1: 失败测试**（viewport：四个预设尺寸照 Global Constraints；`fitScale({w:400,h:900},{w:390,h:844})` = 1；`fitScale({w:300,h:600},{w:390,h:844})` < 1）
- [ ] **Step 2–4** — 测试 + `npx tsc --noEmit -p web -p desktop`（分开跑）+ i18n check
- [ ] **Step 5: 真机看一眼**（临时 HOME 起开发版：Ctrl+F 查到字；切手机视口页面变窄且居中；下载一个文件出现下载条；做不到写明）
- [ ] **Step 6: Commit** — `git commit -m "feat(browser): progress bar, find in page, per-tab zoom, downloads, viewport presets, save screenshot, open a local HTML file"`

---

### Task 4: Cookie、清除数据、允许的网站、三个开关

**Files:**
- Create: `web/src/features/browser/cookies.ts` + `cookies.test.ts`（解析 Netscape cookies.txt 和常见扩展导出的 JSON → 统一结构）
- Modify: `desktop/src/guest-tools.ts` / `preload.ts`（`importCookies(partition, cookies[])` → `session.fromPartition(p).cookies.set` 逐条；`clearBrowsingData(partition)` → `clearStorageData()` + `clearCache()`）
- Modify: `web/src/features/browser/state.ts` / `host.ts`（分区由 `cookiesMode()` 决定：shared → 用户和 Claude 都用 `persist:cw-browser`；separate → Claude 用 `persist:cw-agent`；session → 都用不带 `persist:` 的分区（关掉应用就清））
- Create: `web/src/features/browser/AllowedSites.tsx`（列表 + 删除；对话框）
- Modify: `BrowserPanel.tsx` ⋯ 菜单：三个开关（在内置浏览器打开链接 / 自动打开 Claude 写的文件 / 自动检查改动，写对应设置）、「管理允许的网站…」、「Cookie」分组：「导入 Cookie…」（`dlg` 选文件，读内容给 `parseCookies`，导入到当前分区，toast 导入了几条）、「保留 Cookie ›」（共用 / 分开 / 关掉就清）、「清除浏览数据」（`dlg.confirm` 后清当前模式下用到的分区）
- Modify: `web/src/features/browser/WebSettings.tsx`（原来的「分开」开关改成三档，读写 `web.browser.cookies`，保留旧键回退）
- Test: `cookies.test.ts`、`cookiesMode` 的测试

**Interfaces:**
- Produces: `type CookieMode = 'shared' | 'separate' | 'session'`；`cookiesMode(settings): CookieMode`（`web.browser.cookies` 合法就用，否则 `web.browser.isolated === true ? 'separate' : 'shared'`）；`partitionsFor(mode): { user: string; agent: string }`；`parseCookies(text: string): { ok: ImportedCookie[]; bad: number }`，`ImportedCookie = { url: string; name: string; value: string; domain?: string; path?: string; secure?: boolean; httpOnly?: boolean; expirationDate?: number }`。

- [ ] **Step 1: 失败测试**（Netscape：注释行、`#HttpOnly_` 前缀、TRUE/FALSE、过期 0；JSON：数组 / `{cookies:[...]}`、`expirationDate` / `expires`；坏行计数；cookiesMode 三种 + 旧键回退）
- [ ] **Step 2–4** — 测试 + typecheck + i18n
- [ ] **Step 5: Commit** — `git commit -m "feat(browser): cookie import from a file, keep cookies (shared / separate / session), clear browsing data, allowed sites, the three switches"`

---

### Task 5: 标注工具条

**Files:**
- Create: `web/src/features/browser/Annotate.tsx`（工具条 + 透明 canvas 画笔 / 矩形 / 文字 + 选元素模式）
- Create: `web/src/features/browser/annotate-model.ts` + `annotate-model.test.ts`（标注数据结构、把元素信息截短、合成附件说明文字）
- Modify: `web/src/features/browser/page-agent.js`（加 `pick()`：悬停高亮、点击后返回 `{ selector, html(≤2KB), rect, styles: { width, height, color, background, font } }`，Esc 退出）
- Modify: `BrowserPanel.tsx`（地址栏的选元素按钮 + 底部居中工具条：选元素 / 画笔 / 矩形 / 文字 / 关闭；「发给 Claude」）
- Modify: composer 加附件的入口（找现有程序化加附件的函数，如粘贴图片用的那个；没有就加一个 store action `addComposerAttachment(sessionId, file)`）

**Interfaces:**
- Produces: `type Mark = { kind: 'pen'; points: [number, number][] } | { kind: 'rect'; x: number; y: number; w: number; h: number } | { kind: 'text'; x: number; y: number; text: string }`；`type PickedEl = { selector: string; html: string; rect: {x,y,w,h}; styles: Record<string, string> }`；`clipHtml(html: string, max = 2048): string`；`annotationNote(url: string, picked: PickedEl[], marks: Mark[]): string`（发给 Claude 的文字部分：页面地址、每个元素的选择器 + 截短的 HTML + 样式、标注数量）。

规则：截图 = 当前 webview 截图（`captureGuest`）上叠 canvas 画的标注，合成一张 PNG；附件名 `tr('页面标注 · {n} 处', { n })`；文字说明作为附件里的文本部分或随附件一起的文本（照 composer 现有附件能带的类型）。标注模式下 canvas 挡住页面滚动；退出时还有没发的就 `dlg.confirm(tr('丢掉标注？'))`。纯网页版：只有画笔 / 矩形 / 文字，截不了图时 toast「截图需要桌面版」。

- [ ] **Step 1: 失败测试**（clipHtml 边界；annotationNote 内容；Mark 计数）
- [ ] **Step 2–4** — 测试 + typecheck + i18n
- [ ] **Step 5: 真机**（临时 HOME：选一个元素、画个框、发给 Claude → 输入框里有「页面标注 · 2 处」附件）
- [ ] **Step 6: Commit** — `git commit -m "feat(browser): annotate a page (pick elements, pen, box, text) and send it to Claude as one attachment"`

---

### Task 6: Claude 的新工具（一）：控制台、网络、页面结构、等待、标签、视口

**Files:**
- Modify: `desktop/src/guest-tools.ts` / `main.ts` / `preload.ts`（CDP：`guestDebug(id, { op: 'console' | 'network' | 'snapshot' })`；首次用时 `wc.debugger.attach('1.3')`，开 `Runtime` / `Log` / `Network`，各存最近 200 条环形缓冲；snapshot 用 `Accessibility.getFullAXTree` 压成每行一个元素（role、name、编号）；guest 销毁时 detach；DevTools 打开时 attach 会失败 → 返回明确错误）
- Modify: `server/src/protocol.ts`（`BrowserOp` 加 `'console' | 'network' | 'snapshot' | 'wait' | 'tabs' | 'viewport'`；`BrowserAnswer` 加 `console?`、`network?`、`tabs?`）
- Modify: `server/src/web/mcp.ts`（新工具 `browser_console`、`browser_network`、`browser_snapshot`、`browser_wait`（`{ text?: string; ref?: string; timeoutMs?: number ≤ 20000 }`）、`browser_tabs`（`{ action: 'list' | 'switch' | 'new' | 'close'; id?: string; url?: string }`，只管这个对话的 Claude 标签）、`browser_viewport`（`{ preset: ViewportId }`））
- Modify: `web/src/features/browser/ops.ts` / `host.ts` / `guest.ts` / `page-agent.js`（执行新 op；snapshot 的编号和现有 `find` / `click` 的 ref 用同一套（page-agent 的编号），AX 树只做补充；wait 轮询 page-agent）
- Test: `server/src/web/mcp.test.ts`（工具表、参数校验、20s 上限）、`web/src/features/browser/ops.test.ts`（新 op 的纯逻辑：格式化、截断、超时）

**Interfaces:**
- Produces: `BrowserAnswer.console?: { level: string; text: string; at: number; url?: string }[]`、`network?: { method: string; url: string; status?: number; ms?: number; type?: string; failed?: string }[]`、`tabs?: { id: string; url: string; title: string; active: boolean }[]`；preload `guestDebug(id: number, q: { op: 'console' | 'network' | 'snapshot' }): Promise<unknown>`。

- [ ] **Step 1: 失败测试**（mcp：新工具都在、schema、wait 超过 20000 夹到 20000；ops：console / network 结果格式化成给模型看的文本且截断到合理长度；tabs 只列 agent 标签）
- [ ] **Step 2–4** — 测试 + 三个 typecheck
- [ ] **Step 5: 真机**（临时 HOME，开一个本地测试页（`server/src/web/__fixtures__` 或临时 http 服务器，页面里 `console.error('boom')` 并请求一个 404），经 `window.__cwBrowser.carryOut`（ui-smoke 里的办法）调 console / network / snapshot，结果里有 boom 和 404）
- [ ] **Step 6: Commit** — `git commit -m "feat(browser): Claude can read the console, network and page structure, wait, manage its tabs and set the viewport"`

---

### Task 7: Claude 的新工具（二）：悬停、拖动、下拉、脚本；允许的网站闸；看得见 + 接管

**Files:**
- Modify: `server/src/protocol.ts`（`BrowserOp` 加 `'hover' | 'drag' | 'select' | 'eval'`）
- Modify: `server/src/web/mcp.ts`（`browser_hover {ref}`、`browser_drag {from: ref, to: ref}`、`browser_select {ref, value}`、`browser_eval {script}`）
- Create: `server/src/web/site-gate.ts` + `site-gate.test.ts`（照 `server/src/computer/access.ts`：`siteAllowed(host, list)`、`needsAsk(op, host, mode)`；问用户：复用 computer 那套 approve 通道的样子，新加一个卡片类型 `browser.site`：「允许一次 / 总是允许这个网站 / 拒绝」，eval 只有「允许一次 / 拒绝」并显示脚本前 400 字）
- Modify: `server/src/web/service.ts`（派会改页面的 op（click / type / key / scroll / computer / hover / drag / select / eval）前过闸；当前页面主机名取这个对话 Claude 标签最近一次回答里的 `page.url`；没有就先 `read` 一次拿地址）
- Modify: `web/src/features/chat/PermissionCards.tsx`（新卡片，照第 138 行 computer 授权卡的样子）
- Modify: `web/src/features/browser/ops.ts` / `guest.ts` / `page-agent.js`（hover / drag 用 `sendInputEvent` 真实鼠标；select 设值并派 input/change；eval 在页面里跑，结果 JSON 截到 8KB）
- Create: `web/src/features/browser/AgentCursor.tsx`（webview 上方一层：虚拟光标移到目标点、点击处波纹；动作来自 `host.ts` 执行每个 op 时广播的坐标）
- Modify: `BrowserPanel.tsx` 的 `AgentStrip`（「Claude 正在操作」+「接管」；接管后这个标签 `takenOver: true`，host 对这个对话之后的会改页面的 op 直接回错误「用户接管了浏览器」，直到点「交还」）
- Test: `site-gate.test.ts`（子域、端口、`*.` 通配、大小写、IP、localhost；mode=bypassPermissions 不问；只读 op 不问；eval 总问）、`ops.test.ts`（接管后拒绝）

**Interfaces:**
- Consumes: Task 4 的 `web.browser.allowedSites`；Task 6 的 op 管道。
- Produces: `siteAllowed(host: string, list: string[]): boolean`；`needsAsk(op: BrowserOp, host: string | undefined, o: { list: string[]; mode?: PermissionMode }): 'no' | 'site' | 'eval'`；卡片答复 `{ allow: 'once' | 'always' | 'deny' }`（always 时服务端把主机名加进 `web.browser.allowedSites`）。

- [ ] **Step 1: 失败测试**（site-gate 全部用例；mcp 新工具 schema；接管）
- [ ] **Step 2–4** — 测试 + 三个 typecheck + i18n
- [ ] **Step 5: 真机**（本地测试页：让 Claude 填表提交；第一次点击弹授权卡，选「总是允许」后不再问；接管后 Claude 的下一步收到「用户接管了浏览器」）
- [ ] **Step 6: Commit** — `git commit -m "feat(browser): hover, drag, select and eval; allowed sites (asks on a new site, eval always asks); a visible cursor and 接管 / 交还"`

---

### Task 8: 自动检查改动

**Files:**
- Create: `web/src/features/browser/auto-verify.ts` + `auto-verify.test.ts`
- Modify: `web/src/store/index.ts`（`onTurnEnd` 调它，和 Task 2 并列）
- Create: `web/src/features/browser/VerifyChip.tsx`（对话里这一轮底下的小条：「预览有 {n} 个报错」+「让 Claude 修」）
- Modify: 对话渲染里挂小条的位置（看 Task 2 / 现有 turn 尾部组件，比如改动文件卡所在处）

**Interfaces:**
- Produces: `touchedFrontend(items): string[]`（这一轮成功的 Write / Edit 里后缀是 `.html .css .js .jsx .ts .tsx .vue .svelte` 的路径）；`previewTabFor(cwd, tabs): BrowserTab | undefined`（地址是 `localhost` / `127.0.0.1` 的标签，或 `.claude/launch.json` 预览服务器的地址——看 `docs/notes/pages.md` 预览服务器那段怎么拿地址）；`onTurnEndAutoVerify(sessionId)`：设置开 + 有前端改动 + 有预览标签 → reload、等加载完（≤ 15s）、经 Task 6 的 console 拿这次加载以来的 error、截一张图；有 error → 给这一轮挂小条；「让 Claude 修」把报错文字 + 截图放进输入框（不自动发）。

- [ ] **Step 1: 失败测试**（touchedFrontend；previewTabFor；没 error 不挂；设置关不跑；出错的轮不跑）
- [ ] **Step 2–4** — 测试 + typecheck + i18n
- [ ] **Step 5: Commit** — `git commit -m "feat(browser): after a turn that changed front-end files, the open preview reloads; errors show as 「预览有 N 个报错」 with 让 Claude 修"`

---

### Task 9: e2e、ui-smoke、笔记

**Files:**
- Modify: `scripts/ui-smoke.cjs`（新 phase `browser-b`）、相关 e2e（找有假上游、能看见 MCP 工具表或 `browser.command` 往返的那一期；没有就新加一期并登记进 `scripts/e2e.mjs`）
- Modify: `docs/notes/phase10-browser-tile.md`（或新笔记 `browser-b.md` 并加进 CLAUDE.md 索引）、`docs/notes/search-computer.md`

- [ ] **Step 1: ui-smoke**：回答里的网页链接点了开成浏览器标签（桌面）；⋯ 菜单每一项都在（截图、打开本地 HTML、视口、三个开关、允许的网站、Cookie 三项、清除数据）；切手机视口后 webview 尺寸变化；停止按钮在加载中出现；标注工具条出现、画一个框计数 1、关闭时问丢掉；虚拟光标在 `carryOut` click 时出现；接管后 carryOut click 被拒。
- [ ] **Step 2: e2e**：工具表里有新工具；会改页面的 op 在新网站上触发授权卡、always 后写进 `web.browser.allowedSites`；eval 每次问。
- [ ] **Step 3: 全量** — `$CLEAN npm run typecheck`、`$CLEAN npm test`、`$CLEAN npm run build:all`、`$CLEAN npm run e2e`、`$CLEAN node scripts/ui-smoke.cjs`、`node scripts/i18n/extract.mjs --check`（已知偶发：ui-smoke 审阅评论那条；e2e 第 6 期端口被占 → 单独重跑）。
- [ ] **Step 4: 真机走一遍**：本地测试页让 Claude 「打开 → 填表 → 提交 → 读控制台报错」（没有真模型就用 `carryOut` 逐步驱动并写明）。
- [ ] **Step 5: 笔记** — 每块写做法、设置键、IPC 名、坑（DevTools 开着时 debugger attach 失败；分区切换要重建 webview；纯网页版限制）。
- [ ] **Step 6: Commit** — `git commit -m "test: stage B ui-smoke and e2e; notes"`
