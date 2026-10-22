# 字符画主题与过程动画（2026-10-22，用户要求）

设计：`docs/superpowers/specs/2026-10-22-ascii-themes-design.md`；第 1 步计划：`docs/superpowers/plans/2026-10-22-ascii-themes-p1.md`。
四步都做完了：骨架、十套内置主题、「描述一下就生成主题」的 skill（ascii-theme）和它的工具、设置 → 外观的主题卡片画廊。

## 结构（`web/src/themes/`）

- 纯逻辑在 `server/src/themes/core/`（前端经 `@themes` 别名引，服务端检查 skill 的草稿也用它）：`process.ts` `frames.ts` `default-anims.ts` `css-tokens.ts` `pack.ts` `contrast.ts`。前端的 `web/src/themes/` 只放和页面有关的。
- `process.ts`：16 个过程（start think read search edit cmd test git install web agent plan tool wait compact connect）和 `processOf(name, input)`。
  Bash / PowerShell 看命令：先 git，再装依赖（`npm i -D vitest` 是装依赖，不是测试），再测试。`RunStatus.process`（`chat/run-status.ts`）在思考时分 start（本回合还没有 assistant 输出）和 think。
- `frames.ts`：帧表格式和 `checkAnim`。stage ≤ 2 行 × 14 格、同一个动画所有帧同宽同行数；inline 每帧 ≤ 3 格；颜色只能写令牌名。宽度按等宽格算（`strWidth`，CJK / 全角 2 格）。报错是中文，给 skill 看的（i18n 覆盖测试的允许名单里）。
- `default-anims.ts`：经典主题用的 16 个动画，也是字符画主题缺项 / 坏项时的兜底。
- `pack.ts`：`parsePack`（theme.json → `ThemePack`；坏的过程只记在 `broken` 里退回默认，别的错就整个不要）、`paletteCss`、`sanitizeCss`、`animFor`。
- `registry.ts` + `builtin/<id>/{theme.json,backdrop.js,theme.css}`：内置主题，`builtin/index.ts` 用 `import.meta.glob` 按文件夹自动收（加一个文件夹就是加一套；`ORDER` 定设置页里的顺序）。用户自己的主题由服务端发来（`setUserThemes`），和内置的同一个格式；id 撞了内置的以内置为准。
- `apply.ts`：`applyAscii(id)` 维护 `<style id="cw-ascii-theme">` 和 `html[data-ascii]`；`useActivePack()`；救命开关 `setSafeMode()`（Ctrl+Shift+0，`app/App.tsx`，本次启动有效；在设置里再点一个字符画主题就解除）。
- `ProcessGlyph.tsx` + `ticker.ts` + `render.ts`：过程动画。一个共享时钟（30 Hz，没人登记就停），帧号变了才写 `innerHTML`，不走 React 渲染。帧预先转成转义过的 HTML。
- `Backdrop.tsx` + `backdrop-worker.ts` + `sandbox.ts` + `watchdog.ts` + `backdrop-protocol.ts`：背景。

## 主题怎么套上去

- `ui.theme = 'ascii:<id>'`。`resolveTheme` 返回包的 mode（dark / light），所以 `data-theme` 仍是 dark / light，tokens.css 里所有按亮暗写的规则（暗色描边、白天的网吧……）照常生效；包的配色写在 `html:root[data-ascii='<id>']`（多一个 `html` 压过经典主题块）。
- `store.theme` 仍是 dark / light（Monaco、xterm、Mermaid 按它走）。
- custom.css / theme.css 的钩子：`html[data-ascii="<id>"]`。

## 背景（Worker）

- `<Backdrop scene="welcome|chat">`：`canvas.transferControlToOffscreen()` 交给模块 Worker；宿主转发尺寸、指针（canvas 坐标）、点击（点在按钮 / 输入框上的不算）、输入框新打的字、当前对话的过程、`quiet`（欢迎页 `.home-col` 各块的矩形，背景在那里要变淡，否则字雨压在按钮上看不清）。
- **真正断网的是 Worker 自己的 CSP**：服务端发 `backdrop-worker-*.js` 时带 `default-src 'none'; script-src 'self' 'unsafe-eval'`（`server/src/index.ts` `BACKDROP_WORKER_CSP`；开发时 `web/vite.config.ts` 的小插件发同一个）。Worker 的权限看它自己那个响应的 CSP，不看页面的；页面没有 CSP，所以不能用 blob: Worker（会继承页面的「什么都不管」）。
- `lockdown(self)` 只是第二道：沿原型链把 fetch / XHR / WebSocket / EventSource / importScripts / indexedDB / caches / BroadcastChannel / Worker / navigator / FontFace / fonts / Request / Response 删掉钉死。只删 `self` 自己的属性不够——`WorkerGlobalScope.prototype.fetch.call(self, …)` 照样能发请求；`import('http://…')` 和 `new FontFace(…, 'url(http://…)')` 也只有 CSP 拦得住（2026-10-22 验收时实测）。
- 不是内置的主题，Worker 先用真的 fetch 请求一次本页（`cspHolds`）：请求成功 = CSP 没生效，直接报错不跑（看门狗换回默认）。内置主题（`isBuiltin`）跳过这一步。
- 然后把 `export default`（不要求在行首）换成 `return`，用 `new Function` 求值。
- theme.css 不做替换，只做检查（`cssRemoteRefs`）：用 `css-tokens.ts`（照 CSS Syntax 3 写的分词器，转义、字符串、url 记号、坏字符串 / 坏 url 的恢复都和浏览器一样）把 CSS 切成记号再看——有 `@import`、不是 `data:` 的 url、`url("…")` 里不是 data:、指向页面外的字符串（`image-set("http…")`、自定义属性里藏一个；由 `new URL(值, 基址)` 判断——和浏览器同一套 WHATWG 规则，`\/host` 对 http 就是 `//host`，`\\host` 是另一台机器；落到别的源、且是 http / https / ftp / ws / wss / file / blob 才算，`"status: ok"` 这种只是文字），或任何坏字符串 / 坏 url，就**整份不用**，错误写进 `parsePack` 的 errors 给 skill 看。在文本上用正则找的做法被绕过过两轮：`@import/**/"…"`、`url(\68ttp://…)`，以及字符串里转义的换行 `"\a http…"`、标识符里转义的引号 `a\27 b`、坏 url 里落单的引号——都是「我看到的记号」和「浏览器看到的记号」对不上。第三轮是字符串开头的反斜杠 `"\\/host/x"`（解码后 `\/host/x`）——自己写「像不像地址」的规则总会漏，改成让 URL 解析器说了算。第四轮又补两条，都是「失败即拒」：解析不了的也算出界（Chromium 的 `new URL` 拒绝 `//h%3A1/x`，CSS 加载图片时却照样去取）；明写出 http / https 等网络协议的直接算出界，并且同时按 http 和 https 两种页面判断（手机壳在 https 上，`http:host/x` 在那里就是另一台主机）。没用页面级 CSP：对话里的 Markdown 图片、网站图标都从外网加载。
- 帧率：欢迎页 30，对话页 15（对话页还乘 `chatDim.speed`）；离屏、窗口隐藏时 pause；减少动态效果时只画一帧。
- 看门狗：报错、连续两秒每帧 > 50 ms、或 2 秒没有 stats（死循环；宿主每 0.5 秒查一次，卡死约 2.5 秒内被换下）→ terminate，欢迎页换回「字流」，对话页不画，toast 一句。离屏 / 窗口隐藏时暂停不算沉默。 宿主自己的检查晚了一秒以上 = 页面主线程卡住了（Worker 的消息排在后面），这时重新计时，不算 Worker 沉默（验收时主线程卡 2.6 秒把健康的背景误杀过）。
- 减少动态效果：Worker 画完那一帧静止画面发 `still`，宿主这时才停看门狗；每次 resize 重画前再打开，重画完再 `still`。以前一开「减少动态效果」看门狗就永久暂停，卡死的背景永远不被关、一直占一个核。
- 对话页的背景垫在 `.chat-main` 里（`isolation: isolate` + canvas `z-index: -1`），透明度 `chatDim.opacity`；设置「对话里的淡背景」（`ui.backdropInChat`，默认开）。

## 写一个 backdrop.js 要注意

- 只有 `export default { init, frame, event, resize, theme, data }`，不能 import；`frame` 必须有。
- `getContext('2d', { alpha: false })` 自己铺底色；颜色从 `init` / `theme` 的 `colors`（基础色值）拿。
- 拖尾用「每帧盖一层半透明底色」，别用 destination-out（8 位 alpha 永远到不了 0，会留一层雾，见「字流」的注释）。
- 字体只能用系统等宽字体（Worker 里没有页面的 @font-face）。

## 调试 / 截图

- 起一个临时服务：`HOME` / `USERPROFILE` / `CLAUDE_WEB_DIR` 指到临时目录，`CLAUDE_WEB_TOKEN=<随便>`，`env -u CLAUDE_WEB_DIST -u ELECTRON_RUN_AS_NODE`，`PORT=3197 npx tsx server/src/index.ts`；URL 带 `?token=`。
- `scripts/shot.cjs` + `SHOT_JS_FILE`：`setSetting('onboarded', true)`、`setSetting('ui.workbench', true)`、`setSetting('ui.theme', 'ascii:phosphor')`。要欢迎页：`openTile({ id, kind: 'chat' }, 'replace')`；要对话：`openTile({ id, kind: 'chat', sessionId, view: 'chat', wb: 'live' }, 'replace')`——少了 `view` / `wb` 标签里什么都不画，而且这个残缺的标签会存进布局，下次还在。
- 运行中的对话：`node server/ws-demo-running.mjs <port> <token>`（mock agent 跑 `npm test -w server`，60 秒后结束），正好看到 test 过程的三处动画。
- bash heredoc 会吃反斜杠、`printf` 会转义 `!`：生成帧表的脚本和截图脚本用 Write 写文件。


## 内置的十套（`web/src/themes/builtin/`）

磷光 phosphor、深海点阵 abyss、克莱因锦鲤 koi、月光字雨 moon、抖动 dither、景深球 orb、花园 garden（暗）；纸刊 paper、字母乐园 letters、水墨 ink（亮）。
花园的背景读 `data()`：宿主把对话列表按项目文件夹汇总（`backdrop-data.ts`：每个项目的对话数、相对大小、一天内用过、有没有在跑）发给它。

做 / 改一套内置主题：`npx tsx scripts/theme-check.ts web/src/themes/builtin/<id>`——服务端那套草稿检查（格式、16 个过程、对比度、CSS 离线、能编译），再在 Node 里拿假画布把背景跑一遍（两种场景、减少动态效果、指针 / 点击 / 打字 / resize / 每个过程），报异常和每帧耗时。改完 `node scripts/gen-skill-text.mjs`（skill 的范例和 theme_get 用的是生成进 `server/src/themes/skill-text.ts` 的源码；`themes/tools.test.ts` 会拦不一致）。

## 描述一下就生成主题（ascii-theme skill）

- skill 源：`server/src/themes/ascii-theme.md`（也是给人看的制作说明），`scripts/gen-skill-text.mjs` 生成 `skill-text.ts`，`asciiPluginDir()` 写成本地插件 `<dataDir>/runtime/plugins/ascii/`，和网吧的 cafe 插件一起交给会话（`session-runner.ts`）。
- 工具（`web` MCP 里，`themes/tool-defs.ts` + `themes/tools.ts`）：theme_guide / theme_draft / theme_get / theme_save / theme_apply / theme_list / theme_delete。不问就能用的：guide、draft、get、save、list（`THEME_FREE_TOOLS`）；apply（改用户设置）和 delete 照常问。
- 主题库 `themes/service.ts`：`<dataDir>/themes/<id>/`（已保存）、`<dataDir>/themes/.drafts/<id>/`（草稿）。监视整个目录（草稿的变化不广播），`themes.changed` → 窗口重新 `themes.list`。
- **试跑**：theme_draft 存好草稿后把它交给一个本机窗口（`themes.trialHost` 登记，`themes.trial` 事件，`themes.trialResult` 回答；做法照内置浏览器的 `browser.command`）。窗口在同一个沙箱 Worker 里跑 3 秒（中途发指针、点击、打字、思考、项目数据），再要一张快照（Worker 的 `snapshot` 消息：`createImageBitmap(canvas)` 传回来——画布交给 Worker 之后页面读不到它），和 16 个过程的三帧拼成一张图，连同报错、帧耗时回给工具结果。没有窗口 / 窗口断了 / 15 秒没回：草稿照存，告诉模型「没有试跑」。对话里 theme_draft 有自己的卡片（`chat/tools/ThemeDraftTool.tsx`）显示同样的文字和截图。
- 不是内置的主题，背景只在 Worker 的 CSP 在场时运行：页面先 GET 一次 Worker 脚本、看它的 `Content-Security-Policy` 头（`sandbox.ts workerSandboxed`，只查一次），把结果作为 `sandboxed` 交给 Worker。以前是 Worker 自己发一个请求看会不会被拦——拦下来的那一下在控制台是一条错误，ui-smoke 会算失败。Worker 由 `worker-url.ts backdropWorker()` 统一创建：Vite 只认 `new Worker(new URL(…))` 这个写法——别处再写一个 `new URL('./backdrop-worker.ts', import.meta.url)` 会被打包成另一份原样的 `.ts` 资源（没有 CSP 头），查它就永远是「没有沙箱」。所以 Worker 的地址由它自己说：启动时第一条消息 `hello { url: self.location.href }`。

## 设置 → 外观

- `ThemeGallery`：每套一张卡，用它自己的颜色画；指针停在上面（或正在用的那张）才实跑背景（`BackdropPreview`：用主题自己的配色、指针只在卡片里、失败不弹提示，卡片变回静态）和四个过程动画（`ProcessGlyph` 的 `pack` 参数 + 卡片上的颜色变量）。同时只有悬停的和选中的在跑。
- 用户的主题标「我的」，右键「改一改」（开新对话，输入框里写好「用 ascii-theme 改一改我的主题…」）/「删除」。最后一张「＋ 描述一个新主题」开新对话、填好开头。
- 头像菜单「字符画主题…」直接跳到这一项（`openSettings({ section: 'appearance', reveal: 'ui.theme' })`）。经典的六个仍是下面那排小色块。
