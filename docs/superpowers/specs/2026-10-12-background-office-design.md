# 后台：看得见在跑的子代理和工作流（2026-10-12）

用户（截图 + 一段视频）：claude-web 里看不到后台在跑的子代理，要「和 Claude Code desktop 一样能看到」，样子参考一段「代理办公室」视频：每个代理是一个有颜色、有形象的小角色，有自己的卡片和工位，在干活的会亮、会动，连线表示谁在和谁说话，底下滚动一行一条事件。

brainstorm 里定下的（visual companion 的稿子在 `.superpowers/brainstorm/`，不入库）：

| 问题 | 决定 |
| --- | --- |
| 方向 | A + B：「代理办公室」（俯视的小办公室，角色坐工位、走动）+「指挥台」（卡片 + 关系图 + 事件流） |
| 放在哪 | 图标栏多一个「后台」分区，整页照视频排：上面一排代理卡片，左边办公室，右边关系图和事件流；右侧面板「任务」放缩小的指挥台；输入框上方一个「后台」胶囊；对话里的 Workflow 卡片实时显示子代理 +「打开」 |
| 样子 | 跟着主题：浅色是白天的办公室（暖纸色），深色是夜里的 |
| 停止 | 输入框的「停止」只停这一轮（`perTaskStopAffordance`），后台任务各有自己的停止 |
| 算哪些 | 所有子代理（工作流里的、Agent 工具开的，前台后台都算）是角色，后台命令是一台小机器；只管 Claude 对话（两个运行内核都算） |

## 1. 数据

- **官方二进制**已经在发：`task_started`（`task_type: 'local_workflow'`、`workflow_name`）→ `task_progress`（工作流的带 `workflow_progress`：完整的 `workflow_phase` / `workflow_agent` 列表，状态变化时立刻发，只有进度时节流）→ `task_notification`。`workflow_agent` 的字段（2026-10-12 读本机 60 个跑完的工作流核对）：`index, label, phaseIndex, phaseTitle, agentId?, model, state, queuedAt, startedAt?, attempt?, lastToolName?, lastToolSummary?, promptPreview, lastProgressAt, tokens?, toolCalls?, durationMs?, resultPreview?, cached?, error?`；`state` 是 `start`（排上了、还没拿到 agentId）/ `progress`（在跑）/ `done` / `error`。普通子代理是 `task_type: 'local_agent'`（`is_backgrounded` 分前台后台），后台命令 `local_bash`。
- **我们的引擎**（ccb fork）的工作流内部有 agent_started / agent_progress / agent_done，但没往外发。改引擎按官方同样的形状填 `workflow_progress`（fork 的 `CLAUDE-WEB.md` 记一条），发一个引擎版本。claude-web 只认一种格式。
- **磁盘**：跑完的工作流在 `<对话目录>/workflows/<runId>.json`（含 `workflowProgress`、`phases`、`workflowName`、`taskId`），每个子代理的 transcript 在 `<对话目录>/subagents/workflows/<runId>/agent-<agentId>.jsonl`。用来回看和点开角色。

## 2. 服务端：`server/src/background/`

- `BackgroundService`：订阅对话池的 `message` / `state`，按对话维护一张登记表（`BgSession`：任务列表、每个工作流的阶段和子代理、最近的事件）。纯的部分（一条 SDK 消息怎么改登记表、事件文字怎么生成）在 `registry.ts`，可以单测。
  - 事件：子代理开始 / 结束 / 失败、「最后一个工具」变了（`22:09 · reader-gates · 改了 readerGates.test.ts`，用 `lastToolSummary`，没有就用工具名）、任务停止。每个对话留最近 200 条，快照里只带 50 条。
  - 工位显示器的活动：每个子代理记最近 24 次「工具调用数变多」的时间。
  - 进程结束（runner `closed` / `error`、重开进程）：还在跑的任务标成「已停止 · 进程结束了」——CLI 进程没了，它的后台任务也没了。
  - 每个对话最多 1 秒推一次（`background.changed {sessionId, session}`，整份这个对话的快照，不带 `promptPreview`）；连接时 `background.list` 拿全部。结束的对话留 24 小时、最多 50 个。
- 请求：`background.list`、`background.history {sessionId}`（磁盘上这个对话跑过的工作流）、`background.run {sessionId, runId}`（一份跑完的工作流，形状和在跑的一样）、`background.transcript {sessionId, agentId}`（工作流子代理读 `subagents/workflows/*/agent-<id>.jsonl`，普通子代理沿用 `getSubagentMessages`）。停止沿用 `session.stopTask`。
- 联邦：`background.list` 只给本机；`history / run / transcript` 转发（带 peer 前缀）。远端对话的后台在 v1 不进「后台」页。
- runner：SDK 选项加 `perTaskStopAffordance: true`。引擎不认的话一起改。

## 3. 界面

- **图标栏「后台」**（`features/background/`，`sections/pages.ts` 登记的第三页，对话下面、自动化上面）。侧栏那一列是有后台活动的对话：「在跑」在上，「结束了」在下（行尾一个在跑的数量或「✓」），选中的对话下面列出它磁盘上跑过的工作流（点开回看）。
- **整页**：标题行（对话名 · 运行中 3:12 · N 个子代理 · token · 回到对话 · 停止全部）→ 一排代理卡片（名字、阶段、状态、进度条、最后一个工具；在跑的描边发光；多了折成两行 +「还有 N 个」）→ 左边办公室、右边关系图 + 事件流。手机上一列：卡片 → 办公室 → 关系图 → 事件流。
- **办公室**（SVG，纯函数排位 `office-layout.ts`）：后墙一块大屏是主对话（在答话时有走动的折线）；每个阶段一排工位，Agent 工具开的子代理一排「子代理」，后台命令是角落里的小机器；排队的站在门口，开始了走到自己的工位（transform 过渡），在跑的上下轻晃、显示器上是它最近的工具调用节奏、和大屏之间有流动的线，完成的靠在椅背上打勾（交回结果时线上闪一下），失败的红叉。工位按数量排成网格，一个阶段超过 24 个只画 24 个 + 一块「还有 N 个」的牌子。悬停看详情，点角色在页面右边拉出它的对话（复用子代理的渲染）。「减少动画」下不走、不晃、线不流。
- **角色**：颜色按出现顺序取（`--agent-1..10`，浅色 / 深色各一套，对底色 ≥ 3:1），配件按类型：工作流子代理不戴、Explore 戴眼镜、Plan 戴帽子、其它类型一个名字首字母的小牌子；后台命令是小机器。
- **指挥台**（关系图）：主对话在中间，子代理围一圈，在跑的边上有光点流，排队的暗着，完成的打勾。
- **输入框上方的胶囊**：这个对话有在跑的后台任务时出现（这一轮结束了也在）：「后台 · 1 个工作流 · 2 个在跑」，点它打开「后台」页并选中这个对话。按「停止」时还有后台任务在跑，toast 说一句「后台还有 N 个任务在跑，在「后台」里停」。
- **对话里的 Workflow 卡片**：一排小卡片（每个子代理一个色块 + 状态）+「打开」；脚本收进「脚本」折叠。
- **右侧面板「任务」**：缩小的关系图 + 按阶段分组的子代理列表（每个任务一个停止）+ 原来的计划；原来的「子代理 / 后台调用树」由它代替。
- 文案过 `wording.test.ts`（「对话」不说「会话」，不出现实现词）；「后台」进标题字的字表，重新裁字体。

## 4. 测试

- 单测：`background/registry.test.ts`（官方形状的消息序列 → 登记表 / 事件；进程结束；节流）、`history` 读本机形状的 JSON；web 的 `office-layout`、配色对比度、胶囊文字、事件文字。
- e2e `server/ws-phase25.mjs`：真引擎 + 假上游（主对话第一轮回一个 Workflow 工具调用，子代理的请求回固定文字），断言 `background.changed` 里有阶段和子代理、状态走完、`background.transcript` 读得到、`session.interrupt` 之后工作流还在跑、`session.stopTask` 停得掉。
- ui-smoke：用注入的快照打开「后台」页（卡片 / 办公室 / 关系图 / 事件流 / 点角色开对话）、胶囊、Workflow 卡片、右侧面板「任务」。
- 真机：官方二进制 + 一个能用的供应商跑一个两个 haiku 子代理的小工作流。

## 5. 不做

- 工作流里单个子代理的停止（SDK 只能按任务停，只能停整个工作流）。
- 其它 Agent（Codex 的子线程等）进办公室。
- 远端对话的后台（v1）。
- 终端里跑的 Claude Code 的工作流（它不经过我们，磁盘上跑的时候又没有阶段和名字）。
