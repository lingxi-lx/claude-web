# 字符画主题与过程动画（2026-10-22）

用户要求：整个界面换成 ASCII 艺术风，内置 10 套主题让用户挑；用户用一个 skill「描述一下」就能生成自定义主题；
各个「进行中」的动画换成有趣、贴合过程语义的字符动画（编辑 = 笔在写字，读文件 = 书翻页，思考 = 真的在想……）。

参考：用户给的 6 段视频（Oriku 水母 / 锦鲤、dithering 对比、Kat 月光假名、hal_chemy 景深球、yui540 字母 loader），
ascii-magic-art（同一段动画换一套字符就换一种样子）、loading.dev、X 上的高赞作品（@stackedlol 鲨鱼首页、
Kat 的 ASCII 花园、weather.exe、@kianbazza「loading 变成结果」、Unicode Spinner / unicode-animations）。

## 已定的取舍

1. **深度：换皮 + 氛围。** 配色、字符画背景、标题字体、卡片 / 输入框 / 按钮的边角装饰换；布局、交互、对话正文和代码排版不动（只换颜色）。
2. **背景范围：** 欢迎页 / 空对话完整播放；对话页淡化（默认透明度 12%、速度 1/3，主角退到角落）；设置里可关。
3. **亮暗：** 每套主题自带底色，选主题即定亮暗。原有 6 个主题（浅色 / 深色 / 系统 / dracula / nord / tokyo-night）保留在「经典」组。
4. **自定义自由度：完全自由的代码**（背景代码 + 帧生成代码 + 任意 CSS），靠沙箱和看门狗兜底。
5. **过程动画每套主题各一套**（10 套 × 16 个过程）。
6. **架构选 A：主题包 + 背景跑在后台线程**（Web Worker + OffscreenCanvas）。

## 1. 主题包

一套主题 = 一个文件夹：

```
theme.json    id、名字（中 / 英）、mode: dark|light、配色（沿用 tokens.css 的基础色值）、字体、边框字符、
              chatDim（对话页淡化：opacity / speed）、processes（16 个过程的帧表）
backdrop.js   背景，在 Worker 里跑
theme.css     可选，任意样式（作用域 html[data-ascii="<id>"]）
preview.png   设置页缩略图（skill 试跑时由前端截图生成；内置主题打包时生成）
```

- 内置：`web/src/themes/builtin/<id>/`，随应用打包。
- 自定义：`~/.claude-web/themes/<id>/`（`CLAUDE_WEB_DIR` 下）。服务端 chokidar 监视，变动经 WS 推给前端热更新（同 custom.css）。
- 设置：沿用 `ui.theme`，新增取值 `ascii:<id>`；`ui.welcomeBackdrop` 照旧管欢迎页背景开关；新增 `ui.backdropInChat`（默认开）。都在 meta.json。
- 「默认」主题（经典深色 / 浅色等）有一份默认帧表；背景继续用现有「字流」「字场」组件（不迁进 Worker：它们要读页面文字的位置），也是字符画背景出错时的兜底。

## 2. 运行时

1. **主题加载器**：读 theme.json → `data-theme` 取包的 mode（dark / light，现有亮暗规则照用），另设 `html[data-ascii="<id>"]`，把基础色值写到 `:root[data-ascii="<id>"]`，语义层照旧派生（对比度测试照样拦）；
   注入 theme.css；按需加载字体；把帧表交给动画组件。
2. **背景宿主** `<Backdrop>`：页面里一块 canvas，`transferControlToOffscreen()` 交给 Worker 里的 backdrop.js。
   宿主转发：尺寸、devicePixelRatio、鼠标位置 / 点击、输入框打的字、当前过程（idle / think / edit …）、场景（welcome / chat）。
   离屏、窗口最小化、`prefers-reduced-motion` / `data-reduce-motion` 时暂停（减少动态效果下画一帧静止）。
   帧率：欢迎页 ≤ 30，对话页 ≤ 15。
3. **过程动画** `<ProcessGlyph process size="stage|inline" phase="loop|done|fail">`：
   替换步骤行的四点（`WorkDots`）、`.sgw .spin`、发送键 spinner、思考行、输入框上方状态条（RunCard）、断线条。
   结束时播 `done` / `fail` 段，再交还原来的完成图标。

### backdrop.js 接口

```js
// 在 Worker 里运行；ctx 是 OffscreenCanvas 的 2d 或 webgl 上下文（backdrop 自己 getContext）
export default {
  init({ canvas, width, height, dpr, colors, fonts, scene }) {},
  frame({ t, dt, mouse, process, scene }) {},          // 每帧
  event({ type, x, y, text }) {},                      // pointer / click / type
  resize({ width, height, dpr }) {},
  theme({ colors }) {},                                // 配色热更新
}
```

## 3. 16 个过程

| id | 判定 |
|---|---|
| start | 回合已开始、还没有任何 assistant 输出 |
| think | runStatus.kind === 'thinking' 或思考块在流 |
| read | Read |
| search | Grep / Glob |
| edit | Edit / Write / MultiEdit / NotebookEdit |
| cmd | Bash / PowerShell（且不属于下面三类） |
| test | 命令匹配 test / vitest / jest / pytest / mocha / `cargo test` / `go test` / playwright 等 |
| git | 命令以 `git ` 开头 |
| install | `npm i` / `npm install` / `pnpm add` / `yarn add` / `pip install` / `cargo add` 等 |
| web | WebSearch / WebFetch / WebBrowser / web MCP |
| agent | Agent / Task / Workflow |
| plan | TodoWrite / EnterPlanMode / ExitPlanMode |
| tool | 其它所有工具（MCP、Skill …） |
| wait | runStatus.kind === 'waiting' |
| compact | runStatus.kind === 'compacting' |
| connect | 断线 / 重连中 |

判定是纯函数 `processOf(name, input)` / `runProcess(status)`，有单元测试。

### 帧表格式

```json
"edit": {
  "fps": 8,
  "loop": [["✎     ", "──────"], ["a✎    ", "──────"], ["ab✎   ", "──────"]],
  "done": [["abc ✓ ", "──────"]],
  "fail": [["abc ✗ ", "──────"]],
  "color": { "✎": "accent", "✓": "green", "✗": "red" },
  "inline": { "fps": 6, "loop": ["✎", "✐"], "done": ["✓"], "fail": ["✗"] }
}
```

- stage：≤ 2 行 × 14 格，每帧每行等宽；inline：1 行 ≤ 3 格。
- `color` 的值只能是令牌名（accent / green / red / yellow / blue / fg-1..3 / agent-1..10）。
- `gen` 代替 `loop`：一段 `function (api) { return frames }` 源码，主题加载时在 Worker 里跑一次生成帧，之后照常播放。
- 不合规的过程退回默认主题的同名动画，设置页在该主题卡片上标提示。缺 inline 用默认主题的 inline。

## 4. 十套内置主题

| id | 名字 | mode | 底 / 主色 | 背景主角 | 装饰 | 招牌过程 |
|---|---|---|---|---|---|---|
| phosphor | 磷光 | dark | 黑 / 磷光绿（变体琥珀） | 字符终端雨 + 扫描线余辉 | `┌─┐` 单线 | think 内存条跳、cmd 光标打字、connect `NO CARRIER → CONNECT` |
| abyss | 深海点阵 | dark | 近黑偏紫 / 淡紫白 | 半色调点阵水母 | `⌜ ⌝` 四角 + `SYSTEM ● OPERATIONAL` | think 触须脉冲、search 声呐圈、agent 水母分裂 |
| koi | 克莱因锦鲤 | dark | 克莱因蓝 / 金白 | 点阵锦鲤 + 水波 | 金色细框回纹角 | edit 鱼游过留字、think 打转、done 跃出成 ✓ |
| moon | 月光字雨 | dark | 深夜蓝 / 月白 | 月牙，汉字假名淌下堆积 | 竖排页眉小字 | think 月相、read 字浮起、wait 云遮月 |
| dither | 抖动 | dark | 炭黑 / 米白 | 土星，四种抖动交替 | `░▒▓` 渐变边 | compact `▓▓▓▓→▒▒→█`、read 网点显影、web 网页由粗到细显影 |
| paper | 纸刊 | light | 米白 / 锈橙 | 字符太阳 + 像素时钟 | 锈橙细线、装订孔 | edit 铅笔写字、read 翻书、git 封信盖章 |
| garden | 花园 | dark | 深土 / 苔绿 | 项目长成植物（用量驱动） | 藤蔓叶子框 | edit 浇水长叶、test 花苞依次开、install 落种 |
| orb | 景深球 | dark | 纯黑 / 白 + RGB 拖尾 | 字符点云 3D 球 + 彩色笔迹 | 极细线 + RGB 错位影 | think 球内闪烁、agent 分球、web 经纬线亮起 |
| letters | 字母乐园 | light | 浅灰 / 黑 + 一个跳色 | 会掉会弹的粗体字母 | 圆角卡 + 手写小标签 | edit 字母跳进站好、start `L O A D` 弹跳、fail 散落 |
| ink | 水墨 | light | 宣纸白 / 墨黑 + 朱砂 | 墨色字符晕开、远山 | 毛边框 + 朱砂印 | edit 毛笔写字落印、think 墨滴入水、wait 印悬半空 |

- 主题 id 前缀统一 `ascii:`，与现有 `paper`（经典米纸）不冲突。
- 字体只用 OFL：Departure Mono、VT323、Silkscreen、Fusion Pixel（中文，仅标题，按需子集）、Space Mono、Noto Serif SC。切到用它的主题才加载。
- 花园的数据来源：项目列表 + 最近对话数，经已有的 store 交给 backdrop（`init` / `theme` 之外加一个 `data` 消息）。

## 5. skill：描述一下就生成主题

照咖啡馆「捏角色」（`server/src/characters/`）的路子：skill 正文 `server/src/themes/ascii-theme.md` → 生成 `skill-text.ts`；
进程内 MCP 工具：

| 工具 | 作用 |
|---|---|
| theme_guide | 格式说明、16 个过程、令牌与字体清单、一套内置主题当范例 |
| theme_draft | 提交 json / backdrop / css → 存草稿 → 静态检查 → 前端试跑 → 返回错误清单 + 截图 + 帧耗时 |
| theme_get | 读出已有主题（内置的只读，可以拿来改成新的） |
| theme_save | 草稿转正 |
| theme_apply | 设 `ui.theme` |
| theme_list / theme_delete | 列 / 删自定义主题 |

- 静态检查：JSON 格式、帧尺寸、16 个过程覆盖、对比度（同 tokens 对比度测试的算法）、`vm.Script` 语法检查、大小（代码 256 KB、整套 2 MB）。
- 试跑：前端在工具卡片里渲染预览（背景小窗 + 16 格过程动画），跑 3 秒，把截图、报错、帧耗时经 WS 回给服务端，作为工具结果返回。
  没有前端连着时只做静态检查，并明说「没有试跑」。
- 入口：`/ascii-theme <描述>`；设置 → 外观 → 主题末尾「＋ 描述一个新主题」开新对话；自定义主题卡片右键「改一改」。

## 6. 沙箱与兜底

- Worker 启动先删掉 `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `importScripts` / `indexedDB` / `caches`，再执行主题代码。
- theme.css 去掉远程 `@import` 和远程 `url(...)`。
- 看门狗：backdrop 抛错，或连续 2 秒平均每帧 > 50 ms → terminate Worker，换默认主题的 backdrop，toast「这个主题的背景出了问题，已暂时换回默认」+「让 Claude 修」（带报错开对话）。
- 救命开关：`Ctrl+Shift+0` 本次启动临时回到默认主题（不写设置）。

## 7. 挑主题的界面

- 设置 → 外观 → 主题：「字符画」组（10 套内置 + 自定义 + 「＋ 描述一个新主题」）、「经典」组（原 6 个）。
- 卡片平时是 preview.png；悬停 / 选中时卡片里实跑背景，下方滚动 4 个招牌过程动画。同时只有一张在跑。
- 头像弹出菜单保留浅色 / 深色 / 系统三个，加「字符画主题…」跳到设置该节。

## 8. 交付顺序

1. 骨架：加载器、背景宿主（Worker、看门狗、救命开关）、`ProcessGlyph` + 过程判定、帧表校验、默认主题帧表、字流 / 字场迁移、
   `ui.backdropInChat`；磷光（暗）、纸刊（亮）两套。
2. 其余 8 套。
3. skill + MCP 工具 + 试跑预览卡 + 设置页入口。
4. 收尾：README 截图（中 / 英）、`docs/notes/ascii-themes.md` + CLAUDE.md 索引、英文翻译。

## 9. 测试

- 单元：`processOf` 判定；帧表校验；每套内置主题覆盖 16 个过程且尺寸合规；对比度测试纳入 10 套；主题包解析。
- 沙箱：Worker 里 `fetch` 等为 undefined；卡死的 backdrop 2 秒内被换下；抛错的 backdrop 不影响界面。
- ui-smoke：10 套挨个切，控制台零报错，每套截欢迎页和对话页。
- 流式卡顿测量：每套主题下对话页帧耗时不比现在的「字流」差。
- skill 端到端（临时 HOME）：坏 json 返回错误清单；好的能存、能换上、能热更新。
- 文案：`tr()`、`node scripts/i18n/extract.mjs --check`、wording 测试。

## 不做

主题导出 / 导入 / 分享；每套主题的亮暗两版；对话正文改等宽字体。
