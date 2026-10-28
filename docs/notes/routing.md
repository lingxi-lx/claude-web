# 智能路由（2026-10-26，spec 统一模型来源 §7）

设计在 `docs/superpowers/specs/2026-10-26-unified-model-sources-design.md` §7（还有 §2.4、§5.2、§9）。

## 形状

- **智能路由是一种网关组**：`GatewayGroup.routing?: RoutingConfig`。请求走的还是网关那条路（key、翻译、
  `attempt()`、隐私钩子、账本 / 审计），只有「试谁、按什么顺序、最多试几个」由 `server/src/routing/` 决定。
  组 id 固定 `smart`（`gateway.routing.ensure` 建），网关给每个组自动建的供应商档案让它出现在模型菜单里。
- **策略 = 虚拟模型**：`smart-auto / smart-free / smart-performance / smart-capability / smart-custom`
  （`ROUTING_MODELS`）。模型菜单里组名「智能路由」下五项，显示名走 `routingPolicyLabel`。别的模型名
  （引擎后台的 haiku、子代理别名）用组里的「没指明策略时用」（`config.policy`）。`/v1/models` 对路由组只报这五个。
- 候选 = `routing.candidates`（来源引用 + 模型 + `allowAuto` + 可选 cost / caps / price），顺序就是用户优先级。
  `members` 由候选派生（每个来源一条，给 status、lean-tools、官方客户端判断用），保存时会被覆盖，别直接改。

## 文件

| 文件 | 干什么 |
| --- | --- |
| `routing/types.ts` | 线上类型（protocol.ts `export *`）、`candidateKey` = `<memberKey>#<model>` |
| `routing/candidates.ts` | `needsOf`（工具 / 图片 / 思考 / 估算 token / 是否工具之后）、`costOf`、`capsOf`、硬过滤 `filterCandidates` |
| `routing/policies.ts` | 各策略的权重打分、`capabilityScore`、自定义规则匹配、`setClassifyHook`（自然语言规则的分类器留口，现在没人接） |
| `routing/affinity.ts` | 对话 → 上次成功的候选，6 小时，只在内存 |
| `routing/decisions.ts` | 最近 200 条决定、每个候选最近 20 次结果和首字节 EWMA、今天的付费花费（存 meta `routing.spend`）、今天切换次数 |
| `routing/router.ts` | `planAsync`（先问意图判断）/ `plan`（同步，状态页预览用）→ `attempt` → `finish`，网关 `run()` 里调 |
| `routing/selectors.ts` | `config.mode` 不是 `smart` 时的排序：order / rotate（游标只在真发出请求后前进）/ usage / pace / weight / fast |
| `routing/intent.ts` + `intent-ask.ts` | 意图判断：`config.intents` + `intentJudge`（必须是 provider 候选，直接用它的 key 调一次，走隐私中转）；只在「自定义」、一轮第一句、条件规则没命中时调；命中的意图压过亲和 |
| `routing/trace.ts` | 每条决定的回放步骤（group / filter / rank / rule / classifier / affinity / order / attempt / finish），`finish` 时写进 `decision.trace` |
| `routing/quota.ts` | 每个来源（`p:<providerId>` / `a:<accountId>`）的剩余额度和 429 冷却，读 x-ratelimit-* / anthropic-ratelimit-*（含订阅的 unified utilization）/ retry-after；网关 `attempt()` 里一行 `observeUpstream` 喂它 |
| `gateway/service.ts` | `run()` 包一层：有 `routing` 就先 plan，`runMembers` 用 plan 的顺序；`routingStatus / setRouting / ensureRoutingGroup` |
| `web/src/features/routing/RoutingDetail.tsx` | 详情页组件（模型中心的 RoutingPage 也挂它）；`DecisionTraceView.tsx` 是每条决定的回放 |

## 规则（§7.3，别放松）

- 只在 `attempt()` 回 `switch`（还没给客户端发任何字节）时才换下一个候选；`broken`（已经开始输出）不换。
- 请求的最后一条 user 消息带 tool_result = 这一轮已经执行过工具 → 只试一个（`needs.afterTool`），失败就报错，
  不悄悄换模型重放。同一候选的账号池内部换账号仍然照旧（同一个模型）。
- 免费优先只留 `cost === 'free'`；付费候选要 `allowPaid` 且 `budgetUsd > 0` 且今天没花完。
  花费：候选填了 `price` 按它算，Claude 模型按价目表，**别的付费模型没填价格时记 0**（缺口：预算挡不住）。
- `cost` 推断：`:free` 结尾 / gemini、workbuddy 账号 / 本机地址 → 免费；其它账号 / claude-account → 订阅；其余 → 付费。
- 思考只在候选明确 `caps.thinking === false` 时才硬过滤（多数模型的思考能力我们不知道，不拿未知当否）；
  图片同理，只有已知不收图的家族（deepseek / kimi-k2 / qwen-coder …）被过滤。
- 冷却 / 停用读网关的 `MemberStates`，键是 `candidateKey`（账号池的是 `a:<id>`，所以池子的冷却不在候选级显示）。

## 对话里怎么显示实际模型

成功的请求发 `gateway.routed`（`RoutedInfo`，按 `x-claude-code-session-id`），hub 广播，联邦 `rewriteEvent`
给 id 加前缀。store 的 `routed[sessionId]`（不进 reducer），Composer 在跑的对话的模型 chip 显示
「自动 → 实际：<model>」，悬停写原因和是否换过。账本 gateway 信息多一个 `route`（策略、原因、选中、每次尝试）。

## 缺口

- 剩余额度（2026-10-28）：只认上游自己在回应头里说的；没说过的来源算 0.7（中性偏高），打分里 `quota` 权重
  免费优先最大。429：retry-after → 头里用完的那个窗口的重置时间 → 30s 起翻倍、最多 30 分钟；成功一次清零。
  冷却中的来源在硬过滤里排除（原因「限流冷却中」）。账号池（`u:`）没有来源级额度。只在内存。
- 网关的 `applyRouting` 会把候选的 `weight` 丢掉（它只留白名单字段），所以「按权重」现在实际按剩余额度当权重；
  `mode` / `intents` / `intentJudge` 是顶层字段，原样存下来。
- 能力数据是名字启发式 + 上下文窗口表 + 用户覆盖，没有统一的能力表。
- 决定只在内存（重启清空）；账本里有每条的摘要。
