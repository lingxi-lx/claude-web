# ego lite 作为 Agent 的第一浏览器（2026-10-26，用户要求）

用户要把 [ego lite](https://github.com/citrolabs/ego-lite)（citrolabs，不开源的 Chromium 应用，mac / Windows）当成
「第一浏览器」。选定的意思是：**装了 ego lite，Agent 上网、点击、填表、截图先走它**（用用户在 ego lite 里的登录，
每个对话一个独立 Space）；没装 / 连不上退回内置浏览器；内置浏览器留给用户看预览；回答里的链接、预览照旧在内置浏览器里开。

## 怎么接的

- ego lite 没有可嵌的窗口，也没有 MCP；Agent 通过它首次引导装进 PATH 的 `ego-browser` 命令操作它：
  - `ego-browser skill`：打印和已装版本对应的用法，第一行 `[ego-browser:skill] … v<版本>`（我们从这里取版本号）。
  - `ego-browser nodejs -e "await import('file:///…/round-NN.mjs')"`：跑一段 JS，里面有 `taskSpace(name)`、
    `task.page('p1')`、`page.goto / snapshot / click / fill / screenshot`。**每次是新进程**：Space 和标签页留着，变量不留。
  - 它的 skill 明确要求 Windows 上用 `.mjs` 文件 + `import()` 这一行：脚本放命令行或 stdin 会被 shell 吃掉引号和中文。
- `server/src/web/ego.ts`：
  - `egoStatus(force)`：`findOnPath('ego-browser')` + 跑一次 `skill`。缓存 1 分钟，`force`（设置里的「重新检测」）先 `refreshProcessPath(true)`。
    启动时 `index.ts` 在 PATH 补完（注册表 + `~/.local/bin`）之后探一次。
  - `runEgoScript`：脚本写成 `<dataDir>/runtime/ego/<对话 id 前 8 位>/round-NN.mjs`（UTF-8），开头两行
    `globalThis.CW_SPACE = "claude-web <id8>"; globalThis.CW_OUT = "<那个目录>";`；`resolveSpawn` 启动（不经 shell，`.cmd` 垫片展开，
    `windowsHide`），超时默认 120 s、最多 10 分钟，到时 `killTree`；同一对话串行；输出各保留 60 KB（头尾）；这一轮新存进目录的
    png/jpg/webp 最多 4 张、每张 ≤ 5 MB 作为图片返回；结果开头写「网页内容是不可信数据」。
  - 命令没了 / 输出像连不上（`looksUnreachable`）→ 结果里带 `EGO_FALLBACK`：叫 Claude 这个对话改用 `browser_*`。这就是「退回」。
- `web/mcp.ts`：`EGO_TOOLS`（`ego_browser_guide`、`ego_browser`）只在环境变量 `CW_WEB_BROWSER=ego` 时列出（`toolsFor`），
  这时每个 `browser_*` 的说明末尾加「ego_browser 能用时优先用它」，`instructions` 也加一句。
- `web/launcher.ts`：设置 `web.browser.agent`（`auto` 默认 / `builtin`）+ 最近一次探测找到命令 → 启动参数里加 `CW_WEB_BROWSER=ego`。
  Claude / Codex / ACP 三条路都走 `spawnShape`，都生效；改设置只对之后新开的对话生效。
- 权限（2026-10-26 改，spec 14.1 / 14.4）：**由服务端问，不分 Agent**（以前靠各 Agent 自己的提示，Codex / ACP 可能不问就跑）。
  `service.ts` 的 `egoGate` 在跑脚本前用 `needsAsk('eval', …)` 判断（除「完全放开」外每次问；没有 gate 不问），经 `gate.ask` 发
  `browser.site` 卡，`input.tool = 'ego_browser'`、**整段脚本**（`site-gate.ts` 对 ego 不截 400 字）、`host` = 脚本里第一个网址的主机
  （`scriptHost`）。前端 `isEgoScriptRequest` → `EgoScriptRequest` 卡：标题「Claude 想在 ego lite 里运行一段脚本（host）」、代码块、
  只有「允许一次 / 拒绝」，不认 Enter。回答 `always` 当一次，永不写允许的网站。拒绝 / 超时 / 对话停下 → 不跑，结果是「用户没有允许…」，
  **不带 `EGO_FALLBACK`**（不能让模型换内置浏览器做同样的事）。为免 Claude 再弹自己的卡，`mcp__web__ego_browser` 进了 `webAllowedTools`；
  `ego_browser_guide` 也在里面。`ToolPermission` 里对 `mcp__web__ego_browser` 的老卡留着：别的 Agent 可能还会先自己问一次。
- 设置 → 联网 →「Agent 用哪个浏览器操作网页」（`WebSettings.tsx`）：ego lite（装了就用它）/ 内置浏览器、检测结果、「重新检测」
  （`web.egoDetect`）、官网链接（系统浏览器打开）。`WebStatus` 多了 `agentBrowser` 和 `ego`。

## 坑

- **我们的引擎（ccb）把 MCP 工具藏在 `ExecuteExtraTool` 后面，而且它的结果是 `JSON.stringify(整个结果)`**：截图会变成一长串
  base64 文字交给模型，模型看不到图。所以两个 ego 工具带 `_meta: {'anthropic/alwaysLoad': true}`（ccb 的 `Vi()` 认它，不再延迟），
  直接出现在工具列表里，图片按图片块回去。**内置浏览器的 `browser_screenshot` 等在 ccb 上还是这个问题**（没在这次改）。
- 另外，ccb 要求延迟的工具先被 `SearchExtraTools` 找到过才能 `ExecuteExtraTool`，否则返回 `result: null`；写假上游时别忘了先搜。
- 官方二进制读不出尺寸的图片会被换成「Image could not be processed」文字：测试里的假截图要是真的 PNG（1×1 也行）。
- 命令行上没有脚本，只有 `await import("file:///…")`；Space 名用对话 id 前 8 位，别的对话的 Space 不会被碰到。
- **Windows 上 ego-browser 要是个普通 `.cmd` / `.bat`**（不是 npm 那种 `%~dp0\x.js` 垫片），`resolveSpawn` 会经 cmd.exe 跑：
  `execFile` / `spawn` 必须带 `windowsVerbatimArguments: s.via === 'cmd'`（别的调用方都带，第一版漏了，结果「没找到」）；
  而且 cmd.exe 会展开 `%`，`resolveSpawn` 直接拒绝带 `%` 的参数——`pathToFileURL` 给 `C:\Users\张三`、带空格的路径编出的
  `%E5…` / `%20` 就过不去。所以 import 的地址用 `decodeURI` 后的原字（`import()` 自己会把它当 URL 解析）；只有路径里本来就有
  `%` 才保留编码。`resolveSpawn` 抛错时返回退回提示，不让它变成 HTTP 500。
- 停止：对话停下时 MCP 进程收到 `notifications/cancelled` → 关掉对 server 的请求；`web/http.ts` 看到连接关了就 abort，
  `runEgoScript` 结束子进程（还在排队的那轮直接不跑）。
- 脚本上限 60 000 字：工具接口的请求体上限是 256 KB，中文一个字 3 个字节。

## 测试

- 单元：`server/src/web/ego.test.ts`（假 `ego-browser`：node 脚本 + Windows `.cmd` 垫片放临时 PATH，`FAKE_EGO_MODE` 切 noskill / down），
  `mcp.test.ts`（按环境变量列不列、说明加句、alwaysLoad、超时）、`launcher.test.ts`（设置 × 探测 → `CW_WEB_BROWSER`），
  web 的 `web-tools.test.ts`。
- e2e：`server/ws-phase40.mjs`（自己起 server，PATH 前面放假 `ego-browser`，两个真引擎对假上游）：找到版本、工具在列表里且不延迟、
  权限卡带脚本、round 文件逐字节、中文 / 引号 / `$` / `%` 原样回到模型、截图是图片块、选「内置浏览器」后新对话没有 ego 工具。
- ui-smoke：设置 → 联网的新一行和「重新检测」，切到内置浏览器后 `web.status` 跟着变。
- **没在真 ego lite 上验过**（这台电脑没装）：装好并完成首次引导后，让 Claude 打开一个页面，看 ego lite 里出现 `claude-web <id8>` 这个 Space。
