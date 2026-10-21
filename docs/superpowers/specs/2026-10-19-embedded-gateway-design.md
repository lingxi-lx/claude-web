# 内嵌网关与订阅账号池 设计

日期：2026-10-19 · 状态：待用户审阅

## 目标

把五个网关仓库的能力吸收进 claude-web，同时保留现有网关已经做好的协议直通、翻译、故障转移和缓存：

1. **统一账号池**：Claude 订阅、Gemini 网页、WorkBuddy / CodeBuddy、现有 OpenAI / Grok 供应商，在同一个界面里管理。
2. **完整网关**：Anthropic Messages、OpenAI Chat Completions、OpenAI Responses、Gemini 四种入口；同协议直通，跨协议翻译；跨账号池故障转移。
3. **对外范围**：本机回环默认开启；可选局域网监听，带密钥组、IP 白名单、限速和审计。不做公网暴露。
4. **完整任务中心**：签到、成长任务、抽奖、猫咪旅行、活跃度、保活。
5. **四种账号接入**：浏览器 OAuth 回调、手动粘贴 / 文件导入、扫码批量、读桌面客户端凭据。
6. **管理界面**：账号、分组、密钥、任务、日志、设置集中在「网关」分区。

## 明确不做

- **不内嵌 sub2api**（LGPL-3.0，体量大，许可证与 MIT 仓库不兼容）。只参考它的密钥组、额度护栏、账号调度和计费设计，不复制代码。
- **不读取进程内存**。桌面客户端凭据只读用户明确确认的文件和系统凭据库（Windows Credential Manager / DPAPI 文件、macOS Keychain），每一条导入前展示来源路径和掩码身份。
- **不做公网监听**。局域网之外由用户自己的反向代理、VPN 或 ZeroTier / Tailscale 负责。
- **不自动升级 sidecar**。版本固定、SHA256 校验、用户手动升级，失败保留上一版。
- **不把密钥、cookie、OAuth token、prompt 正文写进日志或发给前端**。前端只拿掩码和健康状态。
- **不绕过供应商的计费、风控或地区限制**。账号被封、额度受限是用户风险；界面在接入前明确提示。

## 架构

```
外部客户端 / claude-web 自己的对话
        │ Anthropic / OpenAI Chat / Responses / Gemini
        ▼
GatewayListener（新增，独立 http.Server）
  ├─ 回环监听（默认）：127.0.0.1:<port>/<groupId>/v1/...
  └─ 局域网监听（可选）：<bind>:<lanPort>/v1/...
        │
        ▼
GatewayService（现有，扩展）
  ├─ 鉴权：key → 密钥组 → 路由组 + 策略（IP / 模型 / 限速 / 预算）
  ├─ 路由：/v1/...（按键解析）或 /<groupId>/v1/...（显式）
  ├─ 协议直通 / 翻译（现有 IR + convert）
  ├─ 跨成员故障转移 / 权重 / 模型映射（现有 failover）
  └─ 成员解析：
       ├─ provider profile（现有）
       ├─ claude-account（原生 Claude 订阅）
       └─ sidecar member（gemini / workbuddy，OpenAI 兼容）
        │
        ▼
UpstreamService（新增）
  ├─ AccountStore（账号、凭据引用、健康、额度快照的唯一真源）
  ├─ ClaudeAdapter（直连 Anthropic Messages + OAuth beta；可选 CLI 兜底）
  ├─ SidecarManager（下载 / 校验 / 启动 / 健康 / 日志 / 重启）
  ├─ GeminiAdapter → gemini-web2api-go
  ├─ WorkBuddyAdapter → workbuddy2api-panel
  └─ MaintenanceScheduler（任务中心）
```

### 为什么是混合架构

- **Claude 订阅**必须原生 TypeScript：它和现有网关的 Anthropic 协议、`Provider` 档案、`claude-account` 类型、OAuth token 注入都在同一个进程里，交给外部二进制只会多一层翻译。
- **Gemini 网页**和 **WorkBuddy** 依赖各自的网页接口逆向、cookie 续期、TLS 指纹、风控节奏。这些逻辑更新频繁，做成独立 MIT 单文件二进制 sidecar，升级和回滚都不碰主程序。
- **跨家族故障转移**继续由现有网关负责，sidecar 只负责家族内部轮换。两层职责不重叠。

## 数据模型

### 存储位置

`~/.claude-web/meta.json` 新增（全部通过 `MetaStore` 的写队列，写前临时文件 + 原子 rename）：

```ts
upstreamAccounts?: UpstreamAccount[];
upstreamGroups?: UpstreamGroup[];
gatewayKeys?: GatewayKey[];
gatewayKeyGroups?: GatewayKeyGroup[];
gatewayLan?: GatewayLanConfig;
gatewayAudit?: GatewayAuditConfig;
sidecars?: Record<SidecarId, SidecarInstall>;
maintenanceTasks?: MaintenanceTask[];
maintenanceRuns?: MaintenanceRun[];   // 只保留最近 N 条
```

凭据字段一律是 `enc:…`（`server/src/secrets/service.ts`），运行时才解密。健康、冷却、额度是运行态，内存里维护，定期快照回 `meta.json` 以便重启后展示；sidecar 管理的账号以 sidecar 回报为准。

### 统一账号

```ts
export type UpstreamKind = 'claude' | 'gemini' | 'workbuddy';

export interface UpstreamAccount {
  id: string;                    // acct_xxxxxxxx
  kind: UpstreamKind;
  name: string;                  // 用户可改的显示名
  enabled: boolean;
  credential: string;            // enc:…；解密后是按 kind 的 JSON 信封，前端只见掩码
  credentialKind: 'oauth' | 'setup-token' | 'cookie' | 'token' | 'password';
  proxy?: string;                // enc:…；单账号代理，空 = 直连
  maxConcurrent?: number;        // 单账号并发上限
  dailyRequestLimit?: number;    // 单账号每日请求上限
  identity?: {
    email?: string;
    plan?: string;               // Pro / Max / 会员等级
    org?: string;
    expiresAt?: number;
  };
  source: 'oauth' | 'paste' | 'file' | 'qr' | 'desktop';
  createdAt: number;
  updatedAt: number;

  // 运行态镜像
  health: 'unknown' | 'ok' | 'cooling' | 'expired' | 'disabled' | 'error';
  cooldownUntil?: number;
  lastOkAt?: number;
  lastUsedAt?: number;
  lastError?: string;
  quota?: QuotaSnapshot;

  // sidecar 管理的账号
  sidecar?: { id: SidecarId; remoteId: string; syncedAt: number };
}

`credential` 解密后是 JSON 信封，按 `credentialKind` 取字段：

```ts
// oauth:       { accessToken, refreshToken?, expiresAt?, scope? }
// setup-token: { token }
// cookie:      { cookies: [{ name, value, domain? }], userAgent? }
// token:       { token, header? }
// password:    { username, password }
```

`proxy` 只作用于该账号的出站请求（Claude 直连或 sidecar 的账号级代理），格式 `http://user:pass@host:port` 或 `socks5://…`，保存前校验协议白名单。

```ts
export interface QuotaSnapshot {
  checkedAt: number;
  windows: {
    id: string;                  // five_hour / weekly / daily / credits…
    label: string;
    used?: number;
    limit?: number;
    usedPct?: number;
    resetAt?: number;
  }[];
  credits?: { remaining?: number; total?: number; unit?: string };
  note?: string;
}
```

### 账号池

```ts
export interface UpstreamGroup {
  id: string;
  kind: UpstreamKind;
  name: string;
  strategy: 'failover' | 'round-robin' | 'least-used' | 'most-quota';
  members: string[];             // UpstreamAccount.id
  modelMap?: Record<string, string>;
  affinity?: { mode: 'none' | 'session'; ttlMinutes: number };  // 默认 session / 60 分钟
  enabled: boolean;
  createdAt: number;
}
```

`failover`：按顺序取第一个健康成员。`round-robin`：按权重轮询。`least-used`：今天请求数最少。`most-quota`：剩余额度比例最高。健康成员为空时，回退到最近冷却结束的成员，并在响应头标记 `x-cw-degraded: 1`。

**会话粘性**：请求里能取到 `metadata.user_id`、`session_id`、`conversation_id`、`prompt_cache_key` 或 Codex 的 `session_id` 时，同一键在 TTL 内固定选同一账号，避免订阅账号的提示缓存被打散、也避免每次换账号触发风控。成员失败时立即解除粘性并重选；冷却中的粘性目标直接跳过。粘性表只在内存里，重启后清空。

### 网关成员引用

现有 `GatewayMember` 扩展为三选一：

```ts
export interface GatewayMember {
  providerId?: string;           // 现有供应商档案
  accountId?: string;            // 单个 Claude 订阅账号
  upstreamGroupId?: string;      // 整个账号池作为一个成员
  model?: string;
  weight?: number;
}
```

- 恰好设置一个引用；都为空或同时设置多个时保存报错。
- 状态键：`p:<providerId>`、`a:<accountId>`、`u:<upstreamGroupId>`；旧数据没有前缀时按 `p:` 处理。
- `claude-account` 不再被 `ProviderService.member()` 排除；`outboundOf('claude-account')` 返回 `'anthropic'`。
- 账号成员**不走字节直通**：OAuth 需要替换鉴权头、加 `anthropic-beta: oauth-2025-04-20` 和 Claude Code 的系统前缀，所以统一走 IR 渲染。供应商档案仍按原规则直通。

**两种 Claude 账号的关系**：现有 `Provider` 里的 `claude-account`（`setup-token` 生成的 `sk-ant-oat01-…`）继续有效，可以直接作为 `providerId` 成员；新的 `UpstreamAccount`（`kind: 'claude'`）是统一账号池里的条目，支持 OAuth 刷新、桌面凭据导入和额度快照。两者都通过同一个 `ClaudeAdapter` 发请求。设置页提供「把现有 Claude 账号导入账号池」的一次性迁移按钮；不迁移也能继续用。单个 Gemini / WorkBuddy 账号不单独做成员，统一通过 `upstreamGroupId` 入池——这样家族内轮换和额度调度只有一条路径。

### 密钥与密钥组

```ts
export interface GatewayKeyGroup {
  id: string;
  name: string;
  routeGroupIds: string[];       // 允许使用的路由组（GatewayGroup.id）
  modelAllowlist?: string[];     // glob，空 = 全部
  modelDeny?: string[];
  allowLan: boolean;
  ipAllowlist: string[];         // IPv4 / IPv6 CIDR；空 = 拒绝所有非回环
  rateLimit?: {
    rpm?: number;
    concurrent?: number;
    dailyTokens?: number;
    dailyCostUsd?: number;
  };
  createdAt: number;
}

export interface GatewayKey {
  id: string;
  name: string;
  keyGroupId: string;
  prefix: string;                // cwg-abcd… 用于显示
  hash: string;                  // sha256(salt + key)
  salt: string;
  secret?: string;               // enc:…；只有迁移来的旧密钥保留，用于「显示密钥」
  enabled: boolean;
  expiresAt?: number;
  createdAt: number;
  lastUsedAt?: number;
  stats: {
    requests: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    day: string;                 // YYYY-MM-DD，跨天清零
  };
}
```

- 新密钥只在创建时返回一次明文，之后只显示 `prefix`；验证用哈希，比较用 `crypto.timingSafeEqual`，前缀冲突时重新生成。
- 现有 `gateway.key`（`enc:`）迁移成默认密钥组下的一个密钥，写入 `secret` 字段，保留 `revealKey` 能力，旧配置无需改；新建密钥不写 `secret`。
- 密钥组是策略边界；密钥可以换组，但不会继承旧组的使用统计。

### 局域网配置

```ts
export interface GatewayLanConfig {
  enabled: boolean;
  bind: string;                  // 明确的私网 IP 或 0.0.0.0（0.0.0.0 需要二次确认）
  port: number;                  // 0 = 随机
  ipAllowlist: string[];         // 监听器级兜底白名单
  corsOrigins: string[];         // 空 = 不发 CORS 头
  maxBodyBytes: number;
}
```

### 审计

```ts
export interface GatewayAuditConfig {
  enabled: boolean;
  maxBytes: number;              // 单文件上限，超出轮转
  keepFiles: number;
}
```

每行 JSON：`ts, keyId, ip, protocol, model, routeGroupId, member, status, ms, tokensIn, tokensOut, errorCode`。**不记录** prompt、响应正文、密钥、cookie、Authorization。

## 账号生命周期

### 加入

1. 解析输入：OAuth 回调、粘贴文本、文件、二维码、桌面凭据。
2. 规范化成 `UpstreamAccount`；计算 `sha256(kind + credential)` 去重，重复时提示已有账号。
3. 异步探测（超时 20 秒，不阻塞界面）：
   - **Claude**：`POST /v1/messages`，`max_tokens: 1`，`claude-haiku-*`，带 OAuth beta 头；失败再试 `GET /v1/models`。
   - **Gemini**：sidecar 的账号检查接口；sidecar 未运行时状态为 `unknown`，启动后自动补探测。
   - **WorkBuddy**：sidecar 的 refresh / whoami 接口。
4. 探测通过 → `ok`；401/403 → `expired`（需要重新授权）；429/402 → `cooling`；其他 → `error`。
5. 入池：加入用户选择的 `UpstreamGroup`；Claude 账号同时可直接作为 `accountId` 成员。
6. sidecar 账号：写入 sidecar，记录 `sidecar.remoteId`，并立即拉一次健康与额度。

### 健康与冷却

- 429 / 402 / 5xx：按 `retry-after` 或 `anthropic-ratelimit-*-reset` 冷却；没有就 60 秒起指数退避，上限 30 分钟。
- 401 / 403：账号 `expired`，停止使用，界面提示重新授权；不自动删除。
- 连续失败达到阈值：`error`，需要手动恢复或下一次定时任务成功。
- 恢复：`gateway.reset` / `upstreams.reset` 清除冷却和 strikes。
- 每个账号、每个路由组、每个密钥组都可以一键停用（kill switch）。

### 保活与额度

- **Claude**：`setup-token` 生成的 `sk-ant-oat01-…` 不能刷新，只能定期验证；带 refresh token 的 OAuth 走刷新。验证失败提醒重新授权。
- **Gemini**：cookie 由 sidecar 自动续期；claude-web 定时触发 keepalive 任务并拉回额度。
- **WorkBuddy**：sidecar 刷新 token；签到 / 保活 / 成长任务 / 旅行 / 抽奖由任务中心统一调度。
- 额度快照统一成 `QuotaSnapshot`，界面画进度条；额度未知时显示「未知」，不伪造 0%。

### 删除与禁用

- 删除：从所有 `UpstreamGroup` 和 `GatewayGroup` 成员里移除 → 删除 sidecar 账号 → 删除加密凭据 → 写审计。
- 禁用：保留凭据，立即停止被选中，保留历史统计。
- 账号改名、换组、改策略都写审计，但不记录凭据。

### 导入 / 导出与模型同步

- **导出**：默认只导出非敏感元数据（名称、类型、分组、策略、代理地址的掩码）。勾选「包含凭据」后导出的文件是 `enc:` 信封或用户提供的口令加密包，界面明确提示风险；不提供明文导出。
- **导入**：支持本工具的导出文件、sidecar 原生导出、以及纯凭据列表；逐条去重，冲突时让用户选择跳过 / 覆盖 / 另建。
- **模型同步**：每个供应商 / 账号池有「拉取模型」按钮，调用 `/v1/models`（或 sidecar 的模型接口）更新可用模型列表；失败时保留旧列表并显示错误。

### 桌面客户端凭据导入

只读以下来源，逐条展示、逐条确认：

- Claude Desktop / Claude Code：`~/.claude/.credentials.json`、系统凭据库中的 OAuth 条目。
- WorkBuddy / CodeBuddy 桌面端：其用户数据目录下的 token / cookie 文件（按平台列举，路径写在 adapter 里，不写死在 UI）。
- 不读浏览器 cookie 数据库的加密内容；不读进程内存；不读系统 keychain 里与本工具无关的条目。

导入对话框显示：来源路径、账号掩码、过期时间、将写入的字段。用户取消时不留任何副本。

## 网关暴露与路由

### 监听器

- **回环监听器**：跟随主 HTTP 服务端口，路径 `/<groupId>/v1/...` 与 `/v1/...`，仅 `127.0.0.1` / `::1`。
- **局域网监听器**：`GatewayLanConfig.enabled` 时单独 `http.Server`，绑定用户指定地址；只提供 `/v1/...` 和 `/healthz`，不提供管理接口、不提供 WebSocket、不提供静态文件。
- 现有 `GatewayService.handle()` 里的「非回环一律 404」改为按 `surface` 判断：`loopback` / `lan` / `remote`。远程访问监听器（`RemoteService`）仍然一律 404。
- 关闭服务器时两个监听器一起关闭；端口变化通过 `gateway.changed` 事件推给前端。

### 路由解析

1. 读密钥：`x-api-key`、`Authorization: Bearer`、`x-goog-api-key`，或 `?key=`（仅限本地调试，默认关闭）。
2. 验证哈希、启用状态、过期时间。
3. 取密钥组：检查 IP 白名单、`allowLan`（局域网请求）、RPM / 并发 / 每日预算。
4. 选路由组：
   - 显式路径 `/<groupId>/...`：必须在 `routeGroupIds` 里。
   - 根路径 `/v1/...`：只有一个路由组时直接用它；多个时按模型前缀 `group/model` 或模型归属选择；仍无法确定返回 400 并列出可用组。
5. 检查模型白名单 / 黑名单（glob）。
6. 进入现有 `failover`，按成员引用解析成实际上游。

### 入口与出口

| 入口 | 路径 | 出口 |
| --- | --- | --- |
| Anthropic | `/v1/messages`、`/v1/messages/count_tokens` | anthropic 直通；openai / gemini 翻译 |
| OpenAI Chat | `/v1/chat/completions` | openai 直通；anthropic / gemini 翻译 |
| OpenAI Responses | `/v1/responses` | openai 直通；anthropic 翻译 |
| Gemini | `/v1beta/models/<m>:generateContent`、`:streamGenerateContent`、`:countTokens` | gemini 直通；anthropic / openai 翻译 |
| 模型列表 | `/v1/models`、`/v1beta/models` | 成员模型并集，按密钥组过滤 |

- `/v1/models` 的 `id` 是客户端可见模型：`modelMap` 的入口键 + 成员的模型 id。重名时加 `family/` 前缀，两种写法都接受。
- **模型别名**：`modelMap` 支持精确键、尾部 `*` 通配和 `group/model` 前缀；`<groupId>/<model>` 优先解析到指定路由组，其余按当前密钥组的路由组顺序匹配。别名可以指向 `providerId/model` 或纯模型名（由成员自身决定）。
- `/v1/messages/count_tokens` 在出口不支持时本地估算（按字符 / token 的保守系数），响应头 `x-cw-estimated: 1`；支持的出口照常转发。
- 上游的限速头（`anthropic-ratelimit-*`、`x-ratelimit-*`、`retry-after`）归一成 `x-cw-ratelimit-*` 回给客户端，并写入账号额度快照的窗口。
- 错误按入口协议返回：Anthropic `{type:'error',error:{type,message}}`，OpenAI `{error:{message,type,code}}`，Gemini `{error:{code,message,status}}`。
- 流式响应一旦向客户端吐字就不再切换成员；之前的失败可以切换。

### 限速与预算

- 令牌桶按密钥：RPM 和并发。
- 每日 token / 费用上限：网关自己的计数器（内存 + `meta.json` 每日快照）为准；`ledger` 只用于界面交叉核对，因为外部客户端的请求没有会话 id。超限返回 429，`Retry-After` 到次日零点。
- 账号级护栏：单个账号每天最多 N 次请求 / N 美元，防止一个账号被跑空。
- 所有限制都可在界面临时放宽或关闭，并写审计。

### CORS 与 TLS

- 默认不发 CORS 头（命令行 SDK 不需要）。
- `corsOrigins` 非空时只对白名单来源回显；不允许 `*` 与凭据同时使用。
- 不内置 TLS。局域网明文 HTTP 在界面明确警告；公网必须由用户反代提供 HTTPS。

## 界面

### 入口

- 图标栏新增「网关」分区（`web/src/features/rail/rail-model.ts` 注册）。
- 设置 → 模型网关保留精简卡片：开关、地址、密钥、健康摘要、「打开网关」按钮。
- 现有 `GatewaySection.tsx` 的分组编辑能力迁移到新分区，旧入口不丢功能。

### 分区标签

1. **概览**：监听状态、回环 / 局域网地址、密钥数、账号健康分布、今日请求 / token / 费用、最近错误。
2. **账号**：统一列表，按家族筛选；每行显示名称、类型徽标、身份、健康、冷却倒计时、额度条、最后使用；操作：验证、刷新额度、启用 / 禁用、编辑、删除。顶部「添加账号」打开四种方式的向导。
3. **分组与路由**：现有故障转移组编辑器，成员选择器扩展为「供应商 / Claude 账号 / 账号池」；保留拖序、权重、固定模型、模型映射、1 小时缓存、测试按钮。
4. **密钥**：密钥组列表（路由组、模型白名单、LAN、IP 白名单、限速、预算）+ 密钥列表（前缀、组、最后使用、今日用量、启用、过期、删除、新建时一次性显示明文）。
5. **任务**：任务中心。任务类型：签到、保活、成长任务、猫咪旅行、抽奖、活跃度、额度刷新、账号验证。每行显示账号 / 池、计划、下次运行、上次结果、错误；操作：立即运行、暂停、编辑计划、查看历史。
6. **日志**：审计日志实时尾随，按密钥、账号、状态、协议过滤；支持导出；不显示正文。
7. **设置**：局域网监听（地址、端口、白名单、CORS、二次确认）、sidecar 版本与安装 / 升级 / 重启 / 打开日志、审计轮转、预算默认值、诊断信息（端口、版本、二进制哈希）。

### 添加账号向导

- **浏览器 OAuth**：生成 PKCE + state，打开系统浏览器；本机回环回调 `/oauth/<kind>/callback`；5 分钟超时；成功后自动探测并展示身份。
- **粘贴 / 文件**：文本框或文件选择；支持 JSON、cookie 字符串、`sk-ant-oat…`、WorkBuddy token；保存前逐条校验。
- **扫码批量**：两种形态——供应商支持交互式扫码登录时，向导显示二维码并轮询结果；否则上传二维码图片 / 粘贴批量文本，解析成多行，逐行显示状态。支持「全部导入」和「只导入通过的」。
- **桌面客户端凭据**：扫描已知路径，列出候选项（来源、掩码身份、过期时间），用户勾选后导入；不自动全选。

### 前端约定

- 组件放 `web/src/features/gateway/`：`GatewayPage.tsx`、`OverviewTab.tsx`、`AccountsTab.tsx`、`RoutesTab.tsx`、`KeysTab.tsx`、`TasksTab.tsx`、`LogsTab.tsx`、`GatewaySettingsTab.tsx`、`AddAccountWizard.tsx`、`AccountRow.tsx`、`QuotaBar.tsx`、`KeyEditor.tsx`、`TaskEditor.tsx`。
- 状态进 zustand，选择器返回稳定引用；新增 slice：`upstreams`、`gatewayKeys`、`gatewayTasks`、`gatewayLogs`。
- WS 事件：`upstreams.changed`、`gateway.key.changed`、`gateway.task.changed`、`gateway.log`（批量推送，最多 200 行/秒）。
- 对话框一律 `dlg.*`；菜单用 `useAnchoredMenu` / `Popover` / `useDropdown`。
- 界面状态（当前标签、筛选、折叠）存 `meta.json` 的 `settings.set`，不用 localStorage。
- 用户看得见的字全部 `tr('中文')`；新增 / 修改后跑 `node scripts/i18n/extract.mjs --check`；服务端文案加进 `server/src/i18n/en.ts`，前端加进 `web/src/i18n/en.ts`。
- 文案遵守术语表：叫「对话」不叫「会话」；不出现 档案 / 引擎 / 窗格 / 停靠 / effort / ultracode / ACP；空状态走 `terms.ts` 的 `EMPTY`。
- 停靠面板 / 分区页不卸载，只 `hidden`。

## Sidecar

### 清单与安装

`server/src/upstreams/sidecars.json`：

```json
{
  "gemini": {
    "version": "x.y.z",
    "entry": "gemini-web2api-go",
    "healthPath": "/healthz",
    "platforms": {
      "win32-x64": { "url": "…", "sha256": "…", "size": 0 },
      "darwin-arm64": { "url": "…", "sha256": "…", "size": 0 },
      "linux-x64": { "url": "…", "sha256": "…", "size": 0 }
    }
  }
}
```

- 安装到 `dataDir()/sidecars/<id>/<version>/`；下载到临时目录，校验 SHA256，原子 rename。
- 保留上一版用于回滚；升级失败恢复旧版并报错。
- 开发覆盖：`CW_SIDECAR_GEMINI_BIN`、`CW_SIDECAR_WORKBUDDY_BIN` 直接指向本地二进制，跳过下载与哈希。
- 平台没有二进制时，该家族显示「当前平台暂不支持」，其他功能不受影响。

### 启动与监督

- 端口：优先让 sidecar 监听 `127.0.0.1:0`；不支持时选空闲端口并重试。
- 管理 token：每次启动随机生成，存加密；通过环境变量传入，不放命令行（避免 Windows 进程列表泄露）。
- 配置文件写到 `dataDir()/sidecars/<id>/config.json`，权限 `0600`。
- spawn 显式 `windowsHide: true`。
- 健康检查：启动后 500ms 一次，稳定后 30s 一次；连续 3 次失败重启。
- 崩溃退避：1s、2s、4s、… 上限 60s；界面显示重启次数和最后错误。
- 日志：`dataDir()/logs/<id>.log`，按大小轮转；界面可打开目录和尾随。
- 关闭顺序：先停止任务调度，再停 sidecar，再关主服务器。

### 驱动接口

```ts
export interface SidecarDriver {
  readonly id: 'gemini' | 'workbuddy';
  health(): Promise<{ ok: boolean; version?: string; detail?: string }>;
  models(): Promise<string[]>;
  listAccounts(): Promise<SidecarAccount[]>;
  addAccount(input: SidecarAccountInput): Promise<SidecarAccount>;
  updateAccount(remoteId: string, patch: SidecarAccountPatch): Promise<SidecarAccount>;
  removeAccount(remoteId: string): Promise<void>;
  checkAccount(remoteId: string): Promise<SidecarAccount>;
  runTask(remoteId: string, task: MaintenanceKind): Promise<TaskResult>;
  logs?(lines: number): Promise<string>;
}
```

具体 HTTP 路径写在各 driver 里；上游改版只改 driver，不动 `SidecarManager`。

### Gemini（gemini-web2api-go）

- 作为 OpenAI 兼容成员：`/v1/chat/completions`、`/v1/responses`、`/v1/models`、`/v1/videos`、`/mcp`。
- 账号：cookie 池、自动续期、代理池由 sidecar 负责；claude-web 负责展示、启停、任务调度。
- 能力探测：不支持 tools 的模型在网关里标记 `no-tools`，翻译时降级并在响应头提示。
- 模型名统一加 `gemini-web/` 前缀避免与官方 Gemini API 冲突；也接受原名。

### WorkBuddy（workbuddy2api-panel）

- 作为 OpenAI 兼容成员：`/v1/chat/completions`、`/v1/models`。
- 账号：OAuth start / poll、token 刷新、桌面凭据导入由 driver 调用 panel API。
- 任务：签到、保活、成长任务、旅行、抽奖、活跃度。claude-web 的 `MaintenanceScheduler` 是调度真源；启动 sidecar 时传参关闭它内置的定时器；如果某个版本关不掉，用「账号 + 任务 + 日期」幂等键去重，并在界面提示。
- 额度：按信用点 / 剩余次数归一成 `QuotaSnapshot`。

### 任务中心

```ts
export type MaintenanceKind =
  | 'checkin' | 'keepalive' | 'growth' | 'travel' | 'lottery' | 'activity'
  | 'quota-refresh' | 'account-check';

export interface MaintenanceTask {
  id: string;
  kind: MaintenanceKind;
  target: { kind: 'account'; accountId: string } | { kind: 'group'; groupId: string };
  schedule: { cron?: string; everyMinutes?: number };
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  lastError?: string;
}

export interface MaintenanceRun {
  id: string;
  taskId: string;
  accountId?: string;
  at: number;
  ok: boolean;
  durationMs: number;
  result?: string;
  error?: string;
  idempotencyKey: string;
}
```

- 复用 `server/src/schedules/cron.ts` 的 cron 解析和 `catch-up.ts` 的补跑规则。
- 30 秒 tick；同一任务不并发；错过超过 7 天丢弃。
- 结果写 `maintenanceRuns`，保留最近 500 条；详细日志在 sidecar 日志里。
- 失败不自动删除账号，只标记并通知（复用现有通知渠道）。

## 安全

- **凭据**：全部 `enc:`；前端只见掩码；`reveal` 需要显式操作并写审计；导出 / 复制限时。
- **sidecar**：只绑回环；随机 admin token；配置文件 `0600`；二进制 SHA256；不自动更新。
- **局域网**：密钥 + `allowLan` + IP 白名单 + 限速；监听器不提供管理面；`0.0.0.0` 需要二次确认并显示警告。
- **日志**：白名单字段；错误信息截断 300 字符；Authorization / cookie / token 正则脱敏。
- **SSRF**：供应商 base URL 只允许 http/https；sidecar 地址固定回环；OAuth 回调只接受本机。
- **桌面凭据**：只读、逐条确认、不读内存、不读无关 keychain 条目；导入后不保留临时文件。
- **预算**：密钥组和账号双层护栏；超限 429；界面显示今日已用。
- **法律与条款**：首次接入某类订阅账号时显示一次性提示：可能违反供应商条款、可能导致账号受限；用户确认后继续。不隐藏、不代用户勾选。
- **最小权限**：管理接口只在本机主监听器；局域网监听器只有数据面。

## 测试

### 单元

- `upstreams/store.test.ts`：账号增删改、去重、迁移、健康快照、删除时清理分组。
- `upstreams/keys.test.ts`：密钥生成、哈希验证、前缀、过期、密钥组策略、IP CIDR（IPv4 / IPv6 / 非法输入）。
- `upstreams/routing.test.ts`：根路径按键解析、显式组、模型前缀、白名单 / 黑名单、歧义 400、别名精确 / 通配、`group/model` 前缀。
- `upstreams/affinity.test.ts`：会话键粘性、TTL 过期、失败解除、冷却跳过、重启清空。
- `upstreams/sidecar.test.ts`：清单校验、SHA256 失败、原子安装、回滚、端口重试、崩溃退避（假 spawn）。
- `upstreams/claude.test.ts`：OAuth 头、beta 头、IR 渲染、401 → expired、429 → cooling。
- `upstreams/tasks.test.ts`：cron / interval、幂等键、补跑、不并发、失败记录。
- `gateway/audit.test.ts`：脱敏、轮转、字段白名单。
- 扩展现有 `gateway/service.test.ts`、`failover.test.ts`、`convert.test.ts`：账号成员、池成员、LAN surface。

### 集成 / 端到端

- 假 sidecar：Node `http.Server` 实现 driver 的最小接口，验证添加账号、健康、额度、任务、重启。
- 假上游：现有测试里的 Anthropic / OpenAI / Gemini 形状服务器，验证四种入口 × 成员类型的直通与翻译。
- 密钥组：无密钥 401、错密钥 401、IP 不在白名单 403、超 RPM 429、超预算 429、模型不在白名单 400。
- LAN：绑定 `127.0.0.1` 的第二个端口，验证回环可访问、远程监听器仍 404、管理接口不可见。
- `scripts/gateway-e2e.mjs`：临时 `CLAUDE_WEB_DIR`，起服务器和假上游，走完上述主路径；加入 `scripts/e2e.mjs` 默认列表，不花 token。
- UI：`node scripts/ui-smoke.cjs` 打开网关分区，切换所有标签，添加假账号，任何 console 错误算失败。

### 回归

每次提交前：`npm run typecheck`、`npm test`、`npm run build:all`、`npm run e2e`、`node scripts/ui-smoke.cjs`。本机继承的 `CLAUDE_CODE_ENTRYPOINT`、`CLAUDE_WEB_DIST`、`ANTHROPIC_DEFAULT_*` 等变量用 `env -u` 掉。

### 真机验证

- 每类账号至少一个真实账号，验证：接入、探测、一次非流式、一次流式、一次工具调用（支持时）、一次故障转移、一次额度刷新、一次任务。
- 用临时 `CLAUDE_WEB_DIR` / HOME，不碰用户自己的 `~/.claude-web`。
- 记录每个 sidecar 的实际版本和哈希。

## 打包与发布

- sidecar 二进制不进 git。`electron-builder.yml` 的 `extraResources` 按平台放入 `vendor/sidecars/<platform>/`。
- CI 在构建前下载固定版本、校验 SHA256；哈希写进 `sidecars.json`，随应用发布。
- 源码运行 / `npm start`：设置页首次启用某家族时下载到 `dataDir()/sidecars/`；下载失败给出直链和手动放置说明。
- 平台矩阵以 sidecar 实际发布为准；缺失平台在界面上明确禁用，不静默回退。
- 升级 sidecar 需要新的应用版本或手动「检查更新」；校验失败不替换。
- Windows 代码签名沿用桌面版流程；sidecar 二进制如有签名问题在诊断页提示。

## 实施阶段

1. **阶段 A：基础**
   - `UpstreamService`、`AccountStore`、统一账号类型、Claude 账号入池。
   - `GatewayKeyGroup` / `GatewayKey`、哈希验证、IP 白名单、限速、预算。
   - 根路径路由、`GatewayListener`、局域网监听器、审计日志。
   - 网关分区骨架：概览、账号（仅 Claude）、密钥、日志。
   - 现有测试迁移与新增。
2. **阶段 B：Gemini**
   - `SidecarManager`、清单、安装、监督、日志。
   - `GeminiAdapter`、账号同步、健康 / 额度、keepalive 任务。
   - 账号向导的 OAuth / 粘贴 / 扫码 / 桌面导入。
3. **阶段 C：WorkBuddy**
   - `WorkBuddyAdapter`、账号同步。
   - 任务中心全部任务类型、运行历史、通知。
   - 额度护栏与诊断页。
4. **阶段 D：加固**
   - 打包与 CI、平台矩阵、文档、i18n 全量、UI smoke、真机验证。
   - 安全复查：日志脱敏、密钥生命周期、LAN 边界。
5. **阶段 E：heng1234 体验优化**（单独 spec）
   - 逐项对照后只保留确实缺的：对话 / 代码工作区分层、工具进度与文件改动摘要、Context Ledger、断线续跑与审批恢复、Git checkpoint 回滚、原生会话分叉、连接器密钥 `cwsecret://`、Agent Loop 预算、Chrome MV3 侧边栏、TOTP / 访问码、模型目录元数据。

## 仓库映射

| 仓库 | 许可证 | 在 claude-web 里的角色 |
| --- | --- | --- |
| [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api) | LGPL-3.0 | 只做设计参考：密钥组、额度护栏、账号调度、计费。不复制代码、不内嵌。 |
| [zexadev/gemini-web2api-go](https://github.com/zexadev/gemini-web2api-go) | MIT | Gemini 网页 sidecar 二进制。 |
| [ardeyouxipianyi/workbuddy2api-hub](https://github.com/ardeyouxipianyi/workbuddy2api-hub) | MIT | 任务定义、桌面凭据导入、OAuth 流程的参考；能力并入 WorkBuddy driver。 |
| [ithtelab/workbuddy-manager](https://github.com/ithtelab/workbuddy-manager) | MIT | 管理界面参考：扫码批量、密钥组、IP / 模型白名单、审计。 |
| [linguo2625469/workbuddy2api-panel](https://github.com/linguo2625469/workbuddy2api-panel) | MIT | WorkBuddy / CodeBuddy sidecar 二进制（自带 panel API）。 |
| [heng1234/claude-web](https://github.com/heng1234/claude-web) | Apache-2.0 | 体验优化 backlog，阶段 E 单独 spec；不复制其代码。 |

## 风险

- **Claude OAuth 直连可能被上游拒绝**：OAuth token 可能要求 Claude Code 的请求指纹。`ClaudeAdapter` 先走直连（OAuth beta 头 + Claude Code 系统前缀）；连续失败时提供「经本机 CLI / 引擎转发」的兜底模式。兜底模式按请求串行、延迟高、不适合并发，默认关闭，由用户在诊断页显式开启。
- **上游网页接口变更**：Gemini / WorkBuddy sidecar 随时可能失效。固定版本 + 明确错误 + 独立升级路径，避免影响主程序。
- **账号封禁 / 条款风险**：接入前一次性提示，提供账号级 kill switch；不承诺可用性。
- **二进制体积与杀软误报**：sidecar 按需下载；诊断页显示哈希和签名状态；不静默执行来源不明的二进制。
- **桌面凭据导入的敏感性**：只读、逐条确认、不读内存；导入日志只记来源类型，不记内容。
- **局域网误暴露**：默认关闭；`0.0.0.0` 二次确认；空 IP 白名单拒绝所有非回环；界面持续显示监听状态。
- **端口冲突 / Windows 防火墙**：随机端口 + 重试；首次启用局域网时提示防火墙放行。
- **日志增长**：按大小轮转 + 保留份数；审计默认开启但有上限。
- **费用失控**：密钥组与账号双层每日预算；超限 429；界面显示今日用量。

## 验收标准

- 四类上游（Claude 订阅、Gemini 网页、WorkBuddy、现有供应商）都能加入账号池并作为网关成员使用。
- 四种入口协议 × 支持的出口组合都能直通或翻译；不支持组合返回明确 400。
- 密钥组、IP 白名单、LAN 开关、限速、预算全部生效；远程访问监听器上网关仍 404。
- 账号健康、冷却、额度、过期状态在界面上准确展示；删除账号会清理所有引用。
- 同一会话键在 TTL 内命中同一账号；成员失败或冷却时能立即解除粘性并切换。
- 模型别名（精确 / 通配 / `group/model`）解析正确；`/v1/models` 反映同步后的模型列表。
- 任务中心的六类自动化任务能按时运行、补跑、记录结果，且不重复执行。
- 审计日志可过滤、可导出，且不含密钥、cookie、prompt 正文。
- `npm run typecheck`、`npm test`、`npm run build:all`、`npm run e2e`、`node scripts/ui-smoke.cjs` 全部通过。
- 打包产物在 Windows / macOS / Linux 至少各一个平台上能启动对应 sidecar；缺失平台有明确提示。
