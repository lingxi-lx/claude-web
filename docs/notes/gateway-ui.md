# 上游页：来源卡片 + 筛选（2026-10-26，spec 2026-10-26 §2）

网关页改成「上游」：一页来源卡片，左边只有筛选，没有 tab，没有「高级设置」。代码在 `web/src/features/gateway/`。

## 结构

- `GatewayPage.tsx`：OverPage 外壳。页头 = 搜索、活动、盾牌（隐私）、共享、＋ 添加来源。主体 = `SourceDashboard`（一直挂着，进详情时只 `hidden`）+ 详情（`SourceDetail` / `RoutingDetail`）+ 三个抽屉。
- `GatewaySide.tsx`：侧栏只放筛选（全部 / 免费 / 订阅 / API 供应商 / 本机运行内核 / 需要处理，带数）。侧栏不在屏上（手机、收起）时，页里出横向滚动的 `FilterStrip`。
- 数据：`state.ts` 的 `load()` 多拉一个 `channels.status`（`server/src/channels/`，`ChannelRequest` 已并进 `ClientRequest`）。一个 family 没有账号（`unconfigured`）时不出卡片，走「添加来源」。
- `page.ts`：纯函数（筛选、计数、额度、按来源过滤日志），`page.test.ts` 覆盖。

## 旧功能去哪了

| 旧 | 新 |
| --- | --- |
| 概览（开关、地址、密钥） | 共享抽屉（`ShareDrawer`）；「在本应用里用」→ 智能路由详情的「加到模型菜单」 |
| 账号 / 账号池 | 来源详情的「账号」模块（`AccountsTab kind=…`）；代理、并发、每天上限在账号「编辑」里；顺序和模型映射在账号池里 |
| 任务 | 来源详情的「每日任务」（`TasksTab kind=…`，按账号 / 池的 family 过滤） |
| 分组与路由 | 卡片「智能路由」（`ROUTING_ID`）→ `RoutingDetail`（包着 `RoutesTab`） |
| 密钥 | 共享抽屉「密钥和权限」（`KeysTab`） |
| 日志 | 活动抽屉（`ActivityView`）；单个来源的在详情「诊断」（`LogsTab names=…`，按 audit 行的 member 名过滤） |
| 设置 | 端口 / 局域网 / ?key= → 共享抽屉「连接设置」；审计 → 隐私抽屉「请求记录」（`AuditSettings`） |
| 组件（sidecar） | 来源详情「连接组件」（`SidecarCard`，停止 / 同步不再藏在高级里） |

## 添加来源

`add-source.ts`（小 store）+ `AddSourceWizard.tsx`，App.tsx 里经 `AddSourceLazy` 挂一次，所以别处（以后对话的模型菜单）调 `openAddSource()` 就能开。三个大选项（免费使用 / 登录账号 / 填写 API 地址）+ 搜索 + 全表（`CATALOG`，只放今天真能加的）。账号走 `AddAccountWizard embedded kind=…`，API 走 `QuickConnect preset=…`（新加的 prop）。完成页只说「已可用」，没有去聊天按钮。

## 隐私中心挂载点

`PrivacyDrawer.tsx` 用 `import.meta.glob('../privacy/PrivacyCenter.tsx')`：那个文件（具名导出 `PrivacyCenter`，无 props）存在就懒加载它，不存在显示占位。另一条分支落地时这里不用改。

## Esc

`OverPage` 加了 `onEscape`：先收最里面的（抽屉 → 详情），都没有才关页。页根的 keydown 也不再处理 `.modal-bg` / `.menu` / `[role=dialog]` 里冒上来的 Esc（以前在「添加账号」对话框里按 Esc 会把整个网关页关掉）。抽屉、向导自己处理 Esc 并 `stopPropagation`；文本框先问 `imeComposing`。

## 还没做

- 订阅来源的模型数靠 `gateway.status.poolModels`（组件报过才有）；Claude 账号没有列表时显示「模型待读取」。
- 「本机运行内核」「免费」两类要等 channels 的 catalog / drivers 补上真实来源才会有卡片。
- 登录账号里没有 Codex / Cline（还不能真加）。
- 对话模型菜单底部的「管理来源」/ 轻量添加面板还没接（`openAddSource()` 已可调）。
