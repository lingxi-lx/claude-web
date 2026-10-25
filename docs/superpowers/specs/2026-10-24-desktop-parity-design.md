# 对齐官方桌面版 / Codex app：修 bug、内置浏览器、问答卡、项目、节点图、本机版云功能（2026-10-24）

## 背景

用户一次给了 10 条要求、25 张截图和一段 13 秒的 mp4（Charles Postiaux 的「Access settings」动效），
要求一份设计全部做完（不拆成几份 spec）。在对话里分六部分讲过、逐段确认过，这里是汇总。

只照截图、录屏、官方公开文档和公开的 Codex app 资料做，不反编译、不拷官方代码（同「照官方桌面版录屏改的界面」）。
用户给的五个 share.google 链接要登录 + 跑脚本才能看，抓不到内容；B 部分照图 10–12 和对 Codex app 的了解设计，
链接里如果有别的功能，用户点名再加。

开工前发现 `server/` `web/` `desktop/` 和根 `node_modules/` 在 2026-10-24 01:56 左右被清空（原因不明），
已按用户选择从 `64e9474` 恢复并 `npm install`，`npm run typecheck` 通过。

## 实现方式与顺序

一份 spec、分六期依次做：A → B → C → D → E → F。每一期：写计划 → 实现 → `npm run typecheck` / `npm test` /
`npm run build:all` / `npm run e2e` / `node scripts/ui-smoke.cjs`（`env -u` 掉 CLAUDE.md 里列的那些变量）→
独立的 verification 代理验收 → 写进对应笔记（新笔记加进 CLAUDE.md 索引）→ 提交。上一期没过不开下一期。
不并行：B、C、E、F 都要改 `server/src/protocol.ts`、`web/src/model/conversation.ts`、设置 catalog，并行会反复冲突。

跨期规则（CLAUDE.md 已有的，这里列出最容易漏的）：

- 用户看得见的字全走 `tr('中文')`，加完跑 `node scripts/i18n/extract.mjs --check`；不出现 会话 / 引擎 / 窗格 / 停靠 / effort / ACP。
- 新 UI 状态存 meta.json（`settings.set`），不用 localStorage。
- 新的带 `sessionId` 的请求进 `federation/rewrite.ts` 路由表。
- 菜单用 `useAnchoredMenu` / `composer/Popover` / `useDropdown`；原生对话框用 `dlg.*`；Enter / Escape 先问 `imeComposing()`。
- 子进程 `windowsHide: true`。
- 没条件真机验证的（mac、GitLab 自建、外网 VPS）在交付时写明，不说成验证过。

---

## A. 修 bug 与小改动（用户第 2、3、4、7a、9、10 条）

### A1. mac 上点回答里的文件链接，整个窗口变白（图 4–7）

现状：`web/src/features/chat/Markdown.tsx:43-48` 只拦 `http(s):` 链接，`file://`、本地路径、相对路径落到 Electron
默认行为；`desktop/src/main.ts:239-251` 的 `will-navigate` 对非本应用地址调 `shell.openExternal`，没有
`did-fail-load` / `render-process-gone` 的恢复。白屏 = 主窗口离开了应用地址或渲染进程崩了。

做法：

1. 回答里所有链接走一个分派函数（新文件 `web/src/features/chat/link-route.ts`，纯函数可测）：
   - `http(s)` → 内置浏览器（B1 的开关关掉时 → 系统浏览器）；
   - Claude 写出的文件 / 本地路径（绝对、`file://`、相对于对话 cwd）→ 应用内预览（Doc tile / 图片查看器）；
   - `mailto:` 等其它协议 → 系统默认程序；
   - `javascript:`、`data:`（图片以外）→ 不打开。
2. 主窗口：`will-navigate` 对任何非应用地址一律 `preventDefault`（外链交给第 1 步，不在这里打开）；
   `setWindowOpenHandler` 一律 `deny`（链接已在第 1 步处理，弹窗走内置浏览器标签）。
3. 恢复：`did-fail-load`（主 frame）和 `render-process-gone` → 重新加载应用地址，恢复后 toast「页面出错，已恢复」；
   60 秒内连续 3 次就停在一个说明页（「页面连续出错」+「重新加载」），不无限重载。在跑的对话在服务端，不受影响。
4. 测试：`link-route` 单测覆盖各类链接；ui-smoke 在 Windows 上模拟：点 `file://` 链接、强制 `webContents.forcefullyCrashRenderer()`，
   窗口能回到应用。**没有 Mac，mac 只能这样间接验证**，交付时写明。

### A2. 菜单超出窗口被裁（图 3）

现状：`web/src/features/sidebar/place.ts:21-36` 的 `placeFixed` 先试下、再试上，都放不下时钉到顶端并给 `maxHeight`，
但菜单容器没有 `overflow-y: auto`；侧栏行菜单（`session-actions.tsx:151`）没传 `prefer`。

根因（查到的）：桌面上菜单是就地画在按钮旁的 `position: fixed` 元素，而侧栏列表 `.sb-list` 等滚动区有滚动渐隐的
`mask-image`（`web/src/styles/scroll-fade.css`）；mask 会把所有后代（包括 fixed 的）裁到这个元素的框里，所以菜单在
「新对话」下面被切掉。修：`scroll-fade.css` 里同一组选择器加 `:has(.menu)` 时 `mask-image: none`（菜单开着时不渐隐）。

另外 `placeFixed` 上下都放不下时本来就钉到顶、给 `maxHeight`，但 `useAnchoredMenu`（`features/sidebar/menus.tsx:46`）
只设了 `maxHeight` 没设滚动：补 `overflow-y: auto` + `overscroll-behavior: contain`，最后几项能滚到。
测试：`place.test.ts` 加矮窗口的例子；ui-smoke 把窗口设成 600px 高，侧栏列表滚到一半后打开中间一行的菜单，
用 `elementFromPoint` 断言第一项和最后一项都点得到（被 mask 裁掉的点不到）。

### A3. 网吧滚轮：缩放的同时页面也在滚（图 18–25）

现状：`web/src/features/cafe/Cafe.tsx:185-206` 用 React `onWheel`（被动监听，`preventDefault` 无效）。

做法：改成 `canvas.addEventListener('wheel', fn, { passive: false })`：
- 鼠标在网吧上 → 只缩放，`preventDefault`；
- 已经缩到最小（或最大）还往那个方向滚 → 不拦，页面滚动（不会卡住）；
- 按住 Shift → 一律不拦，滚页面。
D 部分的节点图用同一套规矩，规则写成共用函数 `web/src/ui/wheel-zoom.ts`。
测试：`wheel-zoom` 单测；ui-smoke 在后台页对网吧发 wheel，断言页面 `scrollTop` 不变、缩放变了。

### A4. 双击只选中一个词（图 16–17）

做法：助手正文里
- 双击行内 `code` → 选中整个 code 段（`activation_status` 整个选中，不带两边的字）；
- 双击普通文字 → 选中一个词，中文用 `Intl.Segmenter('zh', { granularity: 'word' })` 分词；
- 选中后现有的选区菜单（`web/src/features/chat/SelectionMenu.tsx`：复制 / 引用到输入框 / 钉住 / 分叉，10-20 用户要的）照常出现，
  在「引用到输入框」旁边加官方的「旁聊」：打开旁聊卡，输入框里预先填好引用的这段，用户补一句再问（不自动发）。
实现：在消息容器上监听 `dblclick`，用 `Selection.setBaseAndExtent` 改写浏览器默认选区；三击（整段）不改。
先在 ui-smoke 里复现现在双击选中了什么，再按复现结果修，不叠补丁。
测试：ui-smoke 对种子消息里的行内 code 和中英文各双击一次，断言 `getSelection().toString()`。

### A5. 上下文卡：慢、颜色和数字不对（图 8–9）

现状：`web/src/features/info/InfoColumn.tsx:160-194` 每次展开 / 对话变活就 `session.contextUsage`（detail: full），
引擎要用模型接口数 token，要几秒到十几秒；颜色是按出现顺序给的调色板序号（`info-model.ts:69-74`），所以同一类在
不同对话里颜色不一样；1M 窗口时 Autocompact buffer 显示 333k / 33.3%（官方 700k 窗口是 33k / 4.7%）。

做法：
1. 颜色按类别固定（按 `kind` + 已知类名映射，不认识的类名一律灰）：Messages 蓝、System tools 橙、MCP tools 青、
   Skills 黄、其余灰；排序：已用的按大小从大到小，Autocompact buffer、Free space、deferred 固定在最后。条和行用同一套颜色。
   颜色用主题令牌（新加 `--ctx-messages` 等），浅色 / 深色 / 字符画主题都能看清（对比度测试覆盖）。
2. 快：每个对话最近一次的明细存在前端模块级缓存里（这次运行内有效，不进 localStorage），打开卡片先显示缓存，
   后台再取新的，取的时候底部「更新中…」。**不**每轮结束自动再取（2026-10-23 的决定：每次数要发约 29 个 count_tokens，中转会记，见「界面改版 阶段 3」的「上下文小环不问引擎」）；只在展开时和点「刷新」时取。
3. 卡片折叠时标题行的「95%」+ 小进度条已经有了（`CardSummary`），不用改。
4. buffer 的根因（读引擎 fork 代码查到）：`C:\Users\YPY\claude-web-engine\src\utils\analyzeContext.ts` 第 947 行窗口用
   `runtimeModel` 算，第 1015 行自动压缩阈值却用 `model` 算（`getEffectiveContextWindowSize(model) - 13_000`）；两个模型
   的窗口不同时（档案表里 1M、另一个按默认）buffer = 两窗口之差 + 33k，于是 1M 显示 333k。真实的自动压缩
   （`autoCompact.ts` 的 `autoCompactIfNeeded`）用的是 `toolUseContext.options.mainLoopModel`，也就是这里的 `model`。
   修法：先写复现测试查清两个名字各解析出多大窗口；窗口和阈值都按真实自动压缩用的那个模型算（显示的就是实际会发生的）；
   如果是 `CLAUDE_WEB_CONTEXT_WINDOWS` 的查表只认其中一种写法（例如带不带 `[1m]`、带不带供应商前缀），把查表修成两种都认，
   这样档案里写 1M 的模型实际也按 1M 压缩。buffer 改用和真实压缩同一个函数 `getAutoCompactThreshold`
   （它按窗口大小给 13k / 30k / 50k 余量），1M 窗口显示约 70k / 7%，700k 窗口约 50k。
   引擎发新版本 `2.8.4-cw.7`，按「engine-providers」笔记的发版流程（预发布 Release）走；前端不自己改数字。
测试：`info-model` 单测（固定颜色、排序、未知类名）；用官方二进制和我们的引擎在同一窗口下各取一次，对比 buffer。

### A6. 拿掉「新对话页的动态背景」设置（图 2）

做法：删 `web/src/features/settings/catalog.ts` 里的 `ui.welcomeBackdrop`（第 22、109 行一带）和读它的地方；
用户原话「就做动画或者无在外观里面设置就好」：外观 里加一个两档的「背景动画：开 / 关」（`ui.backdropMotion`），
开 = 新对话页放动画：字符画主题放它自己的背景，经典主题放字流；关 = 静止的纯底。「字场」这一档去掉。
不写迁移：读的时候 `ui.backdropMotion` 没设过就看旧的 `ui.welcomeBackdrop`（是 `'off'` / `false` 就当关），设置表里只剩新键。
系统开了「减少动态效果」时照旧静止。只给字场用的 `features/home/AsciiField.tsx` / `ascii-noise.ts` 删掉（先确认没有别处用）。
wording / i18n 覆盖测试、`catalog.test.ts` 的「added」列表跟着改。

---

## A7. 自动压缩点和 Claude 账号的上下文窗口（2026-10-24 用户追加，已确认）

用户原话：「除了中转可以设置上下文以外，还可以选择上下文压缩……自己 Claude 账号也可以设置和查看上下文窗口，因为有时候新对话还是 Opus 5.5 200k，很怪。」
阶段 A 查到：用户 `~/.claude/settings.json` 写了 `CLAUDE_CODE_AUTO_COMPACT_WINDOW=700000`；账号上普通的 `claude-opus-5-5` 是 200K，`[1m]` 才是 1M（`session-runner.ts` 的 `windowOf`）。

1. **「自动压缩」**：每个供应商（`Provider.compactAt?: number`）和自己的 Claude 账号（设置键 `claude.compactAt`）各一项：
   「跟着上下文窗口」（不设，默认）/「在 ___K 时压缩」（50K 起，不超过该模型窗口；可写 700、700k、700000）。
   设了就给这个供应商 / 账号的对话写 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`，和官方二进制自己算的提前压缩点取小的；
   经现有 `settingsOverride` / `ownOverride` 压过用户 settings.json 里的同名变量（不改用户文件）。没设时 settings.json 的照旧生效。
   编辑处显示现在实际生效的值和来源：「现在：700K（来自你的 settings.json）」/「现在：跟着窗口」。
   新对话立刻用；空闲的对话下一轮用（plan key 带上它，`respawnWhenIdle`）。
2. **Claude 账号的窗口**：设置 → 账号与登录 的 Claude 账号那一行加「编辑」，打开的框里：
   每个支持 1M 的 Claude 模型（Opus、Sonnet、Fable）一行「200K / 1M」（设置键 `claude.contextWindows: Record<模型, 200000|1000000>`，
   默认 1M），Haiku 只有 200K 不给选；下面是 1 里的「自动压缩」。选了 1M 的模型在账号上一律带 `[1m]` 发给引擎
   （两种引擎都认），于是新对话不会再落到 200K。「其它 Claude 账号」档案（`claude-account`）用同一个框，存在它自己的
   `Provider.contextWindows` / `compactAt` 里。`default`（按套餐）不改。
3. **看得到**：runner 把这个对话实际的窗口写进 `SessionInfoSnapshot.contextWindow`（和 A 阶段加的 `compactWindow` 一起）；
   上下文卡标题和输入框小环按 `min(contextWindow, compactWindow)` 算；卡片标题行写「窗口 1M · 700K 内压缩」
   （没有压缩上限就只写「窗口 1M」）；模型菜单里 Claude 模型名后面标 1M / 200K。
4. 测试：单测（账号模型加 `[1m]` 的规则、压缩点输入校验、和官方提前压缩点取小、settings.json 被压过、plan key 变化）；
   e2e 假上游核对引擎启动参数里的模型名和环境变量；ui-smoke 查编辑框、卡片标题、模型菜单标记。

---

## B. 内置浏览器（用户第 7b、7c、8 条）

现状（`web/src/features/browser/`）：`BrowserPanel.tsx` 标签 + 地址栏，桌面版 `<webview>`、纯网页版 `<iframe>`；
`state.ts` 标签 store，分区 `persist:cw-browser`（用户）/ `persist:cw-agent`（`web.browser.isolated`）；
`host.ts` / `ops.ts` / `guest.ts` / `page-agent.js` 执行服务端派来的 `browser.command`；服务端
`server/src/web/mcp.ts` 有 `web_search` 和 `browser_open / read / find / click / type / press_key / scroll / back /
screenshot / computer`；协议 `BrowserOp`（`protocol.ts` ~260 行）。没有：链接自动打开、停止、⋯ 菜单、标注、
视口、Cookie 导入 / 清除、允许网站、控制台 / 网络读取。

### B1. 链接和文件自动打开

- 回答里的网页链接 → 右侧内置浏览器新标签（A1 的分派函数）；Ctrl / Cmd + 点 → 系统浏览器。设置 `web.browser.openLinks`，默认开。
- Claude 写出的文件（html / md / svg / pdf / 图片）→ 应用内预览；设置 `web.browser.openFiles`（「自动打开 Claude 写的文件」），
  默认开：一轮里 Write 了这些类型的文件，这一轮结束时打开最后一个（同一轮多个只开一个，不刷屏）。
- 纯网页版：目标站拒绝被嵌入（X-Frame-Options / CSP）时直接 `window.open` 新窗口，不留白框。

### B2. 标签栏、地址栏

- 标签栏：标签、＋、布局切换（左右 / 上下）、⋯、放大到整个分区、关闭。
- 地址栏：后退、前进、刷新 / 加载中变「停止」（`webview.stop()`）、底部细进度条、选元素按钮。
- 补：Ctrl+F 页内查找（`findInPage`）、每个标签单独缩放（Ctrl ± / 0）、开发者工具、下载条（`will-download`，
  存到系统下载目录，完成后「打开」「在文件夹中显示」）。

### B3. ⋯ 菜单

用系统浏览器打开、复制网址、保存截图（存成 png，`dlg` 选位置）、打开本地 HTML 文件…；
视口 ›：自适应 / 手机 390×844 / 平板 820×1180 / 桌面 1440×900（固定尺寸时页面居中缩放显示，手机 / 平板
开触屏模拟和对应 UA，`webContents.enableDeviceEmulation`）；三个开关：在内置浏览器打开链接、自动打开 Claude 写的文件、
自动检查改动；管理允许的网站…；Cookie：导入 Cookie…（只从文件：Netscape cookies.txt 或常见扩展导出的 JSON；
不从 Chrome 直接读——新版 Chrome 的 Cookie 加密只有 Chrome 能解）、保留 Cookie ›（共用 / 分开 / 关掉就清，
设置 `web.browser.cookies`，取代 `web.browser.isolated`：旧的 false → 共用，true → 分开）、清除浏览数据（`dlg.confirm` 后
`session.clearStorageData()` + `clearCache()`）。

**自动检查改动**（`web.browser.autoVerify`，默认开）：一轮结束时，如果这一轮改了某项目的前端文件
（`.html .css .js .jsx .ts .tsx .vue .svelte`），而这个项目的预览页（`.claude/launch.json` 的预览服务器，或地址是
`localhost` 的标签）开着 → 刷新它、等加载完、收集控制台 error 和一张截图。有报错时对话里出一条小条
「预览有 N 个报错」+「让 Claude 修」（点了把报错和截图放进输入框，用户发）；不自动发。没报错不出东西。

### B4. 标注工具条

预览底部居中一排：选元素、画笔、矩形、文字、关闭。
- 选元素：注入 `page-agent.js` 的悬停高亮，点选后记 CSS 选择器、截断的 outerHTML（≤ 2KB）、几项计算样式（尺寸、颜色、字体）、局部截图。
- 画笔 / 矩形 / 文字：画在 webview 上方的透明 canvas，不改页面。标注模式下页面不响应滚动（canvas 挡住了滚轮），
  要滚先点「关闭」退出标注；退出时还有没发的标注就问「丢掉标注？」。不做标注跟随页面滚动。
- 「发给 Claude」：把带标注的截图 + 选中元素列表合成一个附件「页面标注 · N 处」放进输入框。
- 纯网页版：iframe 跨域拿不到页面，只有画笔 / 矩形 / 文字 + 截不了图时提示用桌面版。

### B5. Claude 像人一样操作网页

新加 MCP 工具（`server/src/web/mcp.ts`，`BrowserOp` 加对应项）：
`browser_console`（最近的控制台消息）、`browser_network`（最近请求：方法、地址、状态、耗时）、
`browser_snapshot`（页面结构树 / 可访问性树，每个元素一个编号，后续 click / type / hover 可用编号）、
`browser_hover`、`browser_drag`、`browser_select`（下拉项）、`browser_wait`（等文字或元素出现，≤ 20s）、
`browser_tabs`（列出 / 切换 / 新开 / 关闭 Claude 的标签）、`browser_viewport`、`browser_eval`（在页面里执行脚本）。
- 控制台、网络、结构树走主进程的 `webContents.debugger`（CDP）附在 Claude 的那个 webview 上，结果经 preload IPC 回来。
- 输入用 `sendInputEvent`（真实事件），现有 `guest.ts` 已经这样做。
- 看得见：每次点 / 输入，页面上方一层画一个虚拟光标移过去、点的位置一个波纹；顶部条「Claude 正在操作」+「接管」
  （点了取消这个对话正在执行的浏览器操作，之后的操作返回「用户接管了浏览器」直到用户点「交还」）。
- 允许的网站：Claude 第一次在某个域名上执行 click / type / eval 这类会改东西的操作时，走现有授权卡：允许一次 /
  总是允许这个网站 / 拒绝；存 `web.browser.allowedSites`。`browser_eval` 每次都要批准（允许的网站也一样）。
  权限模式是全部允许时不弹。只读的 open / read / snapshot / screenshot 不问。
- 纯网页版：只有 open / read（服务端抓取），会改东西的操作返回「需要桌面版」。

### B 的测试

单测：链接分派、视口尺寸、允许网站匹配（子域名、端口）、Cookie 文件解析、自动检查的触发条件。
e2e：回答里的链接点开成浏览器标签。ui-smoke：⋯ 菜单每一项、停止按钮、标注层、虚拟光标。
真机：在本地测试页上让 Claude 走一遍「打开 → 填表 → 提交 → 读控制台报错」。

---

## C. 问答卡、项目、侧栏（用户第 1 条、图 13–15）

### C1. 问答卡（图 1）

现状：`web/src/features/chat/PermissionCards.tsx:186-256` 的 `AskQuestion` 把多个问题叠在一张停靠卡里，
「还有 N 条」+「跳过」「提交」；注册表 `tools/registry.tsx:58`。

做法：AskUserQuestion 改成显示在对话里（这一轮末尾、任务清单上面），工具授权卡仍停靠在输入框上方（防误触，不改）。
- 一页一题，顶部问题原文 + 翻页「‹ 1 / 3 ›」，翻回去答案保留。
- 选项行：圆圈（多选为方框）+ 粗体名 + 灰色说明；有 `preview` 的，选项获得焦点时旁边显示预览。
- 最后一行「其它」，选中后下面出输入框并聚焦。
- 底部「跳过」「下一题 Ctrl+Enter」，最后一题变「提交」。跳过的题答案写 `（用户跳过）`；全部跳过 = 拒绝这次工具调用（同现在的「跳过」）。
- 键盘：↑↓、数字 1–9 选、Enter 下一题；输入法选字时不响应。
- 这一轮底部「需要你回答」橙色标记；侧栏行照旧进「需要你」。
- 答案格式不变（`updatedInput.answers`，question → 逗号连接的选项），只是收集方式变了。
测试：答案拼装单测（跳过、其它、多选、全跳过）；ui-smoke 翻页、键盘、IME。

### C2. 一个项目多个文件夹（图 13–14）

现状：`server/src/meta/store.ts:12` `Workspace { id, path, name, addedAt, order }`，一个项目一个文件夹；
`session-runner.ts` 没传 `additionalDirectories`（SDK 支持）。

做法：
- `Workspace` 加 `folders: string[]`（额外文件夹，不含主文件夹 `path`），旧数据读出来 `folders ?? []`，不用迁移脚本。
- 编辑项目对话框（项目右键「编辑项目」）：名字、源文件夹列表（第一行主文件夹，不能删；其余 × 移除；「添加文件夹」）、
  左下红色「从侧栏移除项目」（只删 meta 记录，不动磁盘）、取消 / 保存。
- 新开的对话：cwd = 主文件夹，`additionalDirectories` = `folders`（只对在项目里开的对话；属于项目的判定沿用 `projectFor()`）。
  在跑的对话不中途改，下次打开生效，对话框里写明。
- 文件面板、@文件、搜索、Git 面板列出全部文件夹，每个一组。
- 别的 agent：Codex 有对应参数的就带上，其它只用主文件夹，对话框注明哪些 agent 不支持。
- `workspaces.update` 请求带上 `folders`；路径存在性在服务端检查。
测试：store 单测（旧数据、增删）；e2e 两个文件夹的项目开对话，断言 SDK 选项里有 `additionalDirectories`。

### C3. 侧栏显示菜单（图 15）

在分区标题行加一个按钮，菜单（`useAnchoredMenu`）：分组方式 ›（文件夹 / 项目 / 日期 / 不分组）、排序 ›（最近更新 /
创建时间 / 名称）、显示 ›（已归档、其它 agent 的对话、每组 5 / 10 / 全部）、新建分区、恢复默认、查看全部（打开对话库）。
- 自建分区：名字 + 手动拖进来的对话；一个对话可同时在自建分区和原分组里。存 `ui.sidebar.sections`。
- 现有 `filter-menu.tsx` 的筛选框 / 来源 / 机器 / 显示已归档 / 选择多个合并进这个菜单，侧栏只留一个入口；
  更新「界面改版 阶段 4」的入口表和外框控件计数测试。
- 设置存 `ui.sidebar.view`（`{ groupBy, sortBy, show }`）。
测试：分组 / 排序纯函数单测；ui-smoke 每一项。

---

## D. 节点图（用户第 5 条：mp4 的样子，用在三处）

mp4 观察：很暗的画布带点阵；左上标题 + 一行小字，右上状态标签（红「1 open path」/「✓ No open paths」）；
卡片依次淡入，连线随后画出；问题路径是发红光的贝塞尔曲线，光点沿线流动，正常线灰色，断开的是虚线；线上有小标签；
卡片里可有几行，每行一个下拉框（`read · Anyone ▾`），改成 Admin 后红线熄灭变灰色虚线、状态标签跟着变；
卡片下可挂小列表（「4 reads this week」+ 国家 / 时间标签）；右下缩放「− 116% +」，拖画布平移、拖卡片。

### D1. 共用组件 `web/src/ui/node-graph/`

SVG。输入：`{ title?, subtitle?, badge?, nodes: [{ id, icon?, title, subtitle?, rows?: [{ label, value, options?: [...] }], list?: { title, items } , state? }], edges: [{ from, to, fromRow?, label?, style: 'normal'|'strong'|'error'|'dashed' }] }`。
- 布局：从左到右分列（复用 `orchestra/graph-layout.ts` 的拓扑分列，挪到共用位置）；可传固定坐标。
- 入场动画（卡片依次淡入、线 `stroke-dashoffset` 画出）；`strong` 线发光 + 光点沿路径流动（`<animateMotion>` 或 CSS offset-path）。
- 拖卡片、拖画布、缩放控件、适应窗口；滚轮用 A3 的 `wheel-zoom`；双击空白恢复布局；位置不保存。
- `prefers-reduced-motion` 或卡片 > 150 时不放动画。卡片可 Tab 聚焦、Enter 选中。颜色全走主题令牌。

### D2. 后台页关系图

`web/src/features/background/CommandGraph.tsx` 的放射图换成节点图：主对话 → 子代理 / 工作流 / 后台命令；
工作流展开成阶段 → 子代理（数据已有：`workflow_progress` 的 phase / agent）。卡片：名字、类型、模型、token、用时。
线：在跑 `strong`、完成 `normal`、失败 `error`、排队 `dashed`。点卡片打开现有详情；右侧「动态」不动。

### D3. 编排

`web/src/features/orchestra/Graph.tsx` 改用共用组件（布局不变）：在跑的步骤卡片发光、指向它的线 `strong`；失败变 `error`。
编辑器预览一起换样子，编辑方式不改。

### D4. Claude 画的图

- 回答里 ```nodegraph 代码块（JSON，就是 D1 的输入格式，外加选项的 `marks`）→ 可交互节点图，下面「查看源码」「复制」。
- 下拉选项可带 `marks: { edgeId: style }`：选中时这些线换样式；`badge` 写成规则（数 `error` 线的条数，0 条时显示 `okText`），
  于是能做出 mp4 的效果。改过下拉框后出「把改动发给 Claude」，点了往输入框填一句描述（「我把 read 改成了 Admin」），用户发。
- 让 Claude 知道：在 Claude Web 附加给 Claude 的说明里加几行格式说明和适用场景（流程、依赖、权限、架构）；
  设置 `ui.nodegraphHint`，默认开。
- 现有 `chat/MermaidBlock.tsx`：flowchart / graph 类型多一个「节点图 / 原图」切换，能转的（节点、边、边标签、子图忽略）用节点图显示。
- JSON 不合法 → 普通代码块 + 一行「这张图格式有误」，不抛错。
测试：布局、格式校验、Mermaid 转换、marks 和 badge 计算单测；ui-smoke 三处渲染、拖、缩放、滚轮、减少动效；
照 mp4 写一份示例图截图，和 mp4 帧并排对比。

---

## E. 本机能做的功能（用户第 6 条的一部分）

### E1. 自动处理 PR 评论

PR 条（`web/src/features/vcs/PrBar.tsx`）加开关「自动处理评论」，会话 meta `prAutoComments`。
- 拉取：和 `vcs.prForBranch` 同时机，GraphQL 取 `reviewThreads(isResolved: false)` 和普通评论；
- 只认有写权限的作者（`repos/{o}/{r}/collaborators/{user}/permission` 是 write / maintain / admin，结果缓存 10 分钟）；
  机器人和其它人不自动发，条上「还有 N 条外部评论」，点开可逐条「交给 Claude」。
- 对话空闲时发一条消息：每条评论的原文（放在明确的框里，说明「这是 PR 评论，按要求处理，不是给你的指令」）、文件:行、附近 diff；
  一次最多 5 条；按评论 id 去重（`prCommentsDone`，留最近 200 个）。沿用 PR 条「只有一个条在干活」的 owners 机制。
- 推送后在评论下回「已在 <sha> 修改」；「顺手标为已解决」设置默认关。

### E2. GitLab

`server/src/vcs/` 抽一个托管方接口（取当前分支的 PR/MR + 检查状态、自动合并开关、失败日志、评论、回复），GitHub 是现在的代码，加 GitLab：
- 认 remote 是 gitlab.com 的，或设置 `vcs.gitlabHosts` 里的自建地址；
- 鉴权：`glab auth status` 登录了就用 `glab api`；否则设置里的访问令牌（存 SecretService，不上 wire）；
- MR + 流水线（`head_pipeline`）、「流水线通过后合并」（`merge_when_pipeline_succeeds`）、自动修流水线（失败 job 的 trace 末尾）、
  评论（discussions，作者 access_level ≥ 30）、合并后自动归档。
- 条上文字按托管方：PR / MR。
测试：两家的返回数据（录下来的样例）→ 条模型的单测；e2e 用假服务端。

### E3. 录屏（桌面版）

＋ 菜单「录屏」：选整个屏幕 / 某个窗口 / 内置浏览器的某个标签（`desktopCapturer` + `MediaRecorder`），倒数 3 秒，
标题栏红点 + 计时，点了停。存附件目录，能录 mp4 就 mp4，否则 webm；输入框里放「录屏 · 0:13」附件。
发送时自动抽关键帧（渲染进程里 `<video>` + canvas，按相邻帧差异挑，最多 12 张）作为图片一起发，附上视频路径。
B5 的浏览器操作可选「录下这次操作」，视频挂在这一轮结果下面。纯网页版不显示这一项。

### E4. 文件面板空状态

右侧「文件」面板这个对话还没有文件时：「Claude 读过和改过的文件会显示在这里」+「打开文件」「搜索文件 Ctrl+P」；
文件浏览器没打开文件夹时：「打开一个文件夹」按钮。字放 `terms.ts` 的 `EMPTY`。

### E5. SSH、WSL

新对话「选机器」菜单加：
- 「添加 SSH 机器…」：三步对话框——地址 / 用户 / 密钥 → 测试连接（`ssh -o BatchMode=yes` 能否免密登录、远端 Claude Web
  是否在跑）→ 没跑就填启动命令（或照提示安装）。底层就是现有 `server/src/remote/tunnel.ts` + 联邦 SSH peer；
  设置里 `HostsSection` 保留。
- WSL：`wsl.exe -l -q` 列出发行版；选了后对话的 Claude Code 在那个发行版里启动（`session-runner.ts:541` 的
  `spawnClaudeCodeProcess` 换成经 `wsl.exe -d <发行版> --cd <路径> --` 启动），cwd 用 WSL 路径；
  Claude Web 仍在 Windows 上。文件 / Git / 终端走 `\\wsl.localhost\<发行版>\…`。
  注入的 memory / web / computer MCP 通过 WSL 互通调用 Windows 上的 node.exe 启动；互通关掉时这三个不可用并在界面注明。
  发行版里没有 `claude` 时给「在 WSL 里安装」：先显示要跑的命令，确认后执行。
- 会话 meta 记 `env: { kind: 'local' | 'wsl', distro? }`；WSL 对话「在原生 CLI 打开」等入口按 WSL 处理或置灰。
测试：WSL / Windows 路径互转单测；真机用本机 WSL 跑一个对话；SSH 用本机 ssh 服务。

---

## F. claude.ai 功能的本机版（用户第 6 条的另一部分）

这些在官方跑在 Anthropic 服务器上，没有第三方能用的接口；用户选了「做本机版」。

### F1. 云端对话 → 常开机器

- 联邦 peer 可标「常开」（meta `peers[].alwaysOn`）。新对话「选机器」里常开机器排前面，标「合上电脑也继续」。
- 交接：本机对话菜单「交给常开机器继续」（只限有 remote 的 Git 项目，否则置灰并写原因）：
  1. 用 `git stash create` 得到包含未提交改动的提交对象（不改工作区、暂存区、当前分支），以 HEAD 为父 `commit-tree`，
     推到 `cw/handoff-<id>`（远端已有同名分支就换 id，不强推）；
  2. 对方 `git fetch` + `git worktree add` 到独立目录；复制 transcript（沿用「会话内核」的交接）；在那里接着跑；
  3. 本机原对话标「已交给 <机器>」只读；
  4. 「取回」：本机 fetch 那个分支，建本地分支 `cw/handoff-<id>`，打开 diff 给用户看，不自动合并。
- 测试：交接前后用户分支、工作区、暂存区逐字节不变（单测在临时仓库里跑）；真机用本机第二个 Claude Web 当常开机器。

### F2. Projects 线程 → 项目页

在 C2 的项目上加：项目说明（`Workspace.instructions`，作为附加说明进这个项目里每个新对话）、项目资料
（拖进来的文件存 `~/.claude-web/projects/<id>/`，对话通过 `additionalDirectories` 能读）、项目里的对话列表；
跨对话工具（sessions MCP）加 `scope: 'project'`，协调者对话只看见 / 只能发给同项目的对话。

### F3. Dispatch → 从手机派活

手机壳（`web/src/shell/`）和 IM 网关加「派活」：一句任务 + 机器 + 项目（默认上次的）→ 电脑上新开对话执行；
做完 / 需要回答时推通知（手机远程现有通道、IM 网关回消息）；侧栏行标「从手机派来」（会话 meta `origin: 'dispatch'`）。
权限模式按项目原设置，需要授权的步骤推到手机上点。

### F4. claude.ai 同步 → 导入导出包

「导入 claude.ai 数据」选 claude.ai 导出的 zip（`conversations.json`、`projects.json`、`users.json`）：
对话进对话库（新来源 `claude.ai`，只读、可搜，id 前缀按「统一会话库」的规则）；「接着聊」把历史写进一个新的 Claude Code transcript
接着聊（同 dsh 接着聊的做法，见 a242a26）；项目说明 / 资料导成 F2 的项目（资料文件放到用户选的文件夹）；再导入按 uuid 去重。
界面写明「一次性导入，不是实时同步」。格式按官方导出的实际样子写解析，字段缺了跳过那一条不整份失败。

### F5. Artifacts 发布 → 分享链接

产物页每个文件「发布」：
- 复制成快照到 `~/.claude-web/published/<id>/`（id 128 位随机），「重新发布」更新快照；
- 路由 `/p/<id>/` 只服务这个目录里的文件（解析后路径必须在目录内，拒绝 `..` 和符号链接出界），不需要也不接受应用令牌，
  响应头 `Content-Security-Policy: sandbox allow-scripts allow-popups`（无 same-origin，碰不到应用的存储和接口）、`X-Content-Type-Options: nosniff`；
- 有效期 1 天 / 7 天 / 永久，「已发布」列表可撤回（删快照）；
- 局域网链接：只有开了远程监听时才有（复用现有远程监听的地址和开关），没开时提示去开；
- 「发布到常开机器」：把快照传到 peer，用它的公网地址；
- 「导出成单个 HTML」：把引用的本地图片 / css 内联成一个文件。
测试：路径穿越、过期、撤回后 404、CSP 头的单测；e2e 发布 → 打开 → 撤回。

---

## 不做的

- 不和 claude.ai 实时同步、不调用 claude.ai 的私有接口（没有公开接口，且违反条款）。
- 不从 Chrome 直接读 Cookie。
- 标注层不跟随页面滚动。
- 节点图里拖动后的位置不保存。
- 交接不支持非 Git 项目；取回不自动合并。

## 交付时要写明的验证缺口

- mac 白屏只在 Windows 上模拟验证（没有 Mac）。
- GitLab 自建实例、外网常开机器如果没有可用的测试环境，只做假服务端 / 本机第二实例验证。
- A5 的 buffer 数字以官方二进制同窗口实测为准；没跑通官方二进制就写明。

---

## 阶段 A 完成后留给后面的（2026-10-24）

阶段 A 已完成（1aa7fec..542599e，引擎 engine-v2.8.4-cw.7）。总审查和修正轮里记下、留到后面阶段处理的：

- `desktop/src/main.ts` 的 `desktop:openExternal` IPC 不限协议，直接交给 `shell.openExternal`；B 阶段改链接打开方式时在主进程加白名单（http / https / mailto / tel）。
- `server/src/files/service.ts` 没有 UNC 路径防护；B1「自动打开 Claude 写的文件」上线前在服务端统一拦 `\host` / `//host`。
- 鼠标中键点页内 `#锚点` 链接会再开一个应用窗口（阶段 A 之前就有）；B2 改标签栏时一并处理。
- 没在本机跑的对话还没有 `compactWindow`，上下文小环按完整窗口算；A7（压缩点设置）接着用这个字段。
- 上下文卡的 `--ctx-*` 颜色还没进对比度测试（`contrast.test.ts` 只读 tokens.css）。
- 失败重试没有退避：服务端重启那一两秒里按 Ctrl+R 会落到「页面连续出错」页（点重新加载能回来）。

## A7 完成后留下的（2026-10-24）

A7 已完成（2acfd06..2828a44）。总审查 / 修正轮复审后留下、不挡用的：

- 窗口变小时的「先压缩」：如果用户恰好在取用量的那几毫秒里发了消息，这次会不压缩直接换（`fitForShrink` 在 `busy()` 之后没转成延后）。概率极低，下次动 runner 时补。
- 自己的账号经用户自己的中转（settings.json 里的 `ANTHROPIC_BASE_URL`）时不应用 200K / 1M 选择，菜单标记仍按设置显示；压缩点按账号选择算的窗口封顶。
- 「默认 1M」只在 Max 账号上实测；不支持长上下文的套餐要在 编辑 里改 200K（笔记已写）。
- 官方二进制这条路没有 e2e（e2e 和验收都走 ccb）；compactWindow 对官方二进制按 100K 下限显示。
- 测试缺口：界面保存路径只在 e2e 用 settings.set 测、ui-smoke 只测取消；中转跳过选择没有 e2e。

## 阶段 B 完成后留下的（2026-10-25）

B 已完成（e722be2..45939c1）：9 个任务 + 三路阶段审查（安全 / Claude 的浏览器工具 / 界面）+ 验收 + 修正轮两轮。留下的、不挡用的：

- 网站检查与真正点击之间仍有极短的窗口：页面可以在检查后、点击前自己跳走（根本性的 TOCTOU，只能缩短不能消除）。
- 下载的「每个页面 10 秒 5 个」上限按页面算，页面开弹窗（变成新标签）可以绕开。
- `cw-local` 分区里的标签之后再输入 https 地址，仍留在那个没有登录状态的分区。
- 卡住的页面被强制结束渲染进程后会重新加载，页面里没提交的表单内容会丢。
- 同一对话开在两个窗口时，第二个窗口的本地页面标签是空白；同一标签里从一个本地页面跳到另一个后后退会是空白。
- 没验证的：Ctrl+F 焦点在网页里时的转发、授权卡在真实模型对话里的显示（e2e 用真实打开的对话测了闸门逻辑）、Ctrl 点链接 / 复制网址（避免启动用户的浏览器、覆盖剪贴板）；mac 没有真机。
- 浏览器实测里有两条偶发：滚轮那条固定等 500ms、截图那条在机器刚崩溃后失败一次，重跑都通过。
