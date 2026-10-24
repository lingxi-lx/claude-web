# 内嵌浏览器（阶段 10，2026-09-04）

- `Tile` 加了 `{kind:'browser'; url}`。桌面端 `webviewTag: true` 渲染 `<webview>`（`will-attach-webview` 里把我们的 preload 摘掉、`did-attach-webview` 里拒绝弹窗）；浏览器端降级成受限 iframe，**被 `X-Frame-Options` 拒绝的站点就是一片空白，这是浏览器行为不是 bug**，底部一直提示「用右上角在系统浏览器打开」。
- 地址栏的 `normalise()` 认 `localhost:3000`、`:3000`、裸域名，都不像就当搜索词丢给 Google。
- **Google 登录**（2026-10-23，用户报告「Couldn't sign you in / This browser or app may not be secure」）：原因是我们自己洗的 UA（`user-agent.ts`）——说是 Chrome、客户端提示里却没有 Google Chrome，Google 判成冒充。实测（`<webview>`、真输入、不挂调试器）：洗过的 → 每次 `/signin/rejected`；Electron 原样的（带不带 `claude-web/x` 都行）→ 正常进到密码 / 人机验证；Firefox 的 → 也拒。所以 `desktop/src/sign-in-ua.ts` 只在 `https://accounts.google.com` / `accounts.youtube.com` 上用原样的 UA，别处照旧洗过的（搜索引擎要）。
  - **换 UA 的时机全是实测出来的**（Electron 44，`desktop/src/main.ts` 的 `did-attach-webview`）：重定向里 `setUserAgent` → Electron 自己从头重来（-3，标签不报错）；`will-navigate` 里 `setUserAgent` → 会重载**当前页**、把这次跳转丢了，所以要 `preventDefault` + `loadURL`；`did-start-navigation` 里 `setUserAgent` → 只有页面 JS 拿到新的、请求头还是旧的（Google 正好查这种不一致），所以要 `loadURL` 重来；新标签页一开就是登录页 → 头一次加载早于 `did-attach-webview`，在 `will-attach-webview` 里设 `params.useragent`。
  - **出来不重来**：从登录页重定向回站点时保留原样 UA（重来会把登录的最后一步、可能是 POST，用另一个 UA 再发一遍），下一次去别处时才静默换回洗过的。
  - 被取消重来的那次会报 -2：`BrowserPanel.tsx` / `BrowserTile.tsx` 在 `did-navigate` 时清掉错误卡（真加载失败不会走到 `did-navigate`，实测）。
  - 没验证到的：真账号走完密码那步（没有可用的账号）；站点用 `window.open` 弹窗登录（GIS popup）时，弹窗被我们变成新标签，没有 `window.opener`，站点可能收不到结果。
  - 测 Google 登录别用 CDP 连 guest 页（Google 把调试器当自动化，会混进结论；没单独测过它一个能不能导致被拒）。只连 app 页、经 `<webview>` 元素的 `executeJavaScript` 驱动；`<webview>.sendInputEvent` 的鼠标在窗口被挡住时进不去，提交用页面里的 `click()`。

## 阶段 B（2026-10-24）收尾时查出的

- **停止加载按钮以前没用**：`drive()` 用的 `guestOf()` 要等 `dom-ready`，一直加载不完的页（正是要按停止的时候）永远到不了 dom-ready，按钮什么都不做。现在 stop / reload 用 `guestElOf()`（不管 ready 没有）。钩子 `.bw [data-id=stop]` / `[data-id=reload]`。
- **file:// 页面里的 Worker 能读任意文件**（任务 9 欠的安全检查查出来的）：`file-guard.ts` 的 `webRequest` 拦得住页面自己的 fetch，但 blob: 的专用 Worker 和 SharedWorker 发的 file: 请求（fetch、同步 XHR）**根本不经过 `webRequest`，也不经过 `protocol.handle`**（实测：去掉 CSP 只留 handler 时照样读到）。现在守卫在浏览器的几个分区上自己接管 file:（`protocol.handle('file')`）：只服务 `webRequest` 刚放行的顶层加载（`takeServe`，一次），带 `Content-Security-Policy: worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'`——Worker 根本起不来。真机检查在 `scripts/ui-smoke.cjs` 的 `browser-b` 段最后一条。
- **ui-smoke 的 `browser-b` 段**：主窗口是 offscreen、没有 `<webview>`，所以另开一个能放 webview 的窗口，preload 里放一个最小的 `window.desktop`（`allowFileOnce` / `guestEmulate` 背后是桌面版真的 `file-guard.js` / `guest-tools.js`）。查：回复里的网页链接开成内置浏览器标签、⋯ 菜单每一项、手机视口让 webview 变 390×844 且页面宽 390、加载中有停止且按了真停、标注画一个框计数 1 且关闭时问丢掉、carryOut click 时出现光标、接管后 click 被拒、Worker 读不到文件。
- 坑：没有 `<meta name=viewport>` 的测试页在手机视口里 `innerWidth` 是 980；Cookie 模式（分区）换了只影响之后新开的标签——一个 webview 的分区在第一次导航后就定了，要换只能重建 webview；纯网页版（没有桌面壳）只有 open / read（服务端抓取），会改页面的工具回「需要桌面版」，⋯ 菜单里截图 / 视口 / 本地 HTML / 导入 Cookie / 清除数据这些都不出现。
