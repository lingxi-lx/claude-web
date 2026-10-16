# 环境与对话：跨对话工具 / 任务 chip / 选机器 / worktree 设置 / 文件右键 / 本机环境变量 / 深链接（2026-10-16）

五期「赶上官方桌面版」路线的第 4 期。spec：`docs/superpowers/specs/2026-10-16-sessions-env-design.md`。依据：官方
`desktop.md`、`worktrees.md`、`cross-session-messaging.md`（code.claude.com/docs，`.md` 才抓得到正文）。

## 跨对话工具（`server/src/sessions-mcp/`）

- **进程内 MCP**：SDK 的 `createSdkMcpServer` + `tool`（zod v4），工具在本进程里跑，挨着 pool 和 library——不用起子进程、
  不用发 token。runner 建 query 时 `mcpServers.sessions`（开关 `sessions.mcp`，默认开；`setSessionsDeps` 在 index.ts
  接 library / pool）。
- 工具：`list_sessions`（不含自己、不含联邦对话，最近的 20 个）、`read_session`（最近 N 轮的用户消息和最后的回答，不含工具）、
  `send_to_session`、`rename_session`、`archive_session`、`suggest_task`。除 archive 外都进 `allowedTools`
  （`SESSIONS_ALLOWED`）；archive 走这个对话自己的权限模式（官方也是归档前才问）。
- 投递：消息包成 `<cw-from session="…" title="…">…</cw-from>`；接收方在跑就等这一轮结束再发（`deliver.ts` 的
  `sendWhenIdle`，30 分钟放弃）；没开着的对话 `pool.open` 重新拉起（供应商 / 权限模式按 meta 恢复）。归档的、别的机器上的不投。
- 前端：`decodeAttachments` 认出整条消息是 `<cw-from>` → `UserItem.from`，气泡顶上「来自『标题』」，点了跳过去。
  只认**整条**都是标记的消息，别人正文里引用的不算。
- 真引擎实测（haiku，2026-10-16）：官方二进制 list → read → send 一次通过；**ccb 把 MCP 工具包在 `ExecuteExtraTool
  { tool_name, params }` 里**，`allowedTools` 认的是里面的名字，于是每次都问——runner 的 `onCanUseTool` 对
  `ExecuteExtraTool` 看 `tool_name` 是否在本 query 的 `allowedTools`（`preAllowed`）里，在就放行（web 搜索在 ccb 上也因此不再每次问）。

## 任务 chip

- `suggest_task { title, prompt, worktree? }` 立刻返回；卡片 `features/chat/tools/TaskChip.tsx`（注册表 standalone）。
  「在新对话里做」：旁边分屏、同一目录、是仓库且 worktree 不为 false 时开 worktree（名字 `task-chip-model.ts`：标题的
  ASCII slug，中文标题用 `task-MMDD-HHMM`），发 prompt。会话 meta `taskStarted`（工具 id → 新对话）/ `taskDismissed`。

## 新对话选机器

- 欢迎页项目 chip 左边的机器 chip（`MachineChip.tsx`，只在有 peer 时出现，`peers.list`）。选了 peer：目录只从那台机器的对话
  用过的里选（本机的对话框看不到那边的盘）、不显示分支 chip、@ 补全关、本机文件附件不让发（图片可以）。
- `session.open` 的 `params.peer` → `federation/rewrite.ts` 的 `planRoute` 直接转发给那台、`outbound` 去掉 `peer`，回来的
  id 照常加 `peer_<id>~`。带 sessionId 又带别的 peer → 拒绝。发过去的只有 cwd / 权限模式 / worktree：本机的供应商、模型、能力开关
  在那边没有意义，用那台机器自己的默认。没在两台真机上跑过。

## worktree 位置与分支前缀

- 设置（新对话 → 更多选项）`worktree.dir` / `worktree.prefix`，都空 = 照旧交给 CLI 的 `--worktree`（`.claude/worktrees/<名>`，
  分支 `worktree-<名>`，CLI 自己处理 `.worktreeinclude`）。任一有值：hub 的 `session.open` 自己 `git worktree add`（位置
  `<dir>/<仓库名>-<名>`，分支 `<前缀><名>`），拷 `.worktreeinclude`，以 worktree 为 cwd 开对话，会话 meta `groupCwd` = 仓库根。
- `.worktreeinclude`（`git/worktree-include.ts`）：让 git 做匹配——`ls-files --others --ignored --exclude-standard` 和
  `--exclude-from=.worktreeinclude` 两次的交集，所以只拷「列出了且被忽略」的文件，被跟踪的永远不拷。
- wording 闸：「worktree」只能以 `TERMS.worktree` 出现；占位文字和文件名进了 `WORKTREE_CODE` 例外表。

## 文件右键菜单

- `features/files/FileMenu.tsx`：`fileMenuProps(path, sessionId)` 撒到元素上，`<FileMenu/>` 在 App 挂一次。加到下一条消息
  （`MENTION_EVENT` → 输入框加 `@相对路径`）、用 VS Code / Cursor / Zed 打开（`shell.editors` 只列装了的：`where`/`which`，
  mac 再看 /Applications）、在资源管理器 / 访达中显示（`shell.open` 的 `reveal`：Windows `explorer /select,"…"` 要
  `windowsVerbatimArguments`）、复制路径。远端对话只有复制。接在 FileLink、改动卡、审阅文件头；文件树有自己的右键菜单，没动。

## 本机环境变量

- 设置 → 环境变量 第一块。存 `<dataDir>/local-env.json`（名字 → `enc:…`，SecretService），**不进 meta.json 的 settings**：
  settings 会发给所有客户端（含配对的手机），Linux 上 `enc:plain:` 只是 base64。列表只给名字，值要 `env.reveal`。
- 作用：runner 的 `featureEnv` 最底层（供应商的变量和对话自己的 `features.env` 都盖过它）、终端 pty。选模型 / 账号 / 引擎的
  名字（`ANTHROPIC_*`、`CLAUDE_CODE_*`、`CLAUDE_WEB_*`、`OPENAI_*`、`CW_*` 等）存的时候就拒。新开的对话 / 终端生效。

## 深链接

- `desktop/src/deep-link.ts`：`claude-web://new?folder=&q=&peer=`（folder 必须是存在的目录、q 截 1 万字、peer 名字白名单字符）、
  `claude-web://session/<id>`。主进程存 `pendingLink`，页面 ready 时 `desktop:deepLink:take` 取一次，之后的链接发 nudge 再取。
  `electron-builder.yml` 的 `protocols` 让安装包注册；**只有打包版 `setAsDefaultProtocolClient`**（开发运行会把系统的链接抢过来）。
  `new` 只预填新对话页，从不自动发送。**桌面版里没真点过链接**（只有解析的单测）；设置里的示例行没做。

## 分屏快捷

`Ctrl+\` 关聚焦的分屏（只剩一个时不动）；侧栏 Ctrl/Cmd+点击在旁边分屏打开（以前是开新标签）。

## 坑

- bash 里 `node -e "…"` 写带反引号的注释 / 模板串会被 shell 执行掉（这期两次）：改用 Write / Edit 或脚本文件。
- 测试里 mock 了 SDK 的地方（`session-runner.test.ts`）要补 `createSdkMcpServer` / `tool`，否则开了 sessions 工具就崩。
