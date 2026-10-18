# 子代理用任何模型（2026-10-18，用户要求）

## 背景

用户：「我要的是子代理能随意切换别的模型，只要供应商那边接过的模型，不是跟着主模型」「所有模型都能设置子代理，主模型 / 会话不影响子代理的设置」
「不管是不是新会话还是什么，反正子代理就是任何模型都能设置和切换」。

现状（`models` 笔记「子代理用的模型」「子代理用别家的模型」）：

- 子代理的选择存成字符串：普通模型 id = 主对话那个供应商的模型；`cw-x:<供应商>:<模型>` = 别家的（`server/src/models/subagent.ts`）。
- 只有主对话在 **Anthropic 格式供应商**上时才能选别家（`subagent-label.ts` 的 `crossProviders`；runner 里 `this.provider?.type === 'anthropic'`）。
  Claude 账号的对话、OpenAI / Grok / Gemini 格式的对话只能选自己的模型——截图里的情况。原因：分流路由（`/gateway/~s/<token>`）转主对话的请求
  要用主供应商存着的 key，账号登录没有。
- 选择跟着主供应商走：对话换了供应商，旧的选择作废（`subagentModelFor` 比对 providerId）；新对话默认按供应商分（设置 `subagentModels`）。

目标：子代理的设置和主模型 / 主对话无关。任何 Claude 对话的子代理都能选、能切到任何一个接得上的模型；换主模型、换供应商、新对话都不影响它。

不做：其它 agent（Codex 等，没有子代理按钮）；网关组档案（`gateway` 类型）作为子代理目标；官方二进制上 OpenAI / Gemini 格式的主对话（它们本来就只跑 ccb）。

## 1. 选择独立于主对话

- 选择一律存成**完整的（供应商, 模型）**。存储格式沿用字符串字段：`''` = 跟主模型一样；`cw-x:<供应商 id>:<模型>` = 选了一个模型，**不再看主对话是哪家**。
  官方账号的供应商 id 是 `claude`（`providerKey`）。
- 读旧数据：SessionMeta 里旧的普通 id（`subagent.model` 不带 `cw-x:`）按它记录时的 `subagent.providerId` 补成完整的；不再因为主对话换了供应商就作废。
- 新对话的默认：设置里一个全局值（新 key `subagentModel`，字符串，同上格式）。菜单底下的勾改成「新对话都这样」。旧的 `subagentModels`（按供应商）
  在读不到新 key 时一次性换算：取当前这个新对话主供应商那一项、补成完整的；之后写新 key。
- 解析顺序（pool）：调用方给的 → 这个对话记过的 → 全局默认 → `''`。IM、定时任务、目标、重开、分叉都走这里，和现在一样。
- runner 里归一：选的供应商 == 主对话的供应商 → 直接给模型 id（现在的「同家」路径，不分流）；不同 → 分流。主对话中途换模型 / 换供应商时
  这条判断重新算（已有的 `respawnWhenIdle()` / 换供应商重启会走 `plan()`）。

## 2. 菜单

- `SubagentChip` 不再 `lockProvider` 到主供应商：列 Claude 账号的模型（账号可用时）+ 所有 Claude 对话接得上的供应商（anthropic / openai / grok / gemini 类型），
  主对话的供应商排第一；`claude-account` 档案（setup-token 加的其它账号）也列。最上面仍是「跟主模型一样」。
- 去掉「用 Claude 账号的对话只能选账号里的模型……」那句；说明统一成「子代理（Task、工作流）用哪个模型，任何供应商的都行：主任务还是用主模型」。
- 标签（`subagentLabel`）：选的是别家时显示「供应商 / 模型」，同家时只显示模型名（和现在一致，但按当下的主供应商判断）。
- 灰显规则沿用统一菜单的「不可用 ≠ 不兼容」：比如选了 openai 格式的子代理模型、而对话跑在官方二进制上时，该节照常可选（分流在网关里翻译，
  不需要 ccb）。被 `ui.disabledModels` 关掉的模型不列。

## 3. 分流路由支持所有主对话

`GatewayService.serveSplit` / `splitEndpoint` 扩展。分流记录变成 `{ main: Endpoint, sub: Endpoint, model }`，`Endpoint` 是
`{ kind: 'provider', providerId } | { kind: 'account' }`。

- **路由自己的认证改到 URL 里**：`/gateway/~s/<token>/k/<key>/v1/…`（和缓存垫片 `/~p/…/k/<key>` 同一个办法）。这样 Authorization 头留给引擎自己的登录。
  分流记录只在内存里、服务重启就没了，没有要兼容的旧进程：只认 URL 里的 key。
- **`account` 端**：请求原样转到 `https://api.anthropic.com`（遵守本机网络代理设置），带上引擎发来的认证头（`authorization`、`anthropic-beta` 等原样），
  不读、不存这个令牌。
- **`claude-account` 档案作子代理目标**（主对话是别的账号或供应商）：用这个档案存的令牌发到 api.anthropic.com（Bearer + 账号登录要的 beta 头），
  替换掉引擎带来的认证头。它作主对话时就是上面的 `account` 端（引擎经 `CLAUDE_CODE_OAUTH_TOKEN` 登录，令牌在请求头里）。
- **`provider` 端**：和现在一样用档案的 key；转给它之前**去掉**引擎带来的 `authorization` / `x-api-key`（可能是账号令牌，不能发给第三方）。
- 各种主对话：
  | 主对话 | 引擎怎么配 | 主请求 | 子代理请求 |
  | --- | --- | --- | --- |
  | Anthropic 格式供应商 | 和现在一样：base → 分流路由 | 原样转主供应商 | 转选的那家（需要时翻译） |
  | Claude 账号（官方登录 / `claude-account` 档案） | base → 分流路由；**不设** `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`，登录照旧 | 原样转 api.anthropic.com，带引擎的认证头 | 去掉认证头，转选的那家 |
  | OpenAI / Grok 格式供应商（ccb） | `OPENAI_BASE_URL` / `GROK_BASE_URL` → 分流路由 | 原样转缓存垫片那条路（保住提示缓存） | 从 OpenAI 格式翻译到选的那家 |
  | Gemini 格式供应商（ccb） | `GEMINI_BASE_URL` → 分流路由 | 原样转主供应商 | 从 Gemini 格式翻译到选的那家 |
  | 任何供应商 + 子代理选 Claude 账号的模型 | 引擎保留账号登录（不设供应商的 key 变量），base → 分流路由 | 去掉账号认证头，用供应商的 key 转主供应商 | 原样转 api.anthropic.com，带账号的认证头 |
- 区分主 / 子代理请求仍靠别名 `cw-sub/<模型>`（`subAlias`），转发前换回真名；Gemini 格式的模型名在 URL 路径里，同样匹配、替换。
- 子代理请求的 `thinking.display` 处理照旧（不是 Claude 模型就去掉）。
- 分流路由不可用（端口还没开）时：子代理留在主模型上，runner 打一行警告（现状），对话照常。

## 4. 先验证的风险（实现的第一步）

1. **引擎指向本地地址时还带不带账号登录**：官方二进制和 ccb，用账号登录、只设 `ANTHROPIC_BASE_URL` 到一个本地假服务，看请求头里是否有账号的
   Bearer 令牌、请求体和直连时是否一致。不带的话，「Claude 账号主对话」和「子代理选账号模型」两种都做不成，改成菜单里灰显并写原因，其余照做。
2. **反向（供应商主对话 + 账号子代理）**：引擎以账号身份运行时，发给供应商的主请求形状会变（OAuth 的 beta 头、账号的别名表）。只校验官方客户端的
   中转可能拒收。用真中转（super-nb）实测；不稳的话只关掉这一个方向（菜单里账号那节灰显 + 原因）。

## 5. 测试

- 单测：`models/subagent.test.ts`（完整选择、旧数据换算、全局默认、同家归一）、web `subagent-cross.test.ts`（菜单列出的供应商、标签）、
  `gateway/service.test.ts`（每一种主对话：URL 里的 key、账号端带认证头、供应商端去掉认证头、OpenAI / Gemini 入站翻译、别名换回）、
  `runtime/session-runner.test.ts`（各种主对话下的环境变量）、`runtime/pool.test.ts`（解析顺序、换供应商不作废）。
- e2e：扩 `server/ws-phase28.mjs`，假上游（假 api.anthropic.com + 假 OpenAI + 假 Gemini），每种主对话各一轮：主请求到主端、子代理请求到选的那家、
  认证头没有串。
- ui-smoke `subagent-chip` 段：账号对话的菜单里能看到供应商的模型。
- 真机：账号登录 + 真中转各跑一次（主请求、子代理 transcript 的 model、modelUsage）。结果写进 `models` 笔记。
