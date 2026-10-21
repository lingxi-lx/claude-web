# Gemini 模型菜单 + 住宅出口 + 熔断（2026-10-20）

## 目标

1. 应用内模型菜单能选到 Gemini 池的模型（现在只能被外部客户端看到）。
2. 住宅 IP 出口：代理池 + 单账号覆盖 + **登录窗口也走同一出口**。
3. 熔断：展示现有账号/代理熔断、自动恢复、池级限流、异常告警；借鉴 CLIProxyAPI 的几处做法。

## 现状（已确认）

- 根因（菜单）：`web/src/features/models/menu.ts` 的 `gatewayModels()` 只读供应商档案和单账号成员，不读 sidecar 池模型；服务端 `gateway/service.ts:701` 的 `/v1/models` 已经会读 `upstreams.familyModels(kind)`，但 `GatewayStatus` 没带这份数据。
- 组件（gemini-web2api-go v4.22.0）已有：账号 401/403 连续 3 次自动停用；代理连续 5 次失败熔断，`proxy_cooldown_min` 后放回；账号↔出口绑定（`accounts.proxy_id`，用过的复用）；每出口限流（并发/RPM/RPH）；`fallback_direct` 默认 false；代理池 `/admin/api/proxies` CRUD；`--proxy` 只用于播种代理池。
- claude-web 已有：网关成员冷却/退避/401 停用；账号 `maxConcurrent`、`probe`、`health`；`AccountEditor` 的代理字段（对 Gemini sidecar 账号**不生效**，adapter 未传）。
- 缺口：Gemini 池的代理池 UI、账号绑定出口的 UI、登录走代理、熔断状态可视化、池级限流、自动恢复。

## 阶段 1：模型菜单（先做，独立可验收）

### 服务端
- `server/src/gateway/types.ts`：`GatewayStatus` 加 `poolModels: Record<string, string[]>`（key 为 `upstreamGroupId`）。
- `server/src/gateway/service.ts` `status()`：遍历各组 `upstreamGroupId` 成员，填 `deps.upstreams?.familyModels(pool.kind) ?? []`。
- `server/src/upstreams/service.ts`：`familyModels(kind)` 为空时异步触发一次 `rememberModels(kind)`（懒加载，避免 sidecar 先于应用启动时缓存为空）；填充后 emit 状态事件让前端刷新。

### 前端
- `web/src/features/models/menu.ts`：`BuildMenuInput` 加 `gatewayPoolModels?: Record<string, string[]>`；`gatewayModels()` 合并 `poolModels[m.upstreamGroupId]`（去重、排序）。
- `web/src/features/composer/Composer.tsx`：把 `useGatewayStatus()` 的 `poolModels` 传进 `buildModelMenu`。
- 测试：`menu.test.ts` 加「池成员模型进入菜单」；服务端 `gateway/service.test.ts` 加 status 用例。

## 阶段 2：住宅出口

### 2.1 代理池（以 sidecar 为真源）
- 新 `server/src/upstreams/proxies.ts`：封装 `/admin/api/proxies` 的 list / create / update / delete / reset / toggle；URL 用现有 `normalizeAccountProxy` 校验（http/https/socks4/5）。
- protocol：`upstreams.proxies.list|add|update|remove|reset|toggle`。
- 说明：代理 URL 由 sidecar 明文存在它自己的 SQLite 里（它需要明文才能用）；claude-web 不再复制一份，避免双写不一致。文档注明这一点。

### 2.2 账号绑定出口
- `server/src/upstreams/gemini.ts`：`SidecarAccountInput` / patch 增加 `proxyId?: number | null`；add 后 PATCH `proxy_id`；update 时改绑。
- `web/src/features/gateway/AccountEditor.tsx`：Gemini 账号显示「出口」下拉（自动 / 指定代理 / 不用代理），展示当前 `proxy_name`。
- 自动绑定继续由 sidecar 负责（`bindAccountProxy`），claude-web 只展示结果。

### 2.3 登录窗口走同一出口（关键）
Chrome 的 `--proxy-server` 不支持带认证的代理，所以：
- 新 `desktop/src/local-proxy.ts`：登录期间在本机起一个 HTTP 代理（`http.createServer` + `CONNECT`），把连接转发到选定出口；上游认证由本地转发完成。支持上游 http/https/socks（socks 用已有 `socks-proxy-agent` 的等价实现或 Node 原生隧道）。
- `desktop/src/gemini-login.ts`：
  - 登录窗口加 `--proxy-server=http://127.0.0.1:<本地端口>`；
  - 出口选择：账号已绑定出口 → 用它；否则由前端传入（默认「自动」= 池里第一个可用出口，池空则直连）；
  - 代理连不上：本地转发记录失败，登录结束时抛「出口连不上」而不是静默直连（防止真实 IP 泄露）；
  - 关闭窗口后一并关掉本地转发。
- headless 读取不访问网络（只读本地 profile），不需要走代理。
- IPC：`geminiLogin(partition, proxyUrl?)`；前端把选中的出口 URL 传过去。

### 2.4 UI
- `web/src/features/gateway/SidecarCard.tsx`（Gemini 卡片）加「出口」区：列表（名称/URL 掩码/失败次数/熔断状态/启用开关）、添加、删除、重置熔断。
- `AddAccountWizard.tsx` 登录模式显示「登录出口」下拉（自动 / 指定）。
- i18n：新增文案全部走 `tr()`，同步 `web/src/i18n/en.ts`、`desktop/src/en.ts`。

## 阶段 3：熔断

### 3.1 展示
- 账号行：失败次数、最近错误、自动停用标记、绑定出口名（数据来自 sidecar cookies 列表，adapter 已返回部分字段，补 `fail_count` / `proxy_id` / `proxy_name`）。
- 出口行：失败次数、熔断剩余时间、最近错误。

### 3.2 自动恢复
- 扩展已有维护任务 `account-check`：对 `health === 'expired'` 且**由自动停用**的账号做 probe；成功则重新启用。
- 区分自动/手动停用：claude-web 在 `upstreams` 侧记录「最后一次停用来源」（meta 里按 remoteId 记 `auto|manual`），只自动恢复 `auto`。
- 恢复开关：设置里可关（默认开）。

### 3.3 池级限流（借鉴 CPA）
- `UpstreamService` 增加池级 `RateLimiter`（key = 池 id），配置 `pool.maxConcurrent` / `pool.rpm`。
- 超出时先短等重试（250ms → 1s 退避，参考 CPA `busy-retry`），仍满则 429 + `retry-after`。
- 默认不启用（0 = 不限），避免影响现有行为。

### 3.4 告警
- 池内无健康账号 / 代理池为空且 `fallback_direct=false` / 连续失败超阈值 → 网关页横幅 + 状态事件；不弹系统通知。
- 复用现有 `x-cw-degraded` 头，前端在对话结果行标注「降级」。

### 3.5 CPA 里暂不抄的
- 凭证权重（sidecar 选号是 `ORDER BY fail_count`，权重需要改 sidecar，暂不做）。
- 冷却状态持久化（sidecar 重启清空；对 Gemini 影响有限，记入笔记即可）。
- 多轮跨成员重试（现有 failover 已覆盖主要场景，暂不加）。

## 测试与验证

- 单测：`menu.test.ts`（池模型）、`gateway/service.test.ts`（status）、`upstreams` 代理客户端与绑定、`local-proxy` 的 CONNECT/认证/清理、池级限流。
- 真机：本地起一个测试代理，验证登录窗口确实经它出网（看代理访问日志），关窗后清理；菜单里出现 Gemini 模型。
- 闸门：`npm run typecheck`、`npm test`、`npm run build:all`、`node scripts/i18n/extract.mjs --check`、`node scripts/ui-smoke.cjs`。
- 验证代理复核。

## 风险

- 登录走本地转发：上游不支持 CONNECT 时登录会失败（会明确报错，不静默直连）。
- sidecar admin API 随版本变化：调用集中在 `proxies.ts` / `gemini.ts`，便于适配。
- 自动恢复可能误判：只恢复 claude-web 记录为「自动停用」的账号，且可关。
- 代理池为明文存储于 sidecar DB：本机风险可接受，文档注明。
