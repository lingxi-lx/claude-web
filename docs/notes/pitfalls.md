# 已踩的坑

- **SDK 自带 spawn 在 Windows 上 ENOENT**：`@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` 直接 `child_process.spawn` 没问题，
  但 SDK 内部的 spawn 报 ENOENT。解决：`options.spawnClaudeCodeProcess` 自定义 spawn（见 `server/src/claude-exe.ts`）。
- **SDK 不回显用户消息**：前端发送时自己往对话里 push 一条 user item（id = 客户端铸的 uuid）。别的窗口（手机、另一个窗口）、IM、定时任务、目标的「继续」发的那条以前只在重开对话后才看得到（2026-10-08 用户报告：手机上问的，电脑上只显示回答）：现在每个驱动的 `send()` 发一个 `sent` 事件（SDK 形状的 user 消息，带 uuid），pool 转发、hub 作为 `session.event` 广播并加 `cw_echo: true`；reducer 的 `applyUser` 遇到 `cw_echo` 且已有同 uuid 的条目（发送的那个窗口）就跳过，插话（`priority:'now'`）不重置回合计时。`sent` 不走 `message` 流：canonical 在 hub 里自己记用户消息，账本 / IM / 目标只读 agent 的流。
- **一条 API 消息会拆成多条 `assistant` 事件**（同一个 `message.id`，每个 content block 一条），reducer 按 id 合并（`web/src/model/conversation.ts`）。
- **子代理对话不在主 jsonl 里**：`<session-id>/subagents/agent-<id>.jsonl`，用 SDK `getSubagentMessages` 按需加载；agentId 从 Agent 工具的 result 文本里正则取。
- **AskUserQuestion / ExitPlanMode 都走 `canUseTool`**：回答 = `{behavior:'allow', updatedInput:{...input, answers}}`。
- **effort 没有运行时控制接口**：改 effort 走 `/effort <level>` 命令发进对话。
- `web/tsconfig.json` 不能用 `baseUrl`（TS 5.9 移除），`paths` 必须是相对路径。

## 只发一张图片 → 之后每一轮都 400（2026-10-17 用户截图）

- `SessionRunner.send()` 以前总是在 content 末尾放 `{type:'text', text}`，只发图片时就是 `[image, {type:'text', text:''}]`。接口不收空文字块，
  引擎还会给最后一块加 `cache_control`：`messages.N.content.1.text: cache_control cannot be set for empty text blocks` /
  `text content blocks must be non-empty`。这条消息进了 transcript，**之后每一轮都带着它重发，对话就再也用不了**（截图里一连串 400）。
- 修法三处：`send()` 只有图片时不加文字块；`transcript-file.ts` 的 `dropEmptyText()` 在 resume 前（还没有进程拿着文件）把 user / assistant
  消息里的空文字块去掉（全空的消息换成 `…`），经临时文件 rename，没东西可修时不碰文件；进程还活着时它内存里有这段历史，
  所以结果是这两种 400 之一时 runner 标 `respawnPending`，这一轮结束后重开进程（resume 读修过的文件）。前端 `classifyError` 新增 `history`
  「对话记录有误」，提示点重试。
