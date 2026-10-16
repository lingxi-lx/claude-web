# 审阅与 PR：diff 行评论 / 代码审查卡 / PR 监控条（2026-10-16）

五期「赶上官方桌面版」路线的第 3 期。spec：`docs/superpowers/specs/2026-10-16-review-pr-design.md`。
依据：官方 `desktop.md`（Review changes with diff view / Review your code / Monitor pull request status）、
`code-review-local.md`、`tools-reference.md`。

## diff 行评论

- `DiffView` 的可选 `comments` 属性（`DiffComments`）：只有审阅面板（`ReviewView` 的 `FileBody`）传，对话里的 diff
  不变。点行（统一 / 并排都行）在下面开输入框，Enter 加、Esc 关；删除行记旧行号（`side: 'old'`）。
- 评论行用 `Fragment` 和行并排，不给每行包一层 div——对话里的 diff 一行多一个 DOM 节点就多一份成本，`.diff-lines`
  在审阅面板里是 grid。
- 状态：`features/workbench/review-comments.ts`（小 zustand，按对话，只在内存）。审阅面板顶上「N 条评论 · 清空 ·
  交给 Claude（Ctrl+Enter）」；发送用 `store.send`（在跑就进队列），发失败把评论放回去。
- 消息格式 `formatComments`（按文件、行号排，每条带那一行代码）。远端（联邦）对话不开评论。

## 代码审查卡（/code-review）

- 引擎开关：`CLAUDE_CODE_REPORT_FINDINGS=1`（runner 设，用户环境里有就不动）。有它且输出是 stream-json 时，
  `/code-review` 结束时调 `ReportFindings`，不再把发现打成文字。
- 输入：`{ level?, findings: [{ file, line?, summary, short_summary?, failure_scenario, category?, verdict?:
  'CONFIRMED'|'PLAUSIBLE', outcome?: 'fixed'|'skipped'|'no_change_needed' }] }`，最多 32 条，最严重的在前；修完重报时
  带 `outcome`。
- 真引擎实测（官方二进制 haiku，2026-10-16）：临时仓库里 `avg.js` 的 `<=` 越界，`/code-review` 后调了两次
  `ReportFindings`（内容一样），发现正确（line 3，correctness，CONFIRMED）。
- 卡片 `features/chat/tools/FindingsTool.tsx`（注册表 `standalone`），纯函数在 `findings.ts`。忽略记在会话 meta 的
  `reviewDismissed`（`toolUseId#index`）。「修这一条」/「修复还开着的」往对话发消息。

## PR 监控条

- 服务端 `vcs.prForBranch { cwd }`：`git rev-parse --abbrev-ref HEAD` → GraphQL 按 `headRefName` 取最新一个 PR，
  带最后一次提交的 `statusCheckRollup.contexts`（CheckRun 和 StatusContext 两种），`summarizeChecks` 汇总
  （`vcs/pr-status.ts`）。不是仓库 / 没 remote / 不是 GitHub / 没登录 / 没 PR 都是 `{ why }`，条不出现。
- `vcs.autoMerge { cwd, prId, on }`：GraphQL `enablePullRequestAutoMerge(SQUASH)` / `disablePullRequestAutoMerge`；
  仓库没开 auto-merge 时 GitHub 报错，原样 toast 并提示去设置里开。
- 前端 `features/vcs/PrBar.tsx`，挂在 `ChatTile` 的 `GoalBar` 下面。拉取时机：对话变空闲时（打开、每轮结束）+ 窗口
  可见时每 60 秒。
- 自动修 CI（会话 meta `prAutoFix`）：对话空闲且有新的失败检查时发一条消息（带 `gh run view <id> --log-failed`）；
  去重键 `PR号:运行id或名字@提交sha`（`prFixed`，留最近 50 个）——同一次推送只问一次，新推送重新算。
- 自动归档（设置 `ui.autoArchivePr`，默认关）：PR merged / closed 且对话空闲 → `library.archive`。
- **只认本仓库的 PR**（验证发现，2026-10-16）：只按 `headRefName` 查，facebook/react 上光 head 叫 main 的就有 519 个，全是别人 fork 来的。现在取前 10 个里第一个 `isCrossRepository: false` 的，当前分支是默认分支时直接不显示。代价：你在自己的 fork 上开 PR 到上游时，条不显示（origin 是 fork）。
- **一个对话只有一个条在干活**：标签页隐藏时不卸载，同一个对话也可能开在两个分屏。拉取、自动修和自动归档只由第一个在屏上的条做（模块里的 `owners`），结果放在共享的小 store 里，别的条只读。自动修还有一个本窗口同步去重（`sentFix`）；两个桌面窗口之间仍可能各发一次，这一点没处理。
- **自动归档只认这次在本窗口里看见过开着的 PR**（`sawOpen`），每个只试一次：刚打开设置时，不会把几个月前就合并的 PR 对应的对话一起扫掉；Codex 对话归档后不写 `sessionMeta.archived`，也不会因此反复归档。
- 没登录 gh 时缓存 60 秒（`noToken`），不会每分钟每个对话都起一次 `gh auth token`。
- 没做：自动处理 PR 评论（官方按作者身份筛选，要可靠的权限判断）、GitLab、联邦对话的条。

## ui-smoke

种子里多了第三个对话（`reviewSid`，一条 ReportFindings），查卡片按文件分组、忽略后变灰且计数减一；审阅面板里点
README 的新增行加一条评论、清空。
