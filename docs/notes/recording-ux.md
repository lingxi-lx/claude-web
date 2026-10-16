# 照官方桌面版录屏改的界面：信息栏 / 标题栏工具 / 一行输入框 / statusLine / 菜单 / 运行行（2026-10-16，用户要求）

用户发了一段官方 Claude Code 桌面版的录屏，要「直接借鉴 ui 和 ux」。spec：`docs/superpowers/specs/2026-10-16-recording-ux-design.md`。
只照录屏里看得见的样子和官方公开文档做，不反编译、不拷官方代码（用户要过用逆向工具，拒绝了：官方条款禁止，而且 claude-web 是公开发布的）。

## 信息栏（`web/src/features/info/`）

- 对话右边一列 288px 的卡片：环境 / 上下文 / 连接器 / 改动 / 后台任务。放在 `ChatTile` 里（每个对话自己一列），不是右侧面板的一个标签。
  结构：`.chat-split > .chat-main + aside.info-col > section.info-card[data-card]`。
- 手机不进这层：`phone.css` 依赖 `.chat-tile > .sess-head + .chat` 的平铺结构，`mobile` 时直接渲染原来那几块。
- 窄了自己让开：`ResizeObserver` 看 `.chat-split`，宽度 < 560 + 288 就不画（右侧面板开着时常见）。开关是设置 `ui.infoPanel`
  （默认开，标题栏 ⓘ 和 设置 → 外观 都能关）；关掉后标题栏的「+N −M」回来（信息栏开着时它在「改动」卡里）。
- 卡片顺序 / 折叠存 `ui.infoCards`（`info-model.ts` 的 `normInfoLayout`：未知的丢掉、新卡补在后面，上下文默认折叠）。拖抓手换位置，
  标题上 Alt+↑↓ 也能挪。
- 上下文卡：`session.contextUsage` 的 `full`（SDK `getContextUsage`），这一轮结束时刷新；分类条颜色是 `.sw-0…7`，不用 SDK 给的颜色名。
- 改动卡的「建 PR」是给 Claude 发一句话（提交、推送、`gh pr create`），只在空闲时能点；已有 PR 就是链接（`usePrs`）。
- 后台任务卡：`useBackground` 里在跑的，秒数每秒走，停止走 `session.stopTask`。

## 标题栏工具和 ⋮

- ⓘ 之后是 终端、审阅（`files` 面板）、浏览器、文件（`explorer`）——各自打开右侧面板对应标签，再点一次关面板。`data-tool` 是面板 id。
  别的机器上的对话没有审阅 / 文件（文件在那台机器上）。
- ⋮ 顶上加了 旁聊（Ctrl+;）、后台任务（在跑的数量）、保持电脑唤醒（只有桌面版；`SessionMeta.keepAwake`，这个对话在跑时
  `reportKeepAwake` 的第三个参数让它保持唤醒；`pool` 的 state 事件调 `recheck()`）。

## 输入框

- 对话里（不是首页、不是手机）：框里一行 `+ · 文字 · 麦克风 · 插话 · 发送`，权限 / 模型 / 子代理 / 强度 / 上下文小环在框下面一行
  （`ComposerUnder`，`.composer-under.cb`——带 `.cb` 是为了沿用那些 chip 的样式和容器查询）。
- 框里一行是 CSS 做的：`.composer-box.one-line` 是 flex，`.composer-bar` `display: contents`，按 `order` 排 `+`、textarea、右边按钮。
  `display: contents` 的元素量不出尺寸，ui-smoke 量 `.composer-box` 和 `.composer-under`。
- 首页的输入框没动（项目 / 分支 chip 在框里，ui-smoke 一大段测它）。
- **和官方不一样的地方**：官方是 Enter 发送、Ctrl+Enter 排到后面。我们一直是「在跑时 Enter 排队、插话按钮马上说」，很多测试和停靠的
  权限卡都靠它，所以没换：加了 **Ctrl+Enter = 插话**（纯文字时），占位字写明「Enter 排到这一轮之后，Ctrl+Enter 马上插话」。
- Ctrl+U = 添加文件或图片（只在输入框里，和 Shift+Tab 一样由输入框自己处理；`SHORTCUTS` 里有一行 `attach` 给速查表）。

## statusLine（`server/src/statusline/run.ts`、`web/src/features/composer/StatusLine.tsx`）

- 只读 **用户级** `~/.claude/settings.json` 的 `statusLine`（`type: 'command'`）。项目里的 `.claude/settings.json` 不读：别人仓库里的
  命令不能一打开对话就跑（CLI 要先信任工作区，我们没有这一步）。
- 输入是 CLI 那套 JSON（`session_id`、`transcript_path`、`cwd`、`model`、`workspace`、`version`、`cost`），从 stdin 给；Windows 上找
  Git Bash（`CLAUDE_CODE_GIT_BASH_PATH` 或常见路径），找不到才用 cmd。5 秒超时（`killTree`，不然脚本卡住每 10 秒漏一个进程），最多 20 行。
- 前端：打开对话时、一轮结束时、在跑时每 10 秒问一次 `session.statusLine`；ANSI 颜色 → span（`ansi.ts`，16 色是 `--ansi-N`，
  暗色 / 亮色两套在 `.cmp-statusline` 上），光标移动、OSC 链接这些转义丢掉。设置 `ui.statusLine` 关掉。
- bash heredoc 写测试会吃掉 `\\`：带反斜杠的文件用 Write 写。

## 模型菜单和 + 菜单

- 模型菜单的行有 1–9 的号，搜索框空着时按数字直接选（`flat` 的顺序，收藏 / 最近也算）。
- 「智能程度 ›」一行打开旁边强度 chip 的菜单（`EffortChip` 的 `openSignal`，和子代理那行一样的做法）。
- 快速模式：CLI 在 init / result 里报 `fast_mode_state`（和 `fast_mode_disabled_reason`）才有这一行；`not_first_party`（中转）和
  `disabled_by_env` 永远不画。开关走 `session.fastMode` → `applyFlagSettings({ fastMode })`。
- 官方的「更多模型 ›」没做：我们的列表本来就全列出来，还能搜。
- + 菜单：斜杠命令（往框里放一个 `/`，命令列表就出来）、连接器 ›（这个对话的 MCP 服务器逐个开关，`session.toggleMcp` →
  `toggleMcpServer`，然后重新拿 `mcpServerStatus`；对话没在跑时只能看）。新 id 在 `PLUS_ID` / `MODEL_MENU_ID`，reach 表的
  `when: 'live' | 'fast'`。

## 对话里

- 运行行（`RunCard`）：Claude 标记转着（`.pip.spark`，3 秒一圈，减少动效时不动），后面是模型名。
- 计划卡（`TodoBody`）：发丝边框、行间细线；进行中是转的弧、待办是虚线圈、完成是勾 + 删除线。右侧任务面板里的计划不加框。
- 回复下面的操作多了「分叉」（`forkAt(sessionId, it.uuid)`，从这条回复之后）和「2 分钟前」（7 天以上显示日期）。
- 浏览器的空白页列出对话目录 `.claude/launch.json` 里的开发服务器（`preview.list`，在跑的带地址），▶ 启动并打开（`preview.start`，
  第 5 期的 `PreviewService`）。别的机器上的对话不列。
- 官方「文件」面板的「打开的文件会显示在这里」没做：我们打开的文件是窗格里的标签，不在面板里。

## 测试

- 单元：`info-model.test.ts`、`ansi.test.ts`、`statusline/run.test.ts`、`keep-awake.test.ts`（`also` / `recheck`）、`preview/service.test.ts`（`list`）。
- ui-smoke 的 `recording-ux` 段：信息栏五张卡、上下文折叠存设置、ⓘ 开关、标题栏三个工具、⋮ 顶上两项、框下一行的位置、+ 菜单在对话里的
  reach、斜杠命令、模型菜单的号和强度 ›。截图脚本的做法：demo 数据 + 离屏 Electron（见 `scripts/readme-shots.cjs`）。
