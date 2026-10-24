# A7：自动压缩点和 Claude 账号的上下文窗口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个供应商和自己的 Claude 账号都能设「自动压缩」点（压过 settings.json）；Claude 账号能给每个模型选 200K / 1M（选 1M 的带 `[1m]`）；上下文卡标题和模型菜单看得到实际窗口和压缩上限。

**Architecture:** 纯函数放 `server/src/models/account-window.ts`（web 经 `@shared` 也能 import 的话就共用，否则 web 只用协议字段）；runner 在拼环境变量和引擎模型名时用它们，结果写进 `SessionInfoSnapshot.contextWindow` / `compactWindow`；web 只读这两个字段和设置，不问引擎。

**Tech Stack:** Node + claude-agent-sdk（server/）、React + zustand（web/）、vitest、e2e `server/ws-phase*.mjs`、ui-smoke。

Spec: `docs/superpowers/specs/2026-10-24-desktop-parity-design.md` 的「A7」一节。

## Global Constraints

- 用户看得见的字全走 `tr('中文')`，英文用仓库的工具加进目录（`docs/notes/i18n.md`）；加完 `node scripts/i18n/extract.mjs --check`。
- 用户看得见的字不出现：会话 / 引擎 / 窗格 / 停靠 / effort / ultracode / ACP；叫「对话」。
- 新 UI 状态 / 设置存 meta.json（`settings.set`），不用 localStorage。
- zustand 选择器返回稳定引用。
- 新加带 `sessionId` 的请求进 `server/src/federation/rewrite.ts` 路由表。
- 不改用户的 `~/.claude/settings.json`；用我们的值压过它只能走现有 `settingsOverride` / `ownOverride`（`server/src/runtime/user-env.ts`）。
- 上下文小环不问引擎（`docs/notes/ui-redesign-3-composer.md`「上下文小环不问引擎」）。
- 压缩点输入：50K 起、不超过该模型窗口；可写 `700`（当 K）、`700k`、`700000`、`1m`。
- 账号上可选 1M 的模型族：opus、sonnet、fable；haiku 固定 200K。默认 1M。`default`（按套餐）不改。
- 测试命令前 `env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_WEB_DIST -u ANTHROPIC_DEFAULT_OPUS_MODEL -u ANTHROPIC_DEFAULT_SONNET_MODEL -u ANTHROPIC_DEFAULT_HAIKU_MODEL -u CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION -u CLAUDE_WEB_THINKING_DISPLAY -u CLAUDE_WEB_CONTEXT_WINDOWS -u CLAUDE_WEB_MODEL_CAPS -u ELECTRON_RUN_AS_NODE`（下文 `$CLEAN`）。
- 不要 `git add -A`（`site/package.json`、`site/package-lock.json` 是用户自己的未提交改动）；只 add 自己改的文件。真机用临时 `CLAUDE_WEB_DIR` / HOME。

---

### Task 1: 纯函数和协议字段

**Files:**
- Create: `server/src/models/account-window.ts`
- Create: `server/src/models/account-window.test.ts`
- Modify: `server/src/protocol.ts`（`Provider` 加 `compactAt`；`SessionInfoSnapshot` 加 `contextWindow`，放在 `compactWindow` 旁边）

**Interfaces:**
- Produces:
  - `type AccountFamily = 'opus' | 'sonnet' | 'fable'`
  - `accountFamily(model: string | undefined): AccountFamily | undefined`
  - `type AccountWindows = Partial<Record<AccountFamily, 200_000 | 1_000_000>>`
  - `familyWindows(raw: unknown): AccountWindows`（从设置 `claude.contextWindows` 或 `claude-account` 档案的 `contextWindows` 读，只认三个族名键、只认这两个值）
  - `accountModel(model: string | undefined, w: AccountWindows): string | undefined`
  - `accountWindowOf(model: string | undefined, w: AccountWindows): number | undefined`
  - `parseTokens(v: string): number | undefined`
  - `compactAtOk(n: number | undefined, window: number | undefined): boolean`
  - `effectiveCompact(...caps: (number | undefined)[]): number | undefined`（取有效值里最小的）
  - 协议：`Provider.compactAt?: number`、`SessionInfoSnapshot.contextWindow?: number`

- [ ] **Step 1: 写失败的测试**

```ts
// server/src/models/account-window.test.ts
import { describe, expect, it } from 'vitest';
import { accountFamily, accountModel, accountWindowOf, compactAtOk, effectiveCompact, familyWindows, parseTokens } from './account-window.js';

describe('accountFamily', () => {
  it('aliases and full ids', () => {
    expect(accountFamily('opus')).toBe('opus');
    expect(accountFamily('opus[1m]')).toBe('opus');
    expect(accountFamily('claude-opus-5-5')).toBe('opus');
    expect(accountFamily('claude-sonnet-5[1m]')).toBe('sonnet');
    expect(accountFamily('fable')).toBe('fable');
    expect(accountFamily('claude-fable-5-1')).toBe('fable');
  });
  it('haiku, default and others have none', () => {
    expect(accountFamily('haiku')).toBeUndefined();
    expect(accountFamily('claude-haiku-4-5-20251001')).toBeUndefined();
    expect(accountFamily('default')).toBeUndefined();
    expect(accountFamily(undefined)).toBeUndefined();
    expect(accountFamily('gpt-5')).toBeUndefined();
  });
});

describe('familyWindows', () => {
  it('keeps only the three families and the two sizes', () => {
    expect(familyWindows({ opus: 200000, sonnet: 1000000, fable: 5, haiku: 1000000, x: 1 })).toEqual({ opus: 200000, sonnet: 1000000 });
    expect(familyWindows(undefined)).toEqual({});
    expect(familyWindows('nope')).toEqual({});
  });
});

describe('accountModel', () => {
  it('1M by default: a plain pick gets [1m]', () => {
    expect(accountModel('claude-opus-5-5', {})).toBe('claude-opus-5-5[1m]');
    expect(accountModel('opus', {})).toBe('opus[1m]');
    expect(accountModel('opus[1m]', {})).toBe('opus[1m]');
  });
  it('200K picked: [1m] comes off', () => {
    expect(accountModel('opus[1m]', { opus: 200000 })).toBe('opus');
    expect(accountModel('claude-sonnet-5', { sonnet: 200000 })).toBe('claude-sonnet-5');
  });
  it('haiku, default and unknown pass unchanged', () => {
    expect(accountModel('haiku', {})).toBe('haiku');
    expect(accountModel('default', {})).toBe('default');
    expect(accountModel(undefined, {})).toBeUndefined();
  });
  it('window follows the same rule', () => {
    expect(accountWindowOf('claude-opus-5-5', {})).toBe(1_000_000);
    expect(accountWindowOf('opus[1m]', { opus: 200000 })).toBe(200_000);
    expect(accountWindowOf('haiku', {})).toBe(200_000);
    expect(accountWindowOf('default', {})).toBeUndefined();
  });
});

describe('parseTokens / compactAtOk / effectiveCompact', () => {
  it('parses K-style input', () => {
    expect(parseTokens('700')).toBe(700_000);
    expect(parseTokens('700k')).toBe(700_000);
    expect(parseTokens('700K')).toBe(700_000);
    expect(parseTokens('700000')).toBe(700_000);
    expect(parseTokens('700,000')).toBe(700_000);
    expect(parseTokens('1m')).toBe(1_000_000);
    expect(parseTokens('')).toBeUndefined();
    expect(parseTokens('abc')).toBeUndefined();
    expect(parseTokens('-5')).toBeUndefined();
  });
  it('a compaction point is 50K up to the window', () => {
    expect(compactAtOk(700_000, 1_000_000)).toBe(true);
    expect(compactAtOk(49_999, 1_000_000)).toBe(false);
    expect(compactAtOk(1_200_000, 1_000_000)).toBe(false);
    expect(compactAtOk(700_000, undefined)).toBe(true);
    expect(compactAtOk(undefined, 1_000_000)).toBe(false);
  });
  it('the smallest valid cap wins', () => {
    expect(effectiveCompact(700_000, 500_000, undefined)).toBe(500_000);
    expect(effectiveCompact(undefined, 0, NaN)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `cd server && $CLEAN npx vitest run src/models/account-window.test.ts`
Expected: FAIL（找不到模块）

- [ ] **Step 3: 实现**

```ts
// server/src/models/account-window.ts
/**
 * The account's context windows and the compaction point (spec 2026-10-24 A7, a user: new conversations sometimes
 * started on Opus 5.5 at 200K). On the claude.ai login a plain Claude id is 200K and `<id>[1m]` is 1M (both engines);
 * the user picks per family, 1M by default, and the pick is applied to whatever model the conversation asks for.
 */
export type AccountFamily = 'opus' | 'sonnet' | 'fable';
export type AccountWindows = Partial<Record<AccountFamily, 200_000 | 1_000_000>>;

const FAMILIES: AccountFamily[] = ['opus', 'sonnet', 'fable'];
const ONE_M = 1_000_000;
const TWO_K = 200_000;

export function accountFamily(model: string | undefined): AccountFamily | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase().replace(/\[1m\]$/, '');
  return FAMILIES.find((f) => m === f || m.startsWith(`claude-${f}-`));
}

export function familyWindows(raw: unknown): AccountWindows {
  const out: AccountWindows = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const f of FAMILIES) {
    const v = (raw as Record<string, unknown>)[f];
    if (v === TWO_K || v === ONE_M) out[f] = v;
  }
  return out;
}

export function accountModel(model: string | undefined, w: AccountWindows): string | undefined {
  const f = accountFamily(model);
  if (!f || !model) return model;
  const base = model.replace(/\[1m\]$/i, '');
  return (w[f] ?? ONE_M) === ONE_M ? `${base}[1m]` : base;
}

export function accountWindowOf(model: string | undefined, w: AccountWindows): number | undefined {
  if (!model || model === 'default') return undefined;
  const f = accountFamily(model);
  return f ? (w[f] ?? ONE_M) : TWO_K;
}

export function parseTokens(v: string): number | undefined {
  const s = v.trim().replace(/[,_\s]/g, '').toLowerCase();
  if (!/^\d+(\.\d+)?[km]?$/.test(s)) return undefined;
  const n = parseFloat(s);
  const out = s.endsWith('m') ? n * 1_000_000 : s.endsWith('k') || n < 10_000 ? n * 1000 : n;
  return out > 0 ? Math.round(out) : undefined;
}

export function compactAtOk(n: number | undefined, window: number | undefined): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n >= 50_000 && (!window || n <= window);
}

export function effectiveCompact(...caps: (number | undefined)[]): number | undefined {
  const ok = caps.filter((c): c is number => typeof c === 'number' && Number.isFinite(c) && c > 0);
  return ok.length ? Math.min(...ok) : undefined;
}
```

`protocol.ts`：
- `Provider` 里 `contextWindows` 旁边加：`/** 自动压缩 (A7): compact at this many tokens on this provider's conversations (CLAUDE_CODE_AUTO_COMPACT_WINDOW, over the user's settings.json); unset = follow the window. For a claude-account profile, contextWindows holds the family picks (opus / sonnet / fable → 200000 | 1000000). */ compactAt?: number;`
- `SessionInfoSnapshot` 里 `compactWindow` 旁边加：`/** the model's context window in this conversation as the engine will use it (A7): the provider's setting, or on the account 1M / 200K per the family pick */ contextWindow?: number;`

- [ ] **Step 4: 跑测试 + 类型**

Run: `cd server && $CLEAN npx vitest run src/models/account-window.test.ts && cd .. && npx tsc --noEmit -p server && npx tsc --noEmit -p web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/models/account-window.ts server/src/models/account-window.test.ts server/src/protocol.ts
git commit -m "feat(models): account window picks and compaction point helpers; Provider.compactAt, SessionInfoSnapshot.contextWindow"
```

---

### Task 2: runner 用上（模型名、压缩点、info 字段、在跑的对话跟着变）

**Files:**
- Modify: `server/src/runtime/session-runner.ts`（`plan()` 约第 361 行的 key；环境变量段约第 415–430 行；`engineModel` / `windowOf` 约第 995–1030 行；`setModel`；构造参数）
- Modify: `server/src/runtime/pool.ts`（约第 120–127 行开 runner 处：把账号设置传进去；设置变了推给在跑的 runner）
- Test: `server/src/runtime/session-runner.test.ts`、`server/src/runtime/pool.test.ts`

**Interfaces:**
- Consumes: Task 1 全部函数；`compactCap(fenv, cwd, oursWins)`（`user-env.ts`，阶段 A 加的）。
- Produces: `SessionRunner` 构造 opts 加 `account?: { windows: AccountWindows; compactAt?: number }`（自己的 claude.ai 登录时由 pool 从设置 `claude.contextWindows` / `claude.compactAt` 读）；方法 `setAccountPrefs(p: { windows: AccountWindows; compactAt?: number }): Promise<void>`（plan key 变了就 `respawnWhenIdle()`）；`info.contextWindow` 始终是当前模型的窗口（不知道就删掉这个字段）。

先读 `docs/notes/models.md`「改供应商对在跑的对话生效」那一段和 `docs/notes/claude-accounts.md`，照它们现有的机制把设置变化推给在跑的对话（供应商的 `compactAt` 改了走供应商那条现成的路；账号设置改了在 pool 里监听 meta 设置变化，对 providerId 是 claude / 空 的 runner 调 `setAccountPrefs`）。

规则（每条都要有测试）：
1. **账号的模型名**：自己的登录（没有 provider）和 `claude-account` 档案（`this.account`）都走 `accountModel(model, windows)`，windows 分别来自 opts.account.windows 和 `familyWindows(this.account.contextWindows)`；在 `engineModel` 里、交给 ccb / 官方二进制的映射之前做（ccb 的 `ccbModel` 保留 `[1m]`）。子代理模型（`sameSub`）同样处理。
2. **窗口**：`windowOf` 在账号上改成 `accountWindowOf(model, windows)`；`info.contextWindow = windowOf(当前模型)`，在拼环境变量时和 `setModel` 后都更新并 `emit('info')`。
3. **压缩点**：`ours = effectiveCompact(官方二进制按窗口算的 officialCompactWindow（现有）, provider?.compactAt, 账号 compactAt)`，并且只取 `compactAtOk(值, 窗口)` 为真的用户值；有值就 `fenv.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(ours)`（覆盖现有只在 provider 时设的那行，两种引擎都设）。用户自己设了（provider.compactAt 或账号 compactAt）时，它要压过 settings.json：provider 对话现有 `settingsOverride` 已让我们的值赢；账号对话确认 `ownOverride` 会把这个键带进 `--settings`（写测试证明 settings.json 里是 700000、账号设 500000 时引擎拿到 500000）。用户没设时不写这个键，settings.json 照旧。
4. **plan key**：在现有 `:compact-${compact}` 处用新的 `ours`（用户值变了 key 就变 → `respawnWhenIdle`）。
5. `info.compactWindow` 继续由 `compactCap(fenv, this.cwd, oursWins)` 算（阶段 A 的逻辑不改）。

- [ ] **Step 1: 写失败的测试**（在 `session-runner.test.ts` 里照现有「环境变量、换了重启、`[1m]`」那几条的写法加）：
  - 账号对话，模型 `claude-opus-5-5`，windows `{}` → 引擎拿到的模型是 `claude-opus-5-5[1m]`，`info.contextWindow === 1_000_000`。
  - 账号对话，windows `{ opus: 200000 }`，模型 `opus[1m]` → 引擎拿到 `opus`，`info.contextWindow === 200_000`。
  - `claude-account` 档案 `contextWindows: { sonnet: 200000 }`，模型 `claude-sonnet-5` → 不加 `[1m]`。
  - 账号 compactAt 500000 + 临时 HOME 的 settings.json env `CLAUDE_CODE_AUTO_COMPACT_WINDOW=700000` → spawn env / `--settings` 里是 500000，`info.compactWindow === 500000`。
  - 供应商 `compactAt: 400000`，窗口 1M → env 400000；`compactAt: 30000`（太小）→ 不写。
  - 在跑的对话调 `setAccountPrefs({ windows: {}, compactAt: 600000 })` → plan key 变、空闲时重启（用现有测重启的办法）。
  - haiku / `default` 不变。

- [ ] **Step 2: 确认失败** — `cd server && $CLEAN npx vitest run src/runtime/session-runner.test.ts src/runtime/pool.test.ts`

- [ ] **Step 3: 实现**（按上面 5 条；pool 里读 `m.settings()['claude.contextWindows']` 经 `familyWindows`，`m.settings()['claude.compactAt']` 是数字才用）

- [ ] **Step 4: 跑测试 + 类型** — 同上，再 `npx tsc --noEmit -p server`

- [ ] **Step 5: Commit**

```bash
git add server/src/runtime/session-runner.ts server/src/runtime/session-runner.test.ts server/src/runtime/pool.ts server/src/runtime/pool.test.ts
git commit -m "feat(runtime): the account's 1M / 200K picks reach the engine ([1m]); 自动压缩 point per provider / account beats settings.json; info.contextWindow"
```

---

### Task 3: 「现在生效的是什么」接口

**Files:**
- Modify: `server/src/runtime/user-env.ts`（导出一个读用户级来源的函数）
- Modify: 服务端处理 WS 请求的地方（找 `kind: 'settings.get'` 或类似的 switch，照现有请求的写法加一个）
- Modify: `server/src/protocol.ts`（请求和返回类型）
- Test: `server/src/runtime/user-env.test.ts`

**Interfaces:**
- Produces: 请求 `{ kind: 'config.compactSource' }` → `{ value?: number; source: 'settings' | 'env' | 'none' }`：用户级 `~/.claude/settings.json` 的 env 里有 `CLAUDE_CODE_AUTO_COMPACT_WINDOW` → settings；否则 server 进程环境里有 → env；否则 none。函数 `userCompactSource(home?: string): { value?: number; source: … }`。没有 sessionId，不进联邦路由表。

- [ ] **Step 1: 失败测试**：临时 HOME 写 settings.json `{ "env": { "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "700000" } }` → `{ value: 700000, source: 'settings' }`；没文件、process.env 有 → env；都没有 → none；值是 `abc` / `0` → 当没有。
- [ ] **Step 2: 确认失败** — `cd server && $CLEAN npx vitest run src/runtime/user-env.test.ts`
- [ ] **Step 3: 实现**（复用 user-env.ts 现有读 settings 文件的函数，别重写 JSON 解析）
- [ ] **Step 4: 跑测试 + 类型**
- [ ] **Step 5: Commit** — `git add server/src/runtime/user-env.ts server/src/runtime/user-env.test.ts server/src/protocol.ts <处理请求的文件>`；`git commit -m "feat(config): config.compactSource tells where the compaction point in effect comes from"`

---

### Task 4: web 显示（卡片标题、小环、模型菜单）

**Files:**
- Modify: `web/src/features/composer/stats.ts`（`estimateContext`）、`web/src/features/composer/ContextMeter.tsx`（`useContextUsage`）
- Modify: `web/src/features/info/InfoColumn.tsx`（`CardSummary` 的 context 卡标题行）、`web/src/features/info/info-model.ts`（标题文字的纯函数）
- Modify: `web/src/features/models/ModelMenu.tsx` 和它的纯函数 `buildModelMenu`（所在文件按 import 找）
- Test: `web/src/features/composer/stats.test.ts`、`web/src/features/info/info-model.test.ts`、模型菜单的测试文件

**Interfaces:**
- Consumes: `SessionInfoSnapshot.contextWindow` / `compactWindow`；设置 `claude.contextWindows`。
- Produces: `contextTitle(window?: number, cap?: number): string`（info-model.ts）→ `'窗口 1M · 700K 内压缩'` / `'窗口 1M'` / `''`（都没有时）；数字格式 1M、200K、272K、650K（整 K，1M 起用 M，非整 M 写 1.5M）。

规则：
1. `estimateContext` 的 `o` 加 `contextWindow?: number`：有它就用它当 max（优先于 provider / `[1m]` 推断），然后照旧 `min(max, compactWindow)`。`useContextUsage` 传 `o.info?.contextWindow`（加进 memo 依赖）。
2. 卡片标题行（折叠和展开都显示）在百分比旁边加 `contextTitle(info.contextWindow, info.compactWindow)`，灰字小号；文字走 `tr('窗口 {w}')` / `tr('窗口 {w} · {c} 内压缩')`。
3. 模型菜单：Claude 账号（自己的登录和 `claude-account` 档案）下，opus / sonnet / fable 族的模型行名字后面一个小标「1M」或「200K」（按 `familyWindows(settings['claude.contextWindows'])` 或档案的 `contextWindows`，默认 1M），haiku 标「200K」；供应商下用 `contextWindowFor(provider, id)` 有值才标。不改菜单其它东西。`familyWindows` 若 web 不能 import server 文件，就在 `@shared` 能到的地方放（看 `web/vite.config.ts` 的 `@shared` 别名指向哪；protocol.ts 所在目录能被 web import 的话，把 account-window.ts 放在能被 import 的位置并更新 Task 1 的 import——只移动文件，不复制）。

- [ ] **Step 1: 失败测试**：`estimateContext` 有 contextWindow 时用它、和 compactWindow 取小；`contextTitle` 各种组合；菜单纯函数给出标记。
- [ ] **Step 2: 确认失败** — `cd web && $CLEAN npx vitest run src/features/composer src/features/info src/features/models`
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑测试 + 类型 + i18n** — 加 `npx tsc --noEmit -p web && node scripts/i18n/extract.mjs --check`
- [ ] **Step 5: Commit** — 只 add 改过的文件；`git commit -m "feat(web): the context card title shows the window and the compaction point; model menu marks 1M / 200K"`

---

### Task 5: 编辑界面（供应商的「自动压缩」、Claude 账号的「编辑」）

**Files:**
- Create: `web/src/features/settings/CompactAt.tsx`（「自动压缩」一行：两个选项 + 输入框 + 「现在：…」）
- Create: `web/src/features/settings/AccountWindows.tsx`（Claude 账号的编辑框内容：每族 200K / 1M + `<CompactAt>`）
- Modify: `web/src/features/panels/ConfigPanel.tsx`（`ContextWindows` 组件下面加 `<CompactAt>`，写 `Draft.compactAt`；`claude-account` 类型的档案编辑时显示 `<AccountWindows>` 代替按模型 id 的窗口表）
- Modify: `web/src/features/settings/AccountSection.tsx`（自己的 Claude 账号那一行加「编辑」按钮，打开 `dlg` 框或就地展开 `<AccountWindows>`，写设置 `claude.contextWindows` / `claude.compactAt`）
- Modify: `web/src/features/settings/ClaudeAccounts.tsx`（每个档案行的编辑入口用同一个 `<AccountWindows>`，写进档案的 `contextWindows` / `compactAt`，经 `providers.upsert`）
- Test: 纯逻辑抽成函数测（输入 → 存的值；校验失败提示）；界面在 Task 6 的 ui-smoke 测

**Interfaces:**
- Consumes: Task 1 `parseTokens` / `compactAtOk`（web 能 import 的位置，见 Task 4 第 3 条）；Task 3 `config.compactSource`。
- Produces: `<CompactAt value={number|undefined} window={number|undefined} onChange={(v: number|undefined) => void} />`；`<AccountWindows windows={AccountWindows} compactAt={number|undefined} onChange={(p) => void} />`。

文案（全部 `tr()`）：
- 标题「自动压缩」；选项「跟着上下文窗口」「在这个大小时压缩」；输入框 placeholder「例如 700k」；
- 说明：「对话用到这么多 token 时自动压缩。设了就以这里为准，不看你 settings.json 里的。正在跑的对话下一轮用上。」
- 「现在：{v}（来自你的 settings.json）」/「现在：{v}（来自环境变量）」/「现在：跟着上下文窗口」；
- 校验：「最少 50K」「不能超过上下文窗口 {w}」；
- 账号编辑框标题「Claude 账号的上下文窗口」，每行「Opus」「Sonnet」「Fable」+ 分段按钮「200K」「1M」，Haiku 一行灰字「200K（只有这一档）」，说明「选 1M 的模型发给 Claude 时带 [1m]。新对话立刻用，正在跑的对话重新打开后用。」（「[1m]」照写）。

- [ ] **Step 1: 失败测试**（纯函数：草稿 → 要存的值；非法输入不存并给出提示 key）
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**（分段按钮用现有的 `Seg` 组件，输入框用现有 `field` 样式；对话框用 `dlg.*`；文本框 Enter 先问 `imeComposing()`）
- [ ] **Step 4: 测试 + 类型 + i18n**；用临时 HOME 起开发版看一眼编辑框（做不到就写明）
- [ ] **Step 5: Commit** — 只 add 改过的文件；`git commit -m "feat(settings): 自动压缩 on every provider; Claude 账号 → 编辑: 200K / 1M per model and 自动压缩"`

---

### Task 6: e2e、ui-smoke、笔记

**Files:**
- Modify: 现有 e2e 里管 claude-account / 子代理 / 环境变量的那一期（`server/ws-phase28.mjs` 或 `ws-phase29.mjs`，看哪期有假上游且能读到 spawn 的参数和 env），或新加一期并登记进 e2e 入口
- Modify: `scripts/ui-smoke.cjs`（新 phase `a7`）
- Modify: `docs/notes/models.md`、`docs/notes/claude-accounts.md`、`docs/notes/engine-providers.md`（各加一小节，2026-10-24）

- [ ] **Step 1: e2e**：假上游下，(a) 账号对话选 `claude-opus-5-5`、设置默认 → 请求里模型是 1M 的（看假上游收到的 model 或 beta 头，按该期现有断言方式）；设成 200K 后新对话不带；(b) 供应商 `compactAt: 400000` → 引擎进程 env 里 `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000`（按该期读 env 的办法）。
- [ ] **Step 2: ui-smoke**：打开 设置 → 账号与登录 → Claude 账号「编辑」，有 Opus / Sonnet / Fable 三行和「自动压缩」；供应商编辑页有「自动压缩」；往 store 塞一个 `info: { contextWindow: 1000000, compactWindow: 700000 }` 的对话，上下文卡标题有「窗口 1M · 700K 内压缩」；模型菜单 Claude 行有「1M」标记。
- [ ] **Step 3: 全量** — `$CLEAN npm run typecheck`、`$CLEAN npm test`、`$CLEAN npm run build:all`、`$CLEAN npm run e2e`、`$CLEAN node scripts/ui-smoke.cjs`、`node scripts/i18n/extract.mjs --check`，全部通过（ui-smoke 的 审阅 评论那条已知偶发，只它失败就重跑一次）。
- [ ] **Step 4: 笔记** — 写现象（Opus 5.5 新对话 200K、settings.json 的 700000）、做法、设置键、坑（ownOverride 只带我们设了且 settings 也有的键；账号 plain id 是 200K）。
- [ ] **Step 5: Commit** — `git add <改过的文件>`；`git commit -m "test: A7 e2e and ui-smoke; notes"`
