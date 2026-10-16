# 环境与对话：跨对话工具 / 任务 chip / 选机器 / worktree 设置 / 文件右键 / 本机环境变量 / 深链接（2026-10-16，第 4 期）

## 背景

五期路线第 4 期。依据：官方 `desktop.md`（Start a session、Work in parallel with sessions、Work across sessions、Open
files in other apps、Local sessions、Open an SSH session from a link）、`worktrees.md`、`cross-session-messaging.md`。
盘点（Explore，2026-10-16）：

- 已有：worktree 对话（CLI 的 `--worktree <名字>`，Claude Code 自己建在 `<仓库>/.claude/worktrees/<名字>`、分支
  `worktree-<名字>`，`.worktreeinclude` 也是它自己处理）、完成时的桌面通知、分组拖到新窗口（`windows.ts`）、联邦
  peer（`peer_<id>~<远端 id>`，`rewrite.ts` 按 id 转发）、三个注入的 MCP（memory / web / computer，各自一个
  launcher）、`GoalService.sendWhenReady`（等对话空闲再发）。
- 缺：跨对话工具、任务 chip、新对话选机器、worktree 位置 / 分支前缀、文件路径右键菜单、本机环境变量编辑器、深链接、
  Ctrl+\ 关分屏、Ctrl+点侧栏开在旁边。
- 不做：云端对话、SSH 环境（我们用联邦 peer 代替，SSH 隧道接入 peer 已有）、WSL 环境（Windows 上 WSL 里的
  claude-web 当 peer 加入即可，写进笔记）、单个面板（终端 / diff）弹到新窗口（pty 和面板状态在主窗口，跨窗口搬要
  重做；整个分组拖到新窗口已有）。

## 1. 跨对话工具（sessions MCP）

官方：Claude 能列出最近 20 个对话、读其中一个在做什么、给它发消息、改名、归档（归档前要审批，Auto / Bypass 模式除外）；
发来的消息在接收方显示成一张卡片，标着发送方标题和回链；接收方在跑就等它这轮做完再读；不能投递给归档的对话、没人看的
对话（定时任务的运行）。

- **服务端** `server/src/sessions-mcp/`：和 `web/` 一样的 launcher（SDK 走 `mcpServers`，stdio 子进程，token 文件
  在 `<dataDir>/runtime/sessions-mcp/<pid>.token`，回连本机 `/ws`），开关 `sessions.mcp`（默认开）。工具：
  - `list_sessions { includeArchived?, limit? }` → 最近活动的 20 个（不含自己）：id、标题、目录、分支、状态（在跑 /
    等你 / 空闲）、最后活动时间、最后一条回答的前 200 字。
  - `read_session { id, turns? }` → 最近 N 轮（默认 3）的用户消息和最终回答（不含工具细节），每段截 4000 字。
  - `send_to_session { id, message, summary? }` → 投递。接收方在跑：排队，空闲后作为新一轮发出（复用
    `sendWhenReady` 的机制，抽成 `pool.deliverWhenIdle`）；归档的、定时任务的、不存在的：返回错误原文给 Claude。
  - `rename_session { id, title }`、`archive_session { id }`：归档走权限闸（发送方对话的权限模式是 auto /
    bypassPermissions 时直接做，否则弹普通的权限卡）。
- **投递的格式**：接收方收到的用户消息带前缀标记 `<cw-from session="<id>" title="<标题>">…</cw-from>`；reducer 认出
  它，渲染成「来自『标题』的消息」卡片（`features/chat/FromSessionCard.tsx`），标题可点、跳回发送方对话。导出 / 手机照常
  显示成卡片。
- 只看本机对话（联邦对话不列，官方也只看桌面自己跑的）。

## 2. 任务 chip

官方：Claude 发现超出当前任务范围、值得做的事时，在对话里给一个任务 chip，点了就在新对话（自带 worktree）里开做，当前
对话不受影响。

- sessions MCP 加工具 `suggest_task { title, prompt, worktree? }`（默认 worktree = true）→ 立即返回「已提示用户」，不
  阻塞。前端：工具卡注册 `mcp__sessions__suggest_task` 为独立卡片（`TaskChip`）：标题 + 一行 prompt 预览 +「在新对话里
  做」按钮 + ×（忽略，记在会话 meta `taskDismissed`）。点按钮：用同一项目目录开新对话（git 仓库且 worktree 为真时开
  worktree，名字由标题 slug），发 prompt，新对话开在旁边分屏；卡片变成「已开始 → 跳到那个对话」。

## 3. 新对话选机器

- 欢迎页输入框的项目 chip 左边加一个机器 chip：「本机」+ 已连上的 peer（名字、在线点）。选了 peer：项目目录菜单列那台
  机器的最近目录（`sessions.projects` 走 peer）；模型 / 权限 chip 照旧（参数原样带过去）。
- 服务端：`session.open` 的 `params.peer?: string` → `rewrite.ts` 在有 `peer` 时 FORWARD 到那台，去掉 `peer` 字段，回来
  的 sessionId 加 `peer_<id>~` 前缀。附件、@ 文件在远端对话本就被拦，不变。
- peer 离线：chip 灰掉，发送时报「这台机器现在连不上」。

## 4. worktree 位置与分支前缀

- 设置 → 对话 加两项：「worktree 放在哪」（空 = 交给 Claude Code，放在仓库的 `.claude/worktrees/`）、「worktree 分支
  前缀」（空 = Claude Code 的 `worktree-`）。
- 两项都空：照旧传 `--worktree <名字>`。任一项有值：服务端自己建——`git worktree add -b <前缀><名字> <位置>/<仓库名>-
  <名字>`（基于默认分支，`worktree.baseRef: "head"` 时基于 HEAD），再按 `.worktreeinclude`（gitignore 语法，只拷被
  忽略的文件）把文件拷进去，然后以 worktree 为 cwd 开对话，会话 meta `groupCwd` = 仓库根（侧栏照旧归在原项目下）。
  `.worktreeinclude` 的匹配用 `git ls-files --others --ignored --exclude-standard` 列出被忽略文件，再用 `ignore` 包
  （已在依赖里就用，否则自己写一个够用的 gitignore 匹配）筛。
- 归档对话时不删 worktree（官方归档会删；我们的 worktree 可能有用户没提交的东西，删除要明确操作——对话 ··· 里已有的
  「删除 worktree」）。

## 5. 文件路径右键菜单

对话里的文件路径（`FileLink`、附件芯片、改动卡的文件行）、审阅面板的文件头、文件树：右键出一个菜单（`useAnchoredMenu`
的右键版本，规则照 CLAUDE.md：菜单用现成的）：

- 「作为附件加到下一条消息」：塞进当前对话输入框的引用（已有的 `REFERENCE_EVENT`）。
- 「用 VS Code / Cursor / Zed 打开」：服务端 `shell.open { path, app }` 已支持 `code`，加 `cursor` / `zed`；只列装了的
  （新请求 `shell.editors` → 在 PATH 里找 `code` / `cursor` / `zed`，结果缓存）。
- 「在资源管理器中显示」（mac 叫访达）：`shell.open { path, reveal: true }`（Windows `explorer /select,`，mac `open -R`，
  Linux 打开所在目录）。
- 「复制路径」：绝对路径进剪贴板。
- 远端对话的路径：只有「复制路径」。

## 6. 本机环境变量

官方：环境下拉里本机的齿轮 → 编辑环境变量，加密存本机，作用于每个本机对话和预览服务器。

- 设置 → 对话 加「环境变量」一节：键值表（值默认遮住，眼睛按钮看），增删改。存 `secrets` 服务（Windows DPAPI /
  mac 钥匙串，已有），meta.json 只存键名列表。
- 作用：runner 起 query 时并进 env（在用户的 settings.json env 之后、供应商路由键之前——供应商的 `ANTHROPIC_*` 等不能被
  这里覆盖，覆盖了就忽略并在设置页标黄提示）；终端 pty 也带上。改了对新开的对话 / 终端生效（hint 写明）。

## 7. 深链接

- 桌面版注册 `claude-web://` 协议（`app.setAsDefaultProtocolClient('claude-web')`；Windows 走 `second-instance` 的
  argv，mac 走 `open-url`）。
- `claude-web://new?folder=<路径>&q=<文字>&peer=<机器>` → 主窗口到前台，新对话页预填目录和输入框文字（不自动发送）。
  `claude-web://session/<id>` → 打开那个对话。参数逐个校验：folder 必须是存在的目录，q 截 10 000 字，未知参数忽略。
- 设置 → 关于 里一行「从链接打开：claude-web://new?folder=…&q=…」并带「复制示例」。

## 8. 分屏快捷

- `Ctrl+\`：关掉聚焦的分屏（只剩一个时什么都不做）——和官方同键。
- 侧栏对话行 `Ctrl+点击`（mac `Cmd`）：在旁边分屏打开（复用已有的 `open-split` 动作）。

## 测试

- sessions MCP：工具的输入输出（server 单测，用假的 pool / sessions 服务）；投递排队（在跑时不发、空闲后发一次）；归档
  的权限闸（auto 直接、default 走权限请求）；`<cw-from>` 在 reducer 里变成卡片。
- 任务 chip：卡片按钮开新对话的参数（worktree、cwd、prompt）。
- `session.open` 带 peer 的转发与 id 前缀（`rewrite.test.ts`）。
- worktree 自建：临时仓库里建、分支名带前缀、`.worktreeinclude` 只拷被忽略的匹配文件。
- 右键菜单：`shell.editors`、`reveal` 的参数（不真的开程序）；ui-smoke 里右键一个路径看到菜单项。
- 环境变量：并进 env 的顺序与不能覆盖路由键；存取走 secrets。
- 深链接：解析与校验的纯函数；桌面版 argv 解析单测。
- 快捷键：`matchBrowserKey` 新键；cover-commands 决定。
- 真机：真引擎两个对话，一个让 Claude「告诉另一个对话 X」，看另一个收到卡片并回复。

## 不做

云端 / SSH / WSL 环境、单面板弹窗、归档时删 worktree、自动从远端拉附件。
