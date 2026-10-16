# 页面与入口：总览 / 定时任务补跑 / 预览服务器 / 更新内容 / 只聊天 / 生成的文件 / 快捷键（2026-10-16，第 5 期）

## 背景

五期路线最后一期。依据：官方 `desktop.md`（Preview your app、Configure preview servers、Keyboard shortcuts、Accept a
suggested prompt）、`desktop-scheduled-tasks.md`、`claude-projects.md`（Overview）。盘点（Explore，2026-10-16）：

- 已有：定时任务（`server/src/schedules/`：cron / 每 N 分钟、模板、立即运行、复用对话或每次新对话、权限模式、模型）、自动化页、
  扩展页（连接器 / Skills / 插件——就是官方的 Customize，不再改）、右侧「生成的文件」（Write / Artifact 的输出）、内置浏览器 +
  `web` MCP（打开 / 读 / 点 / 输入 / 截图）、快捷键速查（F1 / ?）、侧栏行状态（`sidebar/status.ts`）、CHANGELOG(.zh-CN).md。
- 官方 Projects 是**云端**的（云线程、各开 PR），我们不做云；做它的 **Overview**：本机所有对话按状态分栏。协调对话不另做——
  第 4 期的跨对话工具已经让任何对话能派活、看别的对话。
- 不做：Artifacts 模板 / 发布到 claude.ai、Customize 改名（扩展页已等价）、云端 Routines（API / GitHub 事件触发）。

## 1. 总览（Overview）

- 新分区页「总览」（图标栏 + 命令面板 + 侧栏顶部入口，和自动化页同样的全窗页规则：不卸载、只 `hidden`）。
- 六栏，按官方：
  | 栏 | 放什么（本机能知道的） |
  | --- | --- |
  | 待审 | 分支有开着的 PR、PR 还没批准（PR 条已拉到的数据） |
  | 等你 | 有待确认的权限 / 提问，或出错停下的 |
  | 在做 | 在跑的 |
  | 落地中 | PR 已批准或开了自动合并 |
  | 空闲 | 其余没归档的（最近 30 天有动静的） |
  | 已解决 | 7 天内归档的（官方：手动标记 / 合并后 / 一周没动静；我们用归档表达「做完了」） |
- 每张卡：标题、项目名、分支、状态字（复用 `rowStatus`）、最后活动时间；点开对话；卡片 ··· 里「归档 / 取消归档」。
- 顶部筛选：项目（下拉）、只看有 worktree 的。数据全在前端已有的 store（`sessions`、`open`、`pending`、`sessionMeta`）+ PR 条的
  共享缓存（`usePrs`，从 `PrBar.tsx` 挪到 `features/vcs/pr-cache.ts`）；**不为总览新开轮询**——没被 PR 条拉过的对话不进待审 / 落地中。
  需要 PR 的 `reviewDecision`：`prForBranch` 加取 `reviewDecision`，`BranchPr.review?: 'approved' | 'changes' | 'required'`。
- 分栏函数 `overviewLanes(...)` 纯函数、有测试。

## 2. 定时任务：补跑、手动档、预设、worktree

- **补跑**（官方：开机 / 唤醒后，7 天内漏掉的只补最近一次，更早的丢掉，并发通知）：启动时（和电脑唤醒——`powerMonitor` 在桌面版
  里转发一个 `resume` 事件给服务端，浏览器版没有就只在启动时）对每个启用的 cron 任务：`nextRunAt` 在过去且距今 ≤ 7 天 → 保留让下一个
  tick 补跑一次，并标 `catchUp: true`（运行时 toast / 桌面通知「补跑：<名字>」）；> 7 天 → 重算下一次（现在是 12 小时）。
- **手动档**：`cron` 和 `everyMinutes` 都空 = 只在「立即运行」时跑（`tick` 跳过）。
- **预设**：新建 / 编辑表单的「频率」先给 手动 / 每小时 / 每天 / 工作日 / 每周 + 时间，选了就生成 cron（`0 * * * *`、`M H * * *`、
  `M H * * 1-5`、`M H * * D`）；「自定义」才露出 cron 输入框。纯函数 `presetCron` / `cronPreset`（反解已有任务的显示）有测试。
- **每次跑在独立 worktree**：任务字段 `worktree?: boolean`；每次运行以 `--worktree sched-<任务id前6>-<MMDDHHmm>` 开新对话（只在
  `freshSession` 时可选；复用对话的任务没有意义）。

## 3. 预览服务器（`.claude/launch.json`）与自动验证

- 格式照官方：`{ version, autoVerify?, configurations: [{ name, runtimeExecutable?, runtimeArgs?, program?, args?, port?, cwd?,
  env?, autoPort?, url? }] }`，JSON 允许注释。解析 `server/src/preview/launch.ts`（纯函数，有测试；`url` 规则：localhost 只能是
  origin 且端口一致，否则报配置错误）。
- `web` MCP 加三个工具（`server/src/web/`）：
  - `preview_start { name? }`：按配置起进程（`spawn`，`windowsHide: true`，`shell: false`；`runtimeExecutable` 在 Windows 上走
    `.cmd` 解析——复用已有的 spawn guard / 垫片办法），cwd 默认项目根，env = 本机环境变量 + 配置 env；等端口通了（最多 60 秒）
    在内置浏览器打开 url。端口被占：`autoPort: true` 换一个空端口（通过 `PORT` 环境变量告诉它），false 报错，未设置报错并说明。
  - `preview_stop { name? }`、`preview_logs { name?, lines? }`（最近的输出，环形缓冲 2000 行）。
  - 进程表在服务端（`server/src/preview/service.ts`），对话关掉不停，应用退出时全停；同一项目同一配置只起一个。
- **自动验证**：项目有 launch.json 且 `autoVerify !== false` 时，runner 往 system prompt 追加一段：「改完前端 / 服务端代码后，用
  preview_start 打开预览、browser_screenshot 截图、看控制台和日志确认没坏，再结束这一轮」。没有 launch.json 不加（官方会让 Claude
  先生成配置；我们在这段提示里写：需要预览但没有配置时，先按项目写一份 `.claude/launch.json`）。
- 权限：`preview_start` **不进** allowedTools——起进程等于跑命令，第一次要用户批准（批准时选「总是允许」后就不再问，CLI 自己记）。
- 浏览器标签显示这个预览的名字和「停止」按钮（`browser` 标签带 `previewOf?: { cwd, name }`）。

## 4. 更新内容（What's new）

- 标题栏右上角「更新内容」按钮：版本变了（`ui.lastSeenVersion` ≠ 当前版本）时带一个点。点开一个对话框，渲染当前界面语言的
  CHANGELOG（`CHANGELOG.md` / `CHANGELOG.zh-CN.md`）最近 5 个版本；打开即记下已看过。服务端 `app.changelog { lang }` 读文件
  （打包时 `electron-builder.yml` 的 files / extraResources 带上两份 CHANGELOG，开发时读仓库根）。

## 5. 只聊天

- 新对话页 + 菜单里加「只聊天（不碰文件、不跑命令）」开关（`features.chatOnly`）。runner：`tools: []`、不注入 MCP（web / sessions /
  computer / memory 都不给）、权限模式无所谓。对话头和侧栏行上一个小标记「只聊天」。开了以后中途不能切（要切就新开）。

## 6. 生成的文件（跨对话）

- 右侧面板「生成的文件」现在只看当前对话。加一个「所有对话」切换：服务端 `artifacts.list { limit }` 扫最近 50 个对话的 jsonl，收集
  Write / Artifact 工具写的 `.html .htm .md .svg .png .jpg .jpeg .gif .webp .pdf .csv` 路径（文件还在的），按时间倒序，带来源对话。
  卡片：文件名、来源对话（点了跳过去）、类型图标；点文件按现有规则打开（文档标签 / 浏览器标签）。

## 7. 快捷键与小交互

- `Ctrl+/`（mac `Cmd+/`）打开快捷键速查（F1 / ? 照旧）。
- 下一句提示：输入框为空时 `→` 也能采用（和 Tab 一样）。
- 打开的菜单里按 `1`–`9` 选第 N 项（`useAnchoredMenu` / `Popover` 的菜单项，焦点在菜单里时；输入框里不拦）。

## 测试

- `overviewLanes`、`presetCron` / `cronPreset`、补跑判定（`catchUpPlan(schedules, now)`）、launch.json 解析与 url 校验、changelog 截取
  最近 N 版：纯函数单测。
- 定时任务：手动档不被 tick 跑；7 天内补跑一次、超过 7 天不补（假时间）。
- 预览：起一个临时的 `node -e "require('http').createServer(...).listen(port)"` 配置，`preview_start` 等到端口、`preview_logs` 有输出、
  `preview_stop` 结束进程；端口占用三种 `autoPort`。
- 只聊天：runner 给 SDK 的 `tools` 是 `[]`、`mcpServers` 为空。
- ui-smoke：总览页打开、六栏标题在、种子对话出现在某一栏；更新内容对话框打开有内容；Ctrl+/ 打开速查；菜单里按 2 选第二项。
- 真机：真引擎在一个带 launch.json 的临时项目里改一个文件，看它调用 preview_start + 截图（官方二进制，haiku）。

## 不做

云端 Projects / 线程、Artifacts 模板与发布、Routines 的 API / GitHub 触发、Customize 改名、Chrome 扩展、选中浏览器元素（Cmd+Shift+S）。
