# Claude Web 官网（2026-10-21）

介绍 Claude Web、让人下载并用起来的官网。首屏就是活的像素网吧，整站以交互为先。

调研依据：`reports/Claude Web 官网设计参考调研.md`（Awwwards / FWA 获奖站、同类工具站、微交互库、3D 可行性），要点：
两年内没有等距像素站获奖、25 个同类站没有一家用角色化首屏——赛道是空的；评委奖励的是「主体固定、滚动换章、过程即动画、
角色替你导览」，不要求真 3D；同类站用 DOM 重建产品界面、把真实终端数据当素材；预算 1–2 MB、原生滚动、无全屏预加载、
声音默认关。用户的取向：首要目的是介绍和让人用，交互最重要，可以炫。方案选的是 A（分层 Canvas 视差 + 滚动章节 +
可玩微交互，零 3D 库），真 3D 转视角（R3F + 像素化后处理）留作后续，本设计只为它留接口。

## 1. 范围

做：

- `site/`：Astro 静态站，三个页面 `/`（首页）、`/download`、`/changelog`，中英各一套（`/` 与 `/zh/`）。
- 首页首屏是满屏的网吧，复用产品的网吧引擎；滚动 7 章，场景随章节演戏；结尾下载区；页脚。
- GitHub Pages 部署（`.github/workflows/site.yml`）。

- **主题放映厅**：首屏 7 章之后单独一段。产品在 10 套字符画主题（磷光、深海点阵、锦鲤、月光字雨、抖动、景深球、花园；
  纸刊、字母乐园、水墨）下各录一段真实界面的视频，外加一段「描述一个新主题」，访客切换、拖动、对比（§5.1）。
  录像由 `scripts/record-themes.cjs` 在本机从真实应用录出（§5.2）。官网本身不换皮，也不跑主题的背景程序。

不做：博客、文档站（README 继续承担）、评论、埋点统计、真 3D（留接口）、音乐（只有短音效且默认关）。

## 2. 目录与构建

```
site/
  astro.config.mjs        # 静态输出，部署在主域名 psycioxyxs.my 的根上（base 为 /，GitHub Pages 自定义域名），alias 同 web/vite.config.ts
  package.json            # astro、vitest；不装 three / gsap / lenis
  src/
    pages/ index.astro  download.astro  changelog.astro  zh/{index,download,changelog}.astro
    layouts/ Base.astro   # html lang、字体、主题色、OG 图、语言跳转脚本
    i18n/ en.ts           # 官网自己的英文表（key 是中文原文）；运行时注册到 @i18n 的 core
    hero/                 # 首屏：Scene.ts（分层渲染 + 视差）、post.ts（WebGL 后处理）、demo.ts（演示日脚本）、
                          # chapters.ts（章节表）、Hero.tsx（挂载、滚动、指针、键盘）、tier.ts（分级与降级）
    sections/             # 章节文案与叠在场景上的 DOM 气泡（回合折叠行、权限卡、diff 卡、小票）
    showcase/             # 主题放映厅：Showcase.tsx（窗口、切换、拖动、对比）、clips.ts（片段表、时间标记）
    components/           # DownloadButton、SoundToggle、LangSwitch、Footer
    styles/ tokens.css    # 从 web/src/tokens.css 取暗 / 亮两套值，变量名与产品一致；复制常量，不 import，避免把产品样式整份拖进来
  public/ og/*.png  poster/*.png  sfx/*.ogg
  media.json              # 主题录像清单：文件名 → sha256 / 字节数（录像本身不进仓库，§5.2）
  scripts/ releases.mjs   # 构建时抓 GitHub Releases → src/data/releases.json
           fetch-media.mjs # 构建时按 media.json 下载录像到 dist/themes/，校验 sha256
```

- `site/` 原来是 9 月的单页旧宣传页（`index.html` / `page.html` / `build.mjs` / `assets/`），新站整个替换它（2026-10-22 用户确认）；
  `scripts/icons.cjs` 改为把图标写到 `site/public/icon.svg`。
- 主题复用：alias `@themes` → `../server/src/themes/core`，只用 `parsePack` / `paletteCss`（读各主题的 `theme.json`，给放映厅
  这一段着色）和帧表 / 默认动画（主题按钮上的小过程动画）；`@web-themes` → `../web/src/themes`，只取 `builtin/*/theme.json`
  和 `ProcessGlyph` 依赖的 `ticker.ts` / `render.ts`。不取 `backdrop.js`、背景 Worker、`apply.ts` / `registry.ts`。
- 引擎复用：alias `@cafe` → `../web/src/features/cafe`，`@shared` / `@characters` / `@i18n` 与 `web/vite.config.ts` 一致。
  官网只引用 `iso.ts`、`map.ts`、`path.ts`、`sim.ts`、`bake.ts`、`render.ts`、`money.ts` 和 `@characters` 的内置角色；
  不引用 `Cafe.tsx` / `state.ts`（它们连着产品的 zustand 和 WS）。
- `render.ts` 的改动（产品端行为不变）：把 `render()` 的四段拆成导出函数 `drawRoom(c, w, sz, look)`（墙、窗、大屏、霓虹、招牌、
  海报、地板、门垫）、`drawItems(c, w, sz, look, pick?)`（按深度排序的家具 / 桌 / 椅 / 人 / 玻璃；`pick(d) => boolean`
  决定这次画哪些深度）、`drawLight(c, w, sz, look)`（multiply 压暗 + lighter 光晕）、`labels(out, …)` 已是独立函数。
  `render()` 仍按原顺序调这四个，`npm test -w web` 的 cafe 测试不变。
- 版本与更新内容：`scripts/releases.mjs` 在构建时请求 `api.github.com/repos/ypyik0669/claude-web/releases`
  写成 `releases.json`（版本、日期、各平台文件 URL 与大小、正文）；无网或 403 时用上次提交的 json。
  `/changelog` 由仓库根的 `CHANGELOG.md` / `CHANGELOG.zh-CN.md` 构建。
- 构建：`npm run build -w site`；根 `package.json` 加 `build:site`。部署：push `main` 时 Pages 工作流构建 `site/dist`。
  首页 LCP 元素是 poster 图（见 §7），不等 JS。

## 3. 页面

### 3.1 首页 `/`

从上到下：

1. **首屏**（100 vh，场景钉住）：满屏网吧；左上 logo + 导航（功能 / 主题 / 下载 / 更新 / GitHub / 语言 / 声音；「主题」跳到放映厅）；
   左侧叠标题区：H1「Claude Code，有了界面。」（英：`Claude Code, with a face.`），副标一句「桌面版和网页版，
   对话、审阅、分屏、手机远程；底下跑的是官方 Claude Code，也能带 Codex、Gemini CLI 这些」；主按钮按系统自动
   写「下载 Windows 版」/「下载 macOS 版」，次按钮「从源码跑 `R`」，按钮下一行「免费开源 · Windows、macOS 和网页 · 不用注册」。
   右下角一行提示「滚动看它们干活 ↓」。
2. **7 章**（每章 100 vh，场景继续钉住，左侧文案换、场景里演对应的戏，见 §4）。
3. **主题放映厅**（场景在第 7 章后解除钉住、滚走）：标题「十套皮，换着穿」（英：`Ten skins. Same app.`），见 §5.1。
4. **三联数字**：GitHub stars / 版本数 / 支持的 agent 数（构建时从 releases.json 和 GitHub API 取，取不到就不显示这块）。
5. **下载区**：前台特写（同一个 `World` 再挂一块小画布，镜头固定在前台，进视口才跑），按钮同首屏；点击后打印机吐一张小票（§5）。
6. **页脚**：一行「社区项目，与 Anthropic 无关；"Claude"、"Claude Code" 是 Anthropic 的商标」+「© Claude Web contributors · MIT」+ GitHub / Releases / 更新内容 / 语言。

### 3.2 下载页 `/download`

顶部版本号 + 日期 + 「更新内容」链接。按系统分节，当前系统的那节排最前并展开：
Windows（安装版 / 便携版）、macOS（Apple Silicon / Intel，附「首次打开的提示怎么处理」一行，链到 README 对应节）、
从源码跑（`git clone … && npm install && npm run build && npm start`，带复制按钮，并说明需要 Node 22.13+）。
每个文件给大小。页面末尾「安装器的警告」摘自 README。

### 3.3 更新内容 `/changelog`

CHANGELOG 的 Markdown 直接渲染，版本标题可锚链。

## 4. 首屏场景与章节

### 4.1 一个 sim，两个消费者

官网不接产品的 WS，而是喂一段**演示日脚本**（`hero/demo.ts`）：一组按时间排列的 `BgSession` 快照，
`step(world, snapshot, now, opts)` 原样跑，`createWorld(seed)` 固定种子，同一访客同一台机器看到的是同一出戏。
脚本是一个 60 s 的循环：

| 秒 | 快照里发生的事 | 场景里看到的 |
| --- | --- | --- |
| 0 | 主对话 running，无子代理 | 网管在前台，大屏亮，座位空 |
| 3 | 3 个子代理 running（api / tests / docs） | 三个客人进门、办理入住、走到座位、屏幕亮起滚代码 |
| 12 | docs 的 agent 没新动作（超过 WORK_FRESH_MS） | docs 去泡面 |
| 18 | api 的一条工具调用停在「等待批准」（快照里任务状态与产品「需要你」同一字段） | api 举手，头顶气泡「需要你」（§5 的可玩权限卡） |
| 24 | tests 完成 | tests 走到前台，结账，小票打出，离开 |
| 30 | 新子代理 lint 在另一台机器（联邦）启动 | 第四个客人穿不同颜色进门 |
| 40 | 全部完成 | 依次结账离开，网管回座 |
| 60 | 回到 0 | 循环 |

章节切换不打断循环：每章只告诉镜头看哪里、把哪些 DOM 气泡挂到哪个座位（§4.3）。
如果某章需要的事件此刻没在发生（比如访客滚到「权限」章时没人举手），`demo.ts` 提供 `jumpTo(phase)`：
把脚本时钟拨到最近一个该阶段的开头（同种子，可重现），镜头推过去的 400 ms 里完成，访客看不出跳帧。

### 4.2 分层与视差

`hero/Scene.ts` 把一帧画成 4 张离屏画布（都是 1:1 像素小画布，和现有 `scene()` 一样最后 nearest 放大）：

| 层 | 画什么 | 视差系数 |
| --- | --- | --- |
| L0 back | `drawRoom`（墙、窗、大屏、霓虹、海报、地板） | 0.4 |
| L1 mid | `drawItems` 里深度 `d < 前台深度` 的（后排桌椅和人） | 0.7 |
| L2 front | `drawItems` 里 `d ≥ 前台深度` 的（前台、网管、门口、玻璃） | 1.0 |
| L3 light | `drawLight` 单独画在透明画布上（光晕层） | 0.55，并随指针轻微"呼吸" |

合成到页面画布：每层按 `offset = (pointer − center) × 系数 × 最大位移（12 px，小画布像素）` 平移后 `drawImage`，
L3 以 `lighter` 叠上。指针用 `pointermove` 更新目标、每帧以 `--ease-out` 的 lerp 跟上；无指针（触屏）时视差关。
`labels()`（名字、座位牌、气泡）仍按页面分辨率画在最上层，不参与视差。
分层只是绘制目标不同，`sim` 和 `drawItems` 的排序逻辑不动——这就是将来换成真 3D 渲染器（方案 B）时唯一要替换的文件。

镜头：`View { scale, x, y }` 由章节决定（§4.3），切章时在 400 ms 内 lerp；滚动过程中按章节进度再加一段 0–6% 的推拉，
用 `animation-timeline: scroll()` 写进 CSS 变量 `--hero-progress`，不支持时 `IntersectionObserver` 按章节取整。
原生滚动，不用 Lenis，不劫持。

### 4.3 章节表（`hero/chapters.ts`）

每章：`{ id, phase, look: { u, v, scale }, bubbles: BubbleSpec[] }`，文案走 `tr()`。

| # | 标题（中文 key） | 镜头 | 叠在场景上的 DOM | 对应产品功能 |
| --- | --- | --- | --- | --- |
| 1 | 「派活，它们自己去干」 | 全景 | 无 | 对话、子代理 |
| 2 | 「一回合折成一行」 | 推到 api 的座位 | 回合折叠行「干了 52 秒 · 读 1 个文件 · 改 2 个 · 跑 1 条命令」，点开展开时间线；时间线每步前面是过程动画（`ProcessGlyph`，随当前皮肤）；末尾一个带「运行」按钮的代码块，点了在气泡里打出预录的输出 | 回合时间线、过程动画、运行代码块 |
| 3 | 「要你点头的时候，它举手」 | 推到举手的人 | 权限卡（可玩，§5） | 权限卡 |
| 4 | 「改了什么，当场看」 | 推到 tests | 改动文件卡 `+6 −1`，点开 diff（真实的 cart.ts 例子，和 README 截图同一份） | 审阅 |
| 5 | 「干完了，结账」 | 推到前台 | 小票：时长、token、约 $ | 用量 / 费用 |
| 6 | 「不止 Claude，也不止这台电脑」 | 拉远，门口进来穿别的颜色的客人 | 三个 chip：Codex / Gemini CLI / 其它电脑；手机壳小图；一行「子代理可以用任何一家的模型」 | 多 agent、联邦、手机远程、子代理任意模型 |
| 7 | 「一个地址，接所有账号」 | 大屏特写 | 大屏上显示 `/v1` 地址和账号列表（Claude / Gemini 网页 / WorkBuddy 各一行，状态灯在跳） | 网关 |

左侧文案区固定宽 420 px（手机全宽、在场景下方），标题 `--fs-display`，正文一两句，不堆功能表。
每章右下角一个小「试试」链接跳到 README 对应节。

### 4.4 屏幕上的字

每台 PC 的屏幕滚动的是真实的工具调用行（`Read src/cart.ts` / `Edit …` / `Bash npm test`），由 demo 快照里的
`tasks[].steps` 提供，不是乱码；小画布上按 3 px 高的色条画（现有 `drawDesk` 的做法），镜头推近（scale ≥ 4）时换成
真文字（`labels()` 里按页面分辨率画）。

## 5. 微交互

按成本从低到高，全部做；每条写明降级。

| 交互 | 做法 | 触屏 / 减少动画 |
| --- | --- | --- |
| 视线跟指针 | 指针在场景上时，最近的 3 个人 `facing` 朝向指针所在格（只改渲染朝向，不改 sim） | 关 |
| 悬停一台 PC 抬亮 | 该座位的屏幕光晕半径 ×1.4，其它不变（Linear 的「大的慢、小的快」） | 点一下等价 |
| 悬停小人弹想法气泡 | DOM tooltip：任务名、正在用的工具、token、约 $（现有座位牌 tooltip 的内容） | 点一下弹，再点关 |
| 权限卡可玩 | 第 3 章的卡：悬停「允许」时小人提前放下手、屏幕预亮（预览）；点击才真「批准」——demo 脚本收到 `approve`，小人继续敲；点「拒绝」他耸肩回去 | 同样，点击 |
| 下载按钮吐小票 | 点击：前台打印机出一张小票（Canvas 画，内容：版本、平台、大小、「谢谢惠顾」），同时 `<a download>` 正常触发 | 同样 |
| ← → 切小人 | 镜头在客人之间平移，想法气泡跟着出现 | 无 |
| 键盘快捷键 | `D` 下载、`R` 从源码跑、`C` 更新内容、`G` GitHub、`S` 声音（按钮上标字母，Zed 式） | 无 |
| Konami 码 | 露出调试面板：调光、加速脚本、换种子、显示 fps | 无 |
| 声音 | 默认关；右上「声音：关」开关；开了之后：键盘敲击（按屏幕亮的人数混）、结账「叮」、泡面吸溜；都是 ≤ 50 KB 的 ogg，总共 ≤ 200 KB，首次开才加载 | 减少动画时整段禁用 |
| 开机预加载 | 没有独立 loader：poster 先显示，场景 JS 到位后显示器逐台亮起（0.8 s）接管，不是淡入 | 直接接管 |
| 主题放映厅 | 见 §5.1 | 见 §5.1 末尾 |

### 5.1 主题放映厅（`site/src/showcase/`）

**布局**：中间一个 16:10 的应用窗口（DOM 画的标题栏，标题「Claude Web — 磷光」随主题变），里面放当前主题的录像；
窗口下面一条细时间轴，带三个标记「首页 / 跑一回合 / 等你批准」；再下面一排 11 个主题按钮（名字 + 亮 / 暗小标 +
一个用该主题帧表实跑的小过程动画，`ProcessGlyph`，纯 DOM 不跑背景），最后一个是「描述一个新的 →」。
整段的背景色、强调色、文字色取当前主题 `theme.json` 的配色（`paletteCss` 只作用在这一段的容器上，颜色变量用 `@property`
注册，切换时 400 ms 过渡）；亮色主题时这一段整体变亮。默认选中「磷光」。

**同一条时间线**：10 段主题录像由同一个录制脚本（§5.2）按同一套动作录出，长度都是 12 s、循环播放：

| 秒 | 录像里的画面 |
| --- | --- |
| 0–3 | 首页，主题背景在动；鼠标划过背景（背景对指针有反应的主题会起涟漪 / 拖尾） |
| 3–5 | 点进一个对话 |
| 5–10 | 发一句话，一回合开始：时间线里逐步出现 读文件 → 改文件 → 跑测试，每步前面是该主题的过程动画，回复逐字流出 |
| 10–12 | 停在权限卡「要运行 `npm test` 吗？」，然后接回 0 s |

**交互**（这一段的全部交互，不再加）：

| 交互 | 做法 |
| --- | --- |
| 切换 | 点主题按钮；这一段有焦点时 ← → 或数字键 1–9、0。新录像从**同一秒**接着放（`currentTime` 对齐），从点击处圆形揭开（新 `<video>` 叠在上面，`clip-path: circle()` 400 ms 展开，结束后撤掉旧的）。按钮悬停时预加载那段录像 |
| 拖动 | 在窗口上横向按住拖（或拖时间轴）＝ 前后拖动画面，松手接着放；点三个标记直接跳过去 |
| 对比 | 窗口右上「对比」开关：打开后窗口被一条竖线分成两半，左边是上一个主题、右边是当前主题，同一秒同步播放，竖线跟着指针走（触屏：拖竖线） |
| 暂停 | 点窗口或空格：暂停 / 继续 |
| 分享 | 当前主题写进 URL：`?theme=phosphor#themes`，打开即选中并滚到这一段 |

**「描述一个新的」**：第 11 段录像，单独一条 15 s 的时间线：在输入框里打一句「深夜的地铁站，绿色的指示灯在闪」
→ ascii-theme 开始干活，过程动画走一遍 → 对话里出现试跑截图卡 → 点「应用」→ 整个界面换成新主题。
这一段不能对比（没有对应的「上一个」）。窗口下方一行「这是 Claude Web 自己生成的；你也可以描述一个」。

**加载**：这一段进入视口前一屏才开始加载；先只加载 11 张海报（webp，1280×800，各 ≤ 80 KB），当前主题的录像随后加载，
其它的悬停或切到时才加载。全部不计入首页 1.5 MB 预算（§7）。

**降级**：手机用 720×450 的小版录像，主题按钮变成可横滑的一条，没有「对比」，拖动只在时间轴上；
`prefers-reduced-motion`：不自动播放，只换海报，窗口中间一个「播放」按钮；视频加载失败就停在海报上。

### 5.2 录制（`scripts/record-themes.cjs`）

- 基于 `scripts/readme-shots.cjs` 的做法：`scripts/lib/demo.cjs` 起临时 HOME + 假上游 + 演示项目，Electron 离屏窗口
  1280×800、`deviceScaleFactor` 2（录完缩到 1280×800，字更清楚），`setFrameRate(30)`，用 `paint` 事件逐帧存 PNG。
- 每段录像前切到对应主题（写主题画廊用的那个设置项），等背景就绪，然后执行**同一份**动作脚本：鼠标轨迹用
  `sendInputEvent` 回放、点击、发消息；假上游按固定剧本回放这一回合（读 / 改 / 测试三个工具调用、一张 `npm test` 的权限卡），
  不花 token、每次一样。每帧带时间戳，ffmpeg 按时间戳重采样成恒定 30 fps，保证 10 段的第 n 秒是同一个动作（误差 ≤ 1 帧）。
- 「描述一个新的」那段：假上游回放一段预先写好的 ascii-theme 过程（工具调用写出主题文件，主题本身放在
  `scripts/lib/fixtures/theme-metro/`），试跑和应用走产品真实的流程。
- 输出（每段、中英各一）：`<id>.<lang>.webm`（AV1，`libsvtav1`）、`<id>.<lang>.mp4`（H.264 兜底，给不支持 AV1 的 Safari）、
  `-sm` 小版两种、`<id>.<lang>.webp` 海报（取第 7 s 那一帧）；完成后打印每个文件的大小，单段大版超过 1.5 MB 就报警。
- 用法：`node scripts/record-themes.cjs [--lang en|zh] [--only phosphor,ink]`；界面或主题有改动时手动重录，不进 CI
  （CI 上 Electron 离屏录制不稳定、也慢）。
- 录像不进仓库（11 段 × 2 种语言 × 4 种编码，几十 MB）：录完上传到一个 GitHub Release（tag `site-media`，不是正式版本，
  标成 pre-release），同时更新 `site/media.json`（文件名、sha256、字节数）并提交；官网构建时 `fetch-media.mjs` 按清单下载、
  校验后放进 `dist/themes/`，由 Pages 同源提供（Release 的下载地址会重定向、不适合直接当 `<video src>`）。

## 6. 文案与双语

- 所有可见文字 `tr('中文')`，英文在 `site/src/i18n/en.ts`；`scripts/i18n/extract.mjs --check` 加入 `site/src`。
- 用词守产品的规则：叫「对话」不叫「会话」；不出现「引擎 / 窗格 / 停靠 / ACP」。`web` 的 `wording.test.ts` 的词表复用到 `site` 的测试。
- 语言：`/` 英文、`/zh/` 中文。首次访问 `/` 时若 `navigator.language` 以 `zh` 开头则跳 `/zh/`（一次，带 `?lang=` 参数的不跳）。
  不用 localStorage 记语言——URL 就是状态。
- `html lang`、OG 标题 / 描述、poster 上的招牌（「CLAUDE 网咖」/「CLAUDE Internet Café」）都按语言出两份。

## 7. 性能与降级

预算：首页首次加载 ≤ 1.5 MB（含字体、poster、引擎 JS），场景 JS 懒加载（`requestIdleCallback` 或首屏可见后），音效按需。
主题放映厅的海报和录像不算在内（滚到附近才加载，§5.1）。
字体：标题用一款像素位图字（只用于 H1 和章节标题，subset），正文系统 UI 栈，命令用等宽系统字体；不加载 Inter。

三层，共用同一套精灵与脚本（`hero/tier.ts` 决定）：

| 层 | 条件 | 行为 |
| --- | --- | --- |
| T0 分层 Canvas + WebGL 后处理 | 桌面指针设备、`hardwareConcurrency > 4`、WebGL2 可用且 renderer 不含 `SwiftShader` | 全部 §4–5；后处理 = 一个全屏片元着色器：Bayer 4×4 抖动 + 光晕层高斯 bloom + 轻暗角，输入是合成后的页面画布纹理 |
| T1 纯 Canvas 2D 分层 | 其余桌面、所有手机 | 无后处理；手机：缩小视口、关视差、客人 ≤ 4、≤ 24 fps；画布区「点一下锁定」后才接管拖拽平移，再点或滚动释放 |
| T2 静态 | `prefers-reduced-motion`、无 Canvas、爬虫 | poster PNG（构建时 `scripts/poster.mjs` 用 Playwright 打开构建好的站点、带 `?poster=1` 让场景按固定种子停在第 20 秒，截图存 `public/poster/`，中英各一；引擎用浏览器 Canvas，不在 Node 里跑）；章节文案照常可滚 |

所有层：标签页不可见时 rAF 停；场景不在视口内（滚过了下载区）时停。
方案 B 的接口：`Scene.ts` 导出 `interface SceneRenderer { mount(el, world) ; frame(world, view, pointer) ; unmount() }`，
分层 Canvas 是它的第一个实现；真 3D 以后是第二个，`tier.ts` 多一档。

## 8. 无障碍

场景画布上覆盖透明的 `role="img"` + 随章节更新的 `aria-label`（「三个子代理在座位上工作，一个在前台结账」）；
章节导航可键盘到达；所有叠在场景上的卡是真 DOM，文字可选可读屏；焦点环用产品的令牌。
权限卡、下载按钮都是 `<button>` / `<a>`。

## 9. 测试

- `site/src/hero/*.test.ts`（vitest）：`demo.ts` 的脚本在固定种子下 60 s 内每个阶段都出现、`jumpTo` 可重现；
  `chapters.ts` 每章的 `look` 落在地图内；`tier.ts` 的分级表。
- 文案：i18n 覆盖测试和 wording 测试扩展到 `site/`。
- `render.ts` 拆分后 `npm test -w web` 全过；产品的 ui-smoke 不受影响。
- 放映厅：`clips.ts` 的片段表和 `media.json` 一一对应（每个主题、每种语言、每种编码都有，加上海报）；10 套内置主题的
  `theme.json` 都能 `parsePack` 并生成配色，每套在这一段的文字 / 按钮上过 `contrast.ts` 的对比度检查；`?theme=` 非法值回到磷光。
  Playwright 打开构建好的站点：逐个切换，断言新录像的 `currentTime` 与切换前相差 ≤ 0.1 s、控制台无错误；对比模式两段同步。
- `fetch-media.mjs`：sha256 不符时构建失败；下载不到时用占位海报并在构建日志里警告，不让整站构建失败。
- 预算：构建后 `scripts/site-budget.mjs` 统计 `dist/` 首屏引用的资源总量，超过 1.5 MB 构建失败。
- 手动：Chrome 的 Lighthouse（性能 ≥ 90、无障碍 ≥ 90）；一台集显笔记本上 T0 ≥ 50 fps；iPhone / Android 各看一遍 T1。

## 10. 之后可做（不在本设计内）

真 3D 转视角（方案 B）；白天版调色板跟随浅色主题；「让它带你逛」自动导览；用访客自己的 Claude Web 实例的真实数据
（本机 `127.0.0.1:3090` 可达时）替换演示日。
