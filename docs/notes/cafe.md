# 后台 · 网吧（2026-10-13）

spec：`docs/superpowers/specs/2026-10-13-cafe-design.md`，计划 `docs/superpowers/plans/2026-10-13-cafe.md`。用户要 Mavis 那种「能到处走的办公室」，
场景是网吧：子代理是客人（进门开机、坐着干活、空下来吃泡面打游戏上厕所、到前台结账），主对话是网管，默认角色是 Claude 的小章鱼，
能在右侧面板里看，还要一个像 Codex pet 那样的「捏角色」skill（照片或口述）。

- **数据只来自 `background.changed` 快照**（见 [background](background.md)），网吧没有自己的服务端状态，角色除外。
- **角色格式 = 纯 TS，两边共用**：`server/src/characters/core/`（web 经 `@characters` 别名；不 import `node:*`）。一个角色 = 24×24 的 front / back
  两张像素格子 + ≤ 16 色调色板 + `rig {legs, eyes, hands}`；`poseFrame(def, facing, pose, tick)` 从这两张图做出每个动作（走路 = 腿部左右半边交替抬一格、
  坐 = 藏掉腿、打字 / 打游戏 = 手位叠 2×2 的手、吃 = 手位叠碗 + 点头、眨眼 = 眼睛换成皮肤色），sw / nw 是镜像。内置小章鱼 / 网管是脚本生成后贴进
  `builtin.ts` 的数据；客人的小章鱼按 agent 颜色换 o / h / s 三个字母（`tinted()`），自定义角色保持自己的颜色。
- **服务端** `server/src/characters/`：`service.ts`（`<dataDir>/characters/<id>.json`，草稿 `draft: true`，坏文件跳过、只警告一次；指定存 meta
  `settings['cafe.assign']`，删角色会把指定里的它清掉）、`preview.ts` + `png.ts`（自写 PNG 编码，给模型看的预览：正面、背面、走路 4 帧、打字、吃）、
  请求 `characters.list / save / delete / assign` + 事件 `characters.changed`；远程 / 配对设备 / peer 连接只能 list。
- **给模型的工具挂在 `web` MCP 服务器上**（`mcp__web__character_guide / draft / save / assign / list`，定义在 `characters/tool-defs.ts`，
  `WebService.tool` 把 `character_*` 转给 `characters/tools.ts`）——没另开 MCP 服务器，共用启动、密钥文件和三种 agent 的接法；所以「联网」关掉时它们
  也没有。guide / draft / save / list 只动角色库，预先放行（`CHARACTER_FREE_TOOLS`）；assign 改设置，照常问。
- **skill = 本地插件**：`characters/cafe-character.md` 是源，`node scripts/gen-skill-text.mjs` 生成 `skill-text.ts`（tsc 不复制 .md，打包版只带
  `server/dist`；`tools.test.ts` 比对两者）。`cafePluginDir()` 把它写到 `<dataDir>/runtime/plugins/cafe/`（内容变了才重写），runner 在 `web.mcp`
  开着时传 SDK `plugins: [{type:'local', path}]`。**2026-10-13 实测两个运行内核都认**（我们的引擎和官方二进制的 init 里都有 `cafe:cafe-character`），
  phase 26 用真引擎再验一遍。
- **网吧引擎** `web/src/features/cafe/`，Canvas 2D，没有依赖：
  - `iso.ts`（2:1 等距，地板格 16×8）、`map.ts`（快照 → 平面图，纯函数：u 0–5 服务区（厕所、零食、充电宝、前台、门）、u 7–24 座位（每排 6 个，
    每个工作流阶段一排，单个子代理一排，最多 8 排，多出来的在门口排队）、u 26–33 包间（后台命令的机器）和吸烟阳台；结束的任务留 2 分钟让客人结账）、
    `path.ts`（A*，四方向）。
  - `sim.ts`：`step(world, snapshot, now, opts)` 纯函数，随机数（mulberry32）在 world 里，同一个种子完全重现。客人：toDesk → checkin → toSeat →
    work（agent 在跑且 20 s 内有动静）/ 空闲时随机挑 吃 · 喝 · 打游戏（回座位）· 厕所 · 吸烟 · 充电宝 · 聊天 · 看大屏（5–20 s）→ 一有活就回座位 →
    结束 toCheckout → checkout（小票、收银机叮）→ leave。工作流里先做完的人等整个工作流结束才结账；失败先蓝屏 2 s；被停止网管喊「NN 号机被叫下机」；
    从快照里消失 30 s 后直接消失、不结账。打开页面时已经在跑的人直接坐在座位上。
  - `render.ts`：先在一张小画布上按 1:1 像素画（地板、墙、窗外夜景、大屏、霓虹、招牌，家具用等距立方体画，人用 `bake.ts` 缓存的帧），再
    multiply 压暗 + lighter 叠光（屏幕、霓虹、冰柜、前台灯、包间、门口），不平滑地放大到页面画布；名字、座位牌、气泡、小票、门口招牌最后按页面分辨率画。
  - `Cafe.tsx`：rAF 循环（≤ 30 帧 / 秒，看不见就停），拖动平移、滚轮缩放、双击回全景；画布上盖一层透明按钮（每个客人和网管一个，键盘 / 读屏用）；
    悬停座位牌出 tooltip（网费、token、约 $）。拿不到 2D 画布就不画。
  - 位置：「后台」页顶上一大块（`BackgroundPage` 里 `lazy()` 加载——首屏入口文件有大小上限），下面是卡片、今日账单（`Bill.tsx`，读 `useCafe` 的
    receipts）、关系图、动态；右侧面板 extra 标签「网吧」（`CafePanel`，跟当前对话），图标栏 ··· 里也有；角色库（`CharacterLibrary.tsx`，`.dialog-bg`
    浮层，App 里挂一次）：动着的预览、给谁用、收回、删除、「捏个角色」= 新对话 + 输入框预填「用 cafe-character 帮我做一个网吧角色：」。
- **钱**：网费 = `cafe.rate`（元 / 小时，默认 5，设置 → 通用「后台网吧」）× 上机时长，纯娱乐；估算费用 = token × 模型输入单价（`usage/pricing.ts` 的
  `claudeInputPrice`，非 Claude 模型写「费用未知」），子代理只报一个总 token，所以偏低，tooltip 写明。结账声音 `cafe.sound` 默认关。
- 房间永远是夜里（客人颜色用 `AGENT_NIGHT`，tokens.css 深色那套），外框跟主题走。减少动画：不走路、不闪、不眨眼。
- **调试**：`window.__cwBackground.inject(session)` + `open(sid)` 造场景（scratchpad 里的 cafe-demo.js 是个会动的例子）；截图用页面里
  `canvas.toBlob` 再 `POST /api/attachments?sessionId=<hex>&rel=x.png` 落到数据目录（浏览器面板的截图是缩小过的）。
  `node server/ws-phase26.mjs`（e2e 默认列表）；ui-smoke 的 background 段数客人按钮、量画布亮的像素、点客人开抽屉、角色库、右侧面板。
- **踩过的坑**：Electron / 浏览器面板在后台时 rAF 不跑，画布停在 300×150 的初始尺寸——截图前先让页面可见；bash heredoc 喂 Python 吃反斜杠
  （`\'` 变 `'`，phase 23 的一条断言因此是语法错误）——这类改动用 Edit。
