# 审阅与 PR：diff 行评论 / 代码审查卡 / PR 监控条（2026-10-16，第 3 期）

## 背景

五期路线第 3 期。依据：官方文档 `code.claude.com/docs/en/desktop.md`（Review changes with diff view、Review your
code、Monitor pull request status）、`code-review-local.md`、`tools-reference.md`（`ReportFindings`）。我们已有：
审阅面板（`ReviewView` + 共用的 `DiffView`）、VCS 服务（`server/src/vcs/service.ts`：PR 列表 / 详情含 `checkRuns` /
合并 / 评论，走 gh 或 token）、对话归档（`sessionMeta.archived`、`library.archive`）。

## 1. diff 行评论

官方：在 diff 里点任意一行开评论框，Enter 加一条；加了几条后 Ctrl+Enter 一次交给 Claude，Claude 按评论改。

- `DiffView` 加可选 `comments` 属性 `{ path; list: LineComment[]; onAdd(c); onRemove(id) }`。只有审阅面板传；对话里的
  diff 不变。有它时：点行号或行（新增 / 上下文行取新行号，删除行取旧行号）在那行下面开一个单行输入框，Enter 加、
  Esc 关；已有的评论显示在对应行下面（一个小卡片，× 删）。分栏（split）和统一（unified）两种都支持。
- `LineComment = { id; path; line; side: 'new' | 'old'; code: string; text: string }`。
- 状态：`features/workbench/review-comments.ts`，独立小 zustand，按对话存（内存；切对话不丢，关应用就没——和官方
  一致，评论是交给 Claude 的，不是存档）。
- 审阅面板顶上有评论时出现一条：「N 条评论 · 交给 Claude（Ctrl+Enter）· 清空」。Ctrl+Enter（焦点在审阅面板里）
  或按钮：把评论整理成一条消息发进这个对话（`useStore.send`），清空评论。对话在跑时照常进队列。
- 消息格式（`formatComments`，纯函数，有测试）：

  ```
  请按下面这些代码审阅评论修改：

  1. src/a.ts:12
     > const x = foo();
     这里应该处理 foo 返回 null 的情况
  ```

  英文界面用英文的开头一句（走 `tr`）。

## 2. 代码审查卡（/code-review）

官方：`/code-review` 的发现在桌面版里是一张「Code review」卡，按文件分组；「在 diff 里逐条看」、「修这一条」、
「应用修复」（修还开着的）。

- **引擎**：宿主设 `CLAUDE_CODE_REPORT_FINDINGS=1`（且输出不是 text/json，SDK 的 stream-json 满足），审查结束时
  Claude 调 `ReportFindings` 工具，输入 `{ level?, findings: [{ file, line?, summary, short_summary?,
  failure_scenario, category?, verdict?, outcome? }] }`（最多 32 条，最严重的在前；修完重报时带 `outcome`:
  `fixed | skipped | no_change_needed`）。runner 对 Claude 引擎设这个变量（用户自己的 env 优先）。
- **工具卡**：注册 `ReportFindings` 的卡片（`features/chat/tools/` 的注册表）。按文件分组；每条：行号链接（点开
  文件到那行）、摘要、类别小标签、`verdict`、展开看「怎么出错」（failure_scenario）、`outcome` 徽章（已修 / 跳过 /
  不用改）。每条两个按钮：「修这一条」（往对话发一条「修复代码审查发现：file:line — summary」）、「忽略」（本地
  标记，卡片里变灰，存 meta.json 的会话 meta 里，`reviewDismissed: string[]`，键 `toolUseId#index`）。卡片底部
  「修复还开着的（N）」：把没忽略、没 outcome 的发成一条消息。没有发现时显示「没发现问题」。
- **在 diff 里看**：一条发现点「在审阅里看」→ 打开审阅面板并滚到那个文件（审阅面板已有按文件定位就用，没有就
  只打开文件到那一行）。不做 diff 里内嵌发现（官方有，我们这期不做）。
- 卡片是普通工具卡，手机、导出、历史都照常。

## 3. PR 监控条

官方：开了 PR 后，对话里出现 CI 状态条（gh 轮询）；点 CI 可开「自动修 CI 和评论」「就绪后自动合并（squash）」；
设置里「PR 合并或关闭后自动归档」。

- **发现 PR**：对话的 cwd 是 git 仓库、当前分支不是默认分支时，服务端用已有 VCS 服务按 head 分支找开着的 PR（新
  `vcs.prForBranch { cwd } → { pr?: { number, url, state, title, checks: { total, passed, failed, pending, failedNames }, mergeable, autoMerge } }`）。
  前端在对话打开、每轮结束、每 60 秒（只在窗口可见且这个对话在前面时）问一次。
- **条**：输入框上方（和目标细条同一行规则，`GoalBar` 旁边），只在有 PR 时出现：「PR #12 · ✓ 4 · ✗ 1 · ⏳ 2 ·
  已可合并」，点 PR 号开浏览器，点「CI」开一个小菜单：
  - 「自动修 CI 和评论」开关（会话 meta `prAutoFix`）。开着时，某个检查从非失败变成失败、且对话没在跑：发一条
    消息「PR #12 的 CI 检查 X 失败了。用 `gh run view <id> --log-failed` 看失败原因，修好后提交并推送。」同一个
    检查的同一次运行只发一次（记在会话 meta 的 `prFixed: string[]`）。新评论：这期只做 CI，评论不自动处理
    （官方还会按作者身份筛评论——需要可靠的作者权限判断，留到以后）。
  - 「就绪后自动合并」开关：开时调 `gh pr merge <n> --auto --squash`（新 `vcs.autoMerge { cwd, number, on }`；关时
    `--disable-auto`）。仓库没开 auto-merge 时 gh 报错，原样 toast。
  - 「在看板里打开」：跳到已有的 Issue/PR 看板的这个 PR。
- **自动归档**：设置 → 对话 加「PR 合并或关闭后自动归档对话」（`ui.autoArchivePr`，默认关）。条看到 PR 变成
  merged / closed 且对话没在跑时，`library.archive` 归档它并 toast「PR 已合并，对话已归档」。
- 远端（联邦）对话：不显示条（这期不做）。没装 gh 也没有 token：不显示条（VCS 服务已有的「没登录」状态）。

## 测试

- `formatComments`、发现分组 / 开着的发现计算、CI 汇总（`summarizeChecks`）、自动修的去重键：纯函数单测。
- `vcs.prForBranch`：服务端单测（mock gh 的输出）。
- runner：Claude 引擎的 env 有 `CLAUDE_CODE_REPORT_FINDINGS=1`。
- ui-smoke：审阅面板里点一行 → 输入框出现 → Enter 加一条 → 顶部条显示 1 条；一张 ReportFindings 卡（种子对话里
  放一条 ReportFindings 工具调用）能渲染、能忽略一条。
- 真机：真引擎在一个有改动的临时 git 仓库里跑 `/code-review`，确认 ReportFindings 被调用、卡片显示。
- 文案 / 联邦：新请求都带 cwd 不带 sessionId，不进联邦表；`tr` 全覆盖。

## 不做

- diff 里内嵌审查发现、自动处理 PR 评论、GitLab、联邦对话的 PR 条。
