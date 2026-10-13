# 对话渲染与 composer（阶段 9，2026-09-04）

- **一轮 = 一条竖向时间线**（`ChatView` 的 `Steps`）。三态必须互不相同：完成 = 空心勾、进行中 = 呼吸方块 + 计时、待执行 = 灰色空心圆（`stepState()`）。（界面改版阶段 5：完成的回合把它折成一行摘要、点开才是这条线；多了第四态「等你确认」= 黄色盾牌，见「界面改版 阶段 5」。）折叠态就是这条线，点节点展开该步的卡片（`ToolCard` 的 `bare` 模式只渲染 body，头和导轨由时间线画）。
- 工具折叠态是**单行**：图标 + 动词 + 目标（路径取 basename，全路径在 title 里）+ 右侧耗时。运行中的秒数：agent 持续发 `tool_progress` 就用它（Claude），不发就用 `startedAt` 的墙上时间自己数（ACP / Codex），否则会一直停在 `0s`。
- **composer 上方钉一行** `RunCard`（正在做什么 · 已跑多久 · 第几步 · 停止），像标签一样贴在输入框上沿（阶段 3）。原来的 `ContextRow`（工作目录 · 分支 · worktree · agent 名）并进了会话头的灰字（`workbench/repo-context.ts` 的 `useRepoContext`）。`StatusStrip` 只留 RunCard 说不出来的东西：卡住、失败、限流、排队 —— 别把「运行中」重复两遍。输入框下面原来的统计栏（轮数 / token / 缓存 / 费用…）收进了输入框右下角的上下文小环（见「界面改版 阶段 3」）。
- `conv.turnStartedAt` 在用户消息落地时打点、`result` 时清空，RunCard 从它开始计时。
- **`applyTranscript(c, msgs, {live})`**：点开一个**正在跑**的会话时不能把最后那个工具扫成 `done`，否则一条还在执行的命令会顶着绿勾，`runningTool` 也被清掉（表现为「思考中」但其实在编译）。`live` 由 `SessionSummary.live` 判断，同时用 transcript 里用户消息的时间戳回填 `turnStartedAt`。
- **模型 / effort 的唯一真相是 `server/src/models/catalog.ts`**：版本化显示名（`Fable 5.1` 不是 `Fable`）、每个模型自己的 effort 档位、别名、`supportsUltracode`、未核实的标 `unverified`。运行时优先用 agent 自报的列表（`info.models` / `model/list`），catalog 只补显示名和档位。`SessionInfoSnapshot.models[].supportsEffort / supportedEffortLevels` 现在真的被前端读了：Gemini 不出 effort chip。
- **ultracode 不是 effort 等级**：Claude 侧它是「xhigh + 动态工作流编排」的会话级布尔（`CLAUDE_CODE_EFFORT_LEVEL` 不接受这个值），做成模型菜单顶部独立的「深度编排」开关（`session.setUltracode`，只对 `supportsUltracode` 的模型出现），不是「智能程度」分段控件里的一档；Codex 侧的 `ultra` 才是 effort 枚举里真实存在的一档（分段里的「超限」），effort 传给 Claude 前要把 `ultra` 降成 `max`。
