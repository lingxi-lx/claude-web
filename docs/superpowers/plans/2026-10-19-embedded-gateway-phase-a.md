# 内嵌模型网关 · 阶段 A（基础）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有本机模型网关扩成「账号池 + 密钥组 + 根路径 + 局域网 + 审计」的基础设施：Claude 订阅账号能入池并被网关当成成员，密钥可分组、可限速、可限额、可限制来源 IP，`/v1/...` 直接可用，局域网监听器可单独开关，网关分区在界面上有完整骨架。

**Architecture:** 新增 `server/src/upstreams/` 管账号、账号池、Claude 凭据与网关目标解析；`server/src/gateway/` 保留协议转换与故障转移，成员引用从单一 `providerId` 扩成 `p:` / `a:` / `u:` 三种，账号成员强制走 IR 翻译（OAuth 头 + Claude Code 系统前缀），不再字节透传。密钥、IP 白名单、限速、预算在请求进入时统一裁决；局域网监听器只暴露数据面。前端新增「网关」分区页，替换设置里的旧网关卡片。

**Tech Stack:** TypeScript、node:http/https、vitest、React 19 + zustand、Electron 打包（本阶段不改打包）。

Spec: `docs/superpowers/specs/2026-10-19-embedded-gateway-design.md`。本计划只做「阶段 A」，B/C/D/E 另立计划。

## Global Constraints

- 用户看得见的字一律 `tr('中文')`；英文写进 `server/src/i18n/en.ts` / `web/src/i18n/en.ts`；改完跑 `node scripts/i18n/extract.mjs --check`。叫「对话」不叫「会话」；不出现 档案 / 引擎 / 窗格 / 停靠 / effort / ultracode / ACP。
- 凭据只以 `enc:` 形式落盘（`SecretService.protect`）；前端永远只收掩码；明文只允许在服务端内存、发给上游的请求头里出现。
- 网关管理面只在主监听器（回环）；局域网监听器只有 `/v1/...`、`/v1beta/...`、`/healthz`，其余一律 404。
- 审计日志只写白名单字段：`ts, keyId, ip, protocol, model, routeGroupId, member, status, ms, tokensIn, tokensOut, errorCode`。绝不写 prompt、响应正文、密钥、cookie、Authorization。
- 所有新增子进程（本阶段没有）如出现必须 `windowsHide: true`；本阶段不新增依赖。
- 测试命令：`npm run typecheck`、`npm test`、`npm run build:all`、`npm run e2e`、`node scripts/ui-smoke.cjs`。跑 `npm test` 前按 CLAUDE.md 用 `env -u` 去掉继承的 `CLAUDE_CODE_ENTRYPOINT`、`CLAUDE_WEB_DIST`、`ANTHROPIC_DEFAULT_*`、`CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION`、`CLAUDE_WEB_THINKING_DISPLAY`。
- 提交身份固定 `ypyik0669`；仓库是 LF。

---

## File Map

**新增（服务端）**

- `server/src/upstreams/types.ts` — 统一账号、账号池、请求 / 状态类型（经 `protocol.ts` 共享给 web）。
- `server/src/upstreams/store.ts` — `AccountStore`：加密、去重、增删改、级联清理。
- `server/src/upstreams/claude.ts` — `ClaudeAdapter`：凭据解析、探测、OAuth 刷新、Claude Code 系统前缀。
- `server/src/upstreams/service.ts` — `UpstreamService`：账号池、策略排序、`GatewayTarget` 解析、每日计数。
- `server/src/upstreams/affinity.ts` — 会话粘性表（内存，TTL）。
- `server/src/upstreams/handlers.ts` — `upstreams.*` 请求分发。
- `server/src/upstreams/keys.ts` — `GatewayKeyStore`：密钥生成 / 哈希 / 校验 / 迁移 / 用量。
- `server/src/upstreams/routing.ts` — IP 白名单、模型 glob、根路径选组。
- `server/src/upstreams/ratelimit.ts` — 每密钥 RPM / 并发令牌桶。
- `server/src/gateway/listener.ts` — `GatewayListener`：独立局域网 `http.Server`。
- `server/src/gateway/audit.ts` — `AuditLog`：JSONL、轮转、批量事件。

**修改（服务端）**

- `server/src/protocol.ts` — 导出 `upstreams/types`，`ClientRequest` 加 `UpstreamRequest`。
- `server/src/meta/store.ts` — `Data` 加账号、账号池、密钥组、密钥、LAN、审计；保存方法。
- `server/src/gateway/types.ts` — `GatewayMember` 三选一、`GatewayTarget`、密钥 / LAN / 审计类型、请求与事件。
- `server/src/gateway/failover.ts` — `memberKey()`，状态表按 `p:` / `a:` / `u:` 记。
- `server/src/gateway/service.ts` — 成员解析、账号强制翻译、根路径、密钥鉴权、限速 / 预算、LAN、审计。
- `server/src/gateway/anthropic.ts` — `systemPrefix`。
- `server/src/gateway/upstream.ts` — `translatedHeaders` 支持 OAuth 头。
- `server/src/ws/hub.ts` — `Services.upstreams`、事件广播、请求分发。
- `server/src/index.ts` — 构造 / 关闭 `UpstreamService`、`GatewayService` 依赖、LAN 启停。

**新增（前端）**

- `web/src/features/gateway/page.ts` + `page.test.ts` — 标签表、标题。
- `web/src/features/gateway/state.ts` — 页面开合 + 数据 store（账号、池、密钥、LAN、日志）。
- `web/src/features/gateway/GatewayPage.tsx`、`GatewaySide.tsx`。
- `web/src/features/gateway/OverviewTab.tsx`、`AccountsTab.tsx`、`AccountRow.tsx`、`QuotaBar.tsx`、`AddAccountWizard.tsx`、`RoutesTab.tsx`、`KeysTab.tsx`、`KeyEditor.tsx`、`LogsTab.tsx`、`GatewaySettingsTab.tsx`。
- `web/src/styles/gateway.css`。

**修改（前端）**

- `web/src/features/sections/pages.ts` — `Section` 加 `'gateway'`。
- `web/src/features/sections/index.ts` — 引入网关 state（注册页面）。
- `web/src/features/rail/rail-model.ts`、`Rail.tsx` — 图标栏入口。
- `web/src/features/workbench/Workbench.tsx` — 挂载 `GatewayPage`。
- `web/src/app/App.tsx` — 侧栏分区。
- `web/src/ui/icon-map.json` + `web/src/ui/icons.generated.ts` — `gateway` 图标。
- `web/src/features/settings/GatewaySection.tsx` — 瘦成一张卡片。
- `web/src/main.tsx` — 引入 `styles/gateway.css`。
- `scripts/ui-smoke.cjs` — 图标栏期望加 `gateway`，并打开网关分区检查无 console 错误。

**测试 / 端到端**

- `server/src/upstreams/store.test.ts`、`claude.test.ts`、`service.test.ts`、`affinity.test.ts`、`keys.test.ts`、`routing.test.ts`。
- `server/src/gateway/audit.test.ts`；扩展 `gateway/service.test.ts`、`gateway/failover.test.ts`。
- `server/ws-phase30.mjs`；`scripts/e2e.mjs` 默认 phase 列表加 `'30'`。

---

## Task 1: 协议与 meta.json 存储

**Files:**
- Create: `server/src/upstreams/types.ts`
- Modify: `server/src/protocol.ts:685`, `server/src/protocol.ts:786`
- Modify: `server/src/meta/store.ts:1-42`, `server/src/meta/store.ts:258-262`
- Test: `server/src/upstreams/store.test.ts`（本任务只测 meta 读写，下一任务扩展）

**Interfaces:**
- Consumes: `MetaStore`、`SecretService`。
- Produces: `UpstreamKind`、`UpstreamAccount`、`UpstreamAccountInput`、`UpstreamAccountPatch`、`UpstreamAccountView`、`UpstreamGroup`、`UpstreamStatus`、`UpstreamRequest`；`MetaStore.upstreamAccounts()`、`upstreamGroups()`、`gatewayKeyGroups()`、`gatewayKeys()`、`gatewayLan()`、`gatewayAudit()`、`saveUpstreams()`、`saveGatewayKeys()`。

- [ ] **Step 1: 写失败测试**

```ts
// server/src/upstreams/store.test.ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaStore } from '../meta/store.js';

describe('meta store: upstreams', () => {
  it('persists accounts and groups across a reload', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-up-'));
    const file = path.join(dir, 'meta.json');
    const a = new MetaStore(file);
    await a.load();
    a.upstreamAccounts().push({
      id: 'acct_1', kind: 'claude', name: 'Claude 1', enabled: true,
      credential: 'enc:plain:e30=', credentialKind: 'setup-token', source: 'paste',
      createdAt: 1, updatedAt: 1, health: 'unknown',
    });
    a.upstreamGroups().push({ id: 'pool', kind: 'claude', name: 'Pool', strategy: 'failover', members: ['acct_1'], enabled: true, createdAt: 1 });
    await a.saveUpstreams();
    const b = new MetaStore(file);
    await b.load();
    expect(b.upstreamAccounts().map((x) => x.id)).toEqual(['acct_1']);
    expect(b.upstreamGroups()[0].members).toEqual(['acct_1']);
  });

  it('gives LAN and audit config safe defaults without writing them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-up-'));
    const m = new MetaStore(path.join(dir, 'meta.json'));
    expect(m.gatewayLan()).toMatchObject({ enabled: false, bind: '127.0.0.1', port: 0, ipAllowlist: [] });
    expect(m.gatewayAudit()).toMatchObject({ enabled: true, maxBytes: 10 * 1024 * 1024, keepFiles: 5 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/upstreams/store.test.ts`
Expected: FAIL — `meta.upstreamAccounts is not a function`.

- [ ] **Step 3: 写类型文件**

```ts
// server/src/upstreams/types.ts
export type UpstreamKind = 'claude' | 'gemini' | 'workbuddy';

export interface QuotaWindow {
  id: string;
  label: string;
  used?: number;
  limit?: number;
  usedPct?: number;
  resetAt?: number;
}

export interface QuotaSnapshot {
  checkedAt: number;
  windows: QuotaWindow[];
  credits?: { remaining?: number; total?: number; unit?: string };
  note?: string;
}

export interface UpstreamAccount {
  id: string;
  kind: UpstreamKind;
  name: string;
  enabled: boolean;
  credential: string; // enc:…
  credentialKind: 'oauth' | 'setup-token' | 'cookie' | 'token' | 'password';
  /** sha256(kind + '\0' + normalized credential): dedupe without decrypting everything */
  fingerprint?: string;
  proxy?: string; // enc:…
  maxConcurrent?: number;
  dailyRequestLimit?: number;
  identity?: { email?: string; plan?: string; org?: string; expiresAt?: number };
  source: 'oauth' | 'paste' | 'file' | 'qr' | 'desktop';
  createdAt: number;
  updatedAt: number;
  health: 'unknown' | 'ok' | 'cooling' | 'expired' | 'disabled' | 'error';
  cooldownUntil?: number;
  lastOkAt?: number;
  lastUsedAt?: number;
  lastError?: string;
  quota?: QuotaSnapshot;
  sidecar?: { id: 'gemini' | 'workbuddy'; remoteId: string; syncedAt: number };
  /** today's counters (local midnight), for dailyRequestLimit */
  stats?: { day: string; requests: number; tokensIn: number; tokensOut: number };
}

export interface UpstreamAccountInput {
  kind: UpstreamKind;
  name?: string;
  credential: unknown;
  credentialKind?: UpstreamAccount['credentialKind'];
  source?: UpstreamAccount['source'];
  proxy?: string;
  maxConcurrent?: number;
  dailyRequestLimit?: number;
  identity?: UpstreamAccount['identity'];
  probe?: boolean;
}

export interface UpstreamAccountPatch {
  name?: string;
  enabled?: boolean;
  credential?: unknown;
  credentialKind?: UpstreamAccount['credentialKind'];
  proxy?: string | null;
  maxConcurrent?: number | null;
  dailyRequestLimit?: number | null;
  identity?: UpstreamAccount['identity'];
}

export type UpstreamAccountView = Omit<UpstreamAccount, 'credential' | 'proxy' | 'fingerprint'> & {
  credentialMasked: string;
  hasProxy: boolean;
};

export interface UpstreamGroup {
  id: string;
  kind: UpstreamKind;
  name: string;
  strategy: 'failover' | 'round-robin' | 'least-used' | 'most-quota';
  members: string[];
  modelMap?: Record<string, string>;
  affinity?: { mode: 'none' | 'session'; ttlMinutes: number };
  enabled: boolean;
  createdAt: number;
}

export interface UpstreamStatus {
  accounts: UpstreamAccountView[];
  groups: UpstreamGroup[];
  /** one line per family: can it be used yet (Claude now; Gemini / WorkBuddy need a sidecar) */
  families: { kind: UpstreamKind; ready: boolean; detail?: string }[];
}

export type UpstreamRequest =
  | { kind: 'upstreams.status' }
  | { kind: 'upstreams.add'; input: UpstreamAccountInput }
  | { kind: 'upstreams.update'; id: string; patch: UpstreamAccountPatch }
  | { kind: 'upstreams.remove'; id: string }
  | { kind: 'upstreams.probe'; id: string }
  | { kind: 'upstreams.reset'; id: string }
  | { kind: 'upstreams.groups.upsert'; group: Partial<UpstreamGroup> & { id?: string } }
  | { kind: 'upstreams.groups.remove'; id: string };
```

- [ ] **Step 4: 网关共享类型（成员三选一、目标、密钥、LAN、审计）**

`server/src/gateway/types.ts` 顶部加 `import type { Provider } from '../protocol.js';`，并把成员类型改成：

```ts
export interface GatewayMember {
  providerId?: string;
  accountId?: string;
  upstreamGroupId?: string;
  model?: string;
  weight?: number;
}

export const memberKey = (m: GatewayMember): string =>
  m.accountId ? `a:${m.accountId}` : m.upstreamGroupId ? `u:${m.upstreamGroupId}` : `p:${m.providerId ?? ''}`;

export type GatewayTarget = Provider & {
  /** a Claude subscription login: Bearer + anthropic-beta, never x-api-key */
  auth?: 'oauth';
  /** account members always go through the IR renderers (the login needs Claude Code's request shape) */
  forceTranslate?: boolean;
  /** a pool's modelMap result; wins over the group's mapping */
  model?: string;
};

export interface GatewayKeyGroup {
  id: string;
  name: string;
  /** empty = every route group (the migrated default key group) */
  routeGroupIds: string[];
  modelAllowlist?: string[];
  modelDeny?: string[];
  allowLan: boolean;
  ipAllowlist: string[];
  rateLimit?: { rpm?: number; concurrent?: number; dailyTokens?: number; dailyCostUsd?: number };
  createdAt: number;
}

export interface GatewayKey {
  id: string;
  name: string;
  keyGroupId: string;
  prefix: string;
  hash: string;
  salt: string;
  /** enc:…; only the migrated legacy key keeps it, for 「显示密钥」 */
  secret?: string;
  enabled: boolean;
  expiresAt?: number;
  createdAt: number;
  lastUsedAt?: number;
  stats: { requests: number; tokensIn: number; tokensOut: number; costUsd: number; day: string };
}

export type GatewayKeyView = Omit<GatewayKey, 'hash' | 'salt' | 'secret'>;

export interface GatewayLanConfig {
  enabled: boolean;
  bind: string;
  port: number;
  ipAllowlist: string[];
  corsOrigins: string[];
  maxBodyBytes: number;
}

export interface GatewayAuditConfig {
  enabled: boolean;
  maxBytes: number;
  keepFiles: number;
}

export interface GatewayAuditLine {
  ts: number;
  keyId: string;
  ip: string;
  protocol: GatewayProtocol;
  model: string;
  routeGroupId: string;
  member: string;
  status: number;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  errorCode: string;
}

export interface GatewayKeyStatus { groups: GatewayKeyGroup[]; keys: GatewayKeyView[]; defaultKeyId: string }
export interface GatewayLanStatus extends GatewayLanConfig { running: boolean; port: number; addresses: string[]; audit: GatewayAuditConfig }
```

`GatewayMemberState` 加 `key: string`（`p:` / `a:` / `u:`），保留 `providerId` 作为 ref 里的 id（显示和旧测试用）。

- [ ] **Step 5: 接到协议与 meta**

`server/src/protocol.ts` 顶部加：

```ts
export * from './upstreams/types.js';
```

`ClientRequest` 联合里（`| GatewayRequest` 前一行）加：

```ts
  | UpstreamRequest
```

文件末尾的 import 加：

```ts
import type { UpstreamRequest } from './upstreams/types.js';
```

`server/src/meta/store.ts`：

```ts
import type { UpstreamAccount, UpstreamGroup } from '../upstreams/types.js';
import type { GatewayAuditConfig, GatewayKey, GatewayKeyGroup, GatewayLanConfig } from '../gateway/types.js';
```

`Data` 接口加：

```ts
  upstreamAccounts?: UpstreamAccount[];
  upstreamGroups?: UpstreamGroup[];
  gatewayKeyGroups?: GatewayKeyGroup[];
  gatewayKeys?: GatewayKey[];
  gatewayLan?: GatewayLanConfig;
  gatewayAudit?: GatewayAuditConfig;
```

类里加：

```ts
  upstreamAccounts(): UpstreamAccount[] { return this.data.upstreamAccounts ??= []; }
  upstreamGroups(): UpstreamGroup[] { return this.data.upstreamGroups ??= []; }
  gatewayKeyGroups(): GatewayKeyGroup[] { return this.data.gatewayKeyGroups ??= []; }
  gatewayKeys(): GatewayKey[] { return this.data.gatewayKeys ??= []; }
  gatewayLan(): GatewayLanConfig {
    return this.data.gatewayLan ??= { enabled: false, bind: '127.0.0.1', port: 0, ipAllowlist: [], corsOrigins: [], maxBodyBytes: 8 * 1024 * 1024 };
  }
  gatewayAudit(): GatewayAuditConfig {
    return this.data.gatewayAudit ??= { enabled: true, maxBytes: 10 * 1024 * 1024, keepFiles: 5 };
  }
  async saveUpstreams() { await this.queueSave(true); }
  async saveGatewayKeys() { await this.queueSave(true); }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd server && npx vitest run src/upstreams/store.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 7: 提交**

```bash
git add server/src/upstreams/types.ts server/src/gateway/types.ts server/src/protocol.ts server/src/meta/store.ts server/src/upstreams/store.test.ts
git commit -m "feat(gateway): upstream account and key storage types"
```

---

## Task 2: AccountStore（加密、去重、级联删除）

**Files:**
- Create: `server/src/upstreams/store.ts`
- Test: `server/src/upstreams/store.test.ts`（追加）

**Interfaces:**
- Consumes: `MetaStore`、`SecretService`、`UpstreamAccount*`。
- Produces:
  - `normalizeCredential(kind, input, kindHint?) => { credentialKind, credential, fingerprint }`（`credential` 是 JSON 字符串）
  - `class AccountStore { list(); get(id); revealCredential(a); revealProxy(a); add(input); update(id, patch); remove(id); setHealth(id, patch) }`

- [ ] **Step 1: 追加失败测试**

```ts
import { SecretService } from '../secrets/service.js';
import { AccountStore, normalizeCredential } from './store.js';

describe('AccountStore', () => {
  const make = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-acct-'));
    const meta = new MetaStore(path.join(dir, 'meta.json'));
    await meta.load();
    return { meta, store: new AccountStore(meta, new SecretService()) };
  };

  it('normalizes a setup token and never stores it in plaintext', async () => {
    const { meta, store } = await make();
    const { account } = await store.add({ kind: 'claude', name: 'A', credential: 'sk-ant-oat01-abc' });
    expect(account.credentialKind).toBe('setup-token');
    expect(account.credential.startsWith('enc:')).toBe(true);
    expect(JSON.stringify(meta.data)).not.toContain('sk-ant-oat01-abc');
    expect(await store.revealCredential(account)).toBe(JSON.stringify({ kind: 'setup-token', token: 'sk-ant-oat01-abc' }));
  });

  it('dedupes the same credential of the same kind', async () => {
    const { store } = await make();
    const a = await store.add({ kind: 'claude', credential: 'sk-ant-oat01-abc' });
    const b = await store.add({ kind: 'claude', credential: 'sk-ant-oat01-abc' });
    expect(b.duplicate).toBe(true);
    expect(b.account.id).toBe(a.account.id);
    expect(store.list()).toHaveLength(1);
  });

  it('removes the account from every upstream group and gateway group', async () => {
    const { meta, store } = await make();
    const { account } = await store.add({ kind: 'claude', credential: 'sk-ant-oat01-abc' });
    meta.upstreamGroups().push({ id: 'pool', kind: 'claude', name: 'Pool', strategy: 'failover', members: [account.id], enabled: true, createdAt: 1 });
    meta.gatewayGroups().push({ id: 'main', name: 'Main', strategy: 'failover', members: [{ accountId: account.id }] });
    await store.remove(account.id);
    expect(meta.upstreamGroups()[0].members).toEqual([]);
    expect(meta.gatewayGroups()[0].members).toEqual([]);
  });

  it('parses an OAuth JSON envelope', () => {
    const n = normalizeCredential('claude', { accessToken: 'at', refreshToken: 'rt', expiresAt: 123 });
    expect(n.credentialKind).toBe('oauth');
    expect(JSON.parse(n.credential)).toMatchObject({ kind: 'oauth', accessToken: 'at', refreshToken: 'rt', expiresAt: 123 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/upstreams/store.test.ts`
Expected: FAIL — `AccountStore` / `normalizeCredential` not exported.

- [ ] **Step 3: 实现**

```ts
// server/src/upstreams/store.ts
import crypto from 'node:crypto';
import type { MetaStore } from '../meta/store.js';
import type { SecretService } from '../secrets/service.js';
import type { UpstreamAccount, UpstreamAccountInput, UpstreamAccountPatch, UpstreamKind } from './types.js';
import { tr } from '../i18n/index.js';

export interface NormalizedCredential {
  credentialKind: UpstreamAccount['credentialKind'];
  credential: string; // JSON
  fingerprint: string;
}

const fp = (kind: UpstreamKind, credential: string) =>
  crypto.createHash('sha256').update(`${kind}\0${credential}`).digest('hex');

const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};

export function normalizeCredential(kind: UpstreamKind, input: unknown, hint?: UpstreamAccount['credentialKind']): NormalizedCredential {
  const text = typeof input === 'string' ? input.trim() : '';
  if (kind === 'claude') {
    if (text.startsWith('sk-ant-oat')) {
      const credential = JSON.stringify({ kind: 'setup-token', token: text });
      return { credentialKind: 'setup-token', credential, fingerprint: fp(kind, credential) };
    }
    let j: Record<string, any> = {};
    if (text) { try { j = obj(JSON.parse(text)); } catch { j = {}; } }
    else j = obj(input);
    const oauth = obj(j.claudeAiOauth ?? j);
    const accessToken = oauth.accessToken ?? oauth.access_token;
    if (accessToken) {
      const credential = JSON.stringify({
        kind: 'oauth',
        accessToken,
        refreshToken: oauth.refreshToken ?? oauth.refresh_token,
        expiresAt: oauth.expiresAt ?? oauth.expires_at,
        scope: oauth.scope,
      });
      return { credentialKind: 'oauth', credential, fingerprint: fp(kind, credential) };
    }
    const token = j.token ?? j.tokenValue;
    if (typeof token === 'string' && token.trim()) {
      const credential = JSON.stringify({ kind: 'setup-token', token: token.trim() });
      return { credentialKind: 'setup-token', credential, fingerprint: fp(kind, credential) };
    }
    throw new Error(tr('无法识别的 Claude 凭据：需要 sk-ant-oat… 令牌或包含 accessToken 的 JSON'));
  }
  if (kind === 'gemini') {
    const cookies = text || String(obj(input).cookie ?? '');
    if (!cookies) throw new Error(tr('Gemini 凭据需要 cookie'));
    const credential = JSON.stringify({ kind: 'cookie', cookies: [{ name: 'cookie', value: cookies }], userAgent: obj(input).userAgent });
    return { credentialKind: 'cookie', credential, fingerprint: fp(kind, credential) };
  }
  const token = text || String(obj(input).token ?? obj(input).password ?? '');
  if (!token) throw new Error(tr('WorkBuddy 凭据需要令牌或密码'));
  const credentialKind = obj(input).password ? 'password' : 'token';
  const credential = JSON.stringify({ kind: credentialKind, ...(credentialKind === 'password' ? { username: obj(input).username, password: obj(input).password } : { token }) });
  return { credentialKind: hint ?? credentialKind, credential, fingerprint: fp(kind, credential) };
}

export class AccountStore {
  constructor(private meta: MetaStore, private secrets: SecretService) {}

  list(): UpstreamAccount[] { return this.meta.upstreamAccounts(); }
  get(id: string): UpstreamAccount | undefined { return this.list().find((a) => a.id === id); }
  async revealCredential(a: UpstreamAccount): Promise<string> { return this.secrets.reveal(a.credential); }
  async revealProxy(a: UpstreamAccount): Promise<string | undefined> { return a.proxy ? this.secrets.reveal(a.proxy) : undefined; }

  async add(input: UpstreamAccountInput): Promise<{ account: UpstreamAccount; duplicate: boolean }> {
    const n = normalizeCredential(input.kind, input.credential, input.credentialKind);
    const dup = this.list().find((a) => a.kind === input.kind && a.fingerprint === n.fingerprint);
    if (dup) return { account: dup, duplicate: true };
    const id = `acct_${crypto.randomBytes(5).toString('hex')}`;
    const now = Date.now();
    const account: UpstreamAccount = {
      id,
      kind: input.kind,
      name: input.name?.trim() || `${input.kind} ${this.list().filter((a) => a.kind === input.kind).length + 1}`,
      enabled: true,
      credential: await this.secrets.protect(n.credential, id),
      credentialKind: n.credentialKind,
      fingerprint: n.fingerprint,
      source: input.source ?? 'paste',
      createdAt: now,
      updatedAt: now,
      health: 'unknown',
      ...(input.maxConcurrent ? { maxConcurrent: input.maxConcurrent } : {}),
      ...(input.dailyRequestLimit ? { dailyRequestLimit: input.dailyRequestLimit } : {}),
      ...(input.identity ? { identity: input.identity } : {}),
    };
    if (input.proxy) account.proxy = await this.secrets.protect(input.proxy, `${id}:proxy`);
    this.list().push(account);
    await this.meta.saveUpstreams();
    return { account, duplicate: false };
  }

  async update(id: string, patch: UpstreamAccountPatch): Promise<UpstreamAccount> {
    const a = this.get(id);
    if (!a) throw new Error(tr('没有这个账号'));
    if (patch.name !== undefined) a.name = patch.name.trim() || a.name;
    if (patch.enabled !== undefined) { a.enabled = patch.enabled; if (!patch.enabled) a.health = 'disabled'; else if (a.health === 'disabled') a.health = 'unknown'; }
    if (patch.credential !== undefined) {
      const n = normalizeCredential(a.kind, patch.credential, patch.credentialKind);
      a.credential = await this.secrets.protect(n.credential, id);
      a.credentialKind = n.credentialKind;
      a.fingerprint = n.fingerprint;
      a.health = 'unknown';
      delete a.lastError;
    }
    if (patch.proxy !== undefined) {
      if (patch.proxy === null || patch.proxy === '') delete a.proxy;
      else a.proxy = await this.secrets.protect(patch.proxy, `${id}:proxy`);
    }
    if (patch.maxConcurrent !== undefined) { if (patch.maxConcurrent === null) delete a.maxConcurrent; else a.maxConcurrent = patch.maxConcurrent; }
    if (patch.dailyRequestLimit !== undefined) { if (patch.dailyRequestLimit === null) delete a.dailyRequestLimit; else a.dailyRequestLimit = patch.dailyRequestLimit; }
    if (patch.identity !== undefined) a.identity = patch.identity;
    a.updatedAt = Date.now();
    await this.meta.saveUpstreams();
    return a;
  }

  async remove(id: string): Promise<void> {
    this.meta.data.upstreamAccounts = this.list().filter((a) => a.id !== id);
    for (const g of this.meta.upstreamGroups()) g.members = g.members.filter((x) => x !== id);
    for (const g of this.meta.gatewayGroups()) g.members = g.members.filter((m) => m.accountId !== id);
    await this.meta.saveUpstreams();
  }

  async setHealth(id: string, patch: Partial<Pick<UpstreamAccount, 'health' | 'cooldownUntil' | 'lastOkAt' | 'lastUsedAt' | 'lastError' | 'quota' | 'identity'>>): Promise<void> {
    const a = this.get(id);
    if (!a) return;
    Object.assign(a, patch);
    a.updatedAt = Date.now();
    await this.meta.saveUpstreams();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/upstreams/store.test.ts`
Expected: PASS（6 tests）。

- [ ] **Step 5: 提交**

```bash
git add server/src/upstreams/store.ts server/src/upstreams/store.test.ts
git commit -m "feat(gateway): account store with encrypted credentials and dedupe"
```

---

## Task 3: ClaudeAdapter（解析、探测、刷新、系统前缀）

**Files:**
- Create: `server/src/upstreams/claude.ts`
- Test: `server/src/upstreams/claude.test.ts`

**Interfaces:**
- Consumes: `UpstreamAccount`、`QuotaSnapshot`、`normalizeCredential`。
- Produces:
  - `CLAUDE_CODE_SYSTEM_PREFIX`、`OAUTH_BETA`、`CLAUDE_OAUTH_CLIENT_ID`
  - `class ClaudeAdapter { constructor(opts?: { baseUrl?; tokenUrl?; fetch?; now? }); probe(a, credential); refresh(a, credential) }`
  - `probe` 返回 `{ health, identity?, quota?, error?, cooldownUntil? }`。

- [ ] **Step 1: 写失败测试**

```ts
// server/src/upstreams/claude.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { ClaudeAdapter } from './claude.js';

let srv: http.Server | null = null;
async function fake(handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void) {
  srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => handler(req, res, b)); });
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(srv!.address() as any).port}`;
}
afterEach(async () => { if (srv) { srv.closeAllConnections(); await new Promise<void>((r) => srv!.close(() => r())); srv = null; } });

describe('ClaudeAdapter', () => {
  it('probes with a Bearer token and the oauth beta, and reads quota headers', async () => {
    const base = await fake((req, res) => {
      expect(req.headers.authorization).toBe('Bearer at-1');
      expect(req.headers['anthropic-beta']).toBe('oauth-2025-04-20');
      res.writeHead(200, {
        'content-type': 'application/json',
        'anthropic-ratelimit-requests-limit': '100',
        'anthropic-ratelimit-requests-remaining': '80',
        'anthropic-ratelimit-requests-reset': new Date(Date.now() + 60_000).toISOString(),
      }).end(JSON.stringify({ id: 'msg_1', type: 'message', content: [] }));
    });
    const a = new ClaudeAdapter({ baseUrl: base });
    const r = await a.probe({ id: 'acct_1' } as any, JSON.stringify({ kind: 'oauth', accessToken: 'at-1' }));
    expect(r.health).toBe('ok');
    expect(r.quota?.windows[0]).toMatchObject({ id: 'requests', used: 20, limit: 100 });
  });

  it('maps 401 to expired and 429 to cooling', async () => {
    let status = 401;
    const base = await fake((_q, res) => res.writeHead(status, { 'content-type': 'application/json', ...(status === 429 ? { 'retry-after': '120' } : {}) }).end('{}'));
    const a = new ClaudeAdapter({ baseUrl: base });
    const cred = JSON.stringify({ kind: 'setup-token', token: 'sk-ant-oat01-x' });
    expect((await a.probe({ id: 'a' } as any, cred)).health).toBe('expired');
    status = 429;
    const cooling = await a.probe({ id: 'a' } as any, cred);
    expect(cooling.health).toBe('cooling');
    expect(cooling.cooldownUntil).toBeGreaterThan(Date.now() + 100_000);
  });

  it('refreshes an oauth token', async () => {
    const tokenUrl = await fake((req, res, body) => {
      expect(JSON.parse(body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 }));
    });
    const a = new ClaudeAdapter({ tokenUrl });
    const out = await a.refresh({ id: 'a' } as any, JSON.stringify({ kind: 'oauth', accessToken: 'at-1', refreshToken: 'rt-1' }));
    expect(JSON.parse(out!.credential)).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/upstreams/claude.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: 实现**

```ts
// server/src/upstreams/claude.ts
import type { QuotaSnapshot, UpstreamAccount } from './types.js';
import { tr } from '../i18n/index.js';

export const OAUTH_BETA = 'oauth-2025-04-20';
export const CLAUDE_CODE_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI tool for Claude.";
export const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export interface ClaudeProbe {
  health: UpstreamAccount['health'];
  identity?: UpstreamAccount['identity'];
  quota?: QuotaSnapshot;
  error?: string;
  cooldownUntil?: number;
}

interface OauthCredential { kind: 'oauth'; accessToken: string; refreshToken?: string; expiresAt?: number; scope?: string }
interface TokenCredential { kind: 'setup-token'; token: string }
type Credential = OauthCredential | TokenCredential;

const parse = (credential: string): Credential => {
  const j = JSON.parse(credential);
  return j.kind === 'oauth' ? j : { kind: 'setup-token', token: j.token };
};

export class ClaudeAdapter {
  private baseUrl: string;
  private tokenUrl: string;
  private doFetch: typeof fetch;
  private now: () => number;

  constructor(opts: { baseUrl?: string; tokenUrl?: string; fetch?: typeof fetch; now?: () => number } = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    this.tokenUrl = opts.tokenUrl ?? 'https://console.anthropic.com/v1/oauth/token';
    this.doFetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  async probe(a: UpstreamAccount, credential: string): Promise<ClaudeProbe> {
    const c = parse(credential);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
    // both a `setup-token` (sk-ant-oat…) and an OAuth access token are Claude Code logins: Bearer + the oauth beta
    headers.authorization = `Bearer ${c.kind === 'oauth' ? c.accessToken : c.token}`;
    headers['anthropic-beta'] = OAUTH_BETA;
    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e: any) {
      return { health: 'error', error: tr('探测失败：{message}', { message: e?.message ?? String(e) }) };
    }
    if (res.ok) {
      const quota = quotaFromHeaders(res.headers, this.now());
      return { health: 'ok', quota, ...(quota.note ? {} : {}) };
    }
    const text = await res.text().catch(() => '');
    const error = `HTTP ${res.status} ${text.slice(0, 200)}`.trim();
    if (res.status === 401 || res.status === 403) return { health: 'expired', error };
    if (res.status === 429 || res.status === 402) {
      const retry = Number(res.headers.get('retry-after') ?? '');
      return { health: 'cooling', error, cooldownUntil: this.now() + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : 60_000) };
    }
    // some endpoints have no /v1/messages but do have /v1/models
    if (res.status === 404 || res.status === 405) {
      try {
        const m = await this.doFetch(`${this.baseUrl}/v1/models`, { headers });
        if (m.ok) return { health: 'ok' };
      } catch { /* fall through */ }
    }
    return { health: 'error', error };
  }

  async refresh(a: UpstreamAccount, credential: string): Promise<{ credential: string; expiresAt?: number } | null> {
    const c = parse(credential);
    if (c.kind !== 'oauth' || !c.refreshToken) return null;
    const res = await this.doFetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: CLAUDE_OAUTH_CLIENT_ID }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const j: any = await res.json().catch(() => null);
    if (!j?.access_token) return null;
    const expiresAt = j.expires_in ? this.now() + Number(j.expires_in) * 1000 : undefined;
    return {
      credential: JSON.stringify({ kind: 'oauth', accessToken: j.access_token, refreshToken: j.refresh_token ?? c.refreshToken, expiresAt, scope: j.scope ?? c.scope }),
      expiresAt,
    };
  }
}

export function quotaFromHeaders(h: Headers, now: number): QuotaSnapshot {
  const windows: QuotaSnapshot['windows'] = [];
  for (const id of ['requests', 'tokens', 'input-tokens', 'output-tokens']) {
    const limit = Number(h.get(`anthropic-ratelimit-${id}-limit`) ?? '');
    const remaining = Number(h.get(`anthropic-ratelimit-${id}-remaining`) ?? '');
    const reset = h.get(`anthropic-ratelimit-${id}-reset`);
    if (!Number.isFinite(limit) || limit <= 0) continue;
    const used = Number.isFinite(remaining) ? Math.max(0, limit - remaining) : undefined;
    windows.push({ id, label: id, limit, used, usedPct: used === undefined ? undefined : Math.round((used / limit) * 100), resetAt: reset ? Date.parse(reset) || undefined : undefined });
  }
  return { checkedAt: now, windows };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/upstreams/claude.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: 提交**

```bash
git add server/src/upstreams/claude.ts server/src/upstreams/claude.test.ts
git commit -m "feat(gateway): Claude credential probe and oauth refresh"
```

---

## Task 4: UpstreamService（账号池、策略、GatewayTarget）

**Files:**
- Create: `server/src/upstreams/service.ts`, `server/src/upstreams/handlers.ts`, `server/src/upstreams/affinity.ts`
- Test: `server/src/upstreams/service.test.ts`, `server/src/upstreams/affinity.test.ts`

**Interfaces:**
- Consumes: `AccountStore`、`ClaudeAdapter`、`GatewayMember`、`GatewayTarget`。
- Produces:
  - `class AffinityTable { get(groupId, key, now?); bind(groupId, key, accountId, ttlMinutes, now?); drop(groupId, key); dropAccount(accountId); clear() }`
  - `class UpstreamService extends EventEmitter`
  - `status(): UpstreamStatus`
  - `add(input) / update(id, patch) / remove(id) / probe(id) / reset(id) / markFailure(id, health, error, cooldownUntil?) / markSuccess(id)`
  - `groups() / upsertGroup(patch) / removeGroup(id)`
  - `order(g: UpstreamGroup, sessionKey?: string): UpstreamAccount[]`
  - `resolveMembers(m: GatewayMember, model: string, sessionKey?: string): Promise<GatewayTarget[]>`
  - `noteUse(id, usage) / flush()`
  - `handleUpstreamRequest(svc, req): Promise<unknown>`、`isUpstreamRequest(req)`

- [ ] **Step 1: 写失败测试**

```ts
// server/src/upstreams/service.test.ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaStore } from '../meta/store.js';
import { SecretService } from '../secrets/service.js';
import { UpstreamService } from './service.js';

async function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-upsvc-'));
  const meta = new MetaStore(path.join(dir, 'meta.json'));
  await meta.load();
  return { meta, svc: new UpstreamService({ meta, secrets: new SecretService() }) };
}

describe('UpstreamService', () => {
  it('adds an account and resolves it as a translated Anthropic target', async () => {
    const { svc } = await make();
    const { account } = await svc.add({ kind: 'claude', name: 'A', credential: 'sk-ant-oat01-abc', probe: false });
    const [t] = await svc.resolveMembers({ accountId: account.id }, 'claude-sonnet-4-6');
    expect(t).toMatchObject({ id: account.id, type: 'anthropic', auth: 'oauth', forceTranslate: true });
    expect(t.apiKey).toBe('sk-ant-oat01-abc');
  });

  it('orders a pool by strategy and skips disabled accounts', async () => {
    const { svc } = await make();
    const a = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-a', probe: false })).account;
    const b = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-b', probe: false })).account;
    await svc.update(b.id, { enabled: false });
    const g = await svc.upsertGroup({ kind: 'claude', name: 'Pool', strategy: 'failover', members: [a.id, b.id] });
    expect(svc.order(g).map((x) => x.id)).toEqual([a.id]);
  });

  it('applies the pool model map', async () => {
    const { svc } = await make();
    const a = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-a', probe: false })).account;
    const g = await svc.upsertGroup({ kind: 'claude', name: 'Pool', strategy: 'failover', members: [a.id], modelMap: { 'claude-*': 'claude-sonnet-4-6' } });
    const [t] = await svc.resolveMembers({ upstreamGroupId: g.id }, 'claude-haiku-4-5');
    expect(t.name).toBe(a.name);
    // the model is applied by GatewayService through target.model
    expect(t.model).toBe('claude-sonnet-4-6');
  });

  it('removes a pool and refuses unknown members', async () => {
    const { svc } = await make();
    const g = await svc.upsertGroup({ kind: 'claude', name: 'Pool', strategy: 'failover', members: [] });
    await svc.removeGroup(g.id);
    expect(svc.groups()).toEqual([]);
    expect(await svc.resolveMembers({ upstreamGroupId: g.id }, 'x')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/upstreams/service.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: 实现 service**

```ts
// server/src/upstreams/service.ts
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { MetaStore } from '../meta/store.js';
import type { SecretService } from '../secrets/service.js';
import type { GatewayMember, GatewayTarget } from '../gateway/types.js';
import { AccountStore } from './store.js';
import { AffinityTable } from './affinity.js';
import { ClaudeAdapter } from './claude.js';
import type { UpstreamAccount, UpstreamAccountInput, UpstreamAccountPatch, UpstreamAccountView, UpstreamGroup, UpstreamKind, UpstreamStatus } from './types.js';
import { tr } from '../i18n/index.js';

export interface UpstreamDeps {
  meta: MetaStore;
  secrets: SecretService;
  claude?: ClaudeAdapter;
  claudeBase?: string;
  now?: () => number;
}

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export class UpstreamService extends EventEmitter {
  readonly store: AccountStore;
  readonly affinity = new AffinityTable();
  private claude: ClaudeAdapter;
  private now: () => number;
  private cursor = new Map<string, number>();
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private deps: UpstreamDeps) {
    super();
    this.store = new AccountStore(deps.meta, deps.secrets);
    this.now = deps.now ?? Date.now;
    this.claude = deps.claude ?? new ClaudeAdapter({ baseUrl: deps.claudeBase ?? process.env.CW_CLAUDE_BASE });
  }

  status(): UpstreamStatus {
    return {
      accounts: this.store.list().map((a) => this.view(a)),
      groups: this.groups(),
      families: [
        { kind: 'claude', ready: true },
        { kind: 'gemini', ready: false, detail: tr('阶段 B 提供：需要 Gemini sidecar') },
        { kind: 'workbuddy', ready: false, detail: tr('阶段 C 提供：需要 WorkBuddy sidecar') },
      ],
    };
  }

  private view(a: UpstreamAccount): UpstreamAccountView {
    const { credential: _credential, proxy, fingerprint: _fingerprint, ...rest } = a;
    return { ...rest, credentialMasked: `${a.credentialKind} · ••••`, hasProxy: !!proxy };
  }

  async add(input: UpstreamAccountInput): Promise<{ account: UpstreamAccountView; duplicate: boolean; id: string }> {
    const { account, duplicate } = await this.store.add(input);
    if (!duplicate && input.probe !== false && input.kind === 'claude') await this.probe(account.id);
    this.emit('changed');
    return { account: this.view(this.store.get(account.id)!), duplicate, id: account.id };
  }

  async update(id: string, patch: UpstreamAccountPatch): Promise<UpstreamAccountView> {
    const a = await this.store.update(id, patch);
    this.emit('changed');
    return this.view(a);
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
    this.emit('changed');
  }

  async probe(id: string): Promise<UpstreamAccountView> {
    const a = this.store.get(id);
    if (!a) throw new Error(tr('没有这个账号'));
    if (a.kind !== 'claude') {
      await this.store.setHealth(id, { health: 'unknown', lastError: tr('这个类型的探测在后续阶段提供') });
      this.emit('changed');
      return this.view(this.store.get(id)!);
    }
    let credential = await this.store.revealCredential(a);
    let r = await this.claude.probe(a, credential);
    if (r.health === 'expired') {
      const refreshed = await this.claude.refresh(a, credential);
      if (refreshed) {
        await this.store.update(id, { credential: JSON.parse(refreshed.credential) });
        credential = refreshed.credential;
        r = await this.claude.probe(a, credential);
      }
    }
    await this.store.setHealth(id, {
      health: r.health,
      cooldownUntil: r.cooldownUntil,
      lastError: r.error,
      ...(r.health === 'ok' ? { lastOkAt: this.now() } : {}),
      ...(r.quota ? { quota: r.quota } : {}),
      ...(r.identity ? { identity: r.identity } : {}),
    });
    this.emit('changed');
    return this.view(this.store.get(id)!);
  }

  async reset(id: string): Promise<void> {
    await this.store.setHealth(id, { health: 'unknown', cooldownUntil: undefined, lastError: undefined });
    this.emit('changed');
  }

  /** a gateway request failed on this account: keep the account row's health in step with the member state */
  async markFailure(id: string, health: UpstreamAccount['health'], error: string, cooldownUntil?: number): Promise<void> {
    this.affinity.dropAccount(id); // the next request of a bound conversation may pick another account
    await this.store.setHealth(id, { health, lastError: error, ...(cooldownUntil ? { cooldownUntil } : {}) });
    this.emit('changed');
  }

  async markSuccess(id: string): Promise<void> {
    const a = this.store.get(id);
    if (!a || a.health === 'ok') return;
    await this.store.setHealth(id, { health: 'ok', lastOkAt: this.now(), lastError: undefined, cooldownUntil: undefined });
    this.emit('changed');
  }

  groups(): UpstreamGroup[] { return this.deps.meta.upstreamGroups(); }

  async upsertGroup(patch: Partial<UpstreamGroup> & { id?: string }): Promise<UpstreamGroup> {
    const list = this.groups();
    let g = patch.id ? list.find((x) => x.id === patch.id) : undefined;
    if (!g) {
      g = {
        id: patch.id && /^[A-Za-z0-9_-]{1,40}$/.test(patch.id) ? patch.id : crypto.randomBytes(4).toString('hex'),
        kind: patch.kind ?? 'claude',
        name: patch.name?.trim() || tr('新账号池'),
        strategy: patch.strategy ?? 'failover',
        members: [],
        enabled: patch.enabled ?? true,
        createdAt: this.now(),
      };
      list.push(g);
    }
    if (patch.name !== undefined) g.name = patch.name.trim() || g.name;
    if (patch.kind) g.kind = patch.kind;
    if (patch.strategy) g.strategy = patch.strategy;
    if (patch.enabled !== undefined) g.enabled = patch.enabled;
    if (patch.members) g.members = [...new Set(patch.members.filter((id) => this.store.get(id)))];
    if (patch.modelMap !== undefined) g.modelMap = Object.fromEntries(Object.entries(patch.modelMap ?? {}).map(([k, v]) => [k.trim(), String(v).trim()]).filter(([k, v]) => k && v));
    if (patch.affinity !== undefined) g.affinity = patch.affinity;
    await this.deps.meta.saveUpstreams();
    this.emit('changed');
    return g;
  }

  async removeGroup(id: string): Promise<void> {
    this.deps.meta.data.upstreamGroups = this.groups().filter((g) => g.id !== id);
    for (const g of this.deps.meta.gatewayGroups()) g.members = g.members.filter((m) => m.upstreamGroupId !== id);
    await this.deps.meta.saveUpstreams();
    this.emit('changed');
  }

  order(g: UpstreamGroup, sessionKey?: string): UpstreamAccount[] {
    const now = this.now();
    const all = g.members.map((id) => this.store.get(id)).filter((a): a is UpstreamAccount => !!a);
    const usable = all.filter((a) => {
      if (!a.enabled || a.health === 'disabled' || a.health === 'expired') return false;
      if (a.cooldownUntil && a.cooldownUntil > now) return false;
      const day = today(now);
      if (a.dailyRequestLimit && a.stats?.day === day && a.stats.requests >= a.dailyRequestLimit) return false;
      return true;
    });
    const cooling = all.filter((a) => a.enabled && a.cooldownUntil && a.cooldownUntil > now).sort((x, y) => (x.cooldownUntil ?? 0) - (y.cooldownUntil ?? 0));
    let list = usable.length ? usable : cooling;
    let sticky = false;
    // session affinity: the same conversation key sticks to the same account for the TTL, whatever the strategy
    if (sessionKey && (g.affinity?.mode ?? 'session') === 'session') {
      const bound = this.affinity.get(g.id, sessionKey, now);
      if (bound) {
        const hit = list.find((a) => a.id === bound);
        if (hit) { list = [hit, ...list.filter((a) => a.id !== bound)]; sticky = true; }
        else this.affinity.drop(g.id, sessionKey);
      }
      if (list[0]) this.affinity.bind(g.id, sessionKey, list[0].id, g.affinity?.ttlMinutes ?? 60, now);
    }
    if (sticky) return list;
    if (g.strategy === 'round-robin') {
      const n = this.cursor.get(g.id) ?? 0;
      this.cursor.set(g.id, (n + 1) % Math.max(1, list.length));
      return [...list.slice(n % Math.max(1, list.length)), ...list.slice(0, n % Math.max(1, list.length))];
    }
    if (g.strategy === 'least-used') return [...list].sort((x, y) => (x.stats?.requests ?? 0) - (y.stats?.requests ?? 0));
    if (g.strategy === 'most-quota') {
      const ratio = (a: UpstreamAccount) => {
        const w = a.quota?.windows.find((x) => x.usedPct !== undefined);
        return w?.usedPct === undefined ? -1 : 100 - w.usedPct;
      };
      return [...list].sort((x, y) => ratio(y) - ratio(x));
    }
    return list;
  }

  private mapModel(map: Record<string, string> | undefined, model: string): string {
    if (!map) return model;
    if (map[model]) return map[model];
    for (const [k, v] of Object.entries(map)) {
      if (k.endsWith('*') && model.startsWith(k.slice(0, -1))) return v;
    }
    return model;
  }

  async resolveMembers(m: GatewayMember, model: string, sessionKey?: string): Promise<GatewayTarget[]> {
    if (m.accountId) {
      const a = this.store.get(m.accountId);
      return a ? this.targets([a], model) : [];
    }
    if (m.upstreamGroupId) {
      const g = this.groups().find((x) => x.id === m.upstreamGroupId);
      if (!g || !g.enabled) return [];
      return this.targets(this.order(g, sessionKey), this.mapModel(g.modelMap, model));
    }
    return [];
  }

  private async targets(accounts: UpstreamAccount[], model: string): Promise<GatewayTarget[]> {
    const out: GatewayTarget[] = [];
    for (const a of accounts) {
      if (a.kind !== 'claude') continue;
      const credential = JSON.parse(await this.store.revealCredential(a));
      const token = credential.kind === 'oauth' ? credential.accessToken : credential.token;
      if (!token) continue;
      out.push({
        id: a.id,
        name: a.name,
        type: 'anthropic',
        baseUrl: this.deps.claudeBase ?? process.env.CW_CLAUDE_BASE ?? 'https://api.anthropic.com',
        apiKey: token,
        createdAt: 0,
        auth: 'oauth',
        forceTranslate: true,
        ...(model ? { model } : {}),
      });
    }
    return out;
  }

  noteUse(id: string, usage: { input: number; output: number }): void {
    const a = this.store.get(id);
    if (!a) return;
    const day = today(this.now());
    const s = a.stats?.day === day ? a.stats : { day, requests: 0, tokensIn: 0, tokensOut: 0 };
    s.requests += 1;
    s.tokensIn += usage.input;
    s.tokensOut += usage.output;
    a.stats = s;
    a.lastUsedAt = this.now();
    this.dirty = true;
    if (!this.flushTimer) { this.flushTimer = setTimeout(() => { void this.flush(); }, 30_000); this.flushTimer.unref?.(); }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (!this.dirty) return;
    this.dirty = false;
    await this.deps.meta.saveUpstreams();
  }

  async stop(): Promise<void> {
    await this.flush();
  }
}
```

`server/src/upstreams/handlers.ts`：

```ts
import type { UpstreamRequest } from './types.js';
import type { UpstreamService } from './service.js';

export const isUpstreamRequest = (req: { kind: string }): req is UpstreamRequest => req.kind.startsWith('upstreams.');

export async function handleUpstreamRequest(svc: UpstreamService, req: UpstreamRequest): Promise<unknown> {
  switch (req.kind) {
    case 'upstreams.status': return svc.status();
    case 'upstreams.add': return svc.add(req.input);
    case 'upstreams.update': return svc.update(req.id, req.patch);
    case 'upstreams.remove': await svc.remove(req.id); return null;
    case 'upstreams.probe': return svc.probe(req.id);
    case 'upstreams.reset': await svc.reset(req.id); return svc.status();
    case 'upstreams.groups.upsert': return svc.upsertGroup(req.group);
    case 'upstreams.groups.remove': await svc.removeGroup(req.id); return null;
  }
  throw new Error(`unknown request ${(req as { kind: string }).kind}`);
}
```

- [ ] **Step 4: 会话粘性表**

```ts
// server/src/upstreams/affinity.ts
export class AffinityTable {
  private map = new Map<string, { accountId: string; until: number }>();
  private k(groupId: string, key: string) { return `${groupId}\0${key}`; }

  get(groupId: string, key: string, now = Date.now()): string | undefined {
    const hit = this.map.get(this.k(groupId, key));
    if (!hit) return undefined;
    if (hit.until <= now) { this.map.delete(this.k(groupId, key)); return undefined; }
    return hit.accountId;
  }

  bind(groupId: string, key: string, accountId: string, ttlMinutes: number, now = Date.now()): void {
    this.map.set(this.k(groupId, key), { accountId, until: now + ttlMinutes * 60_000 });
  }

  drop(groupId: string, key: string): void { this.map.delete(this.k(groupId, key)); }

  dropAccount(accountId: string): void {
    for (const [k, v] of this.map) if (v.accountId === accountId) this.map.delete(k);
  }

  clear(): void { this.map.clear(); }
}
```

```ts
// server/src/upstreams/affinity.test.ts
import { describe, expect, it } from 'vitest';
import { AffinityTable } from './affinity.js';

describe('AffinityTable', () => {
  it('binds within the TTL and forgets after it', () => {
    const t = new AffinityTable();
    t.bind('pool', 's1', 'acct_1', 60, 1000);
    expect(t.get('pool', 's1', 1000 + 59 * 60_000)).toBe('acct_1');
    expect(t.get('pool', 's1', 1000 + 61 * 60_000)).toBeUndefined();
  });

  it('drops one key or every key of an account', () => {
    const t = new AffinityTable();
    t.bind('pool', 's1', 'acct_1', 60);
    t.bind('pool', 's2', 'acct_1', 60);
    t.bind('pool', 's3', 'acct_2', 60);
    t.drop('pool', 's1');
    expect(t.get('pool', 's1')).toBeUndefined();
    t.dropAccount('acct_1');
    expect(t.get('pool', 's2')).toBeUndefined();
    expect(t.get('pool', 's3')).toBe('acct_2');
  });
});
```

`UpstreamService.order` / `resolveMembers` 已在上面的实现里用 `this.affinity`；再加一条测试：

```ts
it('keeps one conversation key on one account inside the pool', async () => {
  const { svc } = await make();
  const a = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-a', probe: false })).account;
  const b = (await svc.add({ kind: 'claude', credential: 'sk-ant-oat01-b', probe: false })).account;
  const g = await svc.upsertGroup({ kind: 'claude', name: 'Pool', strategy: 'round-robin', members: [a.id, b.id] });
  const first = (await svc.resolveMembers({ upstreamGroupId: g.id }, 'm', 'session-1'))[0].id;
  const again = (await svc.resolveMembers({ upstreamGroupId: g.id }, 'm', 'session-1'))[0].id;
  expect(again).toBe(first);
  svc.affinity.dropAccount(first);
  expect(svc.affinity.get(g.id, 'session-1')).toBeUndefined();
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd server && npx vitest run src/upstreams/service.test.ts src/upstreams/affinity.test.ts`
Expected: PASS（4 + 2 + 1 tests）。

- [ ] **Step 6: 提交**

```bash
git add server/src/upstreams/service.ts server/src/upstreams/handlers.ts server/src/upstreams/affinity.ts server/src/upstreams/service.test.ts server/src/upstreams/affinity.test.ts
git commit -m "feat(gateway): upstream service with pools, gateway targets and session affinity"
```

---

## Task 5: 网关成员三选一 + 账号成员强制翻译

**Files:**
- Modify: `server/src/gateway/types.ts:6-12`, `server/src/gateway/failover.ts`, `server/src/gateway/service.ts:40-44`, `server/src/gateway/service.ts:448-639`, `server/src/gateway/anthropic.ts:73-91`, `server/src/gateway/upstream.ts:185-191`
- Test: `server/src/gateway/failover.test.ts`（追加）、`server/src/gateway/service.test.ts`（追加）

**Interfaces:**
- Consumes: `UpstreamService.resolveMembers`。
- Produces:
  - `GatewayMember { providerId?; accountId?; upstreamGroupId?; model?; weight? }`
  - `memberKey(m): 'p:…' | 'a:…' | 'u:…'`
  - `GatewayTarget = Provider & { auth?: 'oauth'; forceTranslate?: boolean }`
  - `GatewayDeps.resolveMember?(m, model): Promise<GatewayTarget[]>`
  - `GatewayMemberState.key`

- [ ] **Step 1: 追加失败测试**

```ts
// failover.test.ts
import { memberKey } from './types.js';
it('keys each member reference kind', () => {
  expect(memberKey({ providerId: 'a' })).toBe('p:a');
  expect(memberKey({ accountId: 'acct_1' })).toBe('a:acct_1');
  expect(memberKey({ upstreamGroupId: 'pool' })).toBe('u:pool');
});
```

```ts
// service.test.ts（新 describe）
it('routes an account member through translation with oauth headers', async () => {
  const seen: any[] = [];
  const up = await fake();
  up.handler.fn = (q, res, body) => {
    seen.push({ headers: q.headers, body });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-4-5',
      content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    }));
  };
  const g2 = new GatewayService({
    meta, member: () => null,
    resolveMember: async () => [{ id: 'acct_1', name: 'Account', type: 'anthropic', baseUrl: up.url, apiKey: 'at-1', createdAt: 0, auth: 'oauth', forceTranslate: true }],
    firstByteMs: 400, nonStreamMs: 3000,
  });
  const s = http.createServer((q, r) => { if (!g2.handle(q, r, new URL(q.url ?? '/', 'http://x'))) r.writeHead(418).end(); });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  g2.port = (s.address() as any).port;
  await g2.setEnabled(true);
  await g2.upsertGroup({ id: 'acct', name: 'Acct', strategy: 'failover', members: [{ accountId: 'acct_1' }] });
  const r = await call('/acct/v1/messages', { model: 'claude-sonnet-4-6', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }, { 'x-api-key': g2.revealKey() }, `http://127.0.0.1:${g2.port}`);
  expect(r.status).toBe(200);
  expect(seen[0].headers.authorization).toBe('Bearer at-1');
  expect(seen[0].headers['x-api-key']).toBeUndefined();
  expect(seen[0].headers['anthropic-beta']).toContain('oauth-2025-04-20');
  expect(JSON.parse(seen[0].body).system[0].text).toContain('You are Claude Code');
  s.closeAllConnections(); s.close();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/gateway/failover.test.ts src/gateway/service.test.ts`
Expected: FAIL — `memberKey` not exported；account member 404。

- [ ] **Step 3: 状态表与组成员编辑**

`GatewayMember`、`memberKey`、`GatewayTarget` 已在 Task 1 定义；这里确认 `GatewayMemberState` 也已有 `key: string`。

`server/src/gateway/failover.ts`：`MemberStates` 的 `get/peek/reset/available/order/fail/ok` 全部把成员 id 参数当作 member key（`get/peek/reset/available/order` 内部用 `memberKey(m)`）；`reset(groupId, key?)` 的第二个参数语义改为 member key。导入 `memberKey`。

`GatewayService.upsertGroup` 的成员过滤要保留三种 ref：

```ts
if (patch.members) {
  const seen = new Set<string>();
  g.members = patch.members
    .filter((m) => {
      const k = memberKey(m);
      return k !== 'p:' && !seen.has(k) && !!seen.add(k);
    })
    .map((m) => ({
      ...(m.providerId ? { providerId: m.providerId } : {}),
      ...(m.accountId ? { accountId: m.accountId } : {}),
      ...(m.upstreamGroupId ? { upstreamGroupId: m.upstreamGroupId } : {}),
      ...(m.model?.trim() ? { model: m.model.trim() } : {}),
      ...(m.weight && m.weight !== 1 ? { weight: Math.max(1, Math.floor(m.weight)) } : {}),
    }));
}
```

`reset()` 保留旧调用（`gateway.reset` 传的是供应商 id）：

```ts
reset(groupId: string, ref?: string) {
  this.states.reset(groupId, ref && !ref.includes(':') ? `p:${ref}` : ref);
  this.emit('changed');
}
```

其余读 `m.providerId` 的地方都要容忍它可选：

```ts
// serveModels()
const p = m.providerId ? this.deps.meta.provider(m.providerId) : undefined;

// test()
const p0 = m0?.providerId ? this.deps.meta.provider(m0.providerId) : undefined;
if (g.members.some((m) => m.providerId && this.deps.meta.provider(m.providerId)?.type === 'anthropic')) { /* note */ }
```

`needsOfficialClient` 改成只看供应商成员：

```ts
needsOfficialClient(g: GatewayGroup): boolean {
  return g.members.some((m) => {
    const p = m.providerId ? this.deps.meta.provider(m.providerId) : undefined;
    return p?.type === 'anthropic' && p.runtime === 'claude';
  });
}
```

- [ ] **Step 4: 改 GatewayService 的解析与 attempt**

`GatewayDeps`：

```ts
  member(providerId: string): Provider | null;
  /** account / pool members (upstreams); falls back to member() for provider members */
  resolveMember?(m: GatewayMember, model: string, sessionKey?: string): Promise<GatewayTarget[]>;
```

`run()` 开头把成员展开：

```ts
interface Resolved { m: GatewayMember; key: string; target: GatewayTarget; model: string }
const sessionKey = cacheKeyOf(ctx.json, ctx.req.headers);
const order: Resolved[] = [];
for (const m of this.states.order(group)) {
  const mapped = mapModel(group, m, ctx.model);
  const targets = this.deps.resolveMember ? await this.deps.resolveMember(m, mapped, sessionKey) : (m.providerId && this.deps.member(m.providerId) ? [this.deps.member(m.providerId)!] : []);
  for (const t of targets) order.push({ m, key: t.auth ? `a:${t.id}` : memberKey(m), target: t, model: t.model ?? mapped });
}
```

循环改为 `for (const r of order)`，用 `r.target` 代替 `this.deps.member(m.providerId)`；`lastMember` 存 `{ p: r.target, outbound }`；`this.attempt(ctx, r, outbound, tried - 1)`；`record` 用 `r.target`。

`attempt(ctx, r: Resolved, outbound, switches)`：

```ts
const { group, route } = ctx;
const p = r.target;
const key = r.key;
const track = route.op !== 'count';
const pass = !p.forceTranslate && isPassthrough(route.inbound, outbound);
const model = r.model;
```

所有 `this.states.fail(group.id, p.id, …)` / `ok(group.id, p.id, …)` 改成 `this.states.fail(group.id, key, …)` / `ok(group.id, key, …)`。

账号成员的失败还要写回账号行（否则「账号」页的健康一直是旧的）：

```ts
if (p.auth) {
  void this.deps.upstreams?.markFailure(
    p.id,
    v.action === 'switch' && v.kind === 'auth' ? 'expired' : v.kind === 'rate' ? 'cooling' : 'error',
    msg,
    v.action === 'switch' && v.kind === 'rate' ? Date.now() + v.cooldownMs : undefined,
  );
}
```

第一段 2xx 成功后（`this.states.ok(...)` 旁边）：

```ts
if (track && p.auth) void this.deps.upstreams?.markSuccess(p.id);
```

`translatedHeaders` 后：

```ts
if (p.auth === 'oauth') {
  delete headers['x-api-key'];
  headers.authorization = `Bearer ${p.apiKey}`;
  headers['anthropic-beta'] = OAUTH_BETA;
}
```

`buildOutbound` 的 opts 加：

```ts
const opts: OutboundOpts = outbound === 'anthropic'
  ? { cacheTtl: group.cache1h || p.cache1h ? '1h' : undefined, systemPrefix: p.auth === 'oauth' ? CLAUDE_CODE_SYSTEM_PREFIX : undefined }
  : outbound === 'openai' ? { promptCacheKey: !p.noPromptCacheKey, cacheControlFormat: p.cacheControlFormat === 'anthropic' } : {};
```

`server/src/gateway/anthropic.ts`：

```ts
export interface AnthropicRenderOpts { cacheTtl?: '1h'; systemPrefix?: string }
```

```ts
  const sys = [
    ...(opts.systemPrefix ? [{ type: 'text', text: opts.systemPrefix }] : []),
    ...(r.system ? [{ type: 'text', text: r.system, cache_control: cc }] : []),
  ];
  if (sys.length) out.system = sys;
```

`status()` 里每个成员改成：

```ts
states[g.id] = g.members.map((m) => {
  const key = memberKey(m);
  const p = m.providerId ? this.deps.meta.provider(m.providerId) : undefined;
  const s = this.states.peek(g.id, key);
  const now = Date.now();
  const health = s?.disabled ? 'disabled' : s && s.cooldownUntil > now ? 'cooling' : s?.lastOkAt ? 'ok' : 'unknown';
  return {
    providerId: m.accountId ?? m.upstreamGroupId ?? m.providerId ?? '',
    key,
    name: p?.name ?? m.accountId ?? m.upstreamGroupId ?? tr('(已删除的供应商)'),
    type: p?.type ?? '',
    health,
    cooldownUntil: s && s.cooldownUntil > now ? s.cooldownUntil : undefined,
    strikes: s?.strikes ?? 0,
    lastError: m.providerId && !p ? tr('供应商不存在') : s?.lastError,
    lastStatus: s?.lastStatus, lastOkAt: s?.lastOkAt, lastUsedAt: s?.lastUsedAt,
  };
});
```

- [ ] **Step 5: 旧设置页先兼容可选 providerId**

`GatewayMember.providerId` 现在可选，`web/src/features/settings/GatewaySection.tsx` 里所有 `m.providerId` 读取先改成 `m.providerId ?? ''`（组编辑整段会在 Task 15 删掉）。这一步只为了让 `npm run typecheck` 在中间任务里保持绿。

- [ ] **Step 6: 运行测试**

Run: `cd server && npx vitest run src/gateway/failover.test.ts src/gateway/service.test.ts && npm run typecheck`
Expected: PASS（原有 + 新增）。

- [ ] **Step 7: 提交**

```bash
git add server/src/gateway/types.ts server/src/gateway/failover.ts server/src/gateway/service.ts server/src/gateway/anthropic.ts server/src/gateway/failover.test.ts server/src/gateway/service.test.ts web/src/features/settings/GatewaySection.tsx
git commit -m "feat(gateway): account and pool member refs, oauth targets"
```

---

## Task 6: 密钥组 / 密钥（哈希、迁移、CRUD、用量）

**Files:**
- Create: `server/src/upstreams/keys.ts`
- Modify: `server/src/gateway/types.ts`（密钥 / LAN / 审计类型）
- Test: `server/src/upstreams/keys.test.ts`

**Interfaces:**
- Consumes: `MetaStore`、`SecretService`、`GatewayKeyGroup`、`GatewayKey`。
- Produces:
  - `newKeyParts(): { plaintext; prefix; hash; salt }`
  - `verifyKey(presented, key): boolean`
  - `class GatewayKeyStore { groups(); list(); group(id); ensureDefault(legacy); migrateLegacy(legacy); create(groupId, name, opts?); update(id, patch); remove(id); reveal(id); verify(presented); recordUsage(id, tokensIn, tokensOut, costUsd); canSpend(key, group) }`

- [ ] **Step 1: 确认共享类型并补请求 / 事件**

密钥、LAN、审计类型已在 Task 1 的 `gateway/types.ts` 里；这里只补请求与事件。

请求 / 事件追加：

```ts
export type GatewayRequest =
  | { kind: 'gateway.status' }
  | { kind: 'gateway.set'; enabled: boolean }
  | { kind: 'gateway.revealKey' }
  | { kind: 'gateway.regenerateKey' }
  | { kind: 'gateway.groups.upsert'; group: Partial<GatewayGroup> & { id?: string } }
  | { kind: 'gateway.groups.remove'; id: string }
  | { kind: 'gateway.reset'; groupId: string; providerId?: string }
  | { kind: 'gateway.test'; groupId: string; protocol?: GatewayProtocol }
  | { kind: 'gateway.keys.status' }
  | { kind: 'gateway.keys.create'; groupId: string; name: string; expiresAt?: number }
  | { kind: 'gateway.keys.update'; id: string; patch: { name?: string; enabled?: boolean; keyGroupId?: string; expiresAt?: number | null } }
  | { kind: 'gateway.keys.remove'; id: string }
  | { kind: 'gateway.keys.reveal'; id: string }
  | { kind: 'gateway.keyGroups.upsert'; group: Partial<GatewayKeyGroup> & { id?: string } }
  | { kind: 'gateway.keyGroups.remove'; id: string }
  | { kind: 'gateway.lan.status' }
  | { kind: 'gateway.lan.set'; config: Partial<GatewayLanConfig> & { confirmAny?: boolean } }
  | { kind: 'gateway.audit.list'; limit?: number; since?: number; keyId?: string }
  | { kind: 'gateway.audit.clear' }
  | { kind: 'gateway.audit.export' }
  | { kind: 'gateway.settings.set'; patch: { audit?: Partial<GatewayAuditConfig>; allowQueryKey?: boolean } };

export type GatewayEvent =
  | { kind: 'gateway.changed' }
  | { kind: 'gateway.key.changed' }
  | { kind: 'upstreams.changed' }
  | { kind: 'gateway.log'; lines: GatewayAuditLine[] };
```

- [ ] **Step 2: 写失败测试**

```ts
// server/src/upstreams/keys.test.ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaStore } from '../meta/store.js';
import { SecretService } from '../secrets/service.js';
import { GatewayKeyStore, newKeyParts, verifyKey } from './keys.js';

async function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-keys-'));
  const meta = new MetaStore(path.join(dir, 'meta.json'));
  await meta.load();
  return { meta, store: new GatewayKeyStore(meta, new SecretService()) };
}

describe('GatewayKeyStore', () => {
  it('mints a cwg- key and verifies it without storing plaintext', async () => {
    const { meta, store } = await make();
    const { key, plaintext } = await store.create(undefined, 'test');
    expect(plaintext.startsWith('cwg-')).toBe(true);
    expect(key.hash).toHaveLength(64);
    expect(JSON.stringify(meta.data)).not.toContain(plaintext);
    expect(store.verify(plaintext)?.key.id).toBe(key.id);
    expect(store.verify('cwg-nope')).toBeNull();
  });

  it('migrates the legacy key into the default group and keeps it revealable', async () => {
    const { store } = await make();
    await store.migrateLegacy('cwg-legacy-secret');
    const hit = store.verify('cwg-legacy-secret');
    expect(hit?.group.id).toBe('default');
    expect(await store.reveal(hit!.key.id)).toBe('cwg-legacy-secret');
  });

  it('enforces daily token budgets', async () => {
    const { store } = await make();
    const { key } = await store.create(undefined, 'budget', { rateLimit: { dailyTokens: 100 } });
    const g = store.group(key.keyGroupId)!;
    expect(store.canSpend(key, g)).toEqual({ ok: true });
    store.recordUsage(key.id, 60, 50, 0);
    expect(store.canSpend(store.list().find((k) => k.id === key.id)!, g)).toMatchObject({ ok: false });
  });

  it('rejects disabled and expired keys', async () => {
    const { store } = await make();
    const { key, plaintext } = await store.create(undefined, 'x', { expiresAt: Date.now() - 1 });
    expect(store.verify(plaintext)).toBeNull();
    await store.update(key.id, { enabled: false, expiresAt: null });
    expect(store.verify(plaintext)).toBeNull();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd server && npx vitest run src/upstreams/keys.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 4: 实现**

```ts
// server/src/upstreams/keys.ts
import crypto from 'node:crypto';
import type { MetaStore } from '../meta/store.js';
import type { SecretService } from '../secrets/service.js';
import type { GatewayKey, GatewayKeyGroup } from '../gateway/types.js';
import { tr } from '../i18n/index.js';

const today = () => new Date().toISOString().slice(0, 10);

export function newKeyParts(): { plaintext: string; prefix: string; hash: string; salt: string } {
  const plaintext = `cwg-${crypto.randomBytes(24).toString('hex')}`;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + plaintext).digest('hex');
  return { plaintext, prefix: `${plaintext.slice(0, 8)}…${plaintext.slice(-4)}`, hash, salt };
}

export function verifyKey(presented: string, key: Pick<GatewayKey, 'salt' | 'hash'>): boolean {
  const got = crypto.createHash('sha256').update(key.salt + presented).digest();
  const want = Buffer.from(key.hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export const keyView = (k: GatewayKey) => { const { hash, salt, secret, ...rest } = k; return rest; };

export class GatewayKeyStore {
  constructor(private meta: MetaStore, private secrets?: SecretService) {}

  groups(): GatewayKeyGroup[] { return this.meta.gatewayKeyGroups(); }
  list(): GatewayKey[] { return this.meta.gatewayKeys(); }
  group(id: string): GatewayKeyGroup | undefined { return this.groups().find((g) => g.id === id); }

  status() {
    return { groups: this.groups(), keys: this.list().map(keyView), defaultKeyId: 'key_default' };
  }

  async ensureDefaultGroup(): Promise<GatewayKeyGroup> {
    let g = this.group('default');
    if (!g) {
      g = { id: 'default', name: tr('默认密钥组'), routeGroupIds: [], allowLan: false, ipAllowlist: [], createdAt: Date.now() };
      this.groups().push(g);
      await this.meta.saveGatewayKeys();
    }
    return g;
  }

  async migrateLegacy(legacy: string): Promise<void> {
    const group = await this.ensureDefaultGroup();
    if (!legacy || this.list().some((k) => k.id === 'key_default')) return;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + legacy).digest('hex');
    this.list().push({
      id: 'key_default', name: tr('默认密钥'), keyGroupId: group.id,
      prefix: `${legacy.slice(0, 8)}…${legacy.slice(-4)}`, hash, salt,
      secret: this.secrets ? await this.secrets.protect(legacy, 'gateway-key:key_default') : legacy,
      enabled: true, createdAt: Date.now(),
      stats: { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, day: today() },
    });
    await this.meta.saveGatewayKeys();
  }

  async replaceLegacy(plaintext: string): Promise<void> {
    const k = this.list().find((x) => x.id === 'key_default');
    if (!k) return this.migrateLegacy(plaintext);
    k.salt = crypto.randomBytes(16).toString('hex');
    k.hash = crypto.createHash('sha256').update(k.salt + plaintext).digest('hex');
    k.prefix = `${plaintext.slice(0, 8)}…${plaintext.slice(-4)}`;
    k.secret = this.secrets ? await this.secrets.protect(plaintext, 'gateway-key:key_default') : plaintext;
    k.enabled = true;
    await this.meta.saveGatewayKeys();
  }

  async create(groupId: string | undefined, name: string, opts: { expiresAt?: number; rateLimit?: GatewayKeyGroup['rateLimit'] } = {}): Promise<{ key: GatewayKey; plaintext: string }> {
    const group = groupId ? this.group(groupId) : await this.ensureDefaultGroup();
    if (!group) throw new Error(tr('没有这个密钥组'));
    if (opts.rateLimit) {
      group.rateLimit = { ...group.rateLimit, ...opts.rateLimit };
      await this.meta.saveGatewayKeys();
    }
    const parts = newKeyParts();
    const key: GatewayKey = {
      id: `key_${crypto.randomBytes(5).toString('hex')}`, name: name.trim() || tr('新密钥'), keyGroupId: group.id,
      prefix: parts.prefix, hash: parts.hash, salt: parts.salt,
      enabled: true, ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}), createdAt: Date.now(),
      stats: { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, day: today() },
    };
    this.list().push(key);
    await this.meta.saveGatewayKeys();
    return { key, plaintext: parts.plaintext };
  }

  async update(id: string, patch: { name?: string; enabled?: boolean; keyGroupId?: string; expiresAt?: number | null }): Promise<GatewayKey> {
    const k = this.list().find((x) => x.id === id);
    if (!k) throw new Error(tr('没有这个密钥'));
    if (patch.name !== undefined) k.name = patch.name.trim() || k.name;
    if (patch.enabled !== undefined) k.enabled = patch.enabled;
    if (patch.keyGroupId !== undefined) { if (!this.group(patch.keyGroupId)) throw new Error(tr('没有这个密钥组')); k.keyGroupId = patch.keyGroupId; }
    if (patch.expiresAt !== undefined) { if (patch.expiresAt === null) delete k.expiresAt; else k.expiresAt = patch.expiresAt; }
    await this.meta.saveGatewayKeys();
    return k;
  }

  async remove(id: string): Promise<void> {
    this.meta.data.gatewayKeys = this.list().filter((k) => k.id !== id);
    await this.meta.saveGatewayKeys();
  }

  async reveal(id: string): Promise<string> {
    const k = this.list().find((x) => x.id === id);
    if (!k?.secret) throw new Error(tr('这个密钥只在创建时显示一次'));
    return this.secrets ? this.secrets.reveal(k.secret) : k.secret;
  }

  verify(presented: string): { key: GatewayKey; group: GatewayKeyGroup } | null {
    const now = Date.now();
    for (const k of this.list()) {
      if (!k.enabled || (k.expiresAt && k.expiresAt < now)) continue;
      if (!verifyKey(presented, k)) continue;
      const g = this.group(k.keyGroupId);
      if (g) return { key: k, group: g };
    }
    return null;
  }

  recordUsage(id: string, tokensIn: number, tokensOut: number, costUsd: number): void {
    const k = this.list().find((x) => x.id === id);
    if (!k) return;
    const day = today();
    if (k.stats.day !== day) k.stats = { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, day };
    k.stats.requests += 1;
    k.stats.tokensIn += tokensIn;
    k.stats.tokensOut += tokensOut;
    k.stats.costUsd += costUsd;
    k.lastUsedAt = Date.now();
    // the counters ride on the next save (account usage flushes at most every 30 s)
  }

  canSpend(key: GatewayKey, group: GatewayKeyGroup): { ok: true } | { ok: false; message: string } {
    const day = today();
    const s = key.stats.day === day ? key.stats : { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, day };
    const lim = group.rateLimit;
    if (lim?.dailyTokens && s.tokensIn + s.tokensOut >= lim.dailyTokens) return { ok: false, message: tr('这个密钥今天的 token 额度已用完') };
    if (lim?.dailyCostUsd && s.costUsd >= lim.dailyCostUsd) return { ok: false, message: tr('这个密钥今天的费用额度已用完') };
    return { ok: true };
  }

  async upsertGroup(patch: Partial<GatewayKeyGroup> & { id?: string }): Promise<GatewayKeyGroup> {
    let g = patch.id ? this.group(patch.id) : undefined;
    if (!g) {
      g = { id: patch.id && /^[A-Za-z0-9_-]{1,40}$/.test(patch.id) ? patch.id : `kg_${crypto.randomBytes(4).toString('hex')}`, name: tr('新密钥组'), routeGroupIds: [], allowLan: false, ipAllowlist: [], createdAt: Date.now() };
      this.groups().push(g);
    }
    if (patch.name !== undefined) g.name = patch.name.trim() || g.name;
    if (patch.routeGroupIds !== undefined) g.routeGroupIds = [...new Set(patch.routeGroupIds)];
    if (patch.modelAllowlist !== undefined) g.modelAllowlist = patch.modelAllowlist.filter(Boolean);
    if (patch.modelDeny !== undefined) g.modelDeny = patch.modelDeny.filter(Boolean);
    if (patch.allowLan !== undefined) g.allowLan = patch.allowLan;
    if (patch.ipAllowlist !== undefined) g.ipAllowlist = patch.ipAllowlist.map((x) => x.trim()).filter(Boolean);
    if (patch.rateLimit !== undefined) g.rateLimit = patch.rateLimit;
    await this.meta.saveGatewayKeys();
    return g;
  }

  async removeGroup(id: string): Promise<void> {
    if (id === 'default') throw new Error(tr('默认密钥组不能删除'));
    this.meta.data.gatewayKeyGroups = this.groups().filter((g) => g.id !== id);
    this.meta.data.gatewayKeys = this.list().filter((k) => k.keyGroupId !== id);
    await this.meta.saveGatewayKeys();
  }

  async saveUsage(): Promise<void> { await this.meta.saveGatewayKeys(); }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd server && npx vitest run src/upstreams/keys.test.ts`
Expected: PASS（4 tests）。

- [ ] **Step 6: 提交**

```bash
git add server/src/gateway/types.ts server/src/upstreams/keys.ts server/src/upstreams/keys.test.ts
git commit -m "feat(gateway): key groups, hashed keys and daily budgets"
```

---

## Task 7: IP 白名单、模型 glob、根路径选组、限速器

**Files:**
- Create: `server/src/upstreams/routing.ts`, `server/src/upstreams/ratelimit.ts`
- Test: `server/src/upstreams/routing.test.ts`

**Interfaces:**
- Produces:
  - `ipInList(ip, list): boolean`
  - `modelAllowed(model, allow?, deny?): boolean`
  - `globMatch(pattern, value): boolean`
  - `pickRouteGroup(o: { pathGroupId?; model; groups: GatewayGroup[]; allowed: string[] }): { group; model } | { error: 'no-group' | 'ambiguous'; groups: string[] }`
  - `class RateLimiter { take(id, limits, now?): { ok: true; release(): void } | { ok: false; reason: 'rpm' | 'concurrent'; retryAfterMs: number } }`

- [ ] **Step 1: 写失败测试**

```ts
// server/src/upstreams/routing.test.ts
import { describe, expect, it } from 'vitest';
import { globMatch, ipInList, modelAllowed, pickRouteGroup } from './routing.js';
import { RateLimiter } from './ratelimit.js';

const groups: any[] = [
  { id: 'main', name: 'Main', members: [{ providerId: 'a' }] },
  { id: 'alt', name: 'Alt', members: [{ providerId: 'b' }] },
];

describe('routing', () => {
  it('matches IPv4 and IPv6 CIDRs', () => {
    expect(ipInList('192.168.1.5', ['192.168.1.0/24'])).toBe(true);
    expect(ipInList('10.0.0.1', ['192.168.1.0/24'])).toBe(false);
    expect(ipInList('::1', ['::1/128'])).toBe(true);
    expect(ipInList('127.0.0.1', [])).toBe(false);
  });

  it('matches model globs with deny winning', () => {
    expect(globMatch('claude-*', 'claude-sonnet-4-6')).toBe(true);
    expect(modelAllowed('claude-sonnet-4-6', ['claude-*'], [])).toBe(true);
    expect(modelAllowed('claude-opus-4-7', ['claude-*'], ['claude-opus-*'])).toBe(false);
    expect(modelAllowed('gpt-4.1', ['claude-*'], [])).toBe(false);
  });

  it('resolves an explicit group, a group/model prefix and the single allowed group', () => {
    expect(pickRouteGroup({ pathGroupId: 'main', model: 'x', groups, allowed: [] })).toMatchObject({ group: { id: 'main' } });
    expect(pickRouteGroup({ model: 'alt/gpt-4.1', groups, allowed: [] })).toMatchObject({ group: { id: 'alt' }, model: 'gpt-4.1' });
    expect(pickRouteGroup({ model: 'x', groups: [groups[0]], allowed: [] })).toMatchObject({ group: { id: 'main' } });
    expect(pickRouteGroup({ model: 'x', groups, allowed: [] })).toEqual({ error: 'ambiguous', groups: ['main', 'alt'] });
    expect(pickRouteGroup({ pathGroupId: 'nope', model: 'x', groups, allowed: [] })).toEqual({ error: 'no-group', groups: [] });
  });

  it('limits rpm and concurrency', () => {
    const r = new RateLimiter();
    const a = r.take('k', { rpm: 1, concurrent: 1 }, 0);
    expect(a.ok).toBe(true);
    expect(r.take('k', { rpm: 1, concurrent: 1 }, 10)).toMatchObject({ ok: false, reason: 'concurrent' });
    if (a.ok) a.release();
    expect(r.take('k', { rpm: 1, concurrent: 1 }, 20)).toMatchObject({ ok: false, reason: 'rpm' });
    expect(r.take('k', { rpm: 1, concurrent: 1 }, 61_000).ok).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/upstreams/routing.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: 实现**

```ts
// server/src/upstreams/routing.ts
import net from 'node:net';
import type { GatewayGroup } from '../gateway/types.js';

export function ipInList(ip: string, list: string[]): boolean {
  if (!list.length) return false;
  const bl = new net.BlockList();
  for (const raw of list) {
    const [addr, bits] = raw.trim().split('/');
    const fam = net.isIP(addr);
    if (!fam) continue;
    try {
      if (bits === undefined) bl.addAddress(addr, fam === 6 ? 'ipv6' : 'ipv4');
      else bl.addSubnet(addr, Number(bits), fam === 6 ? 'ipv6' : 'ipv4');
    } catch { /* a malformed entry is ignored, not fatal */ }
  }
  const fam = net.isIP(ip);
  if (!fam) return false;
  try { return bl.check(ip, fam === 6 ? 'ipv6' : 'ipv4'); } catch { return false; }
}

export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
  return re.test(value);
}

export function modelAllowed(model: string, allow?: string[], deny?: string[]): boolean {
  if (deny?.some((p) => globMatch(p, model))) return false;
  if (!allow?.length) return true;
  return allow.some((p) => globMatch(p, model));
}

export function pickRouteGroup(o: {
  pathGroupId?: string;
  model: string;
  groups: GatewayGroup[];
  /** key group routeGroupIds; empty = all */
  allowed: string[];
}): { group: GatewayGroup; model: string } | { error: 'no-group' | 'ambiguous'; groups: string[] } {
  const allowed = o.allowed.length ? o.groups.filter((g) => o.allowed.includes(g.id)) : o.groups;
  if (o.pathGroupId) {
    const g = allowed.find((x) => x.id === o.pathGroupId);
    return g ? { group: g, model: o.model } : { error: 'no-group', groups: [] };
  }
  const pref = /^([A-Za-z0-9_-]{1,40})\/(.+)$/.exec(o.model);
  if (pref) {
    const g = allowed.find((x) => x.id === pref[1]);
    if (g) return { group: g, model: pref[2] };
  }
  if (allowed.length === 1) return { group: allowed[0], model: o.model };
  return { error: 'ambiguous', groups: allowed.map((g) => g.id) };
}
```

```ts
// server/src/upstreams/ratelimit.ts
export interface Limits { rpm?: number; concurrent?: number }

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private live = new Map<string, number>();

  take(id: string, limits: Limits | undefined, now = Date.now()): { ok: true; release(): void } | { ok: false; reason: 'rpm' | 'concurrent'; retryAfterMs: number } {
    if (!limits || (!limits.rpm && !limits.concurrent)) return { ok: true, release: () => {} };
    if (limits.concurrent) {
      const n = this.live.get(id) ?? 0;
      if (n >= limits.concurrent) return { ok: false, reason: 'concurrent', retryAfterMs: 1000 };
    }
    if (limits.rpm) {
      const list = (this.hits.get(id) ?? []).filter((t) => now - t < 60_000);
      this.hits.set(id, list);
      if (list.length >= limits.rpm) return { ok: false, reason: 'rpm', retryAfterMs: 60_000 - (now - list[0]) };
    }
    if (limits.rpm) this.hits.get(id)!.push(now);
    if (limits.concurrent) this.live.set(id, (this.live.get(id) ?? 0) + 1);
    let done = false;
    return {
      ok: true,
      release: () => {
        if (done) return;
        done = true;
        if (limits.concurrent) this.live.set(id, Math.max(0, (this.live.get(id) ?? 1) - 1));
      },
    };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/upstreams/routing.test.ts`
Expected: PASS（4 tests）。

- [ ] **Step 5: 提交**

```bash
git add server/src/upstreams/routing.ts server/src/upstreams/ratelimit.ts server/src/upstreams/routing.test.ts
git commit -m "feat(gateway): ip allowlists, model globs, route selection, rate limiter"
```

---

## Task 8: 审计日志

**Files:**
- Create: `server/src/gateway/audit.ts`
- Test: `server/src/gateway/audit.test.ts`

**Interfaces:**
- Consumes: `GatewayAuditConfig`、`GatewayAuditLine`。
- Produces: `class AuditLog extends EventEmitter { write(line); list(opts); clear(); exportText(); stop() }`，事件 `'lines'`（最多 200 条 / 秒）。

- [ ] **Step 1: 写失败测试**

```ts
// server/src/gateway/audit.test.ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuditLog } from './audit.js';

const line = (i: number, over: any = {}) => ({ ts: i, keyId: 'key_1', ip: '127.0.0.1', protocol: 'anthropic' as const, model: 'm', routeGroupId: 'main', member: 'P', status: 200, ms: 5, tokensIn: 10, tokensOut: 2, errorCode: '', ...over });

describe('AuditLog', () => {
  it('appends JSONL, filters and clears', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-audit-'));
    const a = new AuditLog(dir, () => ({ enabled: true, maxBytes: 1_000_000, keepFiles: 3 }));
    a.write(line(1));
    a.write(line(2, { status: 500, errorCode: '500' }));
    await a.flushNow();
    const all = await a.list({ limit: 10 });
    expect(all).toHaveLength(2);
    expect(await a.list({ status: 500 })).toHaveLength(1);
    await a.clear();
    expect(await a.list({})).toEqual([]);
  });

  it('never writes fields outside the whitelist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-audit-'));
    const a = new AuditLog(dir, () => ({ enabled: true, maxBytes: 1_000_000, keepFiles: 3 }));
    a.write(line(1, { prompt: 'SECRET PROMPT', authorization: 'Bearer SECRET' } as any));
    await a.flushNow();
    const text = await a.exportText();
    expect(text).not.toContain('SECRET');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/gateway/audit.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: 实现**

```ts
// server/src/gateway/audit.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { GatewayAuditConfig, GatewayAuditLine } from './types.js';

const FILE = 'gateway-audit.jsonl';
const FIELDS = ['ts', 'keyId', 'ip', 'protocol', 'model', 'routeGroupId', 'member', 'status', 'ms', 'tokensIn', 'tokensOut', 'errorCode'] as const;

const clean = (l: GatewayAuditLine): GatewayAuditLine => {
  const out: any = {};
  for (const k of FIELDS) out[k] = (l as any)[k] ?? (typeof (l as any)[k] === 'number' ? 0 : '');
  return out as GatewayAuditLine;
};

export class AuditLog extends EventEmitter {
  private buf: GatewayAuditLine[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private dir: string, private cfg: () => GatewayAuditConfig) { super(); }

  write(line: GatewayAuditLine): void {
    if (!this.cfg().enabled) return;
    this.buf.push(clean(line));
    if (!this.timer) { this.timer = setInterval(() => { void this.flushNow(); }, 1000); this.timer.unref?.(); }
  }

  async flushNow(): Promise<void> {
    if (!this.buf.length) { if (this.timer) { clearInterval(this.timer); this.timer = null; } return; }
    const lines = this.buf.splice(0, 200);
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, FILE);
    await fs.appendFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
    this.emit('lines', lines);
    const cfg = this.cfg();
    try {
      const st = await fs.stat(file);
      if (st.size > cfg.maxBytes) await this.rotate(file, cfg.keepFiles);
    } catch { /* nothing to rotate */ }
  }

  private async rotate(file: string, keep: number): Promise<void> {
    for (let i = keep - 1; i >= 1; i--) await fs.rename(`${file}.${i}`, `${file}.${i + 1}`).catch(() => {});
    await fs.rename(file, `${file}.1`).catch(() => {});
  }

  async list(opts: { limit?: number; since?: number; keyId?: string; status?: number }): Promise<GatewayAuditLine[]> {
    await this.flushNow();
    let text = '';
    try { text = await fs.readFile(path.join(this.dir, FILE), 'utf8'); } catch { return []; }
    let lines = text.split('\n').filter(Boolean).map((s) => { try { return JSON.parse(s) as GatewayAuditLine; } catch { return null; } }).filter((x): x is GatewayAuditLine => !!x);
    if (opts.since) lines = lines.filter((l) => l.ts >= opts.since!);
    if (opts.keyId) lines = lines.filter((l) => l.keyId === opts.keyId);
    if (opts.status) lines = lines.filter((l) => l.status === opts.status);
    return lines.slice(-(opts.limit ?? 500));
  }

  async clear(): Promise<void> {
    this.buf = [];
    await fs.rm(path.join(this.dir, FILE), { force: true });
    for (let i = 1; i < 100; i++) await fs.rm(path.join(this.dir, `${FILE}.${i}`), { force: true });
  }

  async exportText(): Promise<string> {
    const lines = await this.list({ limit: Number.MAX_SAFE_INTEGER });
    return lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : '');
  }

  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/gateway/audit.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 5: 提交**

```bash
git add server/src/gateway/audit.ts server/src/gateway/audit.test.ts
git commit -m "feat(gateway): whitelisted rotating audit log"
```

---

## Task 9: 根路径路由 + 密钥鉴权 + 限速 / 预算

**Files:**
- Modify: `server/src/gateway/service.ts:96-135`, `:167-197`, `:234-316`, `:448-519`
- Modify: `server/src/gateway/handlers.ts`
- Test: `server/src/gateway/service.test.ts`（追加）

**Interfaces:**
- Consumes: `GatewayKeyStore`、`RateLimiter`、`pickRouteGroup`、`modelAllowed`、`ipInList`。
- Produces:
  - `GatewayService.keys`
  - `GatewayDeps.keys?`、`audit?`
  - 根路径 `/v1/...`、`/<groupId>/v1/...`
  - `Ctx.keyId`、`Ctx.ip`、`Ctx.surface`

- [ ] **Step 1: 追加失败测试**

```ts
it('serves /v1 directly and enforces a key group allowlist', async () => {
  A.handler.fn = anthropicOk('root');
  // the default group from setEnabled's legacy key works on the root path
  const root = await call('/v1/messages', { model: 'claude-sonnet-4-6', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }, {}, `http://127.0.0.1:${gw.port}`);
  expect(root.status).toBe(200);
  // a second key group restricted to another route group cannot use main
  const kg = await gw.keys.upsertGroup({ id: 'restricted', name: 'R', routeGroupIds: ['mixed'] });
  const { plaintext } = await gw.keys.create(kg.id, 'restricted');
  const denied = await call('/main/v1/messages', { model: 'x', max_tokens: 1, messages: [] }, { 'x-api-key': plaintext }, `http://127.0.0.1:${gw.port}`);
  expect(denied.status).toBe(403);
});

it('rate-limits a key', async () => {
  const kg = await gw.keys.upsertGroup({ id: 'slow', name: 'Slow', routeGroupIds: ['main'], rateLimit: { rpm: 1 } });
  const { plaintext } = await gw.keys.create(kg.id, 'slow');
  A.handler.fn = anthropicOk('x');
  const one = await call('/main/v1/messages', { model: 'm', max_tokens: 1, messages: [] }, { 'x-api-key': plaintext }, `http://127.0.0.1:${gw.port}`);
  expect(one.status).toBe(200);
  const two = await call('/main/v1/messages', { model: 'm', max_tokens: 1, messages: [] }, { 'x-api-key': plaintext }, `http://127.0.0.1:${gw.port}`);
  expect(two.status).toBe(429);
  expect(two.headers.get('retry-after')).toBeTruthy();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/gateway/service.test.ts`
Expected: FAIL — `/v1/messages` 404 / `gw.keys` undefined。

- [ ] **Step 3: 接 keys 与路径解析**

`service.ts` 顶部补 import：`os`、`path`、`AuditLog`、`GatewayKeyStore`、`RateLimiter`、`pickRouteGroup`、`modelAllowed`、`ipInList`，以及类型 `GatewayAuditConfig`、`GatewayKey`、`GatewayKeyGroup`、`GatewayLanConfig`、`GatewayLanStatus`。

构造函数：

```ts
readonly keys: GatewayKeyStore;
readonly audit: AuditLog;
private limiter = new RateLimiter();
constructor(private deps: GatewayDeps) {
  super();
  this.keys = deps.keys ?? new GatewayKeyStore(deps.meta, deps.secrets);
  this.audit = deps.audit ?? new AuditLog(path.join(os.tmpdir(), 'cw-gateway-audit'), () => deps.meta.gatewayAudit());
  this.audit.on('lines', (lines) => this.emit('audit', lines));
  // key usage counters are in memory; write them at most every 30 s, like the account counters
  this.usageTimer = setInterval(() => { void this.keys.saveUsage(); }, 30_000);
  this.usageTimer.unref?.();
  ...
}
private usageTimer: NodeJS.Timeout;
async stop(): Promise<void> { clearInterval(this.usageTimer); await this.keys.saveUsage(); await this.audit.flushNow(); this.audit.stop(); }
```

`init()`：

```ts
async init() {
  const c = this.deps.meta.gatewayConfig();
  if (c.key) { try { this.key = await this.deps.secrets!.reveal(c.key); } catch (e) { console.error('[gateway] cannot decrypt key:', (e as Error).message); } }
  if (this.key) await this.keys.migrateLegacy(this.key);
}
```

`setEnabled()` 里，生成 / 已有密钥后都迁移一次：

```ts
async setEnabled(on: boolean) {
  if (on && !this.key) await this.storeKey(newKey());
  if (on && this.key) await this.keys.migrateLegacy(this.key);
  this.deps.meta.gatewayConfig().enabled = on;
  await this.deps.meta.saveGateway();
  this.emit('changed');
}
```

`regenerateKey()` 加 `await this.keys.replaceLegacy(k)`。

`presentedKeys()` 默认不读 `?key=`（URL 会进日志和历史）：

```ts
private presentedKeys(req: http.IncomingMessage, url: URL): string[] {
  const h = req.headers;
  const bearer = /^Bearer\s+(.+)$/i.exec(String(h.authorization ?? ''))?.[1];
  const allowQuery = this.deps.meta.settings()['gateway.allowQueryKey'] === true;
  return [h['x-api-key'], bearer, h['x-goog-api-key'], ...(allowQuery ? [url.searchParams.get('key')] : [])]
    .map((v) => String(v ?? '').trim()).filter(Boolean);
}
```

`setAudit()`：

```ts
async setAudit(patch: Partial<GatewayAuditConfig>): Promise<void> {
  Object.assign(this.deps.meta.gatewayAudit(), patch);
  await this.deps.meta.saveGateway();
  this.emit('changed');
}
```

`handle()`：

```ts
handle(req, res, url): boolean {
  const path = url.pathname;
  const legacy = path === '/gateway' || path.startsWith('/gateway/');
  const explicit = /^\/([A-Za-z0-9_-]{1,40})\/(v1|v1beta)(\/|$)/.exec(path);
  const root = /^\/(v1|v1beta)(\/|$)/.test(path) || path === '/healthz';
  if (!legacy && !explicit && !root) return false;
  if ((req.socket as any).cwRemote || !isLoopback(req.socket.remoteAddress)) { res.writeHead(404).end(); return true; }
  if (legacy && path.startsWith(`/gateway/${SPLIT_PREFIX}/`)) {
    void this.serveSplit(req, res, url).catch((e) => {
      console.error('[gateway split]', e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: String(e?.message ?? e) } }));
      else res.destroy();
    });
    return true;
  }
  if (legacy && path.startsWith(SHIM_PREFIX)) {
    void this.shim.serve(req, res, url).catch((e) => {
      console.error('[gateway shim]', e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: String(e?.message ?? e) } }));
      else res.destroy();
    });
    return true;
  }
  const groupId = legacy ? /^\/gateway\/([^/]+)/.exec(path)?.[1] : explicit?.[1];
  const rest = legacy ? (path === '/gateway' ? '/' : path.replace(/^\/gateway\/[^/]+/, '') || '/') : explicit ? path.slice(explicit[1].length) : path;
  void this.serveRequest(req, res, url, { surface: 'loopback', groupId: groupId ? decodeURIComponent(groupId) : undefined, rest }).catch((e) => {
    console.error('[gateway]', e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: String(e?.message ?? e) } }));
    else res.destroy();
  });
  return true;
}
```

`serveRequest`：

```ts
private async serveRequest(req, res, url, o: { surface: 'loopback' | 'lan'; groupId?: string; rest: string }) {
  let rest = o.rest;
  if (!/^\/v1(beta)?\//.test(rest)) rest = `/v1${rest === '/' ? '' : rest}`;
  const route = routeOf(req.method ?? 'GET', rest, req.headers);
  const inbound = route?.inbound ?? (rest.startsWith('/v1beta') ? 'gemini' : req.headers['anthropic-version'] ? 'anthropic' : 'openai');
  if (url.pathname === '/healthz') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
  if (!this.enabled()) return this.sendError(res, inbound, 503, tr('模型网关未启用（设置 → 模型网关）'));
  const presented = this.presentedKeys(req, url);
  let auth = presented.map((k) => this.keys.verify(k)).find(Boolean) ?? null;
  // the legacy single key (tests, and the moment before init migrated it): make its default key on demand
  if (!auth && presented.some((k) => this.keyOk(k))) {
    await this.keys.migrateLegacy(this.key);
    const k = this.keys.list().find((x) => x.id === 'key_default');
    const g = this.keys.group('default');
    if (k && g) auth = { key: k, group: g };
  }
  if (!auth) return this.sendError(res, inbound, 401, tr('网关密钥无效'));
  const ip = String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  // an explicit group the key may not use is a permission error, not "no such group"
  if (o.groupId && auth.group.routeGroupIds.length && !auth.group.routeGroupIds.includes(o.groupId)) {
    return this.sendError(res, inbound, 403, tr('这个密钥不能使用组「{group}」', { group: o.groupId }));
  }
  if (o.surface === 'lan') {
    if (!auth.group.allowLan) return this.sendError(res, inbound, 403, tr('这个密钥不允许从局域网使用'));
    if (auth.group.ipAllowlist.length && !ipInList(ip, auth.group.ipAllowlist)) return this.sendError(res, inbound, 403, tr('来源 IP 不在白名单'));
  } else if (auth.group.ipAllowlist.length && !ipInList(ip, auth.group.ipAllowlist) && !isLoopback(ip)) {
    return this.sendError(res, inbound, 403, tr('来源 IP 不在白名单'));
  }
  const take = this.limiter.take(auth.key.id, auth.group.rateLimit);
  if (!take.ok) return this.sendError(res, inbound, 429, take.reason === 'concurrent' ? tr('这个密钥同时进行的请求太多') : tr('这个密钥每分钟的请求太多'), { 'retry-after': String(Math.max(1, Math.ceil(take.retryAfterMs / 1000))) });
  res.on('close', take.release);
  const spend = this.keys.canSpend(auth.key, auth.group);
  if (!spend.ok) return this.sendError(res, inbound, 429, spend.message, { 'retry-after': String(secondsToMidnight()) });
  if (route?.op === 'models') {
    const picked = pickRouteGroup({ pathGroupId: o.groupId, model: '', groups: this.groups(), allowed: auth.group.routeGroupIds });
    if ('error' in picked) return this.sendError(res, inbound, picked.error === 'ambiguous' ? 400 : 404, picked.error === 'ambiguous' ? tr('请指定组：{groups}', { groups: picked.groups.join('、') }) : tr('没有可用的组'));
    return this.serveModels(res, picked.group, route.inbound);
  }
  if (!route) return this.sendError(res, inbound, 404, tr('网关不支持这个接口：{method} {rest}', { method: req.method, rest }));
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > (this.deps.meta.gatewayLan().maxBodyBytes || BODY_LIMIT)) return this.sendError(res, inbound, 413, tr('请求体过大')); chunks.push(c as Buffer); }
  const raw = Buffer.concat(chunks);
  let json: any;
  try { json = JSON.parse(raw.toString('utf8') || '{}'); } catch { return this.sendError(res, inbound, 400, tr('请求体不是合法 JSON')); }
  const model = route.model ?? String(json?.model ?? '');
  const picked = pickRouteGroup({ pathGroupId: o.groupId, model, groups: this.groups(), allowed: auth.group.routeGroupIds });
  if ('error' in picked) return this.sendError(res, inbound, picked.error === 'ambiguous' ? 400 : 404, picked.error === 'ambiguous' ? tr('请用「组名/模型」指定组：{groups}', { groups: picked.groups.join('、') }) : tr('没有可用的组'));
  if (!modelAllowed(picked.model, auth.group.modelAllowlist, auth.group.modelDeny)) return this.sendError(res, inbound, 403, tr('这个密钥不能用模型 {model}', { model: picked.model }));
  const stream = route.inbound === 'gemini' ? route.stream : !!json?.stream;
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  const params = new URLSearchParams(url.search); params.delete('key');
  const ctx: Ctx = { req, res, group: picked.group, route: { ...route, stream }, path: rest, search: params.toString() ? `?${params}` : '', raw, json, model: picked.model, signal: ac.signal, t0: Date.now(), customTools: new Set(), keyId: auth.key.id, ip, surface: o.surface };
  return this.run(ctx);
}
```

`record()` 末尾：

```ts
this.keys.recordUsage(ctx.keyId ?? '', (usage?.input ?? 0) + (usage?.cacheRead ?? 0), usage?.output ?? 0, 0);
this.audit.write({ ts: Date.now(), keyId: ctx.keyId ?? '', ip: ctx.ip, protocol: ctx.route.inbound, model: a.model, routeGroupId: ctx.group.id, member: p.name, status: a.status, ms: Date.now() - ctx.t0, tokensIn: (usage?.input ?? 0) + (usage?.cacheRead ?? 0), tokensOut: usage?.output ?? 0, errorCode: a.kind === 'done' ? '' : String(a.status) });
if (p.auth) this.deps.upstreams?.noteUse(p.id, { input: (usage?.input ?? 0) + (usage?.cacheRead ?? 0), output: usage?.output ?? 0 });
```

`GatewayDeps` 加：

```ts
  keys?: GatewayKeyStore;
  audit?: AuditLog;
  upstreams?: UpstreamService;
```

`secondsToMidnight()`：

```ts
const secondsToMidnight = () => { const d = new Date(); const n = new Date(d); n.setHours(24, 0, 0, 0); return Math.max(1, Math.ceil((n.getTime() - d.getTime()) / 1000)); };
```

- [ ] **Step 4: 运行测试**

Run: `cd server && npx vitest run src/gateway/service.test.ts`
Expected: PASS（原有 + 新增；原有 `/gateway/<group>` 用例继续通过）。

- [ ] **Step 5: 提交**

```bash
git add server/src/gateway/service.ts server/src/gateway/handlers.ts server/src/gateway/service.test.ts
git commit -m "feat(gateway): root routes, key groups, ip allowlists, rate limits and budgets"
```

---

## Task 10: 局域网监听器

**Files:**
- Create: `server/src/gateway/listener.ts`
- Modify: `server/src/gateway/service.ts`（LAN 配置 / 启停 / handleLan）
- Test: `server/src/gateway/service.test.ts`（追加）

**Interfaces:**
- Produces:
  - `class GatewayListener { start(bind, port); stop(); running; port }`
  - `GatewayService.lanStatus() / setLan(config) / startLan() / stopLan() / handleLan(req,res,url)`

- [ ] **Step 1: 追加失败测试**

```ts
it('LAN listener exposes only the data plane and requires allowLan', async () => {
  const kg = await gw.keys.upsertGroup({ id: 'lan', name: 'LAN', routeGroupIds: ['main'], allowLan: true, ipAllowlist: ['127.0.0.0/8'] });
  const { plaintext } = await gw.keys.create(kg.id, 'lan');
  await gw.setLan({ enabled: true, bind: '127.0.0.1', port: 0 });
  const lan = `http://127.0.0.1:${gw.lanStatus().port}`;
  A.handler.fn = anthropicOk('lan');
  const ok = await call('/v1/messages', { model: 'm', max_tokens: 1, messages: [] }, { 'x-api-key': plaintext }, lan);
  expect(ok.status).toBe(200);
  const admin = await fetch(`${lan}/gateway/main/v1/messages`, { method: 'POST', headers: { 'x-api-key': plaintext }, body: '{}' });
  expect(admin.status).toBe(404);
  // the default key group does not allow LAN
  const denied = await call('/v1/messages', { model: 'm', max_tokens: 1, messages: [] }, { 'x-api-key': key }, lan);
  expect(denied.status).toBe(403);
  await gw.stopLan();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/gateway/service.test.ts`
Expected: FAIL — `setLan` undefined。

- [ ] **Step 3: 实现 listener 与 service**

```ts
// server/src/gateway/listener.ts
import http from 'node:http';

export class GatewayListener {
  private srv: http.Server | null = null;
  private _port = 0;
  constructor(private onRequest: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void) {}
  get running() { return !!this.srv; }
  get port() { return this._port; }

  async start(bind: string, port: number): Promise<number> {
    await this.stop();
    const srv = http.createServer((req, res) => {
      let url: URL;
      try { url = new URL(req.url ?? '/', `http://${bind}`); } catch { res.writeHead(400).end(); return; }
      this.onRequest(req, res, url);
    });
    await new Promise<void>((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(port, bind, () => resolve());
    });
    this.srv = srv;
    this._port = (srv.address() as { port: number }).port;
    return this._port;
  }

  async stop(): Promise<void> {
    const srv = this.srv;
    if (!srv) return;
    this.srv = null;
    this._port = 0;
    await new Promise<void>((r) => { srv.close(() => r()); srv.closeAllConnections(); });
  }
}
```

`GatewayService`：

```ts
private lan: GatewayListener;
constructor(...) { ...; this.lan = new GatewayListener((req, res, url) => this.handleLan(req, res, url)); }

lanStatus(): GatewayLanStatus {
  const c = this.deps.meta.gatewayLan();
  const addresses = Object.values(os.networkInterfaces()).flat().filter((x): x is os.NetworkInterfaceInfo => !!x && x.family === 'IPv4' && !x.internal).map((x) => x.address);
  return { ...c, running: this.lan.running, port: this.lan.port, addresses, audit: this.deps.meta.gatewayAudit() };
}

async setLan(patch: Partial<GatewayLanConfig> & { confirmAny?: boolean }): Promise<GatewayLanStatus> {
  const c = this.deps.meta.gatewayLan();
  if (patch.bind !== undefined) {
    const priv = patch.bind === '0.0.0.0' || patch.bind === '127.0.0.1' || /^10\./.test(patch.bind) || /^192\.168\./.test(patch.bind) || /^172\.(1[6-9]|2\d|3[01])\./.test(patch.bind);
    if (!priv) throw new Error(tr('监听地址必须是本机私网 IP 或 0.0.0.0'));
    if (patch.bind === '0.0.0.0' && !patch.confirmAny) throw new Error(tr('监听 0.0.0.0 需要二次确认'));
    c.bind = patch.bind;
  }
  if (patch.port !== undefined) c.port = Math.max(0, Math.floor(patch.port));
  if (patch.ipAllowlist !== undefined) c.ipAllowlist = patch.ipAllowlist.map((x) => x.trim()).filter(Boolean);
  if (patch.corsOrigins !== undefined) c.corsOrigins = patch.corsOrigins.map((x) => x.trim()).filter(Boolean);
  if (patch.maxBodyBytes !== undefined) c.maxBodyBytes = Math.max(1024, Math.floor(patch.maxBodyBytes));
  if (patch.enabled !== undefined) c.enabled = patch.enabled;
  await this.deps.meta.saveGateway();
  if (c.enabled) await this.startLan(); else await this.stopLan();
  this.emit('changed');
  return this.lanStatus();
}

async startLan(): Promise<void> {
  const c = this.deps.meta.gatewayLan();
  if (!c.enabled) return;
  try { await this.lan.start(c.bind, c.port); } catch (e: any) { console.error('[gateway lan]', e?.message ?? e); await this.lan.stop(); }
}

async stopLan(): Promise<void> { await this.lan.stop(); }

private handleLan(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const p = url.pathname;
  const ok = p === '/healthz' || /^\/(v1|v1beta)(\/|$)/.test(p);
  if (!ok) { res.writeHead(404).end(); return; }
  const c = this.deps.meta.gatewayLan();
  // CORS: no header by default; a listed origin is echoed, never `*`
  const origin = String(req.headers.origin ?? '');
  if (origin && c.corsOrigins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-headers', 'content-type, x-api-key, authorization, x-goog-api-key, anthropic-version, anthropic-beta');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  }
  const ip = String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  if (c.ipAllowlist.length && !ipInList(ip, c.ipAllowlist)) { res.writeHead(403).end(); return; }
  if (p === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true })); return; }
  void this.serveRequest(req, res, url, { surface: 'lan', rest: p }).catch((e) => { console.error('[gateway lan]', e); if (!res.headersSent) res.writeHead(500).end(); else res.destroy(); });
}
```

`init()` 末尾加 `await this.startLan();`。

`index.ts` 关闭顺序里 `await gateway.stopLan();` 放在 `remote.stop()` 之前。

- [ ] **Step 4: 运行测试**

Run: `cd server && npx vitest run src/gateway/service.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/gateway/listener.ts server/src/gateway/service.ts server/src/gateway/service.test.ts
git commit -m "feat(gateway): separate LAN data-plane listener"
```

---

## Task 11: Hub / index 接线与请求分发

**Files:**
- Modify: `server/src/ws/hub.ts:78-140`, `:180-200`, `:1030-1040`
- Modify: `server/src/index.ts:306-350`, `:421-438`, `:488-505`
- Modify: `server/src/gateway/handlers.ts`
- Test: 现有 `npm run typecheck`

**Interfaces:**
- Consumes: `UpstreamService`、`GatewayKeyStore`、`AuditLog`。
- Produces: `Services.upstreams`、`upstreams.*` 分发、事件广播。

- [ ] **Step 1: 改 handlers**

```ts
import type { GatewayRequest } from './types.js';
import type { GatewayService } from './service.js';
import { keyView } from '../upstreams/keys.js';

export const isGatewayRequest = (req: { kind: string }): req is GatewayRequest => req.kind.startsWith('gateway.');

export async function handleGatewayRequest(gw: GatewayService, req: GatewayRequest): Promise<unknown> {
  switch (req.kind) {
    // 保留现有的 8 个 case：gateway.status / set / revealKey / regenerateKey / groups.upsert / groups.remove / reset / test
    case 'gateway.keys.status': return gw.keys.status();
    case 'gateway.keys.create': { const r = await gw.keys.create(req.groupId, req.name, { expiresAt: req.expiresAt }); gw.emit('changed'); return { key: keyView(r.key), plaintext: r.plaintext }; }
    case 'gateway.keys.update': { const k = await gw.keys.update(req.id, req.patch); gw.emit('changed'); return keyView(k); }
    case 'gateway.keys.remove': await gw.keys.remove(req.id); gw.emit('changed'); return null;
    case 'gateway.keys.reveal': return gw.keys.reveal(req.id);
    case 'gateway.keyGroups.upsert': return gw.keys.upsertGroup(req.group);
    case 'gateway.keyGroups.remove': await gw.keys.removeGroup(req.id); return null;
    case 'gateway.lan.status': return gw.lanStatus();
    case 'gateway.lan.set': return gw.setLan(req.config);
    case 'gateway.audit.list': return gw.audit.list(req);
    case 'gateway.audit.clear': await gw.audit.clear(); return null;
    case 'gateway.audit.export': return gw.audit.exportText();
  }
  throw new Error(`unknown request ${(req as { kind: string }).kind}`);
}
```

`GatewayService` 加 `readonly audit: AuditLog;`，构造时 `this.audit = deps.audit ?? new AuditLog(path.join(dataDir(), 'logs'), () => deps.meta.gatewayAudit());`，并把 `this.audit.on('lines', (lines) => this.emit('audit', lines))`。

- [ ] **Step 2: Hub**

`Services` 加：

```ts
  /** 账号池：Claude 订阅账号、账号池、网关目标解析（upstreams.*）。 */
  upstreams: UpstreamService;
```

`import { handleUpstreamRequest, isUpstreamRequest } from '../upstreams/handlers.js';`

事件：

```ts
    s.upstreams.on('changed', () => this.broadcast({ kind: 'upstreams.changed' }));
    s.gateway.on('changed', () => this.broadcast({ kind: 'gateway.changed' }));
    s.gateway.on('audit', (lines) => this.broadcast({ kind: 'gateway.log', lines }));
```

分发（放在 `isGatewayRequest` 前）：

```ts
    if (isUpstreamRequest(req)) return handleUpstreamRequest(s.upstreams, req);
```

- [ ] **Step 3: index.ts**

在 `gateway` 构造前：

```ts
const upstreams = new UpstreamService({ meta, secrets });
const gatewayAudit = new AuditLog(path.join(dataDir(), 'logs'), () => meta.gatewayAudit());
```

`gateway` 构造：

```ts
gateway = new GatewayService({
  meta, secrets, ledger, audit: gatewayAudit,
  member: (id) => providers.member(id),
  resolveMember: async (m, model, sessionKey) => {
    const own = await upstreams.resolveMembers(m, model, sessionKey);
    if (own.length || m.accountId || m.upstreamGroupId) return own;
    const p = m.providerId ? providers.member(m.providerId) : null;
    return p ? [p] : [];
  },
  upstreams,
});
```

`index.ts` 顶部加 `import { AuditLog } from './gateway/audit.js';` 与 `import { dataDir } from './files/service.js';`（后者若已导入则复用）。

`services` 加 `upstreams`。

关闭：

```ts
      await gateway.stopLan();
      await gateway.stop();
      await upstreams.stop();
```

放在 `await remote.stop();` 之前。

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/gateway/handlers.ts server/src/gateway/service.ts server/src/ws/hub.ts server/src/index.ts
git commit -m "feat(gateway): wire upstreams, keys, LAN and audit into the server"
```

---

## Task 12: 前端分区骨架（图标栏 / 页面 / 侧栏 / 状态）

**Files:**
- Create: `web/src/features/gateway/page.ts`, `state.ts`, `GatewayPage.tsx`, `GatewaySide.tsx`, `web/src/styles/gateway.css`
- Modify: `web/src/features/sections/pages.ts`, `sections/index.ts`, `rail/rail-model.ts`, `rail/Rail.tsx`, `workbench/Workbench.tsx`, `app/App.tsx`, `ui/icon-map.json`, `web/src/main.tsx`, `scripts/ui-smoke.cjs`
- Test: `web/src/features/gateway/page.test.ts`

**Interfaces:**
- Produces: `GatewayTab`、`GATEWAY_TABS`、`openGateway(tab?)`、`useGateway`（页面状态 + 数据）、`GatewayPage`、`GatewaySide`。

- [ ] **Step 1: 写失败测试**

```ts
// web/src/features/gateway/page.test.ts
import { describe, expect, it } from 'vitest';
import { GATEWAY_TABS, gatewayTabLabel } from './page';

describe('gateway page', () => {
  it('has the Phase A tabs in order', () => {
    expect(GATEWAY_TABS.map((t) => t.id)).toEqual(['overview', 'accounts', 'routes', 'keys', 'logs', 'settings']);
  });
  it('labels every tab', () => {
    for (const t of GATEWAY_TABS) expect(gatewayTabLabel(t.id)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && npx vitest run src/features/gateway/page.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: 页面状态与标签**

```ts
// web/src/features/gateway/page.ts
import type { IconName } from '@/ui/icons';
import { tr } from '@/i18n';

export type GatewayTab = 'overview' | 'accounts' | 'routes' | 'keys' | 'logs' | 'settings';

export const GATEWAY_TITLE = tr('网关');

export const GATEWAY_TABS: { id: GatewayTab; label: string; icon: IconName; title: string }[] = [
  { id: 'overview', label: tr('概览'), icon: 'usage', title: tr('账号、密钥、流量和局域网状态') },
  { id: 'accounts', label: tr('账号'), icon: 'agent', title: tr('订阅账号和账号池') },
  { id: 'routes', label: tr('分组与路由'), icon: 'orchestra', title: tr('网关组、成员和故障转移') },
  { id: 'keys', label: tr('密钥'), icon: 'shield', title: tr('密钥组、来源 IP、限速和预算') },
  { id: 'logs', label: tr('日志'), icon: 'config', title: tr('审计日志') },
  { id: 'settings', label: tr('设置'), icon: 'settings', title: tr('监听地址、局域网和审计保留') },
];

export const gatewayTabLabel = (id: GatewayTab): string => GATEWAY_TABS.find((t) => t.id === id)?.label ?? id;
```

（若 `list` 图标不存在，用 `config` 或已有名字；以 `web/src/ui/icon-map.json` 为准。）

```ts
// web/src/features/gateway/state.ts
import { create } from 'zustand';
import { hideSheet, useStore } from '@/store';
import { closeOtherPages, registerPage } from '@/features/sections/pages';
import { markPageOpened } from '@/features/automation/state';
import { ws } from '@/ws/client';
import type { GatewayAuditLine, GatewayGroup, GatewayKeyGroup, GatewayKeyStatus, GatewayKeyView, GatewayLanStatus, GatewayStatus, UpstreamAccountView, UpstreamGroup, UpstreamStatus } from '@shared';
import { GATEWAY_TABS, type GatewayTab } from './page';

interface GatewayState {
  open: boolean;
  tab: GatewayTab;
  seen: GatewayTab[];
  /** 账号池 (UpstreamGroup) */
  pools: UpstreamGroup[];
  /** 网关组 (GatewayGroup): what keys are allowed to use */
  routeGroups: GatewayGroup[];
  accounts: UpstreamAccountView[];
  keyGroups: GatewayKeyGroup[];
  keys: GatewayKeyView[];
  lan: GatewayLanStatus | null;
  status: GatewayStatus | null;
  logs: GatewayAuditLine[];
  loaded: boolean;
  load(): Promise<void>;
}

export const useGateway = create<GatewayState>(() => ({
  open: false, tab: 'overview', seen: [], pools: [], routeGroups: [], accounts: [], keyGroups: [], keys: [], lan: null, status: null, logs: [], loaded: false,
  async load() {
    const [up, keys, lan, logs, st] = await Promise.all([
      ws.request<UpstreamStatus>({ kind: 'upstreams.status' }),
      ws.request<GatewayKeyStatus>({ kind: 'gateway.keys.status' }),
      ws.request<GatewayLanStatus>({ kind: 'gateway.lan.status' }),
      ws.request<GatewayAuditLine[]>({ kind: 'gateway.audit.list', limit: 300 }),
      ws.request<GatewayStatus>({ kind: 'gateway.status' }),
    ]);
    // every array is replaced as a whole: selectors keep returning stable references between loads
    set({ accounts: up.accounts, pools: up.groups, keyGroups: keys.groups, keys: keys.keys, lan, status: st, logs, loaded: true });
  },
}));

let wired = false;
export function installGatewayEvents(): void {
  if (wired) return;
  wired = true;
  ws.on((e) => {
    if (e.kind === 'upstreams.changed' || e.kind === 'gateway.key.changed' || e.kind === 'gateway.changed') void useGateway.getState().load().catch(() => {});
    if (e.kind === 'gateway.log') useGateway.setState((s) => ({ logs: [...e.lines, ...s.logs].slice(0, 500) }));
  });
}

const withSeen = (seen: GatewayTab[], t: GatewayTab) => (seen.includes(t) ? seen : GATEWAY_TABS.filter((x) => x.id === t || seen.includes(x.id)).map((x) => x.id));

export function openGateway(tab?: GatewayTab): boolean {
  closeOtherPages('gateway');
  if (!useGateway.getState().open) markPageOpened();
  useGateway.setState((s) => { const t = tab ?? s.tab; return { open: true, tab: t, seen: withSeen(s.seen, t) }; });
  if (useStore.getState().mobile) { useStore.setState({ sidebarOpen: false }); hideSheet(); }
  installGatewayEvents();
  void useGateway.getState().load().catch(() => {});
  return true;
}

export function showGatewayTab(tab: GatewayTab): void { useGateway.setState((s) => ({ tab, seen: withSeen(s.seen, tab) })); }
export function closeGateway(): void { if (useGateway.getState().open) useGateway.setState({ open: false }); }

registerPage('gateway', { isOpen: () => useGateway.getState().open, close: closeGateway, subscribe: (fn) => useGateway.subscribe(fn) });
```

- [ ] **Step 4: 页面组件**

`GatewayPage.tsx`：

```tsx
import { OverPage } from '@/features/sections/OverPage';
import { useGateway, closeGateway, showGatewayTab } from './state';
import { GATEWAY_TABS, GATEWAY_TITLE } from './page';
import { OverviewTab } from './OverviewTab';
import { AccountsTab } from './AccountsTab';
import { RoutesTab } from './RoutesTab';
import { KeysTab } from './KeysTab';
import { LogsTab } from './LogsTab';
import { GatewaySettingsTab } from './GatewaySettingsTab';
import { useStore } from '@/store';
import { tr } from '@/i18n';

export function GatewayPage() {
  const open = useGateway((s) => s.open);
  const tab = useGateway((s) => s.tab);
  const seen = useGateway((s) => s.seen);
  const mobile = useStore((s) => s.mobile);
  return (
    <OverPage name="gateway" label={GATEWAY_TITLE} open={open} onClose={closeGateway} title={GATEWAY_TITLE}
      desc={tr('把订阅账号和供应商放在一个池子里，对各个 Agent 提供 Anthropic / OpenAI / Gemini 接口')}
      tab={tab} tabs={GATEWAY_TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, title: t.title }))}
      showTabs={mobile} onTab={(id) => showGatewayTab(id as any)}>
      {seen.includes('overview') && <div hidden={tab !== 'overview'}><OverviewTab /></div>}
      {seen.includes('accounts') && <div hidden={tab !== 'accounts'}><AccountsTab /></div>}
      {seen.includes('routes') && <div hidden={tab !== 'routes'}><RoutesTab /></div>}
      {seen.includes('keys') && <div hidden={tab !== 'keys'}><KeysTab /></div>}
      {seen.includes('logs') && <div hidden={tab !== 'logs'}><LogsTab /></div>}
      {seen.includes('settings') && <div hidden={tab !== 'settings'}><GatewaySettingsTab /></div>}
    </OverPage>
  );
}
```

`GatewaySide.tsx`：

```tsx
import { SectionSide } from '@/features/sections/SectionSide';
import { useGateway, showGatewayTab } from './state';
import { GATEWAY_TABS, GATEWAY_TITLE } from './page';
import { tr } from '@/i18n';

export function GatewaySide() {
  const tab = useGateway((s) => s.tab);
  const accounts = useGateway((s) => s.accounts.length);
  return (
    <SectionSide name="gateway" title={GATEWAY_TITLE} tab={tab} onTab={(id) => showGatewayTab(id as any)}
      tabs={GATEWAY_TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, title: t.title, count: t.id === 'accounts' && accounts ? <span className="count">{accounts}</span> : undefined }))}>
      <div className="sect-note">{tr('账号池只存在这台电脑上；局域网默认关闭。')}</div>
    </SectionSide>
  );
}
```

（先放空壳的六个 Tab 组件，每个返回 `<div className="section gateway-tab" />`，下一批任务填充。）

- [ ] **Step 5: 接进分区 / 图标栏 / 应用**

`web/src/features/sections/pages.ts`：

```ts
export type Section = 'chat' | 'background' | 'automation' | 'extensions' | 'gateway';
```

`web/src/features/sections/index.ts` 加：

```ts
import '@/features/gateway/state';
```

`rail-model.ts` 在 `automation` 与 `extensions` 之间加：

```ts
  { id: 'gateway', label: tr('网关'), icon: 'gateway', tip: tr('网关：账号池、密钥、局域网') },
```

`Rail.tsx`：

```ts
import { openGateway } from '@/features/gateway/state';
const OPEN: Record<Section, () => void> = { ..., gateway: () => { openGateway(); } };
```

`App.tsx` 顶部 import `GatewaySide`，在 `extensions` 前加：

```tsx
      {seen.includes('gateway') && <div className="sb-sect" data-section="gateway" hidden={section !== 'gateway'}><ErrorBoundary area={tr('侧栏 · 网关')}><GatewaySide /></ErrorBoundary></div>}
```

`Workbench.tsx` 顶部 import `useGateway`，再加：

```tsx
const GatewayPage = lazy(() => import('@/features/gateway/GatewayPage').then((m) => ({ default: m.GatewayPage })));
...
const gwSeen = useGateway((s) => s.seen.length > 0);
...
{gwSeen && <ErrorBoundary area={tr('网关')}><Suspense fallback={null}><GatewayPage /></Suspense></ErrorBoundary>}
```

`icon-map.json` 加 `"gateway": "server"`，然后跑 `node scripts/gen-icons.mjs`。

`main.tsx` 加 `import './styles/gateway.css';`。样式先写：

```css
.gateway-page .gateway-tab { padding: 16px 24px; overflow: auto; }
.gateway-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.gateway-card { background: var(--surface-0); border-radius: var(--r-card); box-shadow: var(--elev-1); padding: 12px 14px; }
.gateway-card .n { font: var(--fs-xl); }
.gateway-card .l { color: var(--ink-3); font-size: var(--fs-sm); }
.gateway-row { display: flex; align-items: center; gap: 10px; padding: 10px 4px; border-bottom: 1px solid var(--edge-subtle); }
.gateway-row .grow { flex: 1; }
.gateway-badge { border-radius: var(--r-pill); padding: 1px 8px; font-size: var(--fs-sm); background: var(--surface-2); }
.gateway-badge.ok { color: var(--ok); }
.gateway-badge.bad { color: var(--err); }
.gateway-badge.warn { color: var(--warn); }
.gateway-log { max-height: calc(100vh - 220px); overflow: auto; }
.gateway-log .gateway-row { font-size: var(--fs-sm); }
```

- [ ] **Step 6: 更新 ui-smoke 期望**

`scripts/ui-smoke.cjs:565` 的字符串改为：

```js
chrome.iconRail === 'chat background automation gateway extensions more'
```

并在扩展页检查之后加一段：点击 `[data-id="gateway"]`，等待 `.gateway-page:not([hidden])`，确认无 console 错误，再点 `[data-id="chat"]`。

- [ ] **Step 7: 运行测试**

Run: `cd web && npx vitest run src/features/gateway/page.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add web/src/features/gateway web/src/features/sections web/src/features/rail web/src/features/workbench/Workbench.tsx web/src/app/App.tsx web/src/ui/icon-map.json web/src/ui/icons.generated.ts web/src/main.tsx web/src/styles/gateway.css scripts/ui-smoke.cjs
git commit -m "feat(gateway): gateway section shell in the icon rail"
```

---

## Task 13: 概览页

**Files:**
- Modify: `web/src/features/gateway/OverviewTab.tsx`

**Interfaces:**
- Consumes: `useGateway`、`ws`。
- Produces: 概览卡片、启用开关、地址与密钥入口、LAN 状态。

- [ ] **Step 1: 实现**

```tsx
import { ws } from '@/ws/client';
import { useGateway, showGatewayTab } from './state';
import { useStore } from '@/store';
import { tr } from '@/i18n';

export function OverviewTab() {
  const accounts = useGateway((s) => s.accounts);
  const keys = useGateway((s) => s.keys);
  const lan = useGateway((s) => s.lan);
  const logs = useGateway((s) => s.logs);
  const st = useGateway((s) => s.status);
  const toast = useStore((s) => s.toast);
  const toggle = async (on: boolean) => {
    try { await ws.request({ kind: 'gateway.set', enabled: on }); await useGateway.getState().load(); } catch (e: any) { toast(e.message); }
  };
  const healthy = accounts.filter((a) => a.health === 'ok').length;
  const today = keys.reduce((n, k) => n + k.stats.requests, 0);
  const errors = logs.filter((l) => l.status >= 400).length;
  return (
    <div className="gateway-tab">
      <div className="gateway-cards">
        <div className="gateway-card"><div className="n">{accounts.length}</div><div className="l">{tr('账号')} · {tr('{n} 个正常', { n: healthy })}</div></div>
        <div className="gateway-card"><div className="n">{keys.length}</div><div className="l">{tr('密钥')}</div></div>
        <div className="gateway-card"><div className="n">{today}</div><div className="l">{tr('今天请求')}</div></div>
        <div className="gateway-card"><div className="n">{errors}</div><div className="l">{tr('最近错误')}</div></div>
      </div>
      <div className="gateway-row" style={{ marginTop: 16 }}>
        <label className="chip"><input type="checkbox" checked={!!st?.enabled} onChange={(e) => toggle(e.target.checked)} /> {tr('启用本机模型网关')}</label>
        <span className="grow" />
        <button className="btn sm" onClick={() => showGatewayTab('keys')}>{tr('管理密钥')}</button>
      </div>
      {st?.enabled && <div className="gw-endpoint"><div className="gw-kv"><span className="muted">{tr('地址')}</span><code>{st?.baseUrl.replace(/\/gateway$/, '')}/&lt;组&gt;/v1</code></div><div className="gw-kv"><span className="muted">{tr('默认密钥')}</span><code>{st?.keyMasked}</code></div></div>}
      <div className="gateway-row"><span>{tr('局域网')}</span><span className="grow" /><span className={lan?.running ? 'gateway-badge ok' : 'gateway-badge'}>{lan?.running ? tr('监听中 {port}', { port: lan.port }) : tr('关闭')}</span><button className="btn sm ghost" onClick={() => showGatewayTab('settings')}>{tr('设置')}</button></div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd web && npm run typecheck`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add web/src/features/gateway/OverviewTab.tsx
git commit -m "feat(gateway): overview tab"
```

---

## Task 14: 账号页 + 添加账号向导

**Files:**
- Modify: `web/src/features/gateway/AccountsTab.tsx`, `AccountRow.tsx`, `QuotaBar.tsx`, `AddAccountWizard.tsx`

**Interfaces:**
- Consumes: `upstreams.add/update/remove/probe/reset`。
- Produces: 列表、健康 / 额度、粘贴 / 文件导入、启停、探测、删除。

- [ ] **Step 1: 实现 AccountRow / QuotaBar**

```tsx
// QuotaBar.tsx
import type { QuotaWindow } from '@shared';
import { tr } from '@/i18n';

export function QuotaBar({ w }: { w: QuotaWindow }) {
  const pct = w.usedPct ?? (w.used !== undefined && w.limit ? Math.round((w.used / w.limit) * 100) : undefined);
  return (
    <span className="quota-bar" title={`${w.label}${pct === undefined ? '' : ` · ${pct}%`}`}>
      <span className="q-label">{w.label}</span>
      <span className="q-track"><span className="q-fill" style={{ width: `${pct ?? 0}%` }} /></span>
      <span className="q-num">{pct === undefined ? tr('未知') : `${pct}%`}</span>
    </span>
  );
}
```

```tsx
// AccountRow.tsx
import { Icon } from '@/ui/icons';
import { ago } from '@/util';
import type { UpstreamAccountView } from '@shared';
import { QuotaBar } from './QuotaBar';
import { tr } from '@/i18n';

const HEALTH: Record<UpstreamAccountView['health'], { l: string; c: string }> = {
  unknown: { l: tr('未检查'), c: '' }, ok: { l: tr('正常'), c: 'ok' }, cooling: { l: tr('冷却中'), c: 'warn' },
  expired: { l: tr('已过期'), c: 'bad' }, disabled: { l: tr('已停用'), c: '' }, error: { l: tr('出错'), c: 'bad' },
};

export function AccountRow(p: { a: UpstreamAccountView; busy: boolean; onProbe(): void; onToggle(): void; onRemove(): void; onEdit(): void }) {
  const h = HEALTH[p.a.health];
  return (
    <div className="gateway-row" data-id={p.a.id}>
      <Icon name="agent" size={16} />
      <span className="grow"><span className="l">{p.a.name}</span><span className="sub">{p.a.identity?.email ?? p.a.kind} · {p.a.credentialMasked}</span></span>
      {p.a.quota?.windows.slice(0, 2).map((w) => <QuotaBar key={w.id} w={w} />)}
      <span className={`gateway-badge ${h.c}`}>{h.l}</span>
      <span className="sub">{p.a.lastUsedAt ? tr('{a}前用过', { a: ago(p.a.lastUsedAt) }) : tr('没用过')}</span>
      <button className="btn sm ghost" disabled={p.busy} onClick={p.onProbe}>{tr('检查')}</button>
      <button className="btn sm ghost" disabled={p.busy} onClick={p.onEdit}>{tr('编辑')}</button>
      <button className="btn sm ghost" onClick={p.onToggle}>{p.a.enabled ? tr('停用') : tr('启用')}</button>
      <button className="btn sm ghost danger" onClick={p.onRemove}>{tr('删除')}</button>
    </div>
  );
}
```

- [ ] **Step 2: 实现 AccountsTab**

```tsx
import { useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import { useGateway } from './state';
import { AccountRow } from './AccountRow';
import { AddAccountWizard } from './AddAccountWizard';
import type { UpstreamStatus } from '@shared';
import { tr } from '@/i18n';

export function AccountsTab() {
  const accounts = useGateway((s) => s.accounts);
  const toast = useStore((s) => s.toast);
  const [add, setAdd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => useGateway.getState().load().catch(() => {});
  const run = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(id);
    try { await fn(); if (ok) toast(ok, true); await reload(); } catch (e: any) { toast(e.message); } finally { setBusy(null); }
  };
  const remove = async (id: string, name: string) => {
    if (!(await dlg.confirm(tr('删除账号「{name}」？', { name }), { message: tr('会从所有账号池和网关组里移除，凭据一并删除。'), danger: true, okLabel: tr('删除') }))) return;
    await run(id, () => ws.request({ kind: 'upstreams.remove', id }), tr('已删除'));
  };
  return (
    <div className="gateway-tab">
      <div className="gateway-row"><span className="grow">{tr('Claude 订阅账号（{n}）', { n: accounts.length })}</span><button className="btn sm" onClick={() => setAdd(true)}>{tr('添加账号')}</button></div>
      {accounts.length === 0 && <div className="empty">{tr('还没有账号。用订阅账号的令牌或 OAuth JSON 添加一个。')}</div>}
      {accounts.map((a) => <AccountRow key={a.id} a={a} busy={busy === a.id}
        onProbe={() => run(a.id, () => ws.request({ kind: 'upstreams.probe', id: a.id }))}
        onToggle={() => run(a.id, () => ws.request({ kind: 'upstreams.update', id: a.id, patch: { enabled: !a.enabled } }))}
        onEdit={() => setAdd(true)}
        onRemove={() => remove(a.id, a.name)} />)}
      {add && <AddAccountWizard onClose={() => { setAdd(false); void reload(); }} />}
    </div>
  );
}
```

- [ ] **Step 3: 实现 AddAccountWizard（粘贴 / 文件；OAuth、扫码、桌面导入在阶段 B）**

```tsx
import { useRef, useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { tr } from '@/i18n';

export function AddAccountWizard({ onClose }: { onClose(): void }) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
  };
  const save = async () => {
    if (!text.trim()) { toast(tr('先粘贴令牌或选择文件')); return; }
    setBusy(true);
    try {
      const r = await ws.request<{ duplicate: boolean }>({ kind: 'upstreams.add', input: { kind: 'claude', name, credential: text.trim(), source: text.trim().startsWith('{') ? 'file' : 'paste' } });
      toast(r.duplicate ? tr('这个账号已经在池子里了') : tr('已添加并检查'), true);
      onClose();
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ width: 560 }}>
        <h3>{tr('添加 Claude 账号')}</h3>
        <div className="sub">{tr('支持 sk-ant-oat… 令牌，或包含 accessToken / refreshToken 的 JSON。凭据加密保存在这台电脑上，不会出现在日志里。')}</div>
        <label className="field"><span>{tr('名称')}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('可留空')} /></label>
        <label className="field"><span>{tr('凭据')}</span><textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('粘贴令牌或 JSON')} /></label>
        <input ref={file} type="file" accept=".json,.txt" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
        <div className="row"><button className="btn sm ghost" onClick={() => file.current?.click()}>{tr('从文件导入')}</button><span className="grow" /><button className="btn sm ghost" onClick={onClose} disabled={busy}>{tr('取消')}</button><button className="btn sm" onClick={save} disabled={busy}>{busy ? tr('检查中…') : tr('添加并检查')}</button></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 类型检查 + 手动冒烟**

Run: `cd web && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/gateway/AccountsTab.tsx web/src/features/gateway/AccountRow.tsx web/src/features/gateway/QuotaBar.tsx web/src/features/gateway/AddAccountWizard.tsx
git commit -m "feat(gateway): accounts tab and paste/file onboarding"
```

---

## Task 15: 分组与路由页（旧组编辑器迁入）

**Files:**
- Modify: `web/src/features/gateway/RoutesTab.tsx`
- Modify: `web/src/features/settings/GatewaySection.tsx`（删掉组编辑，只留卡片）
- Test: `web/src/features/settings/wording.test.ts`（现有）

**Interfaces:**
- Consumes: `gateway.status`、`gateway.groups.upsert/remove`、`gateway.reset`、`upstreams.status`。
- Produces: 组列表、成员三选一（供应商 / 账号 / 账号池）、策略、模型映射。

- [ ] **Step 1: 实现 RoutesTab**

```tsx
import { useEffect, useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { useGateway } from './state';
import { dlg } from '@/ui/dialog';
import type { GatewayGroup, GatewayMember, GatewayStatus } from '@shared';
import { tr } from '@/i18n';

export function RoutesTab() {
  const pools = useGateway((s) => s.pools);
  const accounts = useGateway((s) => s.accounts);
  const providers = useStore((s) => s.providers);
  const toast = useStore((s) => s.toast);
  const [st, setSt] = useState<GatewayStatus | null>(null);
  const load = () => ws.request<GatewayStatus>({ kind: 'gateway.status' }).then(setSt).catch((e) => toast(e.message));
  useEffect(() => { void load(); }, []);
  const save = async (g: GatewayGroup) => { try { await ws.request({ kind: 'gateway.groups.upsert', group: g }); await load(); } catch (e: any) { toast(e.message); } };
  const add = async () => { const name = await dlg.prompt(tr('组名称'), tr('默认组')); if (!name) return; await save({ id: '', name, strategy: 'failover', members: [] } as any); };
  const memberValue = (m: GatewayMember) => m.accountId ? `a:${m.accountId}` : m.upstreamGroupId ? `u:${m.upstreamGroupId}` : `p:${m.providerId}`;
  const setMembers = (g: GatewayGroup, values: string[]) => save({ ...g, members: values.map((v) => v.startsWith('a:') ? { accountId: v.slice(2) } : v.startsWith('u:') ? { upstreamGroupId: v.slice(2) } : { providerId: v.slice(2) }) });
  return (
    <div className="gateway-tab">
      <div className="gateway-row"><span className="grow">{tr('网关组')}</span><button className="btn sm" onClick={add}>{tr('新建组')}</button></div>
      {(st?.groups ?? []).map((g) => (
        <div className="gateway-card" key={g.id} style={{ marginTop: 10 }}>
          <div className="gateway-row"><b>{g.name}</b><code className="sub">{g.id}</code><span className="grow" />
            <select value={g.strategy} onChange={(e) => save({ ...g, strategy: e.target.value as any })}>
              <option value="failover">{tr('按顺序故障转移')}</option><option value="round-robin">{tr('轮询')}</option>
            </select>
            <button className="btn sm ghost danger" onClick={async () => { if (await dlg.confirm(tr('删除组「{name}」？', { name: g.name }), { danger: true })) { await ws.request({ kind: 'gateway.groups.remove', id: g.id }); await load(); } }}>{tr('删除')}</button>
          </div>
          <div className="sub">{tr('成员（按顺序尝试）')}</div>
          {g.members.map((m, i) => (
            <div className="gateway-row" key={i}>
              <select value={memberValue(m)} onChange={(e) => { const next = [...g.members]; next[i] = e.target.value.startsWith('a:') ? { accountId: e.target.value.slice(2) } : e.target.value.startsWith('u:') ? { upstreamGroupId: e.target.value.slice(2) } : { providerId: e.target.value.slice(2) }; void save({ ...g, members: next }); }}>
                <optgroup label={tr('供应商')}>{providers.filter((p) => p.type !== 'gateway').map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>
                <optgroup label={tr('账号')}>{accounts.map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name}</option>)}</optgroup>
                <optgroup label={tr('账号池')}>{pools.map((p) => <option key={p.id} value={`u:${p.id}`}>{p.name}</option>)}</optgroup>
              </select>
              <input placeholder={tr('固定模型（可留空）')} value={m.model ?? ''} onChange={(e) => { const next = [...g.members]; next[i] = { ...m, model: e.target.value || undefined }; void save({ ...g, members: next }); }} />
              <button className="btn sm ghost" onClick={() => void setMembers(g, g.members.filter((_, x) => x !== i).map(memberValue))}>{tr('移除')}</button>
            </div>
          ))}
          <div className="row"><select defaultValue="" onChange={(e) => { if (!e.target.value) return; void setMembers(g, [...g.members.map(memberValue), e.target.value]); e.currentTarget.value = ''; }}>
            <option value="">{tr('添加成员…')}</option>
            {providers.filter((p) => p.type !== 'gateway').map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}
            {accounts.map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name}</option>)}
            {pools.map((p) => <option key={p.id} value={`u:${p.id}`}>{p.name}</option>)}
          </select></div>
          <div className="sub">{tr('成员状态：{states}', { states: (st?.states[g.id] ?? []).map((x) => `${x.name}:${x.health}`).join(' · ') })}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 瘦身旧设置卡**

`GatewaySection.tsx` 只保留：启用开关、地址、密钥复制 / 重新生成、健康摘要，以及：

```tsx
<button className="btn sm" onClick={() => openGateway('overview')}>{tr('打开网关')}</button>
```

删除组编辑 JSX 与相关状态。

- [ ] **Step 3: 运行测试**

Run: `cd web && npm run typecheck && npx vitest run src/features/settings/wording.test.ts`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add web/src/features/gateway/RoutesTab.tsx web/src/features/settings/GatewaySection.tsx
git commit -m "feat(gateway): routes tab and slim settings card"
```

---

## Task 16: 密钥页

**Files:**
- Modify: `web/src/features/gateway/KeysTab.tsx`, `KeyEditor.tsx`

**Interfaces:**
- Consumes: `gateway.keys.*`、`gateway.keyGroups.*`。
- Produces: 密钥组编辑（路由组、模型白名单、LAN、IP、限速、预算）、密钥列表、一次性明文展示。

- [ ] **Step 1: 实现 KeysTab**

```tsx
import { useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { useGateway } from './state';
import { dlg } from '@/ui/dialog';
import type { GatewayKey, GatewayKeyGroup } from '@shared';
import { KeyEditor } from './KeyEditor';
import { tr } from '@/i18n';

export function KeysTab() {
  const groups = useGateway((s) => s.keyGroups);
  const keys = useGateway((s) => s.keys);
  const toast = useStore((s) => s.toast);
  const [created, setCreated] = useState<string | null>(null);
  const [edit, setEdit] = useState<GatewayKeyGroup | null>(null);
  const reload = () => useGateway.getState().load().catch(() => {});
  const create = async (groupId: string) => {
    const name = await dlg.prompt(tr('密钥名称'), tr('新密钥'));
    if (!name) return;
    try {
      const r = await ws.request<{ plaintext: string }>({ kind: 'gateway.keys.create', groupId, name });
      setCreated(r.plaintext);
      await reload();
    } catch (e: any) { toast(e.message); }
  };
  return (
    <div className="gateway-tab">
      {created && <div className="gateway-card" style={{ border: '1px solid var(--warn)' }}><div className="sub">{tr('新密钥只显示这一次，复制保存好：')}</div><code>{created}</code><div className="row"><button className="btn sm" onClick={() => { void navigator.clipboard.writeText(created); toast(tr('已复制'), true); }}>{tr('复制')}</button><button className="btn sm ghost" onClick={() => setCreated(null)}>{tr('知道了')}</button></div></div>}
      <div className="gateway-row"><span className="grow">{tr('密钥组')}</span><button className="btn sm" onClick={() => setEdit({ id: '', name: '', routeGroupIds: [], allowLan: false, ipAllowlist: [], createdAt: 0 })}>{tr('新建密钥组')}</button></div>
      {groups.map((g) => (
        <div className="gateway-card" key={g.id} style={{ marginTop: 10 }}>
          <div className="gateway-row"><b>{g.name}</b><span className="sub">{g.allowLan ? tr('允许局域网') : tr('仅本机')}</span><span className="grow" /><button className="btn sm ghost" onClick={() => setEdit(g)}>{tr('编辑')}</button><button className="btn sm" onClick={() => create(g.id)}>{tr('新建密钥')}</button></div>
          {keys.filter((k) => k.keyGroupId === g.id).map((k) => (
            <div className="gateway-row" key={k.id}><code>{k.prefix}</code><span className="grow">{k.name}</span><span className="sub">{tr('今天 {n} 次', { n: k.stats.requests })}</span><button className="btn sm ghost" onClick={async () => { await ws.request({ kind: 'gateway.keys.update', id: k.id, patch: { enabled: !k.enabled } }); await reload(); }}>{k.enabled ? tr('停用') : tr('启用')}</button><button className="btn sm ghost danger" onClick={async () => { if (await dlg.confirm(tr('删除密钥「{name}」？', { name: k.name }), { danger: true })) { await ws.request({ kind: 'gateway.keys.remove', id: k.id }); await reload(); } }}>{tr('删除')}</button></div>
          ))}
        </div>
      ))}
      {edit && <KeyEditor group={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
    </div>
  );
}
```

- [ ] **Step 2: 实现 KeyEditor**

```tsx
import { useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { useGateway } from './state';
import type { GatewayKeyGroup } from '@shared';
import { tr } from '@/i18n';

export function KeyEditor({ group, onClose, onSaved }: { group: GatewayKeyGroup; onClose(): void; onSaved(): void }) {
  const toast = useStore((s) => s.toast);
  const routeGroups = useGateway((s) => s.routeGroups);
  const [g, setG] = useState<any>({ ...group, ipAllowlist: group.ipAllowlist.join('\n'), modelAllowlist: (group.modelAllowlist ?? []).join('\n') });
  const save = async () => {
    try {
      await ws.request({
        kind: 'gateway.keyGroups.upsert',
        group: {
          id: g.id || undefined, name: g.name, allowLan: g.allowLan,
          routeGroupIds: g.routeGroupIds,
          ipAllowlist: g.ipAllowlist.split('\n').map((s) => s.trim()).filter(Boolean),
          modelAllowlist: g.modelAllowlist.split('\n').map((s) => s.trim()).filter(Boolean),
          rateLimit: { rpm: g.rateLimit?.rpm || undefined, concurrent: g.rateLimit?.concurrent || undefined, dailyTokens: g.rateLimit?.dailyTokens || undefined },
        },
      });
      onSaved();
    } catch (e: any) { toast(e.message); }
  };
  return (
    <div className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 560 }}>
        <h3>{group.id ? tr('编辑密钥组') : tr('新建密钥组')}</h3>
        <label className="field"><span>{tr('名称')}</span><input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} /></label>
        <label className="field"><span>{tr('允许的网关组（留空 = 全部）')}</span><select multiple value={g.routeGroupIds} onChange={(e) => setG({ ...g, routeGroupIds: [...e.currentTarget.selectedOptions].map((o) => o.value) })}>{routeGroups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="chip"><input type="checkbox" checked={g.allowLan} onChange={(e) => setG({ ...g, allowLan: e.target.checked })} /> {tr('允许局域网使用')}</label>
        <label className="field"><span>{tr('来源 IP 白名单（每行一个 CIDR；留空 = 只允许本机）')}</span><textarea rows={3} value={g.ipAllowlist} onChange={(e) => setG({ ...g, ipAllowlist: e.target.value })} placeholder={'192.168.1.0/24'} /></label>
        <label className="field"><span>{tr('模型白名单（每行一个 glob；留空 = 全部）')}</span><textarea rows={3} value={g.modelAllowlist} onChange={(e) => setG({ ...g, modelAllowlist: e.target.value })} placeholder={'claude-*'} /></label>
        <div className="row"><label className="field"><span>{tr('每分钟请求')}</span><input type="number" min={0} value={g.rateLimit?.rpm ?? 0} onChange={(e) => setG({ ...g, rateLimit: { ...g.rateLimit, rpm: Number(e.target.value) || undefined } })} /></label><label className="field"><span>{tr('并发')}</span><input type="number" min={0} value={g.rateLimit?.concurrent ?? 0} onChange={(e) => setG({ ...g, rateLimit: { ...g.rateLimit, concurrent: Number(e.target.value) || undefined } })} /></label><label className="field"><span>{tr('每天 token')}</span><input type="number" min={0} value={g.rateLimit?.dailyTokens ?? 0} onChange={(e) => setG({ ...g, rateLimit: { ...g.rateLimit, dailyTokens: Number(e.target.value) || undefined } })} /></label></div>
        <div className="row"><span className="grow" /><button className="btn sm ghost" onClick={onClose}>{tr('取消')}</button><button className="btn sm" onClick={save}>{tr('保存')}</button></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `cd web && npm run typecheck`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add web/src/features/gateway/KeysTab.tsx web/src/features/gateway/KeyEditor.tsx
git commit -m "feat(gateway): keys tab with groups, allowlists and budgets"
```

---

## Task 17: 日志页与设置页

**Files:**
- Modify: `web/src/features/gateway/LogsTab.tsx`, `GatewaySettingsTab.tsx`

**Interfaces:**
- Consumes: `gateway.audit.list/clear/export`、`gateway.lan.*`。
- Produces: 过滤、清空、导出、LAN 开关 / 绑定 / 端口 / 白名单、审计开关。

- [ ] **Step 1: 实现 LogsTab**

```tsx
import { useState } from 'react';
import { ws } from '@/ws/client';
import { useGateway } from './state';
import { useStore } from '@/store';
import { tr } from '@/i18n';

export function LogsTab() {
  const logs = useGateway((s) => s.logs);
  const toast = useStore((s) => s.toast);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const rows = onlyErrors ? logs.filter((l) => l.status >= 400) : logs;
  const clear = async () => { await ws.request({ kind: 'gateway.audit.clear' }); await useGateway.getState().load(); };
  const exportAll = async () => {
    const text = await ws.request<string>({ kind: 'gateway.audit.export' });
    const url = URL.createObjectURL(new Blob([text], { type: 'application/jsonl' }));
    const a = document.createElement('a'); a.href = url; a.download = 'gateway-audit.jsonl'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(tr('已导出'), true);
  };
  return (
    <div className="gateway-tab">
      <div className="gateway-row"><label className="chip"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> {tr('只看错误')}</label><span className="grow" /><button className="btn sm ghost" onClick={exportAll}>{tr('导出')}</button><button className="btn sm ghost danger" onClick={clear}>{tr('清空')}</button></div>
      <div className="gateway-log">
        {rows.map((l, i) => <div className="gateway-row" key={`${l.ts}-${i}`}><span className="sub">{new Date(l.ts).toLocaleTimeString()}</span><code>{l.protocol}</code><span className="grow">{l.model}</span><span className="sub">{l.member}</span><span className={`gateway-badge ${l.status >= 400 ? 'bad' : 'ok'}`}>{l.status}</span><span className="sub">{l.ms}ms</span></div>)}
        {rows.length === 0 && <div className="empty">{tr('还没有记录')}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 实现 GatewaySettingsTab**

```tsx
import { useEffect, useState } from 'react';
import { ws } from '@/ws/client';
import { useGateway } from './state';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import { tr } from '@/i18n';

export function GatewaySettingsTab() {
  const lan = useGateway((s) => s.lan);
  const toast = useStore((s) => s.toast);
  const [bind, setBind] = useState('127.0.0.1');
  const [port, setPort] = useState(0);
  const [ips, setIps] = useState('');
  useEffect(() => { if (lan) { setBind(lan.bind); setPort(lan.port); setIps(lan.ipAllowlist.join('\n')); } }, [lan?.bind, lan?.port, lan?.ipAllowlist.join(',')]);
  const save = async (patch: any) => {
    try {
      if (patch.bind === '0.0.0.0' && !(await dlg.confirm(tr('监听 0.0.0.0 会让同一网络里的设备都能访问数据面，确定吗？'), { danger: true }))) return;
      await ws.request({ kind: 'gateway.lan.set', config: { ...patch, ...(patch.bind === '0.0.0.0' ? { confirmAny: true } : {}) } });
      await useGateway.getState().load();
      toast(tr('已保存'), true);
    } catch (e: any) { toast(e.message); }
  };
  return (
    <div className="gateway-tab">
      <h4>{tr('局域网')}</h4>
      <label className="chip"><input type="checkbox" checked={!!lan?.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> {tr('允许局域网访问（只开放数据面）')}</label>
      <div className="row"><label className="field"><span>{tr('监听地址')}</span><input value={bind} onChange={(e) => setBind(e.target.value)} placeholder="192.168.1.10 / 0.0.0.0" /></label><label className="field"><span>{tr('端口（0 = 随机）')}</span><input type="number" min={0} value={port} onChange={(e) => setPort(Number(e.target.value))} /></label><button className="btn sm" onClick={() => save({ bind, port })}>{tr('应用')}</button></div>
      <label className="field"><span>{tr('监听器来源 IP 白名单（留空 = 不限制）')}</span><textarea rows={3} value={ips} onChange={(e) => setIps(e.target.value)} /></label>
      <button className="btn sm" onClick={() => save({ ipAllowlist: ips.split('\n').map((s) => s.trim()).filter(Boolean) })}>{tr('保存白名单')}</button>
      <div className="sub">{lan?.running ? tr('正在监听 {bind}:{port}', { bind: lan.bind, port: lan.port }) : tr('未监听')} · {lan?.addresses.join(', ') || tr('没有局域网地址')}</div>
      <h4>{tr('审计')}</h4>
      <div className="sub">{tr('记录每次请求的密钥、来源、模型、状态和用量；不记录提示词和响应正文。')}</div>
      <label className="chip"><input type="checkbox" checked={!!lan?.audit.enabled} onChange={(e) => void ws.request({ kind: 'gateway.settings.set', patch: { audit: { enabled: e.target.checked } } }).then(() => useGateway.getState().load())} /> {tr('启用审计日志')}</label>
    </div>
  );
}
```

`gateway.settings.set` 需要加进 `GatewayRequest` 与 handlers：

```ts
| { kind: 'gateway.settings.set'; patch: { audit?: Partial<GatewayAuditConfig> } }
```

```ts
case 'gateway.settings.set': {
  if (req.patch.audit) await gw.setAudit(req.patch.audit);
  if (req.patch.allowQueryKey !== undefined) await gw.setAllowQueryKey(req.patch.allowQueryKey);
  return gw.lanStatus();
}
```

`GatewayService` 上补：

```ts
async setAllowQueryKey(on: boolean): Promise<void> {
  await this.deps.meta.setSetting('gateway.allowQueryKey', on);
  this.emit('changed');
}
```

- [ ] **Step 3: 类型检查 + 测试**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add web/src/features/gateway/LogsTab.tsx web/src/features/gateway/GatewaySettingsTab.tsx server/src/gateway/service.ts server/src/gateway/handlers.ts server/src/gateway/types.ts
git commit -m "feat(gateway): logs and settings tabs"
```

---

## Task 18: i18n、文案闸与文档

**Files:**
- Modify: `server/src/i18n/en.ts`, `web/src/i18n/en.ts`
- Modify: `docs/notes/gateway.md`
- Test: `node scripts/i18n/extract.mjs --check`、`npm test`

- [ ] **Step 1: 提取未翻译文案**

Run: `node scripts/i18n/extract.mjs --check`
Expected: 列出所有新增中文 key。

- [ ] **Step 2: 填英文**

把 `extract.mjs` 列出的 key 填进 `server/src/i18n/en.ts` 与 `web/src/i18n/en.ts`。示例（实际以脚本输出为准）：

```ts
  '网关': 'Gateway',
  '账号池': 'Accounts',
  '分组与路由': 'Routes',
  '密钥': 'Keys',
  '日志': 'Logs',
  '局域网': 'LAN',
  '允许局域网使用': 'Allow LAN access',
  '来源 IP 白名单（每行一个 CIDR；留空 = 只允许本机）': 'Source IP allowlist (one CIDR per line; empty = localhost only)',
  '这个密钥不允许从局域网使用': 'This key may not be used from the LAN',
  '来源 IP 不在白名单': 'Source IP is not allowlisted',
  '这个密钥每分钟的请求太多': 'Too many requests per minute for this key',
  '这个密钥同时进行的请求太多': 'Too many concurrent requests for this key',
  '这个密钥今天的 token 额度已用完': 'This key has used today’s token budget',
  '这个密钥今天的费用额度已用完': 'This key has used today’s cost budget',
```

- [ ] **Step 3: 更新笔记**

在 `docs/notes/gateway.md` 末尾追加：

```md
## 内嵌网关（阶段 A，2026-10-19）

- 账号在 `server/src/upstreams/`：`AccountStore` 只管加密 / 去重 / 级联删除，`UpstreamService` 管池子和策略，`ClaudeAdapter` 管凭据和探测。
- 网关成员是 `p:` / `a:` / `u:` 三选一；账号成员永远走 IR 翻译（OAuth Bearer + `anthropic-beta: oauth-2025-04-20` + Claude Code 系统前缀），不字节透传。
- 根路径：`/v1/...`、`/<组>/v1/...`；旧 `/gateway/<组>/...` 保留。密钥组空 `routeGroupIds` = 全部（迁移来的默认组）。
- 局域网是独立 `GatewayListener`，只认 `/v1`、`/v1beta`、`/healthz`；密钥组必须 `allowLan` 且 IP 命中白名单。
- 审计只写白名单字段，1 秒一批、最多 200 行；轮转按 `gatewayAudit`。
- 阶段 B 的 Gemini sidecar、阶段 C 的 WorkBuddy 任务中心还没接；`families` 里显示为未就绪。
```

- [ ] **Step 4: 跑闸**

Run: `node scripts/i18n/extract.mjs --check && npm test -w web`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/i18n/en.ts web/src/i18n/en.ts docs/notes/gateway.md
git commit -m "docs(gateway): phase A notes and translations"
```

---

## Task 19: 端到端 phase 30

**Files:**
- Create: `server/ws-phase30.mjs`
- Modify: `scripts/e2e.mjs:13`

**Interfaces:**
- Consumes: 真实 server + 假上游。
- Produces: 根路径、账号池、密钥组、LAN、审计五组断言。

- [ ] **Step 1: 写脚本**

以 `server/ws-phase29.mjs` 为骨架（临时 HOME、`PORT=0`、`CLAUDE_WEB_TOKEN`、`CW_NO_MODEL_REFRESH`），增加：

```js
// fake Anthropic upstream: records what it saw
const seen = [];
const upstream = http.createServer((q, s) => {
  let raw = '';
  q.on('data', (c) => { raw += c; });
  q.on('end', () => {
    seen.push({ url: q.url, headers: q.headers, body: raw });
    const j = JSON.parse(raw || '{}');
    if (q.url.includes('/v1/models')) return json(s, 200, { data: [{ id: 'claude-sonnet-4-6', type: 'model' }] });
    return json(s, 200, { id: 'msg_1', type: 'message', role: 'assistant', model: j.model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } });
  });
});
```

环境变量加 `CW_CLAUDE_BASE: up`。

通过 WS 依次：

```js
await req({ kind: 'providers.upsert', provider: { name: 'Fake', type: 'anthropic', baseUrl: up, apiKey: 'sk-fake' } });
const prov = (await req({ kind: 'providers.list' })).find((p) => p.name === 'Fake');
await req({ kind: 'gateway.set', enabled: true });
await req({ kind: 'gateway.groups.upsert', group: { id: 'main', name: 'Main', strategy: 'failover', members: [{ providerId: prov.id }] } });
const keyStatus = await req({ kind: 'gateway.keys.status' });
const legacyKey = await req({ kind: 'gateway.keys.reveal', id: 'key_default' });
check('default key was migrated and is revealable', typeof legacyKey === 'string' && legacyKey.startsWith('cwg-'));
```

请求 / HTTP 辅助：

```js
let stdout = '';
server.stdout.on('data', (c) => { stdout += c; });
const untilPort = async () => {
  const end = Date.now() + 30_000;
  for (;;) {
    const m = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
    if (m) return Number(m[1]);
    if (Date.now() > end) throw new Error(`server did not start:\n${stdout}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
const port = await untilPort(); // parse `listening on http://127.0.0.1:<port>` from the server's stdout
const base = `http://127.0.0.1:${port}`;
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
await new Promise((r) => ws.once('open', r));
const pending = new Map();
let seq = 0;
const req = (request) => new Promise((resolve, reject) => {
  const id = String(++seq);
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ type: 'request', request: { id, req: request } }));
});
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type === 'reply') {
    const p = pending.get(m.reply.id);
    if (!p) return;
    pending.delete(m.reply.id);
    if (m.reply.ok === false) p.reject(new Error(m.reply.error)); else p.resolve(m.reply.data);
  }
});

const httpJson = async (method, url, key, body) => {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
  return { status: r.status, headers: r.headers, text: await r.text() };
};
```

HTTP 断言：

```js
const root = await httpJson('POST', `${base}/v1/messages`, legacyKey, { model: 'claude-sonnet-4-6', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] });
check('root /v1/messages', root.status === 200);
const explicit = await httpJson('POST', `${base}/main/v1/messages`, legacyKey, { model: 'claude-sonnet-4-6', max_tokens: 8, messages: [] });
check('explicit group path', explicit.status === 200);
```

账号池：

```js
const added = await req({ kind: 'upstreams.add', input: { kind: 'claude', name: 'Sub', credential: 'sk-ant-oat01-test' } });
const pool = await req({ kind: 'upstreams.groups.upsert', group: { id: 'pool', kind: 'claude', name: 'Pool', strategy: 'failover', members: [added.id] } });
await req({ kind: 'gateway.groups.upsert', group: { id: 'acct', name: 'Acct', strategy: 'failover', members: [{ upstreamGroupId: 'pool' }] } });
const acct = await httpJson('POST', `${base}/acct/v1/messages`, legacyKey, { model: 'claude-sonnet-4-6', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] });
check('account pool member', acct.status === 200);
check('account request uses bearer + oauth beta + the Claude Code prefix', seen.some((x) =>
  x.headers.authorization === 'Bearer sk-ant-oat01-test'
  && String(x.headers['anthropic-beta'] ?? '').includes('oauth-2025-04-20')
  && x.body.includes('You are Claude Code')));
```

密钥组 / LAN：

```js
const kg = await req({ kind: 'gateway.keyGroups.upsert', group: { id: 'lan', name: 'LAN', routeGroupIds: ['main'], allowLan: true, ipAllowlist: ['127.0.0.0/8'] } });
const created = await req({ kind: 'gateway.keys.create', groupId: 'lan', name: 'LAN key' });
await req({ kind: 'gateway.lan.set', config: { enabled: true, bind: '127.0.0.1', port: 0 } });
const lanPort = (await req({ kind: 'gateway.lan.status' })).port;
const lan = await httpJson('POST', `http://127.0.0.1:${lanPort}/v1/messages`, created.plaintext, { model: 'claude-sonnet-4-6', max_tokens: 8, messages: [] });
check('LAN data plane', lan.status === 200);
const admin = await fetch(`http://127.0.0.1:${lanPort}/gateway/main/v1/messages`, { method: 'POST', headers: { 'x-api-key': created.plaintext }, body: '{}' });
check('LAN has no admin surface', admin.status === 404);
const denied = await httpJson('POST', `http://127.0.0.1:${lanPort}/v1/messages`, legacyKey, { model: 'x', max_tokens: 1, messages: [] });
check('default key group cannot use LAN', denied.status === 403);
```

审计：

```js
const logs = await req({ kind: 'gateway.audit.list', limit: 100 });
check('audit has lines', logs.length > 0);
check('audit never contains the prompt', !JSON.stringify(logs).includes('hi'));
check('audit never contains a key', !JSON.stringify(logs).includes(legacyKey) && !JSON.stringify(logs).includes(created.plaintext));
```

- [ ] **Step 2: 加进 e2e 默认列表**

`scripts/e2e.mjs:13` 末尾加 `'30'`。

- [ ] **Step 3: 运行**

Run: `npm run build -w server && node server/ws-phase30.mjs`
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add server/ws-phase30.mjs scripts/e2e.mjs
git commit -m "test(gateway): end-to-end phase 30"
```

---

## Task 20: 全量回归与验收

**Files:** 无新增。

- [ ] **Step 1: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 2: 单元测试（去掉继承的环境变量）**

Run:
```bash
env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_WEB_DIST -u ANTHROPIC_DEFAULT_OPUS_MODEL -u ANTHROPIC_DEFAULT_SONNET_MODEL -u ANTHROPIC_DEFAULT_HAIKU_MODEL -u CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION -u CLAUDE_WEB_THINKING_DISPLAY npm test
```
Expected: 全部 PASS。

- [ ] **Step 3: 构建**

Run: `npm run build:all`
Expected: PASS。

- [ ] **Step 4: e2e**

Run: `env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_WEB_DIST npm run e2e`
Expected: `all … phases passed`（含 30）。

- [ ] **Step 5: UI smoke**

Run: `node scripts/ui-smoke.cjs`
Expected: PASS，网关分区打开无 console 错误。

- [ ] **Step 6: 真机验证（手动）**

用临时 `CLAUDE_WEB_DIR` / HOME 起 server：
- 添加一个真实 Claude 账号（setup-token 或 OAuth JSON），确认探测状态、额度条、`/v1/messages` 非流式与流式各一次。
- 建一个账号池，网关组用 `u:` 引用，确认请求落到账号、失败时切换。
- 新建密钥组（允许 LAN + `127.0.0.0/8`），局域网监听器打开，另一台设备用该密钥调用一次；旧密钥从 LAN 调用得到 403。
- 审计页看到记录，导出文件不含令牌和提示词。

- [ ] **Step 7: 提交收尾**

```bash
git add server/src/upstreams server/src/gateway server/src/meta server/src/protocol.ts server/src/ws/hub.ts server/src/index.ts server/src/i18n web/src/features/gateway web/src/features/sections web/src/features/rail web/src/features/workbench web/src/app web/src/ui web/src/i18n web/src/main.tsx web/src/styles scripts server/ws-phase30.mjs docs/notes/gateway.md docs/superpowers/plans/2026-10-19-embedded-gateway-phase-a.md
git commit -m "release: embedded gateway phase A"
```

---

## Self-Review

**Spec coverage（阶段 A 五条）**

1. `UpstreamService`、`AccountStore`、统一账号、Claude 入池 → Task 1–5。
2. `GatewayKeyGroup` / `GatewayKey`、哈希、IP、限速、预算 → Task 6–7、Task 9。
3. 根路径、`GatewayListener`、局域网、审计 → Task 8–10。
4. 网关分区骨架：概览、账号（Claude）、密钥、日志 → Task 12–17。
5. 现有测试迁移与新增 → Task 5、9、10 保留旧用例；Task 19 新增 phase 30。
6. 会话粘性（验收标准「同一会话键在 TTL 内命中同一账号」）→ Task 4 的 `AffinityTable` 与 `order(g, sessionKey)`；失败时 `markFailure` 解除绑定。

**已知取舍**

- 阶段 A 的 `GatewayKeyGroup.routeGroupIds` 空数组解释为「全部」，这是为了迁移来的默认密钥组不因新建网关组而失效；阶段 D 的安全复查要重新确认这个默认值是否仍合适。
- `dailyCostUsd` 在阶段 A 只统计、不生效（网关不知道价格，`costUsd` 恒为 0）；token 和请求数已生效。
- 每日 token 预算在请求入口检查、响应后记账：顺序请求严格，6 个并发突发可能都通过（之后立即 429）。阶段 D 若要严格上限，需要在入口预留、响应后结算。
- 准入拒绝（401 / 403 / 429 / 413 / 400）也写审计行；`count_tokens` 对账号成员走本地估算（`x-cw-estimated: 1`），不转发为生成请求。
- 账号健康里的 `cooling` 由探测和网关失败共同产生；网关失败冷却记在 `MemberStates`，账号池排序只看账号自己的 `cooldownUntil`。两者不共享状态是阶段 A 的简化，阶段 B 接入 sidecar 时统一。
- 会话粘性表只在内存里，重启即清空（spec 明确要求）；同一密钥的并发请求可能在第一次绑定完成前各自选到不同账号，这是可接受的竞态。
- OAuth 刷新用的 `CLAUDE_OAUTH_CLIENT_ID` 是 Claude Code 的公开客户端 id；若上游变更，探测会落到 `expired`，用户可重新粘贴凭据。
