# 值班 Bot 一期「能值班」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个新用户一句话建一个晨报 Bot，它每天自己跑、只出草稿、费用可见；对外动作进收件箱等批、批了从检查点续；硬停止能杀进程；所有限制都是用户的旋钮。

**Architecture:** 新子系统 `server/src/bots/`（档案 store、调度 scheduler、流水线 pipeline、策略 policy/、审计 audit、收件箱 inbox、服务 service），复用 `pool.open()` 起对话、`schedules/cron.ts` 算时间、`ledger.rowsFor()` 记账、`memory.db` 新 scope、`im.router` 推消息。策略闸挂在 `SessionRunner.onCanUseTool()` 前面的一个可选 `gate` 钩子上：允许 / 拒绝立刻回答，「先问我」记进收件箱并**拒绝并说明已排队**（SDK 的 canUseTool 挂起就会卡住整轮，所以不挂起），批准后在同一对话里续一轮。前端：图标栏分区 `bots`（`web/src/features/bots/`）+ 总览栏「需要你」lane 上的收件箱。

**Tech Stack:** Node 20 + TypeScript（server，vitest）、React + zustand（web，vitest）、Electron（desktop）。i18n：`tr('中文')`，英文在各自的 `en.ts`。

**Spec:** `docs/superpowers/specs/2026-10-30-duty-bots-design.md`（§1–§3、§5–§7、§10、§11 一期、§12）。二期 / 三期另写计划。

## Global Constraints

- 用户看得见的字全部走 `tr('中文')`（server：`import { tr } from '../i18n/index.js'`；web：`import { tr } from '@/i18n'`），新字加进对应 `en.ts`；每个前端任务末尾跑 `node scripts/i18n/extract.mjs --check`。
- 用户看得见的字叫「对话」不叫「会话」；不出现 档案 / 引擎 / 窗格 / 停靠 / effort / ultracode / ACP（`wording.test.ts` 会拦）。Bot 的 charter 在界面上叫「章程」，Routine 叫「例行」，Run 叫「运行」。
- 子进程 `spawn` / `execFile` 显式 `windowsHide: true`。
- 新 UI 状态存 meta.json（`settings.set`），不用 localStorage。
- zustand 选择器返回稳定引用（不 `?? []`、不 `.filter()`、不 `({…})`）。
- 分区页不卸载，只 `hidden`。
- 仓库是 LF；改文件用 Edit / Write。
- 跑测试前去掉本机 shell 继承的变量：`env $(env | cut -d= -f1 | grep -E '^(CLAUDE|ANTHROPIC|ELECTRON_RUN_AS_NODE)' | sed 's/^/-u /') npm test -w server`。下文写 `npm test -w server -- <file>` 时都默认带这个前缀。
- 提交只 `git add` 自己改的文件；工作区里别的对话的改动（`server/src/config/service.ts`、`protocol.ts` 别处、`.probe/`）不带。
- 数据目录：`dataDir()`（`server/src/files/service.ts`），Bot 在 `<dataDir>/bots/<id>/`。
- Bot 默认走 API / 网关供应商：`bot.providerId` 为空时用设置 `bots.defaultProvider`，仍为空才用对话的默认供应商。

## 文件结构

**server（新建）**
- `server/src/bots/types.ts` — 子系统内部类型（协议里公开的在 `protocol.ts`）
- `server/src/bots/store.ts` — `BotStore`：bot.json、`state/`、`runs/`、`inbox.json`、`trust.json` 的读写
- `server/src/bots/policy/classify.ts` — `classify(toolName, input): ActionClass`
- `server/src/bots/policy/rules.ts` — `DEFAULT_RULES`、`decide(policy, trust, cls, input, now): Decision`
- `server/src/bots/policy/trust.ts` — `recordApproval / recordCorrection / proposeUpgrade`
- `server/src/bots/policy/gate.ts` — `makeGate(ctx)`：把 classify + decide + inbox + audit 接成 runner 的 `gate`
- `server/src/bots/audit.ts` — `AuditLog`：往 `runs/<runId>.jsonl` 追加 `AuditRow`
- `server/src/bots/inbox.ts` — `Inbox`：四类条目、answer()
- `server/src/bots/precheck.ts` — `runScript(script, cwd, timeoutMs)`：预检 / 验收脚本的执行
- `server/src/bots/pipeline.ts` — `runRoutine(ctx, bot, routine, trigger)`：一次运行
- `server/src/bots/scheduler.ts` — `BotScheduler`：tick、队列、并发、预算
- `server/src/bots/templates.ts` — 14 个模板
- `server/src/bots/generate.ts` — 一句话 → Bot 草案（只聊天对话）
- `server/src/bots/service.ts` — `BotService`：对外接口，接 hub
- `server/src/bots/duty.ts` — 值班模式：开机自启 / 无界面服务的脚本生成
- 测试与各文件同目录 `*.test.ts`

**server（修改）**
- `server/src/protocol.ts` — 公开类型、`bots.*` 请求与事件、`MemoryScope` 加 `'bot'`
- `server/src/memory/service.ts` — `MemoryScope` 加 `'bot'`、`MemoryQuery.botId`
- `server/src/runtime/session-runner.ts` — `gate` 钩子
- `server/src/agents/types.ts` — `AgentDriver.gate?`
- `server/src/im/router.ts` — `sendTo(gatewayId, chatId, text, buttons)` 公开；`bots` callback
- `server/src/ws/hub.ts` — `bots.*` 分支、事件转发
- `server/src/index.ts` — 构造 `BotService`
- `server/src/i18n/en.ts` — 新字

**web（新建）**
- `web/src/features/bots/state.ts` — zustand store + `registerPage('bots')` + `installBots()`
- `web/src/features/bots/model.ts` — 纯函数：状态文字、费用格式、排序
- `web/src/features/bots/BotsPage.tsx` — 三栏页
- `web/src/features/bots/BotList.tsx`、`BotDetail.tsx`、`RoutineTable.tsx`、`RunList.tsx`、`PolicyEditor.tsx`、`LoadBar.tsx`
- `web/src/features/bots/CreateBot.tsx` — 三入口 + 一屏预览
- `web/src/features/bots/Inbox.tsx` — 收件箱（总览栏里用）
- `web/src/features/bots/bots.css`
- `web/src/features/bots/model.test.ts`、`state.test.ts`

**web（修改）**
- `web/src/features/sections/pages.ts` — `Section` 加 `'bots'`
- `web/src/features/sections/index.ts` — import bots/state
- `web/src/features/rail/rail-model.ts`、`Rail.tsx` — 新分区
- `web/src/features/workbench/Workbench.tsx` — 挂 `BotsPage`
- `web/src/features/panels/MissionPanel.tsx` — 「需要你」lane 里挂 `Inbox`
- `web/src/features/settings/catalog.ts`、`SettingsModal.tsx` — 设置 → Bot
- `web/src/i18n/en.ts`

**desktop（修改）**
- `desktop/main.ts`（或其窗口管理文件）— 关窗口缩到托盘（`bots.dutyMode === 'tray'`）、开机自启

---

### Task 1: 协议类型与 memory scope

**Files:**
- Modify: `server/src/protocol.ts`（`MemoryScope` 第 31 行；`ClientRequest` 第 534 行起；`ServerEvent` 第 878 行附近；类型放在 `ScheduleRun` 第 944 行之后）
- Modify: `server/src/memory/service.ts:23,40-50,179-200`
- Test: `server/src/memory/service.test.ts`

**Interfaces:**
- Produces（后面所有任务都用这些名字）：

```ts
// ---- 值班 Bot（spec 2026-10-30-duty-bots-design） ----
export type BotTier = 'cheap' | 'balanced' | 'best';
/** what a tool call is about to do; the policy is written per class, not per tool */
export type ActionClass = 'read' | 'write_local' | 'browser' | 'send' | 'pay' | 'delete' | 'install';
export type PolicyLevel = 'do' | 'do_tell' | 'ask' | 'deny';
export interface PolicyScope { recipients?: string[]; domains?: string[]; channels?: string[]; maxAmount?: number; perDay?: number; until?: number; unlimited?: boolean }
export interface PolicyRule { cls: ActionClass; level: PolicyLevel; scope?: PolicyScope }
export interface BotPolicy { rules: PolicyRule[]; autoPilot?: { on: boolean; scope?: PolicyScope }; /** 放开全部: every gate off except stop and audit */ unleashed?: boolean; signOff?: boolean }
export interface BotCharter { role: string; audience?: string; sources: string[]; report?: string; done?: string }
export type BotOutput = { kind: 'inbox' } | { kind: 'im'; gatewayId: string; chatId: string } | { kind: 'file'; path: string };
export type RoutineAcceptance = { kind: 'script'; script: string } | { kind: 'none' };
export interface Routine {
  id: string; name: string; prompt: string; cron?: string; everyMinutes?: number; enabled: boolean;
  /** a script whose stdout is a fingerprint: unchanged since last run = skip without a model */
  precheck?: string;
  acceptance: RoutineAcceptance;
  timeoutMin?: number;
  onFail: 'retry_up' | 'resume' | 'inbox';
  failures?: number; nextRunAt?: number; lastRunAt?: number;
  selfMade?: boolean; shadow?: boolean;
}
export interface BotBudget { dailyUsd?: number; weeklyUsd?: number; explorePct?: number }
export interface Bot {
  id: string; name: string; avatar?: string; charter: BotCharter; cwd: string; tier: BotTier; providerId?: string; model?: string;
  policy: BotPolicy; budget: BotBudget; routines: Routine[]; outputs: BotOutput[];
  quiet?: { from: string; to: string }; threshold?: number; maxRoutines?: number; paused?: boolean; manager?: boolean;
  createdAt: number; updatedAt: number;
}
export type RunTrigger = 'cron' | 'manual' | 'dispatch' | 'resume';
export interface BotRun {
  id: string; botId: string; routineId: string; at: number; trigger: RunTrigger;
  skipped?: boolean; sessionId?: string; ok?: boolean; endedAt?: number; durationMs?: number;
  costUsd?: number; toolCalls?: number; usedScript?: boolean;
  /** what the bot said it did (its final text) vs what the acceptance check found */
  said?: string; verified?: { ok: boolean; note?: string }; error?: string; queued?: number;
}
export type AuditBasis = 'rule' | 'trust' | 'user' | 'autopilot' | 'unleashed';
export interface AuditRow { at: number; runId: string; botId: string; toolName: string; cls: ActionClass; level: PolicyLevel; basis: AuditBasis; summary: string; result: 'allowed' | 'denied' | 'queued'; undo?: string }
export type InboxKind = 'approval' | 'finding' | 'draft' | 'proposal';
export type InboxProposal = { type: 'trust_up'; cls: ActionClass; scope: PolicyScope } | { type: 'routine'; routine: Routine };
export interface InboxItem {
  id: string; kind: InboxKind; botId: string; runId?: string; routineId?: string; sessionId?: string; at: number;
  title: string; body?: string;
  toolName?: string; input?: Record<string, unknown>; cls?: ActionClass; undoable?: boolean;
  proposal?: InboxProposal;
  done?: { at: number; answer: InboxAnswer['answer'] };
}
export interface InboxAnswer { id: string; answer: 'approve' | 'approve_scope' | 'reject' | 'archive' | 'send' | 'adopt'; scope?: PolicyScope }
export interface BotLoad { running: number; queued: number; todayUsd: number; weekEstimateUsd: number; concurrency: number }
export interface BotStatus extends Bot { state: 'idle' | 'running' | 'queued' | 'paused' | 'attention'; todayUsd: number; weekUsd: number; pendingInbox: number; trust: Record<string, { approvals: number; lastAt: number }> }
export interface BotTemplate { id: string; name: string; desc: string; risk?: string; bot: Omit<Bot, 'id' | 'cwd' | 'createdAt' | 'updatedAt'> }
export interface BotDraft { bot: Omit<Bot, 'id' | 'createdAt' | 'updatedAt'> }
```

请求（加进 `ClientRequest` 联合）：

```ts
  | { kind: 'bots.list' }
  | { kind: 'bots.get'; id: string }
  | { kind: 'bots.create'; bot: BotDraft['bot'] }
  | { kind: 'bots.update'; id: string; patch: Partial<Bot> }
  | { kind: 'bots.delete'; id: string }
  | { kind: 'bots.pause'; id: string; paused: boolean }
  | { kind: 'bots.runNow'; id: string; routineId: string }
  | { kind: 'bots.stopAll' }
  | { kind: 'bots.stop'; id: string }
  | { kind: 'bots.inbox.list'; botId?: string; includeDone?: boolean }
  | { kind: 'bots.inbox.answer'; answer: InboxAnswer }
  | { kind: 'bots.runs.list'; botId?: string; routineId?: string; limit?: number }
  | { kind: 'bots.runs.audit'; botId: string; runId: string }
  | { kind: 'bots.generate'; text: string; cwd: string }
  | { kind: 'bots.templates' }
  | { kind: 'bots.load' }
  | { kind: 'bots.unleash'; id: string; on: boolean }
  | { kind: 'bots.duty.install'; mode: 'autostart' | 'service'; on: boolean }
```

事件（加进 `ServerEvent` 联合）：

```ts
  | { kind: 'bots.changed'; bots: BotStatus[] }
  | { kind: 'bots.run'; run: BotRun }
  | { kind: 'bots.inbox'; item: InboxItem }
  | { kind: 'bots.load'; load: BotLoad }
```

`MemoryScope` 改为 `'global' | 'project' | 'session' | 'bot'`（protocol.ts 与 memory/service.ts 两处）；`MemoryQuery` 加 `botId?: string`。

- [ ] **Step 1: 写失败的测试（memory bot scope）**

在 `server/src/memory/service.test.ts` 末尾加：

```ts
describe('bot scope', () => {
  it('writes and finds memories keyed by bot id, and never leaks them into a project search', () => {
    const m = new MemoryService(':memory:');
    m.write({ scope: 'bot', key: 'bot_a', text: '晨报只看 GitHub 的 issue' });
    m.write({ scope: 'project', key: '/p', text: '晨报也看飞书' });
    expect(m.search({ scope: 'bot', botId: 'bot_a' }).map((x) => x.text)).toEqual(['晨报只看 GitHub 的 issue']);
    expect(m.search({ scope: 'bot', botId: 'bot_b' })).toEqual([]);
    expect(m.search({ cwd: '/p' }).map((x) => x.text)).toEqual(['晨报也看飞书']);
  });
});
```

（`MemoryService` 的构造参数按文件顶部现有测试的写法来——先看一眼 `service.test.ts` 开头怎么 new 的，照抄。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w server -- memory/service.test.ts`
Expected: FAIL（类型 `'bot'` 不在 `MemoryScope`，或 search 返回空）

- [ ] **Step 3: 改 protocol.ts 与 memory/service.ts**

protocol.ts 第 31 行：`export type MemoryScope = 'global' | 'project' | 'session' | 'bot';`，把上面的类型块加到 `ScheduleRun` 之后，请求 / 事件加进两个联合。

memory/service.ts：第 23 行同样加 `'bot'`；`MemoryQuery` 加 `botId?: string;`；`search()` 里第 184–196 行：

```ts
    if (q.scope) {
      where.push('m.scope = ?');
      args.push(q.scope);
      if (q.scope !== 'global') {
        where.push('m.key = ?');
        args.push(norm(q.scope === 'session' ? q.sessionId ?? '' : q.scope === 'bot' ? q.botId ?? '' : q.cwd ?? ''));
      }
    } else {
      const parts = ["m.scope = 'global'"];
      if (q.cwd) { parts.push("(m.scope = 'project' AND m.key = ?)"); args.push(norm(q.cwd)); }
      if (q.sessionId) { parts.push("(m.scope = 'session' AND m.key = ?)"); args.push(norm(q.sessionId)); }
      if (q.botId) { parts.push("(m.scope = 'bot' AND m.key = ?)"); args.push(norm(q.botId)); }
      where.push(`(${parts.join(' OR ')})`);
    }
```

（第 188–189 行原来的 `where.push('m.key = ?')` 那两行改成上面的形式；`else` 分支末尾原有的 `where.push(...)` 保留原样。）

- [ ] **Step 4: 跑测试与 typecheck**

Run: `npm test -w server -- memory/service.test.ts && npm run typecheck`
Expected: PASS；typecheck 通过（hub 里 `switch (req.kind)` 没有 default 分支的话，新 kind 不会报错；有 exhaustive check 的话先在 hub 加 `case 'bots.list': throw new Error('todo')` 之类占位——Task 13 会替换）。

- [ ] **Step 5: 提交**

```bash
git add server/src/protocol.ts server/src/memory/service.ts server/src/memory/service.test.ts
git commit -m "feat(bots): protocol types for duty bots (bot, routine, run, policy, inbox, audit) and a bot scope in the memory store"
```

---

### Task 2: BotStore — 档案目录

**Files:**
- Create: `server/src/bots/types.ts`
- Create: `server/src/bots/store.ts`
- Test: `server/src/bots/store.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
export interface TrustEntry { approvals: number; lastAt: number }
export type TrustMap = Record<string, TrustEntry>; // key = `${cls}|${scopeKey}`
export interface RoutineState { fingerprint?: string; checkpoint?: string; lastSummary?: string; updatedAt: number }

// store.ts
export class BotStore {
  constructor(root: string)                       // <dataDir>/bots
  list(): Bot[]; get(id: string): Bot | undefined;
  async save(bot: Bot): Promise<Bot>;             // writes bot.json, updatedAt = now
  async remove(id: string): Promise<void>;
  dir(id: string): string;                        // <root>/<id>
  stateOf(id: string, routineId: string): RoutineState;
  async setState(id: string, routineId: string, patch: Partial<RoutineState>): Promise<void>;
  trust(id: string): TrustMap; async setTrust(id: string, t: TrustMap): Promise<void>;
  runs(id: string, limit?: number): BotRun[];      // newest first, from runs/index.jsonl
  async addRun(run: BotRun): Promise<void>;        // append to runs/index.jsonl; same id replaces (rewrite file)
  async appendAudit(id: string, runId: string, row: AuditRow): Promise<void>;  // runs/<runId>.audit.jsonl
  audit(id: string, runId: string): AuditRow[];
  inbox(id?: string): InboxItem[]; async setInbox(items: InboxItem[]): Promise<void>; // <root>/inbox.json (all bots)
  newId(): string                                  // `b_` + 8 chars
}
```

- [ ] **Step 1: 写失败的测试**

```ts
// server/src/bots/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BotStore } from './store.js';
import type { Bot, BotRun } from '../protocol.js';

const bot = (id: string): Bot => ({ id, name: '晨报', charter: { role: '每天早上汇总 issue', sources: ['github'] }, cwd: '/p', tier: 'balanced', policy: { rules: [] }, budget: {}, routines: [], outputs: [{ kind: 'inbox' }], createdAt: 1, updatedAt: 1 });

describe('BotStore', () => {
  let root: string; let s: BotStore;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-bots-')); s = new BotStore(root); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('saves a bot as <root>/<id>/bot.json and lists it after a fresh load', async () => {
    await s.save(bot('b_1'));
    expect(fs.existsSync(path.join(root, 'b_1', 'bot.json'))).toBe(true);
    expect(new BotStore(root).list().map((b) => b.id)).toEqual(['b_1']);
  });

  it('keeps routine state and trust per bot', async () => {
    await s.save(bot('b_1'));
    await s.setState('b_1', 'r1', { fingerprint: 'abc' });
    expect(s.stateOf('b_1', 'r1').fingerprint).toBe('abc');
    expect(s.stateOf('b_1', 'r2').fingerprint).toBeUndefined();
    await s.setTrust('b_1', { 'send|slack:#dev': { approvals: 2, lastAt: 5 } });
    expect(new BotStore(root).trust('b_1')['send|slack:#dev'].approvals).toBe(2);
  });

  it('appends runs newest-first and replaces a run with the same id', async () => {
    await s.save(bot('b_1'));
    const r = (id: string, at: number): BotRun => ({ id, botId: 'b_1', routineId: 'r1', at, trigger: 'cron' });
    await s.addRun(r('run1', 1)); await s.addRun(r('run2', 2)); await s.addRun({ ...r('run1', 1), ok: true });
    expect(s.runs('b_1').map((x) => [x.id, x.ok])).toEqual([['run2', undefined], ['run1', true]]);
  });

  it('audit rows go to runs/<runId>.audit.jsonl', async () => {
    await s.save(bot('b_1'));
    await s.appendAudit('b_1', 'run1', { at: 1, runId: 'run1', botId: 'b_1', toolName: 'Bash', cls: 'read', level: 'do', basis: 'rule', summary: 'ls', result: 'allowed' });
    expect(s.audit('b_1', 'run1')).toHaveLength(1);
    expect(fs.existsSync(path.join(root, 'b_1', 'runs', 'run1.audit.jsonl'))).toBe(true);
  });

  it('inbox is one file for every bot, filterable by bot', async () => {
    await s.setInbox([{ id: 'i1', kind: 'finding', botId: 'b_1', at: 1, title: 'x' }, { id: 'i2', kind: 'finding', botId: 'b_2', at: 2, title: 'y' }]);
    expect(s.inbox('b_2').map((i) => i.id)).toEqual(['i2']);
    expect(new BotStore(root).inbox()).toHaveLength(2);
  });

  it('remove deletes the directory', async () => {
    await s.save(bot('b_1')); await s.remove('b_1');
    expect(s.list()).toEqual([]); expect(fs.existsSync(path.join(root, 'b_1'))).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w server -- bots/store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// server/src/bots/types.ts
export interface TrustEntry { approvals: number; lastAt: number }
export type TrustMap = Record<string, TrustEntry>;
export interface RoutineState { fingerprint?: string; checkpoint?: string; lastSummary?: string; updatedAt: number }
```

```ts
// server/src/bots/store.ts
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AuditRow, Bot, BotRun, InboxItem } from '../protocol.js';
import type { RoutineState, TrustMap } from './types.js';

const readJson = <T>(file: string, fallback: T): T => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; } };
const readJsonl = <T>(file: string): T[] => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T); } catch { return []; } };
async function writeJson(file: string, v: unknown) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, JSON.stringify(v, null, 2) + '\n', 'utf8'); }

/** One directory per bot under <dataDir>/bots; bot.json is the profile, everything else is what it accumulates. */
export class BotStore {
  private bots = new Map<string, Bot>();
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true });
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const b = readJson<Bot | null>(path.join(root, d.name, 'bot.json'), null);
      if (b?.id) this.bots.set(b.id, b);
    }
  }
  newId() { return `b_${randomBytes(4).toString('hex')}`; }
  dir(id: string) { return path.join(this.root, id); }
  list(): Bot[] { return [...this.bots.values()].sort((a, b) => a.createdAt - b.createdAt); }
  get(id: string) { return this.bots.get(id); }
  async save(bot: Bot): Promise<Bot> {
    const b = { ...bot, updatedAt: Date.now() };
    this.bots.set(b.id, b);
    await writeJson(path.join(this.dir(b.id), 'bot.json'), b);
    return b;
  }
  async remove(id: string) { this.bots.delete(id); await fsp.rm(this.dir(id), { recursive: true, force: true }); }

  private stateFile(id: string, routineId: string) { return path.join(this.dir(id), 'state', `${routineId.replace(/[^\w-]/g, '_')}.json`); }
  stateOf(id: string, routineId: string): RoutineState { return readJson<RoutineState>(this.stateFile(id, routineId), { updatedAt: 0 }); }
  async setState(id: string, routineId: string, patch: Partial<RoutineState>) { await writeJson(this.stateFile(id, routineId), { ...this.stateOf(id, routineId), ...patch, updatedAt: Date.now() }); }

  trust(id: string): TrustMap { return readJson<TrustMap>(path.join(this.dir(id), 'trust.json'), {}); }
  async setTrust(id: string, t: TrustMap) { await writeJson(path.join(this.dir(id), 'trust.json'), t); }

  private runsFile(id: string) { return path.join(this.dir(id), 'runs', 'index.jsonl'); }
  runs(id: string, limit = 200): BotRun[] {
    const byId = new Map<string, BotRun>();
    for (const r of readJsonl<BotRun>(this.runsFile(id))) byId.set(r.id, r);
    return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, limit);
  }
  async addRun(run: BotRun) {
    const f = this.runsFile(run.botId);
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.appendFile(f, JSON.stringify(run) + '\n', 'utf8');
  }
  private auditFile(id: string, runId: string) { return path.join(this.dir(id), 'runs', `${runId}.audit.jsonl`); }
  async appendAudit(id: string, runId: string, row: AuditRow) { const f = this.auditFile(id, runId); await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.appendFile(f, JSON.stringify(row) + '\n', 'utf8'); }
  audit(id: string, runId: string): AuditRow[] { return readJsonl<AuditRow>(this.auditFile(id, runId)); }

  private inboxFile() { return path.join(this.root, 'inbox.json'); }
  inbox(id?: string): InboxItem[] { const all = readJson<InboxItem[]>(this.inboxFile(), []); return id ? all.filter((i) => i.botId === id) : all; }
  async setInbox(items: InboxItem[]) { await writeJson(this.inboxFile(), items); }
}
```

- [ ] **Step 4: 跑测试**

Run: `npm test -w server -- bots/store.test.ts`
Expected: PASS（6 个）

- [ ] **Step 5: 提交**

```bash
git add server/src/bots/types.ts server/src/bots/store.ts server/src/bots/store.test.ts
git commit -m "feat(bots): BotStore — one directory per bot (bot.json, routine state, trust, runs, audit) and a shared inbox file"
```

---

### Task 3: 动作归类 classify()

**Files:**
- Create: `server/src/bots/policy/classify.ts`
- Test: `server/src/bots/policy/classify.test.ts`

**Interfaces:**
- Produces: `export function classify(toolName: string, input: Record<string, unknown>): ActionClass`；`export function summarize(toolName: string, input: Record<string, unknown>): string`（审计用的一行摘要，≤ 160 字）；`export function targetOf(cls, toolName, input): { domain?: string; recipient?: string; channel?: string; amount?: number }`（范围匹配用）。

- [ ] **Step 1: 写失败的测试**

```ts
// server/src/bots/policy/classify.test.ts
import { describe, it, expect } from 'vitest';
import { classify, summarize, targetOf } from './classify.js';

describe('classify', () => {
  it('reads: Read / Glob / Grep / WebFetch GET / web.search', () => {
    expect(classify('Read', { file_path: '/a' })).toBe('read');
    expect(classify('Grep', { pattern: 'x' })).toBe('read');
    expect(classify('WebFetch', { url: 'https://x.com' })).toBe('read');
    expect(classify('ExecuteExtraTool', { tool_name: 'web.search', params: {} })).toBe('read');
  });
  it('local writes: Edit / Write / NotebookEdit, and Bash that stays local', () => {
    expect(classify('Edit', { file_path: '/a' })).toBe('write_local');
    expect(classify('Bash', { command: 'npm test' })).toBe('write_local');
    expect(classify('Bash', { command: 'git commit -m x' })).toBe('write_local');
  });
  it('sends: git push, gh pr create, curl POST, IM / mail tools', () => {
    expect(classify('Bash', { command: 'git push origin main' })).toBe('send');
    expect(classify('Bash', { command: 'gh pr create --title x' })).toBe('send');
    expect(classify('Bash', { command: 'curl -X POST https://api.example.com/x' })).toBe('send');
    expect(classify('ExecuteExtraTool', { tool_name: 'mcp__slack__send_message', params: { channel: 'C1' } })).toBe('send');
  });
  it('irreversible deletes: rm -rf, git push --delete, git branch -D, deleting mail', () => {
    expect(classify('Bash', { command: 'rm -rf dist' })).toBe('delete');
    expect(classify('Bash', { command: 'git push origin --delete feature' })).toBe('delete');
    expect(classify('Bash', { command: 'git branch -D x' })).toBe('delete');
    expect(classify('ExecuteExtraTool', { tool_name: 'mcp__gmail__delete_message', params: {} })).toBe('delete');
  });
  it('pay: known payment hosts and amount-bearing form submits', () => {
    expect(classify('Bash', { command: 'curl https://api.stripe.com/v1/charges -d amount=100' })).toBe('pay');
    expect(classify('ExecuteExtraTool', { tool_name: 'browser_click', params: { url: 'https://checkout.stripe.com/pay' } })).toBe('pay');
  });
  it('install: npm i -g, pip install, brew, apt, winget, claude plugin install', () => {
    expect(classify('Bash', { command: 'npm i -g foo' })).toBe('install');
    expect(classify('Bash', { command: 'pip install requests' })).toBe('install');
    expect(classify('Bash', { command: 'claude plugin install x' })).toBe('install');
  });
  it('browser / computer tools are browser', () => {
    expect(classify('ExecuteExtraTool', { tool_name: 'ego_browser', params: {} })).toBe('browser');
    expect(classify('ExecuteExtraTool', { tool_name: 'browser_computer', params: { action: 'left_click' } })).toBe('browser');
    expect(classify('ExecuteExtraTool', { tool_name: 'computer.click', params: {} })).toBe('browser');
  });
  it('unknown tools count as send (the safe side)', () => {
    expect(classify('SomethingNew', {})).toBe('send');
    expect(classify('ExecuteExtraTool', { tool_name: 'mcp__foo__bar', params: {} })).toBe('send');
  });
  it('summarize is one short line', () => {
    expect(summarize('Bash', { command: 'git push origin main' })).toBe('Bash: git push origin main');
    expect(summarize('Edit', { file_path: '/a/b.ts', old_string: 'x'.repeat(500) }).length).toBeLessThanOrEqual(160);
  });
  it('targetOf picks the domain / channel / amount the scope rules match on', () => {
    expect(targetOf('send', 'Bash', { command: 'curl -X POST https://api.example.com/x' })).toEqual({ domain: 'api.example.com' });
    expect(targetOf('send', 'ExecuteExtraTool', { tool_name: 'mcp__slack__send_message', params: { channel: 'C1' } })).toEqual({ channel: 'C1' });
    expect(targetOf('pay', 'Bash', { command: 'curl https://api.stripe.com/v1/charges -d amount=100' })).toEqual({ domain: 'api.stripe.com', amount: 100 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w server -- bots/policy/classify.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// server/src/bots/policy/classify.ts
import type { ActionClass } from '../../protocol.js';

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TaskOutput', 'TaskList', 'TaskGet', 'LSP']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'TodoWrite', 'TaskCreate', 'TaskUpdate']);
const PAY_HOSTS = /(^|\.)(stripe\.com|paypal\.com|alipay\.com|checkout\.|pay\.|payments?\.)/i;

const innerName = (toolName: string, input: Record<string, unknown>) => toolName === 'ExecuteExtraTool' && typeof input.tool_name === 'string' ? input.tool_name : toolName;
const innerParams = (toolName: string, input: Record<string, unknown>) => (toolName === 'ExecuteExtraTool' && input.params && typeof input.params === 'object' ? input.params : input) as Record<string, unknown>;

function classifyCommand(cmd: string): ActionClass {
  const c = cmd.trim();
  if (/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/.test(c) || /\bgit\s+push\b.*--delete\b/.test(c) || /\bgit\s+branch\s+-D\b/.test(c) || /\bgit\s+push\b.*\s:\S/.test(c)) return 'delete';
  if (/https?:\/\/[^\s/]*(stripe|paypal|alipay|checkout\.|\/pay\b)/i.test(c)) return 'pay';
  if (/\b(npm|pnpm|yarn)\s+(i|install|add)\b.*(-g|--global)|\bpip3?\s+install\b|\buv\s+tool\s+install\b|\bbrew\s+install\b|\bapt(-get)?\s+install\b|\bwinget\s+install\b|\bchoco\s+install\b|\bclaude\s+plugin\s+install\b|\bnpx\s+skills\s+add\b/.test(c)) return 'install';
  if (/\bgit\s+push\b|\bgh\s+(pr|issue|release)\s+(create|comment|merge|close|edit)\b|\bglab\s+mr\b|\bcurl\b.*(-X\s*(POST|PUT|PATCH|DELETE)|--data|-d\s)|\bwget\b.*--post|\bInvoke-WebRequest\b.*-Method\s+(Post|Put)|\bmail\b|\bsendmail\b|\bssh\b|\bscp\b|\brsync\b.*:/.test(c)) return 'send';
  return 'write_local';
}

/** Which class of action a tool call is — the policy is written per class. Unknown tools are 'send': the side that asks. */
export function classify(toolName: string, input: Record<string, unknown>): ActionClass {
  const name = innerName(toolName, input);
  const p = innerParams(toolName, input);
  if (READ_TOOLS.has(name)) return 'read';
  if (WRITE_TOOLS.has(name)) return 'write_local';
  if (name === 'Bash' || name === 'PowerShell') return classifyCommand(String(p.command ?? ''));
  if (/^web\.(search|read)$|^memory\.(search|reflect)$|^mcp__.*(search|list|get|read|fetch|find)/i.test(name)) return 'read';
  if (/^memory\.write$|^sessions\./.test(name)) return 'write_local';
  if (/delete|remove|destroy|purge|trash/i.test(name)) return 'delete';
  if (/pay|charge|checkout|purchase|order|transfer/i.test(name) || PAY_HOSTS.test(String(p.url ?? ''))) return 'pay';
  if (/^(ego_browser|browser_|web\.browser|computer[._])/.test(name) || /^mcp__web__/.test(name)) return 'browser';
  if (/install/i.test(name)) return 'install';
  return 'send';
}

export function summarize(toolName: string, input: Record<string, unknown>): string {
  const name = innerName(toolName, input);
  const p = innerParams(toolName, input);
  const key = typeof p.command === 'string' ? p.command : typeof p.file_path === 'string' ? p.file_path : typeof p.url === 'string' ? p.url : typeof p.channel === 'string' ? p.channel : JSON.stringify(p);
  return `${name}: ${String(key)}`.replace(/\s+/g, ' ').slice(0, 160);
}

export function targetOf(cls: ActionClass, toolName: string, input: Record<string, unknown>): { domain?: string; recipient?: string; channel?: string; amount?: number } {
  const p = innerParams(toolName, input);
  const text = typeof p.command === 'string' ? p.command : typeof p.url === 'string' ? p.url : '';
  const out: ReturnType<typeof targetOf> = {};
  const m = /https?:\/\/([^\s/'"]+)/.exec(text); if (m) out.domain = m[1].toLowerCase();
  if (typeof p.channel === 'string') out.channel = p.channel;
  if (typeof p.to === 'string') out.recipient = p.to; else if (typeof p.recipient === 'string') out.recipient = p.recipient;
  if (cls === 'pay') { const a = /amount[=:\s]+(\d+(?:\.\d+)?)/i.exec(text); if (a) out.amount = Number(a[1]); }
  return out;
}
```

- [ ] **Step 4: 跑测试**

Run: `npm test -w server -- bots/policy/classify.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/bots/policy/classify.ts server/src/bots/policy/classify.test.ts
git commit -m "feat(bots): classify a tool call into read / write_local / browser / send / pay / delete / install (unknown = send)"
```

---

### Task 4: 四档规则 decide()

**Files:**
- Create: `server/src/bots/policy/rules.ts`
- Test: `server/src/bots/policy/rules.test.ts`

**Interfaces:**
- Consumes: `targetOf()` 的返回形状。
- Produces:

```ts
export const DEFAULT_RULES: PolicyRule[];   // read/write_local/browser → do; install → do_tell; send/pay/delete → ask
export interface Decision { level: PolicyLevel; basis: AuditBasis; rule?: PolicyRule }
export function scopeKey(scope: PolicyScope | undefined, target: Target): string;   // `domain:x` | `channel:x` | `recipient:x` | '*'
export function scopeMatches(scope: PolicyScope | undefined, target: Target, now: number, todayCount: number): boolean;
export function decide(policy: BotPolicy, cls: ActionClass, target: Target, now: number, todayCount: number): Decision;
```

规则：`unleashed` → `do` / `unleashed`；`autoPilot.on` 且 scope 匹配 → `do` / `autopilot`；按 `rules` 里同 cls 的规则：带 scope 的规则只在 scope 匹配时生效，优先于不带 scope 的；没有规则 → `DEFAULT_RULES`。scope 匹配：`unlimited` 永远匹配；`until` 过期不匹配；`domains / channels / recipients` 任一非空时 target 对应字段必须在表里；`maxAmount` 时 `target.amount <= maxAmount`；`perDay` 时 `todayCount < perDay`。

- [ ] **Step 1: 写失败的测试**

```ts
// server/src/bots/policy/rules.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES, decide, scopeMatches, scopeKey } from './rules.js';
import type { BotPolicy } from '../../protocol.js';

const empty: BotPolicy = { rules: [] };
describe('decide', () => {
  it('defaults: read / local / browser do, install do_tell, send / pay / delete ask', () => {
    expect(DEFAULT_RULES.find((r) => r.cls === 'read')!.level).toBe('do');
    expect(decide(empty, 'write_local', {}, 0, 0)).toEqual({ level: 'do', basis: 'rule', rule: DEFAULT_RULES.find((r) => r.cls === 'write_local') });
    expect(decide(empty, 'install', {}, 0, 0).level).toBe('do_tell');
    expect(decide(empty, 'send', {}, 0, 0).level).toBe('ask');
    expect(decide(empty, 'pay', {}, 0, 0).level).toBe('ask');
    expect(decide(empty, 'delete', {}, 0, 0).level).toBe('ask');
  });
  it('a scoped rule beats the default only when the target is inside the scope', () => {
    const p: BotPolicy = { rules: [{ cls: 'send', level: 'do', scope: { channels: ['C1'], until: 100 } }] };
    expect(decide(p, 'send', { channel: 'C1' }, 50, 0).level).toBe('do');
    expect(decide(p, 'send', { channel: 'C2' }, 50, 0).level).toBe('ask');
    expect(decide(p, 'send', { channel: 'C1' }, 200, 0).level).toBe('ask');
  });
  it('maxAmount and perDay are limits, unlimited matches everything', () => {
    expect(scopeMatches({ maxAmount: 50 }, { amount: 30 }, 0, 0)).toBe(true);
    expect(scopeMatches({ maxAmount: 50 }, { amount: 80 }, 0, 0)).toBe(false);
    expect(scopeMatches({ maxAmount: 50 }, {}, 0, 0)).toBe(false);
    expect(scopeMatches({ perDay: 3 }, {}, 0, 3)).toBe(false);
    expect(scopeMatches({ unlimited: true }, { amount: 1e9 }, 0, 999)).toBe(true);
  });
  it('autoPilot and unleashed say do with their own basis', () => {
    expect(decide({ rules: [], autoPilot: { on: true, scope: { domains: ['a.com'] } } }, 'send', { domain: 'a.com' }, 0, 0)).toMatchObject({ level: 'do', basis: 'autopilot' });
    expect(decide({ rules: [], autoPilot: { on: true, scope: { domains: ['a.com'] } } }, 'send', { domain: 'b.com' }, 0, 0).level).toBe('ask');
    expect(decide({ rules: [], unleashed: true }, 'pay', {}, 0, 0)).toMatchObject({ level: 'do', basis: 'unleashed' });
  });
  it('an explicit deny stays deny even with autoPilot', () => {
    expect(decide({ rules: [{ cls: 'pay', level: 'deny' }], autoPilot: { on: true, scope: { unlimited: true } } }, 'pay', {}, 0, 0).level).toBe('deny');
  });
  it('scopeKey names what trust is counted on', () => {
    expect(scopeKey(undefined, { channel: 'C1' })).toBe('channel:C1');
    expect(scopeKey(undefined, { domain: 'a.com' })).toBe('domain:a.com');
    expect(scopeKey(undefined, {})).toBe('*');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w server -- bots/policy/rules.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// server/src/bots/policy/rules.ts
import type { ActionClass, AuditBasis, BotPolicy, PolicyLevel, PolicyRule, PolicyScope } from '../../protocol.js';

export type Target = { domain?: string; recipient?: string; channel?: string; amount?: number };
export interface Decision { level: PolicyLevel; basis: AuditBasis; rule?: PolicyRule }

/** 宽但不出事: everything local runs; installing tells; anything outward, money or irreversible asks. */
export const DEFAULT_RULES: PolicyRule[] = [
  { cls: 'read', level: 'do' }, { cls: 'write_local', level: 'do' }, { cls: 'browser', level: 'do' },
  { cls: 'install', level: 'do_tell' },
  { cls: 'send', level: 'ask' }, { cls: 'pay', level: 'ask' }, { cls: 'delete', level: 'ask' },
];

export function scopeKey(_scope: PolicyScope | undefined, t: Target): string {
  if (t.channel) return `channel:${t.channel}`;
  if (t.recipient) return `recipient:${t.recipient}`;
  if (t.domain) return `domain:${t.domain}`;
  return '*';
}

export function scopeMatches(scope: PolicyScope | undefined, t: Target, now: number, todayCount: number): boolean {
  if (!scope) return true;
  if (scope.unlimited) return true;
  if (scope.until !== undefined && now > scope.until) return false;
  if (scope.domains?.length && !(t.domain && scope.domains.includes(t.domain))) return false;
  if (scope.channels?.length && !(t.channel && scope.channels.includes(t.channel))) return false;
  if (scope.recipients?.length && !(t.recipient && scope.recipients.includes(t.recipient))) return false;
  if (scope.maxAmount !== undefined && !(t.amount !== undefined && t.amount <= scope.maxAmount)) return false;
  if (scope.perDay !== undefined && todayCount >= scope.perDay) return false;
  return true;
}

export function decide(policy: BotPolicy, cls: ActionClass, t: Target, now: number, todayCount: number): Decision {
  const own = policy.rules.filter((r) => r.cls === cls);
  const deny = own.find((r) => r.level === 'deny' && scopeMatches(r.scope, t, now, todayCount));
  if (deny) return { level: 'deny', basis: 'rule', rule: deny };
  if (policy.unleashed) return { level: 'do', basis: 'unleashed' };
  if (policy.autoPilot?.on && scopeMatches(policy.autoPilot.scope, t, now, todayCount)) return { level: 'do', basis: 'autopilot' };
  const scoped = own.find((r) => r.scope && scopeMatches(r.scope, t, now, todayCount));
  if (scoped) return { level: scoped.level, basis: 'rule', rule: scoped };
  const plain = own.find((r) => !r.scope);
  if (plain) return { level: plain.level, basis: 'rule', rule: plain };
  const d = DEFAULT_RULES.find((r) => r.cls === cls)!;
  return { level: d.level, basis: 'rule', rule: d };
}
```

- [ ] **Step 4: 跑测试**

Run: `npm test -w server -- bots/policy/rules.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/bots/policy/rules.ts server/src/bots/policy/rules.test.ts
git commit -m "feat(bots): four-level policy per action class with scoped rules, autopilot and unleashed; wide defaults (ask only for send / pay / delete)"
```

---

### Task 5: 信任升降 trust.ts

**Files:**
- Create: `server/src/bots/policy/trust.ts`
- Test: `server/src/bots/policy/trust.test.ts`

**Interfaces:**
- Consumes: `TrustMap` / `TrustEntry`（types.ts）、`scopeKey`。
- Produces:

```ts
export const TRUST_THRESHOLD = 3;
export function recordApproval(t: TrustMap, cls: ActionClass, key: string, now: number): { trust: TrustMap; propose: boolean }; // propose = reached threshold exactly now
export function recordCorrection(t: TrustMap, cls: ActionClass, key: string): TrustMap;   // resets the counter
export function demoteRule(policy: BotPolicy, cls: ActionClass, key: string): BotPolicy;   // removes scoped 'do' / 'do_tell' rules of that cls whose scope covers key → back to ask
export function scopeFromKey(key: string): PolicyScope;                                     // 'channel:C1' → { channels: ['C1'] }
```

- [ ] **Step 1: 写失败的测试**

```ts
// server/src/bots/policy/trust.test.ts
import { describe, it, expect } from 'vitest';
import { recordApproval, recordCorrection, demoteRule, scopeFromKey, TRUST_THRESHOLD } from './trust.js';

describe('trust', () => {
  it('proposes an upgrade exactly when the Nth approval lands', () => {
    let t = {};
    let r = recordApproval(t, 'send', 'channel:C1', 1); expect(r.propose).toBe(false); t = r.trust;
    r = recordApproval(t, 'send', 'channel:C1', 2); expect(r.propose).toBe(false); t = r.trust;
    r = recordApproval(t, 'send', 'channel:C1', 3); expect(r.propose).toBe(TRUST_THRESHOLD === 3); t = r.trust;
    r = recordApproval(t, 'send', 'channel:C1', 4); expect(r.propose).toBe(false);
    expect(t['send|channel:C1']).toEqual({ approvals: 3, lastAt: 3 });
  });
  it('a correction resets the counter', () => {
    const t = recordApproval(recordApproval({}, 'send', 'x', 1).trust, 'send', 'x', 2).trust;
    expect(recordCorrection(t, 'send', 'x')['send|x']).toBeUndefined();
  });
  it('demoteRule drops the scoped do-rule that covered the key, leaving other rules', () => {
    const p = { rules: [{ cls: 'send' as const, level: 'do' as const, scope: { channels: ['C1'] } }, { cls: 'send' as const, level: 'do' as const, scope: { channels: ['C2'] } }, { cls: 'read' as const, level: 'do' as const }] };
    expect(demoteRule(p, 'send', 'channel:C1').rules).toEqual([p.rules[1], p.rules[2]]);
  });
  it('scopeFromKey', () => {
    expect(scopeFromKey('channel:C1')).toEqual({ channels: ['C1'] });
    expect(scopeFromKey('domain:a.com')).toEqual({ domains: ['a.com'] });
    expect(scopeFromKey('recipient:me@x')).toEqual({ recipients: ['me@x'] });
    expect(scopeFromKey('*')).toEqual({});
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w server -- bots/policy/trust.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// server/src/bots/policy/trust.ts
import type { ActionClass, BotPolicy, PolicyScope } from '../../protocol.js';
import type { TrustMap } from '../types.js';
import { scopeMatches } from './rules.js';

export const TRUST_THRESHOLD = 3;
const k = (cls: ActionClass, key: string) => `${cls}|${key}`;

/** The Nth approval of the same class in the same scope with no correction in between: propose one level up. */
export function recordApproval(t: TrustMap, cls: ActionClass, key: string, now: number): { trust: TrustMap; propose: boolean } {
  const cur = t[k(cls, key)] ?? { approvals: 0, lastAt: 0 };
  const next = { approvals: cur.approvals + 1, lastAt: now };
  return { trust: { ...t, [k(cls, key)]: next }, propose: next.approvals === TRUST_THRESHOLD };
}

export function recordCorrection(t: TrustMap, cls: ActionClass, key: string): TrustMap {
  const { [k(cls, key)]: _gone, ...rest } = t;
  return rest;
}

export function scopeFromKey(key: string): PolicyScope {
  const [kind, ...rest] = key.split(':'); const v = rest.join(':');
  if (kind === 'channel') return { channels: [v] };
  if (kind === 'domain') return { domains: [v] };
  if (kind === 'recipient') return { recipients: [v] };
  return {};
}

/** A correction: the scoped rules that let this class run on this target go away — it asks again. */
export function demoteRule(policy: BotPolicy, cls: ActionClass, key: string): BotPolicy {
  const s = scopeFromKey(key);
  const target = { channel: s.channels?.[0], domain: s.domains?.[0], recipient: s.recipients?.[0] };
  return { ...policy, rules: policy.rules.filter((r) => !(r.cls === cls && r.scope && r.level !== 'ask' && r.level !== 'deny' && scopeMatches(r.scope, target, 0, 0))) };
}
```

- [ ] **Step 4: 跑测试**

Run: `npm test -w server -- bots/policy/trust.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/bots/policy/trust.ts server/src/bots/policy/trust.test.ts
git commit -m "feat(bots): trust is earned — N approvals of a class in a scope propose an upgrade, one correction drops it back to ask"
```

---

### Task 6: runner 的 gate 钩子

**Files:**
- Modify: `server/src/agents/types.ts:21-48`（`AgentDriver`）
- Modify: `server/src/runtime/session-runner.ts:855-873`（`onCanUseTool`）
- Test: `server/src/runtime/session-runner.test.ts`（末尾加一个 describe）

**Interfaces:**
- Produces：

```ts
// agents/types.ts
export type ToolGate = (ev: PermissionRequestEvent) => Promise<PermissionResult | null>;
// AgentDriver 加：
  /** 值班 Bot: answers a tool's permission before it is asked anywhere (null = ask as usual) */
  gate?: ToolGate;
```

`PermissionResult` 从 `@anthropic-ai/claude-agent-sdk` 导出；types.ts 只 `import type`。SessionRunner 加 `gate?: ToolGate` 公共字段；`onCanUseTool` 里在 `preAllowed` 那行之后、`new Promise` 之前：

```ts
    if (this.gate) {
      return this.gate(event).then((r) => r ?? this.askUser(event, o.signal)).catch(() => this.askUser(event, o.signal));
    }
    return this.askUser(event, o.signal);
```

把原来 `return new Promise<PermissionResult>((resolve) => { … })` 整段抽成 `private askUser(event: PermissionRequestEvent, signal: AbortSignal): Promise<PermissionResult>`（内容不变，`o.signal` 换成 `signal`、`requestId` 取 `event.requestId`）。

- [ ] **Step 1: 写失败的测试**

在 `session-runner.test.ts` 末尾：

```ts
describe('值班 Bot gate', () => {
  const call = (r: SessionRunner, toolName: string, input: Record<string, unknown>) => (r as any).onCanUseTool(toolName, input, { signal: new AbortController().signal }) as Promise<PermissionResult>;
  it('a gate that answers is used and nothing is emitted', async () => {
    const r = new SessionRunner({ sessionId: 'g1', cwd: '/x' } as any);
    const seen: unknown[] = []; r.on('permission', (e) => seen.push(e));
    r.gate = async (ev) => (ev.toolName === 'Bash' ? { behavior: 'allow', updatedInput: ev.input } : null);
    expect(await call(r, 'Bash', { command: 'ls' })).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
    expect(seen).toEqual([]);
    expect(r.getPendingPermissions()).toEqual([]);
  });
  it('a gate that says null falls through to the usual card', async () => {
    const r = new SessionRunner({ sessionId: 'g2', cwd: '/x' } as any);
    r.gate = async () => null;
    const p = call(r, 'Edit', { file_path: '/a' });
    await new Promise((res) => setTimeout(res, 0));
    const pend = r.getPendingPermissions();
    expect(pend).toHaveLength(1);
    r.respondPermission(pend[0].requestId, { behavior: 'deny', message: 'no' });
    expect(await p).toMatchObject({ behavior: 'deny' });
  });
  it('a gate that throws also falls through', async () => {
    const r = new SessionRunner({ sessionId: 'g3', cwd: '/x' } as any);
    r.gate = async () => { throw new Error('boom'); };
    const p = call(r, 'Edit', { file_path: '/a' });
    await new Promise((res) => setTimeout(res, 0));
    expect(r.getPendingPermissions()).toHaveLength(1);
    r.respondPermission(r.getPendingPermissions()[0].requestId, { behavior: 'allow' });
    expect((await p).behavior).toBe('allow');
  });
});
```

（文件顶部已 `import { SessionRunner }`；`PermissionResult` 需要 `import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'`——该模块在文件第 7 行已被 `vi.mock`，type import 不受影响。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w server -- runtime/session-runner.test.ts -t "值班 Bot gate"`
Expected: FAIL（`gate` 没被调用，第一条 `seen` 不为空）

- [ ] **Step 3: 实现**（按上面 Interfaces 写的改法）

- [ ] **Step 4: 跑整个 runner 测试与 typecheck**

Run: `npm test -w server -- runtime/session-runner.test.ts && npm run typecheck`
Expected: PASS（原有用例不受影响）

- [ ] **Step 5: 提交**

```bash
git add server/src/agents/types.ts server/src/runtime/session-runner.ts server/src/runtime/session-runner.test.ts
git commit -m "feat(runtime): an optional gate answers a tool's permission before the card (duty bots' policy lives here, not in the prompt)"
```

---

### Task 7: 审计 + 收件箱

**Files:**
- Create: `server/src/bots/audit.ts`
- Create: `server/src/bots/inbox.ts`
- Test: `server/src/bots/inbox.test.ts`

**Interfaces:**
- Consumes: `BotStore`。
- Produces:

```ts
// audit.ts
export class AuditLog {
  constructor(private store: BotStore) {}
  async add(row: Omit<AuditRow, 'at'>): Promise<AuditRow>;   // at = Date.now(), appends via store.appendAudit
}
// inbox.ts
export class Inbox extends EventEmitter {   // emits 'item' (InboxItem) on add and on answer
  constructor(private store: BotStore) {}
  list(botId?: string, includeDone = false): InboxItem[];       // newest first
  pendingCount(botId?: string): number;
  async add(item: Omit<InboxItem, 'id' | 'at'>): Promise<InboxItem>;
  get(id: string): InboxItem | undefined;
  async answer(a: InboxAnswer): Promise<InboxItem>;              // marks done; throws when unknown / already done
}
```

- [ ] **Step 1: 写失败的测试**

```ts
// server/src/bots/inbox.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { BotStore } from './store.js';
import { Inbox } from './inbox.js';

describe('Inbox', () => {
  let root: string; let inbox: Inbox;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-inbox-')); inbox = new Inbox(new BotStore(root)); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('adds items newest first, counts only pending, emits on add and answer', async () => {
    const seen: string[] = []; inbox.on('item', (i) => seen.push(`${i.kind}:${i.done ? 'done' : 'open'}`));
    await inbox.add({ kind: 'finding', botId: 'b1', title: 'A' });
    const b = await inbox.add({ kind: 'approval', botId: 'b1', title: 'B', toolName: 'Bash', input: { command: 'git push' }, cls: 'send' });
    expect(inbox.list().map((i) => i.title)).toEqual(['B', 'A']);
    expect(inbox.pendingCount('b1')).toBe(2);
    const done = await inbox.answer({ id: b.id, answer: 'approve' });
    expect(done.done?.answer).toBe('approve');
    expect(inbox.pendingCount()).toBe(1);
    expect(inbox.list(undefined, true)).toHaveLength(2);
    expect(seen).toEqual(['finding:open', 'approval:open', 'approval:done']);
  });
  it('never expires: an item from long ago is still pending', async () => {
    const i = await inbox.add({ kind: 'approval', botId: 'b1', title: 'old' });
    const all = inbox.list(undefined, true); all[0].at = 1;
    await new Inbox(new BotStore(root)).add({ kind: 'finding', botId: 'b1', title: 'x' });
    expect(inbox.get(i.id)?.done).toBeUndefined();
  });
  it('answering twice or an unknown id throws', async () => {
    const i = await inbox.add({ kind: 'approval', botId: 'b1', title: 'x' });
    await inbox.answer({ id: i.id, answer: 'reject' });
    await expect(inbox.answer({ id: i.id, answer: 'approve' })).rejects.toThrow();
    await expect(inbox.answer({ id: 'nope', answer: 'approve' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w server -- bots/inbox.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// server/src/bots/audit.ts
import type { AuditRow } from '../protocol.js';
import type { BotStore } from './store.js';

/** One row per tool call. What the UI shows as "the bot did X" comes from here, never from the bot's own account. */
export class AuditLog {
  constructor(private store: BotStore) {}
  async add(row: Omit<AuditRow, 'at'>): Promise<AuditRow> {
    const full: AuditRow = { at: Date.now(), ...row };
    await this.store.appendAudit(row.botId, row.runId, full);
    return full;
  }
}
```

```ts
// server/src/bots/inbox.ts
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { InboxAnswer, InboxItem } from '../protocol.js';
import type { BotStore } from './store.js';
import { tr } from '../i18n/index.js';

/** 收件箱: approvals, findings, drafts, proposals from every bot. Nothing here expires. */
export class Inbox extends EventEmitter {
  private items: InboxItem[];
  constructor(private store: BotStore) { super(); this.items = store.inbox(); }
  list(botId?: string, includeDone = false): InboxItem[] {
    return this.items.filter((i) => (!botId || i.botId === botId) && (includeDone || !i.done)).sort((a, b) => b.at - a.at);
  }
  pendingCount(botId?: string) { return this.list(botId).length; }
  get(id: string) { return this.items.find((i) => i.id === id); }
  async add(item: Omit<InboxItem, 'id' | 'at'>): Promise<InboxItem> {
    const full: InboxItem = { id: `i_${randomBytes(4).toString('hex')}`, at: Date.now(), ...item };
    this.items.push(full);
    await this.store.setInbox(this.items);
    this.emit('item', full);
    return full;
  }
  async answer(a: InboxAnswer): Promise<InboxItem> {
    const i = this.get(a.id);
    if (!i) throw new Error(tr('收件箱里没有这一条'));
    if (i.done) throw new Error(tr('这一条已经处理过了'));
    i.done = { at: Date.now(), answer: a.answer };
    await this.store.setInbox(this.items);
    this.emit('item', i);
    return i;
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `npm test -w server -- bots/inbox.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/bots/audit.ts server/src/bots/inbox.ts server/src/bots/inbox.test.ts
git commit -m "feat(bots): audit log per run and a never-expiring inbox (approval / finding / draft / proposal)"
```

---

### Task 8: 策略闸 makeGate()

**Files:**
- Create: `server/src/bots/policy/gate.ts`
- Test: `server/src/bots/policy/gate.test.ts`

**Interfaces:**
- Consumes: `classify / summarize / targetOf`、`decide / scopeKey`、`recordApproval`（Task 11 用）、`AuditLog`、`Inbox`、`BotStore`。
- Produces:

```ts
export interface GateCtx { bot: Bot; runId: string; routineId: string; store: BotStore; audit: AuditLog; inbox: Inbox; now?: () => number; onTell?: (text: string) => void }
export interface GateHandle { gate: ToolGate; approveOnce(toolName: string, input: Record<string, unknown>): void; calls: number }
export function makeGate(ctx: GateCtx): GateHandle;
export function callKey(toolName: string, input: Record<string, unknown>): string;  // sha1 of toolName + stable JSON of input
```

行为：
- `do` → `{ behavior: 'allow', updatedInput }`，审计 `allowed`。
- `do_tell` → 同上，并 `onTell(summary)`（流水线用它往收件箱加一条 `finding`）。
- `ask` → 若 `approveOnce` 里有这次调用的 key → allow（basis `user`）；否则往收件箱加 `approval`（toolName、input、cls、runId、sessionId），审计 `queued`，返回 `{ behavior: 'deny', message: tr('这个动作要先经你批准，已放进收件箱（{title}）。先做别的；批准后会从这里继续。', { title }) }`。
- `deny` → `{ behavior: 'deny', message: tr('这个 Bot 的策略禁止这类动作：{cls}', …) }`，审计 `denied`。
- `todayCount`：今天已 `allowed` 的同 cls 行数（从 `store.audit` 不可得——gate 自己在内存里计数即可，一期按运行计）。
- 每次调用 `calls++`。

- [ ] **Step 1: 写失败的测试**

```ts
// server/src/bots/policy/gate.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { BotStore } from '../store.js'; import { AuditLog } from '../audit.js'; import { Inbox } from '../inbox.js';
import { makeGate } from './gate.js';
import type { Bot } from '../../protocol.js';

const bot = (policy: Bot['policy'] = { rules: [] }): Bot => ({ id: 'b1', name: 'x', charter: { role: 'r', sources: [] }, cwd: '/p', tier: 'balanced', policy, budget: {}, routines: [], outputs: [], createdAt: 0, updatedAt: 0 });

describe('makeGate', () => {
  let root: string; let store: BotStore; let inbox: Inbox; let audit: AuditLog;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-gate-')); store = new BotStore(root); inbox = new Inbox(store); audit = new AuditLog(store); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const ev = (toolName: string, input: Record<string, unknown>) => ({ requestId: 'q', sessionId: 's1', toolName, input });

  it('read runs and is audited', async () => {
    const g = makeGate({ bot: bot(), runId: 'run1', routineId: 'r1', store, audit, inbox });
    expect(await g.gate(ev('Read', { file_path: '/a' }))).toEqual({ behavior: 'allow', updatedInput: { file_path: '/a' } });
    expect(store.audit('b1', 'run1')).toMatchObject([{ cls: 'read', level: 'do', result: 'allowed', basis: 'rule' }]);
    expect(g.calls).toBe(1);
  });
  it('install runs and tells', async () => {
    const told: string[] = [];
    const g = makeGate({ bot: bot(), runId: 'run1', routineId: 'r1', store, audit, inbox, onTell: (t) => told.push(t) });
    expect((await g.gate(ev('Bash', { command: 'npm i -g foo' })))?.behavior).toBe('allow');
    expect(told).toEqual(['Bash: npm i -g foo']);
  });
  it('send is queued: denied with a message, an approval item in the inbox, audited as queued', async () => {
    const g = makeGate({ bot: bot(), runId: 'run1', routineId: 'r1', store, audit, inbox });
    const r = await g.gate(ev('Bash', { command: 'git push origin main' }));
    expect(r).toMatchObject({ behavior: 'deny' });
    expect((r as any).message).toContain('收件箱');
    const items = inbox.list('b1');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'approval', toolName: 'Bash', input: { command: 'git push origin main' }, cls: 'send', runId: 'run1', sessionId: 's1' });
    expect(store.audit('b1', 'run1')[0].result).toBe('queued');
  });
  it('approveOnce lets exactly that call through, once', async () => {
    const g = makeGate({ bot: bot(), runId: 'run1', routineId: 'r1', store, audit, inbox });
    g.approveOnce('Bash', { command: 'git push origin main' });
    expect((await g.gate(ev('Bash', { command: 'git push origin main' })))?.behavior).toBe('allow');
    expect(store.audit('b1', 'run1')[0].basis).toBe('user');
    expect((await g.gate(ev('Bash', { command: 'git push origin main' })))?.behavior).toBe('deny');
  });
  it('deny is denied with the class named', async () => {
    const g = makeGate({ bot: bot({ rules: [{ cls: 'pay', level: 'deny' }] }), runId: 'run1', routineId: 'r1', store, audit, inbox });
    const r = await g.gate(ev('Bash', { command: 'curl https://api.stripe.com/v1/charges -d amount=1' }));
    expect(r).toMatchObject({ behavior: 'deny' });
    expect(inbox.list('b1')).toEqual([]);
    expect(store.audit('b1', 'run1')[0]).toMatchObject({ result: 'denied', level: 'deny' });
  });
  it('unleashed: everything runs, basis unleashed', async () => {
    const g = makeGate({ bot: bot({ rules: [], unleashed: true }), runId: 'run1', routineId: 'r1', store, audit, inbox });
    expect((await g.gate(ev('Bash', { command: 'git push origin --delete x' })))?.behavior).toBe('allow');
    expect(store.audit('b1', 'run1')[0].basis).toBe('unleashed');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w server -- bots/policy/gate.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// server/src/bots/policy/gate.ts
import { createHash } from 'node:crypto';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { Bot, PermissionRequestEvent } from '../../protocol.js';
import type { ToolGate } from '../../agents/types.js';
import type { BotStore } from '../store.js';
import type { AuditLog } from '../audit.js';
import type { Inbox } from '../inbox.js';
import { classify, summarize, targetOf } from './classify.js';
import { decide } from './rules.js';
import { tr } from '../../i18n/index.js';

export interface GateCtx { bot: Bot; runId: string; routineId: string; store: BotStore; audit: AuditLog; inbox: Inbox; now?: () => number; onTell?: (text: string) => void }
export interface GateHandle { gate: ToolGate; approveOnce(toolName: string, input: Record<string, unknown>): void; calls: number }

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
export const callKey = (toolName: string, input: Record<string, unknown>) => createHash('sha1').update(toolName + '\n' + stable(input)).digest('hex');

/**
 * The policy gate of one run. "Ask" does not hang the tool call (the SDK would wait, and the whole turn with it):
 * it is refused with a note, queued in the inbox, and re-run after approval (pipeline.resumeApproved).
 */
export function makeGate(ctx: GateCtx): GateHandle {
  const approved = new Set<string>();
  const todayByClass = new Map<string, number>();
  const now = ctx.now ?? Date.now;
  const h: GateHandle = {
    calls: 0,
    approveOnce: (t, i) => { approved.add(callKey(t, i)); },
    gate: async (ev: PermissionRequestEvent): Promise<PermissionResult | null> => {
      h.calls++;
      const cls = classify(ev.toolName, ev.input);
      const summary = summarize(ev.toolName, ev.input);
      const target = targetOf(cls, ev.toolName, ev.input);
      const base = { runId: ctx.runId, botId: ctx.bot.id, toolName: ev.toolName, cls, summary };
      const key = callKey(ev.toolName, ev.input);
      if (approved.has(key)) {
        approved.delete(key);
        await ctx.audit.add({ ...base, level: 'ask', basis: 'user', result: 'allowed' });
        return { behavior: 'allow', updatedInput: ev.input };
      }
      const d = decide(ctx.bot.policy, cls, target, now(), todayByClass.get(cls) ?? 0);
      if (d.level === 'deny') {
        await ctx.audit.add({ ...base, level: 'deny', basis: d.basis, result: 'denied' });
        return { behavior: 'deny', message: tr('这个 Bot 的策略禁止这类动作：{cls}', { cls }) };
      }
      if (d.level === 'ask') {
        const item = await ctx.inbox.add({ kind: 'approval', botId: ctx.bot.id, runId: ctx.runId, routineId: ctx.routineId, sessionId: ev.sessionId, title: summary, toolName: ev.toolName, input: ev.input, cls });
        await ctx.audit.add({ ...base, level: 'ask', basis: d.basis, result: 'queued' });
        return { behavior: 'deny', message: tr('这个动作要先经你批准，已放进收件箱（{title}）。先做别的；批准后会从这里继续。', { title: item.title }) };
      }
      todayByClass.set(cls, (todayByClass.get(cls) ?? 0) + 1);
      await ctx.audit.add({ ...base, level: d.level, basis: d.basis, result: 'allowed' });
      if (d.level === 'do_tell') ctx.onTell?.(summary);
      return { behavior: 'allow', updatedInput: ev.input };
    },
  };
  return h;
}
```

- [ ] **Step 4: 跑测试**

Run: `npm test -w server -- bots/policy/gate.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/bots/policy/gate.ts server/src/bots/policy/gate.test.ts
git commit -m "feat(bots): the policy gate — do / do_tell run and are audited, ask is queued in the inbox without hanging the turn, deny names the class"
```

---

### Task 9: 预检 / 验收脚本执行 precheck.ts

**Files:**
- Create: `server/src/bots/precheck.ts`
- Test: `server/src/bots/precheck.test.ts`

**Interfaces:**
- Produces: `export async function runScript(script: string, o: { cwd: string; timeoutMs?: number; env?: Record<string, string> }): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null; timedOut: boolean }>` — Windows 用 `powershell -NoProfile -NonInteractive -Command <script>`，其它用 `sh -c <script>`；`windowsHide: true`；默认超时 60 s；stdout 截到 64 KB。`export function fingerprint(stdout: string): string`（trim 后 sha1）。

- [ ] **Step 1: 写失败的测试**

```ts
// server/src/bots/precheck.test.ts
import { describe, it, expect } from 'vitest';
import { runScript, fingerprint } from './precheck.js';

describe('runScript', () => {
  it('captures stdout and exit code', async () => {
    const r = await runScript(process.platform === 'win32' ? 'Write-Output hi' : 'echo hi', { cwd: process.cwd() });
    expect(r.ok).toBe(true); expect(r.stdout.trim()).toBe('hi'); expect(r.code).toBe(0);
  });
  it('a failing script is not ok', async () => {
    const r = await runScript(process.platform === 'win32' ? 'exit 3' : 'exit 3', { cwd: process.cwd() });
    expect(r.ok).toBe(false); expect(r.code).toBe(3);
  });
  it('times out', async () => {
    const r = await runScript(process.platform === 'win32' ? 'Start-Sleep 5' : 'sleep 5', { cwd: process.cwd(), timeoutMs: 300 });
    expect(r.ok).toBe(false); expect(r.timedOut).toBe(true);
  });
  it('fingerprint ignores surrounding whitespace', () => {
    expect(fingerprint(' a\n')).toBe(fingerprint('a'));
    expect(fingerprint('a')).not.toBe(fingerprint('b'));
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test -w server -- bots/precheck.test.ts` → FAIL

- [ ] **Step 3: 实现**

```ts
// server/src/bots/precheck.ts
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const MAX_OUT = 64 * 1024;

/** A pre-check or acceptance script: shell on Unix, PowerShell on Windows. Its stdout is what the caller compares. */
export function runScript(script: string, o: { cwd: string; timeoutMs?: number; env?: Record<string, string> }): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const child = spawn(win ? 'powershell' : 'sh', win ? ['-NoProfile', '-NonInteractive', '-Command', script] : ['-c', script], { cwd: o.cwd, env: { ...process.env, ...o.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = ''; let timedOut = false;
    child.stdout.on('data', (d) => { if (out.length < MAX_OUT) out += String(d); });
    child.stderr.on('data', (d) => { if (err.length < MAX_OUT) err += String(d); });
    const t = setTimeout(() => { timedOut = true; child.kill(); }, o.timeoutMs ?? 60_000);
    child.on('error', (e) => { clearTimeout(t); resolve({ ok: false, stdout: out, stderr: `${err}${e.message}`, code: null, timedOut }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ ok: !timedOut && code === 0, stdout: out, stderr: err, code, timedOut }); });
  });
}

export const fingerprint = (stdout: string) => createHash('sha1').update(stdout.trim()).digest('hex');
```

- [ ] **Step 4: 跑测试** — PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/bots/precheck.ts server/src/bots/precheck.test.ts
git commit -m "feat(bots): run a pre-check / acceptance script (sh or PowerShell, hidden, bounded) and fingerprint its output"
```

---

### Task 10: 流水线 pipeline.ts

**Files:**
- Create: `server/src/bots/pipeline.ts`
- Test: `server/src/bots/pipeline.test.ts`

**Interfaces:**
- Consumes: `BotStore`、`AuditLog`、`Inbox`、`makeGate`、`runScript / fingerprint`、`MemoryService.search`、`ledger.rowsFor`。
- Produces:

```ts
/** the slice of RunnerPool / services the pipeline needs — tests fake it */
export interface PipelineDeps {
  store: BotStore; audit: AuditLog; inbox: Inbox;
  open(params: OpenSessionParams): AgentDriver;
  memories(botId: string, q: string): string[];                // texts, ≤ 8
  costOf(sessionId: string): Promise<number>;                  // sum of ledger costUsd
  defaultProvider(): string | undefined;                       // settings 'bots.defaultProvider'
  now?: () => number;
}
export interface RunOutcome { run: BotRun }
export async function runRoutine(d: PipelineDeps, bot: Bot, routine: Routine, trigger: RunTrigger, o?: { resume?: { sessionId: string; approved: { toolName: string; input: Record<string, unknown> } } }): Promise<RunOutcome>;
export function buildPrompt(bot: Bot, routine: Routine, state: RoutineState, memories: string[], checkpointFile: string): string;   // pure
export const RUN_TIMEOUT_MIN = 30;
```

流水线（spec §3）：
1. `runId = <routineId>-<base36 now>`；`run: BotRun = { id, botId, routineId, at, trigger }`；先 `store.addRun(run)`（界面马上看到「在跑」）。
2. **预检**（`trigger !== 'resume'` 且 `routine.precheck`）：`runScript(precheck, { cwd: bot.cwd })`；`ok` 且 `fingerprint(stdout) === state.fingerprint` → `run.skipped = true; run.ok = true; run.endedAt` → `addRun` 返回；否则 `setState({ fingerprint })`。预检脚本自己失败不阻止运行（记到 `run.error` 前缀 `precheck:`，继续）。
3. **开对话**：`resume` 时 `open({ sessionId: resume.sessionId, cwd, permissionMode: 'acceptEdits', providerId, model, drivenBy: 'schedule' })`，否则 `open({ sessionId: undefined, … })`；等 `state !== 'starting'`（最多 60×500 ms）。`providerId = bot.providerId || defaultProvider()`；`model = bot.model`。
4. **闸**：`const g = makeGate({ bot, runId, routineId, store, audit, inbox, onTell: (t) => void inbox.add({ kind: 'finding', botId, runId, title: tr('做了：{t}', { t }) }) })`；`runner.gate = g.gate`；resume 时 `g.approveOnce(approved.toolName, approved.input)`。
5. **发指令**：新对话 `runner.send(buildPrompt(...))`；resume 发 `tr('你之前要做的「{summary}」已经批准，现在执行它，然后接着完成例行任务。', { summary })`。
6. **等结果**：监听 `runner.on('message')`，`m.type === 'result'` → 结束；超时 `routine.timeoutMin ?? RUN_TIMEOUT_MIN` 分钟 → `runner.interrupt()`、`run.error = tr('超时')`。`run.said = result 文本前 2000 字`。
7. **验收**：`routine.acceptance.kind === 'script'` → `runScript(script, { cwd })` → `run.verified = { ok, note: stdout 前 300 }`；`'none'` → `verified = undefined`。`run.ok = !is_error && (verified?.ok ?? true)`。
8. **收尾**：`run.costUsd = await costOf(sessionId)`；`run.toolCalls = g.calls`；`run.endedAt`、`durationMs`；`setState({ lastSummary: said 前 500, checkpoint: 读 <dir>/state/<routineId>.checkpoint.md 若存在 })`；`addRun(run)`；投递：`outputs` 里 `inbox` → `inbox.add({ kind: run.ok ? 'finding' : 'finding', title: routine.name, body: said })`（草稿：said 里出现 `<draft>…</draft>` 段时每段一条 `draft`）；`file` → 追加到 path；`im` 由 service 处理（pipeline 发 `'delivered'` 事件？不——pipeline 返回 run，service 负责 IM，见 Task 13）。
9. 失败处理（`!run.ok` 且非 skipped）：`routine.failures = (failures ?? 0) + 1`；`>= 3` → `routine.enabled = false`、`inbox.add({ kind: 'finding', title: tr('例行「{name}」连续失败 3 次，已停用', …) })`；`onFail === 'inbox'` → 一条 finding 带 error；`'retry_up'` / `'resume'` 的重跑由 scheduler 决定（Task 11），pipeline 只记。成功时 `failures = 0`。routine 的改动通过 `store.save({ ...bot, routines })` 写回。
10. 返回 `{ run }`。

`buildPrompt` 输出（中文，章程 → 例行指令 → 上次结论 → 检查点 → 记忆 → 规则）：

```
你是「{bot.name}」。{charter.role}
服务对象：{audience}
只用这些来源：{sources}
报告格式：{report}
完成条件：{done}

## 这次要做的（例行「{routine.name}」）
{routine.prompt}

## 上次的结论
{state.lastSummary | 无}

## 检查点（上次没做完的从这里接着）
{state.checkpoint | 无}

## 你记住的
- …

## 规则
- 长任务每完成一步就把进度写进 {checkpointFile}（覆盖写），做完后删掉它。
- 要发出去的内容不要直接发，写在 <draft>…</draft> 里，由我来发。
- 查不到的标「待核实」，不要猜。
- 结尾固定写：查了什么 / 没能查到什么 / 建议的下一步。
- 要记住的事用 memory.write，scope 填 bot、key 填 {bot.id}。
```

- [ ] **Step 1: 写失败的测试**

```ts
// server/src/bots/pipeline.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { EventEmitter } from 'node:events';
import { BotStore } from './store.js'; import { AuditLog } from './audit.js'; import { Inbox } from './inbox.js';
import { runRoutine, buildPrompt, type PipelineDeps } from './pipeline.js';
import type { Bot, Routine } from '../protocol.js';

/** a runner that answers the first send with a result, after running `calls` through its gate */
function fakeRunner(o: { resultText?: string; isError?: boolean; calls?: { toolName: string; input: Record<string, unknown> }[] } = {}) {
  const r: any = new EventEmitter();
  r.sessionId = `s_${Math.random().toString(36).slice(2, 8)}`; r.state = 'idle'; r.sent = [] as string[];
  r.send = (text: string) => {
    r.sent.push(text); r.state = 'running';
    setTimeout(async () => {
      for (const c of o.calls ?? []) await r.gate?.({ requestId: 'q', sessionId: r.sessionId, toolName: c.toolName, input: c.input });
      r.state = 'idle';
      r.emit('message', { type: 'result', is_error: !!o.isError, result: o.resultText ?? 'done' });
    }, 0);
  };
  r.interrupt = async () => {}; r.close = async () => {};
  return r;
}

const routine = (p: Partial<Routine> = {}): Routine => ({ id: 'r1', name: '晨报', prompt: '汇总 issue', enabled: true, acceptance: { kind: 'none' }, onFail: 'inbox', ...p });
const bot = (routines: Routine[]): Bot => ({ id: 'b1', name: '小晨', charter: { role: '每天出晨报', sources: ['github'] }, cwd: process.cwd(), tier: 'balanced', policy: { rules: [] }, budget: {}, routines, outputs: [{ kind: 'inbox' }], createdAt: 0, updatedAt: 0 });

describe('runRoutine', () => {
  let root: string; let store: BotStore; let inbox: Inbox; let audit: AuditLog; let opened: any[];
  const deps = (runner: any, extra: Partial<PipelineDeps> = {}): PipelineDeps => ({ store, audit, inbox, open: (p) => { opened.push(p); return runner; }, memories: () => ['只看 claude-web 仓库'], costOf: async () => 0.0123, defaultProvider: () => 'relay-1', ...extra });
  beforeEach(async () => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-pipe-')); store = new BotStore(root); inbox = new Inbox(store); audit = new AuditLog(store); opened = []; });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a plain run: new conversation, prompt built, result recorded with cost, a finding delivered', async () => {
    const b = bot([routine()]); await store.save(b);
    const { run } = await runRoutine(deps(fakeRunner({ resultText: '今天 3 个 issue' })), b, b.routines[0], 'cron');
    expect(opened[0]).toMatchObject({ cwd: process.cwd(), providerId: 'relay-1', drivenBy: 'schedule' });
    expect(opened[0].sessionId).toBeUndefined();
    expect(run).toMatchObject({ ok: true, skipped: undefined, costUsd: 0.0123, said: '今天 3 个 issue', trigger: 'cron' });
    expect(store.runs('b1')[0].id).toBe(run.id);
    expect(inbox.list('b1')[0]).toMatchObject({ kind: 'finding', title: '晨报', body: '今天 3 个 issue' });
    expect(store.stateOf('b1', 'r1').lastSummary).toBe('今天 3 个 issue');
  });

  it('precheck: same fingerprint skips without opening a conversation', async () => {
    const echo = process.platform === 'win32' ? 'Write-Output same' : 'echo same';
    const b = bot([routine({ precheck: echo })]); await store.save(b);
    const first = await runRoutine(deps(fakeRunner()), b, b.routines[0], 'cron');
    expect(first.run.skipped).toBeUndefined(); expect(opened).toHaveLength(1);
    const second = await runRoutine(deps(fakeRunner()), b, b.routines[0], 'cron');
    expect(second.run.skipped).toBe(true); expect(opened).toHaveLength(1);
  });

  it('an ask inside the run is queued, the run still ends ok, and resume approves exactly that call', async () => {
    const b = bot([routine()]); await store.save(b);
    const push = { toolName: 'Bash', input: { command: 'git push origin main' } };
    const first = await runRoutine(deps(fakeRunner({ calls: [push] })), b, b.routines[0], 'cron');
    const item = inbox.list('b1').find((i) => i.kind === 'approval')!;
    expect(item).toMatchObject({ toolName: 'Bash', runId: first.run.id, sessionId: first.run.sessionId });
    const r2 = fakeRunner({ calls: [push] });
    const second = await runRoutine(deps(r2), b, b.routines[0], 'resume', { resume: { sessionId: item.sessionId!, approved: { toolName: item.toolName!, input: item.input! } } });
    expect(opened[1].sessionId).toBe(item.sessionId);
    expect(r2.sent[0]).toContain('已经批准');
    expect(store.audit('b1', second.run.id).map((a) => a.result)).toEqual(['allowed']);
  });

  it('acceptance script decides ok; three failures disable the routine and say so', async () => {
    const fail = process.platform === 'win32' ? 'exit 1' : 'exit 1';
    const b = bot([routine({ acceptance: { kind: 'script', script: fail } })]); await store.save(b);
    for (let i = 0; i < 3; i++) await runRoutine(deps(fakeRunner()), store.get('b1')!, store.get('b1')!.routines[0], 'cron');
    const runs = store.runs('b1');
    expect(runs.every((r) => r.ok === false && r.verified?.ok === false)).toBe(true);
    expect(store.get('b1')!.routines[0]).toMatchObject({ enabled: false, failures: 3 });
    expect(inbox.list('b1').some((i) => i.title.includes('停用'))).toBe(true);
  });

  it('drafts in the answer become draft items', async () => {
    const b = bot([routine()]); await store.save(b);
    await runRoutine(deps(fakeRunner({ resultText: '写好了 <draft>嗨，这是回复</draft> 请过目' })), b, b.routines[0], 'manual');
    expect(inbox.list('b1').map((i) => i.kind).sort()).toEqual(['draft', 'finding']);
    expect(inbox.list('b1').find((i) => i.kind === 'draft')!.body).toBe('嗨，这是回复');
  });

  it('buildPrompt carries charter, routine, state, memories and the rules', () => {
    const p = buildPrompt(bot([routine()]), routine(), { lastSummary: '上次 2 个', checkpoint: '做到第 3 步', updatedAt: 0 }, ['只看 claude-web'], '/x/cp.md');
    for (const s of ['小晨', '每天出晨报', 'github', '汇总 issue', '上次 2 个', '做到第 3 步', '只看 claude-web', '/x/cp.md', '<draft>', 'memory.write', 'b1']) expect(p).toContain(s);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test -w server -- bots/pipeline.test.ts` → FAIL

- [ ] **Step 3: 实现**

```ts
// server/src/bots/pipeline.ts
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AgentDriver } from '../agents/types.js';
import type { Bot, BotRun, OpenSessionParams, Routine, RunTrigger } from '../protocol.js';
import type { BotStore } from './store.js';
import type { AuditLog } from './audit.js';
import type { Inbox } from './inbox.js';
import type { RoutineState } from './types.js';
import { makeGate } from './policy/gate.js';
import { fingerprint, runScript } from './precheck.js';
import { summarize } from './policy/classify.js';
import { tr } from '../i18n/index.js';

export interface PipelineDeps {
  store: BotStore; audit: AuditLog; inbox: Inbox;
  open(params: OpenSessionParams): AgentDriver;
  memories(botId: string, q: string): string[];
  costOf(sessionId: string): Promise<number>;
  defaultProvider(): string | undefined;
  now?: () => number;
}
export interface RunOutcome { run: BotRun }
export const RUN_TIMEOUT_MIN = 30;
export const MAX_FAILURES = 3;

export function buildPrompt(bot: Bot, routine: Routine, state: RoutineState, memories: string[], checkpointFile: string): string {
  const c = bot.charter;
  return [
    `你是「${bot.name}」。${c.role}`,
    c.audience ? `服务对象：${c.audience}` : '',
    c.sources.length ? `只用这些来源：${c.sources.join('、')}` : '',
    c.report ? `报告格式：${c.report}` : '',
    c.done ? `完成条件：${c.done}` : '',
    '', `## 这次要做的（例行「${routine.name}」）`, routine.prompt,
    '', '## 上次的结论', state.lastSummary || '无',
    '', '## 检查点（上次没做完的从这里接着）', state.checkpoint || '无',
    '', '## 你记住的', ...(memories.length ? memories.map((m) => `- ${m}`) : ['- 无']),
    '', '## 规则',
    `- 长任务每完成一步就把进度写进 ${checkpointFile}（覆盖写），做完后删掉它。`,
    '- 要发出去的内容不要直接发，写在 <draft>…</draft> 里，由我来发。',
    '- 查不到的标「待核实」，不要猜。',
    '- 结尾固定写：查了什么 / 没能查到什么 / 建议的下一步。',
    `- 要记住的事用 memory.write，scope 填 bot、key 填 ${bot.id}。`,
  ].filter((l) => l !== '').join('\n');
}

const waitStarted = async (r: AgentDriver) => { for (let i = 0; i < 60 && r.state === 'starting'; i++) await new Promise((res) => setTimeout(res, 500)); };

function waitResult(r: AgentDriver, timeoutMs: number): Promise<{ isError: boolean; text: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { off(); void r.interrupt().catch(() => {}); resolve({ isError: true, text: '', timedOut: true }); }, timeoutMs);
    const onMsg = (m: any) => { if (m?.type === 'result') { clearTimeout(t); off(); resolve({ isError: !!m.is_error, text: typeof m.result === 'string' ? m.result : '', timedOut: false }); } };
    const off = () => r.off('message', onMsg);
    r.on('message', onMsg);
  });
}

const drafts = (text: string) => [...text.matchAll(/<draft>([\s\S]*?)<\/draft>/g)].map((m) => m[1].trim()).filter(Boolean);

/** One run of a routine (spec §3): pre-check → new conversation (or the one being resumed) → gate → acceptance → record → deliver. */
export async function runRoutine(d: PipelineDeps, bot: Bot, routine: Routine, trigger: RunTrigger, o: { resume?: { sessionId: string; approved: { toolName: string; input: Record<string, unknown> } } } = {}): Promise<RunOutcome> {
  const now = d.now ?? Date.now;
  const started = now();
  const run: BotRun = { id: `${routine.id}-${started.toString(36)}`, botId: bot.id, routineId: routine.id, at: started, trigger };
  await d.store.addRun(run);
  const finish = async () => { run.endedAt = now(); run.durationMs = run.endedAt - started; await d.store.addRun(run); return { run }; };

  if (trigger !== 'resume' && routine.precheck) {
    const pc = await runScript(routine.precheck, { cwd: bot.cwd });
    if (pc.ok) {
      const fp = fingerprint(pc.stdout);
      if (fp === d.store.stateOf(bot.id, routine.id).fingerprint) { run.skipped = true; run.ok = true; return finish(); }
      await d.store.setState(bot.id, routine.id, { fingerprint: fp });
    } else run.error = `precheck: ${(pc.stderr || pc.stdout).trim().slice(0, 200)}`;
  }

  const checkpointFile = path.join(d.store.dir(bot.id), 'state', `${routine.id}.checkpoint.md`);
  await fsp.mkdir(path.dirname(checkpointFile), { recursive: true });
  const runner = d.open({ sessionId: o.resume?.sessionId, cwd: bot.cwd, permissionMode: 'acceptEdits', providerId: bot.providerId || d.defaultProvider(), model: bot.model, drivenBy: 'schedule' });
  run.sessionId = runner.sessionId;
  await d.store.addRun(run);
  await waitStarted(runner);
  const g = makeGate({ bot, runId: run.id, routineId: routine.id, store: d.store, audit: d.audit, inbox: d.inbox, now, onTell: (t) => void d.inbox.add({ kind: 'finding', botId: bot.id, runId: run.id, routineId: routine.id, title: tr('做了：{t}', { t }) }) });
  runner.gate = g.gate;
  if (o.resume) {
    g.approveOnce(o.resume.approved.toolName, o.resume.approved.input);
    runner.send(tr('你之前要做的「{summary}」已经批准，现在执行它，然后接着完成例行任务。', { summary: summarize(o.resume.approved.toolName, o.resume.approved.input) }));
  } else {
    runner.send(buildPrompt(bot, routine, d.store.stateOf(bot.id, routine.id), d.memories(bot.id, routine.name).slice(0, 8), checkpointFile));
  }
  const res = await waitResult(runner, (routine.timeoutMin ?? RUN_TIMEOUT_MIN) * 60_000);
  run.sessionId = runner.sessionId;
  run.said = res.text.slice(0, 2000);
  if (res.timedOut) run.error = tr('超时');
  if (routine.acceptance.kind === 'script') {
    const a = await runScript(routine.acceptance.script, { cwd: bot.cwd });
    run.verified = { ok: a.ok, note: (a.stdout || a.stderr).trim().slice(0, 300) };
  }
  run.ok = !res.isError && (run.verified?.ok ?? true);
  run.toolCalls = g.calls;
  run.costUsd = await d.costOf(runner.sessionId).catch(() => 0);
  const checkpoint = fs.existsSync(checkpointFile) ? fs.readFileSync(checkpointFile, 'utf8').slice(0, 4000) : undefined;
  await d.store.setState(bot.id, routine.id, { lastSummary: run.said.slice(0, 500), checkpoint });

  const fresh = d.store.get(bot.id) ?? bot;
  const idx = fresh.routines.findIndex((r) => r.id === routine.id);
  if (idx >= 0) {
    const r = { ...fresh.routines[idx] };
    r.lastRunAt = started;
    r.failures = run.ok ? 0 : (r.failures ?? 0) + 1;
    if (!run.ok && r.failures >= MAX_FAILURES) { r.enabled = false; await d.inbox.add({ kind: 'finding', botId: bot.id, runId: run.id, routineId: routine.id, title: tr('例行「{name}」连续失败 {n} 次，已停用', { name: r.name, n: MAX_FAILURES }), body: run.error ?? run.verified?.note }); }
    else if (!run.ok && r.onFail === 'inbox') await d.inbox.add({ kind: 'finding', botId: bot.id, runId: run.id, routineId: routine.id, title: tr('例行「{name}」没通过验收', { name: r.name }), body: run.error ?? run.verified?.note });
    const routines = [...fresh.routines]; routines[idx] = r;
    await d.store.save({ ...fresh, routines });
  }

  for (const out of bot.outputs) {
    if (out.kind === 'inbox') {
      await d.inbox.add({ kind: 'finding', botId: bot.id, runId: run.id, routineId: routine.id, sessionId: runner.sessionId, title: routine.name, body: run.said });
      for (const t of drafts(run.said)) await d.inbox.add({ kind: 'draft', botId: bot.id, runId: run.id, routineId: routine.id, sessionId: runner.sessionId, title: tr('{name} 的草稿', { name: routine.name }), body: t });
    } else if (out.kind === 'file') {
      await fsp.mkdir(path.dirname(out.path), { recursive: true });
      await fsp.appendFile(out.path, `\n\n## ${new Date(started).toISOString()} ${routine.name}\n\n${run.said}\n`, 'utf8');
    }
  }
  return finish();
}
```

- [ ] **Step 4: 跑测试** — `npm test -w server -- bots/pipeline.test.ts` → PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/bots/pipeline.ts server/src/bots/pipeline.test.ts
git commit -m "feat(bots): one run of a routine — pre-check fingerprint, fresh conversation with charter / state / memories, policy gate, acceptance script, cost, drafts and findings into the inbox, resume after approval"
```

---

### Task 11: 调度器 scheduler.ts（tick、队列、并发、预算、信任提议）

**Files:**
- Create: `server/src/bots/scheduler.ts`
- Test: `server/src/bots/scheduler.test.ts`

**Interfaces:**
- Consumes: `runRoutine`、`nextCron`（`schedules/cron.ts`）、`missedRun`（`schedules/catch-up.ts`）、`recordApproval / recordCorrection / demoteRule / scopeFromKey`、`scopeKey`、`targetOf`。
- Produces:

```ts
export interface SchedulerDeps extends PipelineDeps { concurrency(): number; globalBudgetUsd(): number | undefined; interrupt(sessionId: string): Promise<void> }
export class BotScheduler extends EventEmitter {   // 'run' (BotRun), 'bots' (void: something about a bot changed), 'load' (BotLoad)
  constructor(private d: SchedulerDeps)
  start(): void; stop(): void;                       // 30 s tick, unref
  async tick(now?: number): Promise<void>;           // due routines → queue → run up to concurrency
  enqueue(botId: string, routineId: string, trigger: RunTrigger, resume?: ResumeInfo): void;
  load(): BotLoad;
  todayUsd(botId: string, now?: number): number; weekUsd(botId: string, now?: number): number;   // from store.runs
  async stopBot(botId: string): Promise<void>; async stopAll(): Promise<void>;   // interrupt running sessions, drop queue
  nextRunAt(r: Routine, from: number): number | undefined;
  async onInboxAnswer(item: InboxItem, a: InboxAnswer): Promise<void>;   // approve → enqueue resume; approve_scope → add rule; reject → correction
}
```

规则：
- 到期判断：`routine.enabled && !bot.paused && (nextRunAt ?? 0) <= now`；没 `nextRunAt` 的先算一个不跑。`missedRun(nextRunAt, now) === 'drop'` → 只推 `nextRunAt`。
- 预算：`todayUsd(bot) >= budget.dailyUsd` 或 `weekUsd >= weeklyUsd` 或全局 `sum(todayUsd) >= globalBudgetUsd` → 不入队，`emit('bots')`，一天内只在收件箱记一次 `finding`「预算用完，已暂停」。
- 队列 FIFO；`running.size < concurrency()` 才出队；同一 routine 不重复入队（在跑或在排队都跳过，手动触发除外——手动时提示「正在跑」通过 throw）。
- 跑完：`run.ok === false && routine.onFail === 'retry_up'` → 以 `model: undefined, tier 升一档` 立刻重入队一次（标记 `retried` 防循环，一期升档只是把 `bot.tier` 临时提到 `best` 传给 pipeline；具体模型映射在 Task 13 的 `tierModel()`）。`onFail === 'resume'` → 重入队一次 `trigger: 'resume'`（无 approved，走 checkpoint）。
- `onInboxAnswer`：
  - `approve`：`recordApproval(trust, cls, scopeKey(undefined, targetOf(cls, toolName, input)))` → `propose` 为真则 `inbox.add({ kind: 'proposal', proposal: { type: 'trust_up', cls, scope: scopeFromKey(key) }, title: tr('「{cls}」到「{key}」已连续批准 {n} 次，以后直接做？') })`；然后 `enqueue(botId, routineId, 'resume', { sessionId, approved })`。
  - `approve_scope`：在 `bot.policy.rules` 里加 `{ cls, level: 'do', scope: a.scope }` 并 save；然后同 approve 的 resume。
  - `reject`：`recordCorrection` + `demoteRule` + save。
  - `adopt`（proposal）：`trust_up` → 加规则；`routine` → 推进 `bot.routines`（`selfMade: true`，不超过 `maxRoutines ?? 20`）。
  - `send`（draft）：一期把草稿作为「已批准发送」——`inbox.add({ kind: 'finding', title: tr('已标记为可发送：{title}') })`（真正的外发在二期的撤回体系里做；界面上「发」按钮会说明「复制内容自己发」）。
  - `archive`：无动作。

- [ ] **Step 1: 写失败的测试**

```ts
// server/src/bots/scheduler.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { EventEmitter } from 'node:events';
import { BotStore } from './store.js'; import { AuditLog } from './audit.js'; import { Inbox } from './inbox.js';
import { BotScheduler, type SchedulerDeps } from './scheduler.js';
import type { Bot, Routine } from '../protocol.js';

function fakeRunner(delayMs = 0, calls: { toolName: string; input: Record<string, unknown> }[] = []) {
  const r: any = new EventEmitter(); r.sessionId = `s_${Math.random().toString(36).slice(2, 8)}`; r.state = 'idle'; r.sent = [];
  r.send = (t: string) => { r.sent.push(t); setTimeout(async () => { for (const c of calls) await r.gate?.({ requestId: 'q', sessionId: r.sessionId, toolName: c.toolName, input: c.input }); r.emit('message', { type: 'result', is_error: false, result: 'ok' }); }, delayMs); };
  r.interrupt = vi.fn(async () => {}); r.close = async () => {};
  return r;
}
const routine = (p: Partial<Routine> = {}): Routine => ({ id: 'r1', name: '晨报', prompt: 'x', enabled: true, everyMinutes: 60, acceptance: { kind: 'none' }, onFail: 'inbox', ...p });
const bot = (id: string, routines: Routine[], p: Partial<Bot> = {}): Bot => ({ id, name: id, charter: { role: 'r', sources: [] }, cwd: process.cwd(), tier: 'balanced', policy: { rules: [] }, budget: {}, routines, outputs: [], createdAt: 0, updatedAt: 0, ...p });

describe('BotScheduler', () => {
  let root: string; let store: BotStore; let inbox: Inbox; let audit: AuditLog; let runners: any[]; let conc: number;
  const deps = (mk: () => any = () => fakeRunner()): SchedulerDeps => ({ store, audit, inbox, open: () => { const r = mk(); runners.push(r); return r; }, memories: () => [], costOf: async () => 1, defaultProvider: () => undefined, concurrency: () => conc, globalBudgetUsd: () => undefined, interrupt: async (sid) => { runners.find((r) => r.sessionId === sid)?.interrupt(); } });
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sched-')); store = new BotStore(root); inbox = new Inbox(store); audit = new AuditLog(store); runners = []; conc = 2; });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const settle = () => new Promise((r) => setTimeout(r, 30));

  it('a due routine runs once per tick and gets a next time; a paused bot does not', async () => {
    await store.save(bot('a', [routine({ nextRunAt: 10 })]));
    await store.save(bot('b', [routine({ nextRunAt: 10 })], { paused: true }));
    const s = new BotScheduler(deps());
    await s.tick(20); await settle();
    expect(runners).toHaveLength(1);
    expect(store.get('a')!.routines[0].nextRunAt).toBeGreaterThan(20);
    await s.tick(21); await settle();
    expect(runners).toHaveLength(1);
  });

  it('the queue honours the concurrency cap and the load bar counts it', async () => {
    conc = 1;
    await store.save(bot('a', [routine({ id: 'r1', nextRunAt: 1 }), routine({ id: 'r2', nextRunAt: 1 })]));
    const s = new BotScheduler(deps(() => fakeRunner(50)));
    await s.tick(5);
    expect(s.load()).toMatchObject({ running: 1, queued: 1, concurrency: 1 });
    await new Promise((r) => setTimeout(r, 150));
    expect(runners).toHaveLength(2);
    expect(s.load()).toMatchObject({ running: 0, queued: 0 });
  });

  it('a bot over its daily budget is not started and is told once', async () => {
    await store.save(bot('a', [routine({ nextRunAt: 1 })], { budget: { dailyUsd: 0.5 } }));
    await store.addRun({ id: 'old', botId: 'a', routineId: 'r1', at: Date.now() - 1000, trigger: 'cron', costUsd: 0.6, ok: true });
    const s = new BotScheduler(deps());
    await s.tick(Date.now()); await s.tick(Date.now() + 1); await settle();
    expect(runners).toHaveLength(0);
    expect(inbox.list('a').filter((i) => i.title.includes('预算'))).toHaveLength(1);
  });

  it('stopAll interrupts running sessions and empties the queue', async () => {
    conc = 1;
    await store.save(bot('a', [routine({ id: 'r1', nextRunAt: 1 }), routine({ id: 'r2', nextRunAt: 1 })]));
    const s = new BotScheduler(deps(() => fakeRunner(10_000)));
    await s.tick(5);
    await s.stopAll();
    expect(runners[0].interrupt).toHaveBeenCalled();
    expect(s.load().queued).toBe(0);
  });

  it('approve resumes the run with that call allowed; the third approval proposes an upgrade; reject demotes', async () => {
    await store.save(bot('a', [routine({ nextRunAt: 1 })], { policy: { rules: [{ cls: 'send', level: 'do', scope: { channels: ['C1'] } }] } }));
    const push = { toolName: 'ExecuteExtraTool', input: { tool_name: 'mcp__slack__send_message', params: { channel: 'C9', text: 'hi' } } };
    // every run asks twice: after an approval the resumed run gets the first call through (approveOnce) and queues the second again
    const s = new BotScheduler(deps(() => fakeRunner(0, [push, push])));
    await s.tick(5); await settle();
    const item = () => inbox.list('a').find((i) => i.kind === 'approval' && !i.done)!;
    for (let i = 0; i < 3; i++) { const it = item(); await inbox.answer({ id: it.id, answer: 'approve' }); await s.onInboxAnswer(it, { id: it.id, answer: 'approve' }); await settle(); }
    expect(runners.length).toBeGreaterThanOrEqual(4);
    expect(runners[1].sent[0]).toContain('已经批准');
    expect(inbox.list('a').find((i) => i.kind === 'proposal')?.proposal).toEqual({ type: 'trust_up', cls: 'send', scope: { channels: ['C9'] } });
    const it = item(); await inbox.answer({ id: it.id, answer: 'reject' }); await s.onInboxAnswer(it, { id: it.id, answer: 'reject' });
    expect(store.trust('a')['send|channel:C9']).toBeUndefined();
    expect(store.get('a')!.policy.rules).toEqual([{ cls: 'send', level: 'do', scope: { channels: ['C1'] } }]);
  });

  it('approve_scope adds a scoped do-rule, adopt a routine proposal adds a self-made routine', async () => {
    await store.save(bot('a', [routine()]));
    const s = new BotScheduler(deps());
    const ap = await inbox.add({ kind: 'approval', botId: 'a', routineId: 'r1', sessionId: 'sX', title: 't', toolName: 'Bash', input: { command: 'git push' }, cls: 'send' });
    await s.onInboxAnswer(ap, { id: ap.id, answer: 'approve_scope', scope: { domains: ['github.com'] } });
    expect(store.get('a')!.policy.rules).toEqual([{ cls: 'send', level: 'do', scope: { domains: ['github.com'] } }]);
    const pr = await inbox.add({ kind: 'proposal', botId: 'a', title: 'p', proposal: { type: 'routine', routine: routine({ id: 'r9', name: '周报' }) } });
    await s.onInboxAnswer(pr, { id: pr.id, answer: 'adopt' });
    expect(store.get('a')!.routines.map((r) => [r.id, r.selfMade])).toEqual([['r1', undefined], ['r9', true]]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test -w server -- bots/scheduler.test.ts` → FAIL

- [ ] **Step 3: 实现**

```ts
// server/src/bots/scheduler.ts
import { EventEmitter } from 'node:events';
import type { Bot, BotLoad, BotRun, InboxAnswer, InboxItem, Routine, RunTrigger } from '../protocol.js';
import { nextCron } from '../schedules/cron.js';
import { missedRun } from '../schedules/catch-up.js';
import { runRoutine, type PipelineDeps } from './pipeline.js';
import { recordApproval, recordCorrection, demoteRule, scopeFromKey, TRUST_THRESHOLD } from './policy/trust.js';
import { scopeKey } from './policy/rules.js';
import { targetOf } from './policy/classify.js';
import { tr } from '../i18n/index.js';

export interface SchedulerDeps extends PipelineDeps { concurrency(): number; globalBudgetUsd(): number | undefined; interrupt(sessionId: string): Promise<void> }
export interface ResumeInfo { sessionId: string; approved: { toolName: string; input: Record<string, unknown> } }
interface Job { botId: string; routineId: string; trigger: RunTrigger; resume?: ResumeInfo; retried?: boolean }

const DAY = 24 * 3600_000;

export class BotScheduler extends EventEmitter {
  private timer?: NodeJS.Timeout;
  private queue: Job[] = [];
  private running = new Map<string, { job: Job; sessionId?: string }>();   // key = botId|routineId
  private budgetTold = new Map<string, number>();
  constructor(private d: SchedulerDeps) { super(); }

  start() { if (this.timer) return; this.timer = setInterval(() => void this.tick().catch(() => {}), 30_000); this.timer.unref(); void this.tick().catch(() => {}); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  nextRunAt(r: Routine, from: number): number | undefined {
    try { if (r.cron) return nextCron(r.cron, new Date(from)).getTime(); } catch { return undefined; }
    if (r.everyMinutes) return from + Math.max(1, r.everyMinutes) * 60_000;
    return undefined;
  }

  private costSince(botId: string, since: number) { return this.d.store.runs(botId, 2000).filter((r) => r.at >= since).reduce((a, r) => a + (r.costUsd ?? 0), 0); }
  todayUsd(botId: string, now = Date.now()) { const d = new Date(now); d.setHours(0, 0, 0, 0); return this.costSince(botId, d.getTime()); }
  weekUsd(botId: string, now = Date.now()) { return this.costSince(botId, now - 7 * DAY); }

  load(): BotLoad {
    const bots = this.d.store.list();
    const today = bots.reduce((a, b) => a + this.todayUsd(b.id), 0);
    const week = bots.reduce((a, b) => a + this.weekUsd(b.id), 0);
    return { running: this.running.size, queued: this.queue.length, todayUsd: today, weekEstimateUsd: week, concurrency: this.d.concurrency() };
  }

  private overBudget(bot: Bot, now: number): boolean {
    const b = bot.budget;
    if (b.dailyUsd !== undefined && this.todayUsd(bot.id, now) >= b.dailyUsd) return true;
    if (b.weeklyUsd !== undefined && this.weekUsd(bot.id, now) >= b.weeklyUsd) return true;
    const g = this.d.globalBudgetUsd();
    if (g !== undefined && this.d.store.list().reduce((a, x) => a + this.todayUsd(x.id, now), 0) >= g) return true;
    return false;
  }

  async tick(now = Date.now()) {
    for (const bot of this.d.store.list()) {
      let changed = false; const routines = bot.routines.map((r) => ({ ...r }));
      for (const r of routines) {
        if (!r.enabled || bot.paused) continue;
        if (r.nextRunAt === undefined) { r.nextRunAt = this.nextRunAt(r, now); changed = true; continue; }
        if (r.nextRunAt > now) continue;
        const missed = missedRun(r.nextRunAt, now);
        r.nextRunAt = this.nextRunAt(r, now); changed = true;
        if (missed === 'drop') continue;
        if (this.overBudget(bot, now)) {
          const told = this.budgetTold.get(bot.id) ?? 0;
          if (now - told > DAY) { this.budgetTold.set(bot.id, now); await this.d.inbox.add({ kind: 'finding', botId: bot.id, title: tr('「{name}」的预算用完了，今天不再运行', { name: bot.name }) }); }
          continue;
        }
        this.enqueue(bot.id, r.id, 'cron');
      }
      if (changed) await this.d.store.save({ ...bot, routines });
    }
    this.emit('bots');
    this.pump();
  }

  enqueue(botId: string, routineId: string, trigger: RunTrigger, resume?: ResumeInfo, retried = false) {
    const key = `${botId}|${routineId}`;
    const busy = this.running.has(key) || this.queue.some((j) => j.botId === botId && j.routineId === routineId);
    if (busy && trigger !== 'resume') { if (trigger === 'manual') throw new Error(tr('这条例行正在运行')); return; }
    this.queue.push({ botId, routineId, trigger, resume, retried });
    this.emit('load', this.load());
    this.pump();
  }

  private pump() {
    while (this.running.size < this.d.concurrency() && this.queue.length) {
      const job = this.queue.shift()!;
      const key = `${job.botId}|${job.routineId}`;
      const slot = { job, sessionId: undefined as string | undefined };
      this.running.set(key, slot);
      void this.exec(job, slot).finally(() => { this.running.delete(key); this.emit('load', this.load()); this.pump(); });
    }
    this.emit('load', this.load());
  }

  private async exec(job: Job, slot: { sessionId?: string }) {
    const bot = this.d.store.get(job.botId); const routine = bot?.routines.find((r) => r.id === job.routineId);
    if (!bot || !routine) return;
    const deps: PipelineDeps = { ...this.d, open: (p) => { const r = this.d.open(p); slot.sessionId = r.sessionId; return r; } };
    const effective = job.retried ? { ...bot, tier: 'best' as const, model: undefined } : bot;
    const { run } = await runRoutine(deps, effective, routine, job.trigger, job.resume ? { resume: job.resume } : {});
    this.emit('run', run); this.emit('bots');
    if (run.ok === false && !run.skipped && !job.retried) {
      if (routine.onFail === 'retry_up') this.enqueue(bot.id, routine.id, 'resume', undefined, true);
      else if (routine.onFail === 'resume') this.enqueue(bot.id, routine.id, 'resume', undefined, true);
    }
  }

  async stopBot(botId: string) {
    this.queue = this.queue.filter((j) => j.botId !== botId);
    for (const [, s] of this.running) if (s.job.botId === botId && s.sessionId) await this.d.interrupt(s.sessionId).catch(() => {});
    this.emit('load', this.load());
  }
  async stopAll() {
    this.queue = [];
    for (const [, s] of this.running) if (s.sessionId) await this.d.interrupt(s.sessionId).catch(() => {});
    this.emit('load', this.load());
  }

  async onInboxAnswer(item: InboxItem, a: InboxAnswer) {
    const bot = this.d.store.get(item.botId); if (!bot) return;
    const cls = item.cls; const toolName = item.toolName; const input = item.input;
    if ((a.answer === 'approve' || a.answer === 'approve_scope') && item.kind === 'approval' && cls && toolName && input && item.routineId && item.sessionId) {
      const key = scopeKey(undefined, targetOf(cls, toolName, input));
      if (a.answer === 'approve') {
        const { trust, propose } = recordApproval(this.d.store.trust(bot.id), cls, key, Date.now());
        await this.d.store.setTrust(bot.id, trust);
        if (propose) await this.d.inbox.add({ kind: 'proposal', botId: bot.id, title: tr('「{cls}」到「{key}」已连续批准 {n} 次，以后直接做？', { cls, key, n: TRUST_THRESHOLD }), proposal: { type: 'trust_up', cls, scope: scopeFromKey(key) } });
      } else if (a.scope) {
        await this.d.store.save({ ...bot, policy: { ...bot.policy, rules: [...bot.policy.rules, { cls, level: 'do', scope: a.scope }] } });
      }
      this.enqueue(bot.id, item.routineId, 'resume', { sessionId: item.sessionId, approved: { toolName, input } });
    } else if (a.answer === 'reject' && cls && toolName && input) {
      const key = scopeKey(undefined, targetOf(cls, toolName, input));
      await this.d.store.setTrust(bot.id, recordCorrection(this.d.store.trust(bot.id), cls, key));
      await this.d.store.save({ ...bot, policy: demoteRule(bot.policy, cls, key) });
    } else if (a.answer === 'adopt' && item.proposal) {
      if (item.proposal.type === 'trust_up') await this.d.store.save({ ...bot, policy: { ...bot.policy, rules: [...bot.policy.rules, { cls: item.proposal.cls, level: 'do', scope: item.proposal.scope }] } });
      else if (bot.routines.length < (bot.maxRoutines ?? 20)) await this.d.store.save({ ...bot, routines: [...bot.routines, { ...item.proposal.routine, selfMade: true }] });
    } else if (a.answer === 'send' && item.kind === 'draft') {
      await this.d.inbox.add({ kind: 'finding', botId: bot.id, runId: item.runId, title: tr('已标记为可发送：{title}', { title: item.title }), body: item.body });
    }
    this.emit('bots');
  }
}
```

- [ ] **Step 4: 跑测试** — `npm test -w server -- bots/scheduler.test.ts` → PASS（并发那条看 `running: 1, queued: 1` 是否取决于 `pump` 的同步性：`tick` 返回前 `pump` 已把第一条放进 `running`，第二条留在队列；如果 `exec` 里 `runRoutine` 在 `addRun` 之前同步抛了异常也会从 `running` 删掉——测试用的 fakeRunner 不会）

- [ ] **Step 5: 提交**

```bash
git add server/src/bots/scheduler.ts server/src/bots/scheduler.test.ts
git commit -m "feat(bots): scheduler — 30 s tick, FIFO queue under a concurrency cap, per-bot / global budgets, retry one level up, inbox answers feed trust (3 approvals propose, a reject demotes) and resume the run"
```

---

### Task 12: 模板 + 一句话生成

**Files:**
- Create: `server/src/bots/templates.ts`
- Create: `server/src/bots/generate.ts`
- Test: `server/src/bots/templates.test.ts`、`server/src/bots/generate.test.ts`

**Interfaces:**
- Produces:

```ts
// templates.ts
export const BOT_TEMPLATES: BotTemplate[];   // 14 条，id: morning / pr / inbox / watch / bills / shopping / sales / dev / rpa / content / home / jobs / finance / team
export function fromTemplate(id: string, cwd: string): BotDraft['bot'] | undefined;
// generate.ts
export interface GenerateDeps { open(params: OpenSessionParams): AgentDriver; defaultProvider(): string | undefined }
export async function generateBot(d: GenerateDeps, text: string, cwd: string): Promise<BotDraft['bot']>;
export function parseDraft(answer: string, cwd: string): BotDraft['bot'];   // pure: finds the first ```json block, validates, fills defaults
export const GENERATE_PROMPT: (text: string) => string;
```

每个模板：`name`、`desc`（一句话）、`risk`（有封号先例的写明，如 `content` 里的小红书 / 微信）、`bot`：章程、1–2 条 Routine（带 `precheck` 草案：如 PR 巡检用 `gh pr list --json number,updatedAt`、晨报用 `gh issue list --json number,updatedAt -L 50`，没有 CLI 的 `precheck` 留空）、`acceptance: { kind: 'none' }`、`onFail: 'inbox'`、`outputs: [{ kind: 'inbox' }]`、`tier: 'balanced'`、`policy: { rules: [], signOff: true }`、`budget: { dailyUsd: 2 }`。模板文案全部 `tr()`。`fromTemplate` 深拷贝并给 routine 新 id（`r_` + 6 位）。

`generateBot`：开只聊天对话（`features: { chatOnly: true }`、`permissionMode: 'dontAsk'`、`providerId: defaultProvider()`、`drivenBy: 'schedule'`），发 `GENERATE_PROMPT(text)`，等 result（最多 120 s），`parseDraft`，`close()`。`GENERATE_PROMPT` 要模型只输出一个 ```json 块，字段：`name, charter{role,audience,sources[],report,done}, routines[{name,prompt,cron,precheck,acceptance{kind:'none'|'script',script}}], tier, budget{dailyUsd}`，并举一个例子。`parseDraft`：没有 json 块 / 解析失败 → throw `tr('没能从回答里读出 Bot 设置')`；缺 name 用 text 前 12 字；routines 为空 → 一条 `everyMinutes: 1440` 的默认；每条 routine 补 `id/enabled/onFail/acceptance`；`cron` 非法（`nextCron` throw）→ 删掉 cron 用 `everyMinutes: 1440`。

- [ ] **Step 1: 写失败的测试**

```ts
// server/src/bots/templates.test.ts
import { describe, it, expect } from 'vitest';
import { BOT_TEMPLATES, fromTemplate } from './templates.js';
describe('templates', () => {
  it('has the 14 scenes, each with a charter and at least one routine', () => {
    expect(BOT_TEMPLATES.map((t) => t.id)).toEqual(['morning', 'pr', 'inbox', 'watch', 'bills', 'shopping', 'sales', 'dev', 'rpa', 'content', 'home', 'jobs', 'finance', 'team']);
    for (const t of BOT_TEMPLATES) { expect(t.bot.charter.role.length).toBeGreaterThan(5); expect(t.bot.routines.length).toBeGreaterThan(0); expect(t.bot.policy.signOff).toBe(true); }
    expect(BOT_TEMPLATES.find((t) => t.id === 'content')!.risk).toBeTruthy();
  });
  it('fromTemplate copies with fresh routine ids and the cwd', () => {
    const a = fromTemplate('pr', '/p')!; const b = fromTemplate('pr', '/q')!;
    expect(a.cwd).toBe('/p'); expect(a.routines[0].id).not.toBe(b.routines[0].id);
    a.routines[0].name = 'changed'; expect(BOT_TEMPLATES.find((t) => t.id === 'pr')!.bot.routines[0].name).not.toBe('changed');
    expect(fromTemplate('nope', '/p')).toBeUndefined();
  });
});
```

```ts
// server/src/bots/generate.test.ts
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { parseDraft, generateBot, GENERATE_PROMPT } from './generate.js';

describe('parseDraft', () => {
  it('reads the json block and fills defaults', () => {
    const b = parseDraft('好的：\n```json\n{"name":"小晨","charter":{"role":"出晨报","sources":["github"]},"routines":[{"name":"晨报","prompt":"汇总","cron":"0 8 * * *"}]}\n```', '/p');
    expect(b).toMatchObject({ name: '小晨', cwd: '/p', tier: 'balanced', outputs: [{ kind: 'inbox' }] });
    expect(b.routines[0]).toMatchObject({ name: '晨报', cron: '0 8 * * *', enabled: true, onFail: 'inbox', acceptance: { kind: 'none' } });
    expect(b.routines[0].id).toMatch(/^r_/);
  });
  it('a bad cron falls back to daily; no routines gives one daily routine', () => {
    const b = parseDraft('```json\n{"name":"x","charter":{"role":"r","sources":[]},"routines":[{"name":"a","prompt":"p","cron":"0 0 30 2 *"}]}\n```', '/p');
    expect(b.routines[0].cron).toBeUndefined(); expect(b.routines[0].everyMinutes).toBe(1440);
    expect(parseDraft('```json\n{"name":"x","charter":{"role":"r","sources":[]}}\n```', '/p').routines[0].everyMinutes).toBe(1440);
  });
  it('no json block throws', () => { expect(() => parseDraft('没有', '/p')).toThrow(); });
});

describe('generateBot', () => {
  it('opens a chat-only conversation, sends the prompt, parses the answer, closes', async () => {
    const r: any = new EventEmitter(); r.sessionId = 's'; r.state = 'idle'; r.closed = false;
    r.send = () => setTimeout(() => r.emit('message', { type: 'result', is_error: false, result: '```json\n{"name":"小晨","charter":{"role":"出晨报","sources":[]},"routines":[]}\n```' }), 0);
    r.close = async () => { r.closed = true; }; r.interrupt = async () => {};
    let params: any;
    const b = await generateBot({ open: (p) => { params = p; return r; }, defaultProvider: () => 'relay' }, '每天早上盯 issue', '/p');
    expect(params).toMatchObject({ features: { chatOnly: true }, permissionMode: 'dontAsk', providerId: 'relay' });
    expect(b.name).toBe('小晨'); expect(r.closed).toBe(true);
    expect(GENERATE_PROMPT('x')).toContain('```json');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test -w server -- bots/templates.test.ts bots/generate.test.ts` → FAIL

- [ ] **Step 3: 实现**

templates.ts 骨架（14 条都要写完，下面给前两条的形状，其余照此，每条 `desc`/`role`/`prompt` 用调研报告 `reports/AI 队友 Bot 玩法全景.md` 第 11–26 行那张表里对应场景的做法改写成中文一两句）：

```ts
// server/src/bots/templates.ts
import { randomBytes } from 'node:crypto';
import type { BotDraft, BotTemplate, Routine } from '../protocol.js';
import { tr } from '../i18n/index.js';

const base = (p: { name: string; role: string; audience?: string; sources: string[]; report?: string; done?: string; routines: Omit<Routine, 'id' | 'enabled' | 'onFail' | 'acceptance'>[] }): BotTemplate['bot'] => ({
  name: p.name, charter: { role: p.role, audience: p.audience, sources: p.sources, report: p.report ?? tr('结尾固定写：查了什么 / 没能查到什么 / 建议的下一步'), done: p.done },
  tier: 'balanced', policy: { rules: [], signOff: true }, budget: { dailyUsd: 2 }, outputs: [{ kind: 'inbox' }],
  routines: p.routines.map((r) => ({ id: '', enabled: true, onFail: 'inbox', acceptance: { kind: 'none' }, ...r })),
});

export const BOT_TEMPLATES: BotTemplate[] = [
  { id: 'morning', name: tr('晨报'), desc: tr('每天早上一页纸：紧急 / 等我 / 仅供了解 / 建议下一步'), bot: base({ name: tr('晨报'), role: tr('每个工作日早上把我该知道的事整理成一页纸，不发消息、不改日程、不做承诺。'), sources: ['git log', 'gh issue', 'gh pr'], routines: [{ name: tr('晨报'), prompt: tr('看这个仓库最近 24 小时的提交、issue 和 PR，分四栏：紧急 / 等我 / 仅供了解 / 建议的下一步；每条带链接。'), cron: '30 7 * * 1-5', precheck: 'gh issue list --json number,updatedAt -L 50; gh pr list --json number,updatedAt -L 50' }] }) },
  { id: 'pr', name: tr('PR 巡检'), desc: tr('盯 PR 和 CI，失败了找原因写修复建议，不直接改'), bot: base({ name: tr('PR 巡检'), role: tr('盯这个仓库的 PR 和 CI。失败了读日志找原因，写成修复建议；不直接改代码，不合并。'), sources: ['gh pr', 'gh run'], routines: [{ name: tr('CI 巡检'), prompt: tr('列出打开的 PR 和它们的 CI 状态；有失败的读 gh run view --log-failed 找原因，给修复建议。全部通过就一句话。'), everyMinutes: 60, precheck: 'gh pr list --json number,headRefOid,statusCheckRollup -L 30' }] }) },
  // inbox / watch / bills / shopping / sales / dev / rpa / content(risk: tr('小红书 / 微信 / 闲鱼有封号先例，只起草不自动发')) / home / jobs / finance(role 里写明「绝不下单、改单、撤单」) / team — 同样的形状
];

export function fromTemplate(id: string, cwd: string): BotDraft['bot'] | undefined {
  const t = BOT_TEMPLATES.find((x) => x.id === id); if (!t) return undefined;
  const bot = JSON.parse(JSON.stringify(t.bot)) as BotTemplate['bot'];
  return { ...bot, cwd, routines: bot.routines.map((r) => ({ ...r, id: `r_${randomBytes(3).toString('hex')}` })) };
}
```

```ts
// server/src/bots/generate.ts
import { randomBytes } from 'node:crypto';
import type { AgentDriver } from '../agents/types.js';
import type { BotDraft, OpenSessionParams, Routine } from '../protocol.js';
import { nextCron } from '../schedules/cron.js';
import { tr } from '../i18n/index.js';

export interface GenerateDeps { open(params: OpenSessionParams): AgentDriver; defaultProvider(): string | undefined }

export const GENERATE_PROMPT = (text: string) => [
  '把下面这句话变成一个「值班 Bot」的设置。只输出一个 ```json 代码块，不要别的话。字段：',
  '{ "name": "短名字", "charter": { "role": "一句话职责", "audience": "服务对象", "sources": ["只用这些来源"], "report": "报告格式", "done": "完成条件" },',
  '  "routines": [ { "name": "例行名", "prompt": "每次运行的指令，写清要查什么、输出什么、不做什么", "cron": "5 字段 cron 或省略", "everyMinutes": 60, "precheck": "一段 shell：输出会变化的东西（列表、哈希），没变化就不唤醒；没有合适的就省略", "acceptance": { "kind": "none" } } ],',
  '  "tier": "cheap|balanced|best", "budget": { "dailyUsd": 2 } }',
  '规则：默认只读、只起草、不对外发送；要发的东西让它写进 <draft>…</draft>；节奏能慢就慢（每天一次优先于每小时）。',
  '', '这句话：', text,
].join('\n');

export function parseDraft(answer: string, cwd: string): BotDraft['bot'] {
  const m = /```json\s*([\s\S]*?)```/.exec(answer);
  let j: any; try { j = JSON.parse(m?.[1] ?? ''); } catch { throw new Error(tr('没能从回答里读出 Bot 设置')); }
  const routines: Routine[] = (Array.isArray(j.routines) && j.routines.length ? j.routines : [{ name: tr('每天一次'), prompt: String(j.charter?.role ?? ''), everyMinutes: 1440 }]).map((r: any) => {
    let cron = typeof r.cron === 'string' && r.cron.trim() ? r.cron.trim() : undefined;
    if (cron) { try { nextCron(cron); } catch { cron = undefined; } }
    return { id: `r_${randomBytes(3).toString('hex')}`, name: String(r.name ?? tr('例行')), prompt: String(r.prompt ?? ''), enabled: true, onFail: 'inbox' as const, acceptance: r.acceptance?.kind === 'script' && typeof r.acceptance.script === 'string' ? { kind: 'script' as const, script: r.acceptance.script } : { kind: 'none' as const }, ...(cron ? { cron } : { everyMinutes: Number(r.everyMinutes) > 0 ? Number(r.everyMinutes) : 1440 }), ...(typeof r.precheck === 'string' && r.precheck.trim() ? { precheck: r.precheck.trim() } : {}) };
  });
  return {
    name: String(j.name ?? '').trim() || cwd.slice(-12), cwd,
    charter: { role: String(j.charter?.role ?? ''), audience: j.charter?.audience, sources: Array.isArray(j.charter?.sources) ? j.charter.sources.map(String) : [], report: j.charter?.report, done: j.charter?.done },
    tier: ['cheap', 'balanced', 'best'].includes(j.tier) ? j.tier : 'balanced', policy: { rules: [], signOff: true }, budget: { dailyUsd: Number(j.budget?.dailyUsd) > 0 ? Number(j.budget.dailyUsd) : 2 },
    routines, outputs: [{ kind: 'inbox' }],
  };
}

export async function generateBot(d: GenerateDeps, text: string, cwd: string): Promise<BotDraft['bot']> {
  const r = d.open({ cwd, features: { chatOnly: true }, permissionMode: 'dontAsk', providerId: d.defaultProvider(), drivenBy: 'schedule' });
  try {
    for (let i = 0; i < 60 && r.state === 'starting'; i++) await new Promise((res) => setTimeout(res, 500));
    const answer = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => { off(); reject(new Error(tr('生成超时'))); }, 120_000);
      const onMsg = (m: any) => { if (m?.type === 'result') { clearTimeout(t); off(); m.is_error ? reject(new Error(String(m.result ?? m.subtype))) : resolve(typeof m.result === 'string' ? m.result : ''); } };
      const off = () => r.off('message', onMsg);
      r.on('message', onMsg);
      r.send(GENERATE_PROMPT(text));
    });
    return parseDraft(answer, cwd);
  } finally { await r.close().catch(() => {}); }
}
```

- [ ] **Step 4: 跑测试** — PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/bots/templates.ts server/src/bots/generate.ts server/src/bots/templates.test.ts server/src/bots/generate.test.ts
git commit -m "feat(bots): 14 templates with draft-only guard rails, and one sentence → a bot draft through a chat-only conversation"
```

---

### Task 13: BotService + hub + index + IM 推送

**Files:**
- Create: `server/src/bots/service.ts`
- Modify: `server/src/im/router.ts:218-237`（公开 `sendTo`）
- Modify: `server/src/ws/hub.ts:159,255,663`（`Services.bots`、事件转发、`bots.*` 分支）
- Modify: `server/src/index.ts:642`（构造）
- Test: `server/src/bots/service.test.ts`

**Interfaces:**
- Produces:

```ts
export interface BotServiceDeps {
  dataDir: string; pool: RunnerPool; memory: MemoryService; ledger: LedgerService; meta: MetaStore;
  im?: { sendTo(gatewayId: string, chatId: string, text: string, buttons?: { id: string; label: string; danger?: boolean }[]): Promise<void>; onCallback(prefix: string, h: (parts: string[]) => Promise<string>): void };
}
export class BotService extends EventEmitter {   // 'changed' (BotStatus[]), 'run' (BotRun), 'inbox' (InboxItem), 'load' (BotLoad)
  constructor(d: BotServiceDeps)
  start(): void; stop(): void;
  list(): BotStatus[]; get(id): BotStatus; statusOf(bot: Bot): BotStatus;
  async create(draft: BotDraft['bot']): Promise<BotStatus>;   // ensures the manager bot exists first (id 'manager', manager: true, undeletable)
  async update(id, patch: Partial<Bot>): Promise<BotStatus>;
  async remove(id): Promise<void>;                              // manager → throw
  async pause(id, paused): Promise<BotStatus>;
  runNow(id, routineId): void;                                  // scheduler.enqueue(..., 'manual')
  async stop(id): Promise<void>; async stopAll(): Promise<void>;
  inboxList(botId?, includeDone?): InboxItem[]; async inboxAnswer(a: InboxAnswer): Promise<InboxItem>;
  runs(botId?, routineId?, limit?): BotRun[]; audit(botId, runId): AuditRow[];
  async generate(text, cwd): Promise<BotDraft['bot']>; templates(): BotTemplate[];
  load(): BotLoad;
  async unleash(id, on): Promise<BotStatus>;
}
export function tierModel(tier: BotTier): string | undefined;   // 'cheap' → 'smart-free', 'balanced' → 'smart-auto', 'best' → 'smart-performance'
```

- `statusOf`：`state` = paused → `'paused'`；`inbox.pendingCount(id)` 中有 `approval` → `'attention'`；scheduler 在跑 → `'running'`；在队列 → `'queued'`；否则 `'idle'`。scheduler 要暴露 `isRunning(botId)` / `isQueued(botId)`（Task 11 的类上加这两个只读方法：`running` 里有该 botId 的 key / `queue` 里有）。
- `PipelineDeps` 的实现：`open = (p) => pool.open({ ...p, model: p.model ?? tierModel(bot.tier) })`——`tier` 从 `p` 拿不到，所以 service 包一层：scheduler 的 `open` 不动，`exec` 里 `effective.model ??= tierModel(effective.tier)`（在 Task 11 的 `exec` 中加这一句：`const effective = { ...bot, model: bot.model ?? tierModel(bot.tier) }`，`tierModel` 放在 service.ts 并由 scheduler import——为避免环，把 `tierModel` 放到 `bots/types.ts`）。`memories = (botId, q) => memory.search({ scope: 'bot', botId, q, limit: 8 }).map(m => m.text)`；`costOf = async (sid) => (await ledger.rowsFor(sid)).reduce((a, r) => a + (r.costUsd ?? 0), 0)`；`defaultProvider = () => meta.settings()['bots.defaultProvider'] as string | undefined`；`concurrency = () => Number(meta.settings()['bots.concurrency'] ?? 2)`；`globalBudgetUsd = () => meta.settings()['bots.globalBudgetUsd'] as number | undefined`；`interrupt = (sid) => pool.get(sid)?.interrupt() ?? Promise.resolve()`。
- 事件：scheduler `'run'` → `emit('run')`；`'bots'` / `'load'` → `emit('changed', list())` / `emit('load')`；inbox `'item'` → `emit('inbox', item)` 并：若 bot.outputs 里有 `im` 且条目是新的（`!item.done`）且不在勿扰时段（`bot.quiet`，`HH:mm` 字符串比较本地时间）→ `im.sendTo(gatewayId, chatId, 文本, buttons)`，buttons 对 approval 为 `[{ id: 'bots:approve:<id>', label: tr('批准') }, { id: 'bots:reject:<id>', label: tr('拒绝'), danger: true }]`。勿扰时段里攒起来，每个 bot 一个数组，`quiet.to` 过后下一次 tick 合并成一条「夜里有 N 条」推出去。
- `im.onCallback('bots', parts)`：`parts = ['approve', id]` → `inboxAnswer({ id, answer: 'approve' })` 返回 `tr('已批准')`；`reject` 同理。
- `inboxAnswer` = `inbox.answer(a)` 然后 `scheduler.onInboxAnswer(item, a)`。
- 总管 Bot：`ensureManager()` 在 `start()` 里：不存在则 `store.save({ id: 'manager', name: tr('总管'), manager: true, charter: { role: tr('接我随口说的事，转给合适的 Bot；没有合适的就提议新建一个。'), sources: [] }, cwd: os.homedir(), tier: 'balanced', policy: { rules: [] }, budget: { dailyUsd: 1 }, routines: [], outputs: [{ kind: 'inbox' }], … })`。一期总管没有 Routine，只是存在（IM 转派三期做）。
- `unleash(id, on)`：`policy.unleashed = on`。

hub：`Services` 加 `bots: BotService`；构造里 `s.bots.on('changed', (bots) => this.broadcast({ kind: 'bots.changed', bots }))`、`'run'`、`'inbox'`、`'load'` 同样转发；`switch` 加 17 个 `case 'bots.*'`，一行一个直接调 service（`bots.create` 返回 `statusOf`；`bots.inbox.answer` 返回答完的 item；`bots.duty.install` 调 Task 14 的 `installDuty`）。

ImRouter：把 `announce`/`notify` 旁边加公开方法：

```ts
  /** 值班 Bot: push to one chat of one gateway (a bot's output), buttons as inline keys where the platform has them */
  async sendTo(gatewayId: string, chatId: string, text: string, buttons?: { id: string; label: string; danger?: boolean }[]) {
    const a = this.adapters.get(gatewayId);
    if (!a || a.state !== 'running') throw new Error(tr('这个 IM 没在运行'));
    await a.send(chatId, text, buttons ? { buttons } : undefined);
  }
```

`onCallback` = `this.callbackHandlers.set(prefix, async (parts) => h(parts))`（已有 `callbackHandlers` Map，第 218 行；签名是 `(parts, ctx) => Promise<string>`，包一层）。

index.ts：`const bots = new BotService({ dataDir: path.join(dataDir(), 'bots'), pool, memory, ledger, meta, im: { sendTo: (g, c, t, b) => im.router.sendTo(g, c, t, b), onCallback: (p, h) => im.router.callbackHandlers.set(p, (parts) => h(parts)) } }); bots.start();` 加进 `services`。

- [ ] **Step 1: 写失败的测试**

```ts
// server/src/bots/service.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { EventEmitter } from 'node:events';
import { BotService, tierModel } from './service.js';

function fakePool() {
  const p: any = new EventEmitter(); p.runners = new Map();
  p.open = (params: any) => { const r: any = new EventEmitter(); r.sessionId = params.sessionId ?? `s_${p.runners.size}`; r.state = 'idle'; r.params = params; r.send = () => setTimeout(() => r.emit('message', { type: 'result', is_error: false, result: 'ok' }), 0); r.interrupt = vi.fn(async () => {}); r.close = async () => {}; p.runners.set(r.sessionId, r); return r; };
  p.get = (id: string) => p.runners.get(id);
  return p;
}
const fakeMeta = (settings: Record<string, unknown> = {}) => ({ settings: () => settings });

describe('BotService', () => {
  let root: string; let svc: BotService; let pool: any; let im: any;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-botsvc-')); pool = fakePool();
    im = { sendTo: vi.fn(async () => {}), handlers: new Map(), onCallback: (p: string, h: any) => im.handlers.set(p, h) };
    svc = new BotService({ dataDir: root, pool, memory: { search: () => [] } as any, ledger: { rowsFor: async () => [{ costUsd: 0.5 }] } as any, meta: fakeMeta({ 'bots.concurrency': 2 }) as any, im });
    svc.start();
  });
  afterEach(() => { svc.stop(); fs.rmSync(root, { recursive: true, force: true }); });

  it('start creates the manager; it cannot be deleted', async () => {
    expect(svc.list().map((b) => b.id)).toEqual(['manager']);
    await expect(svc.remove('manager')).rejects.toThrow();
  });
  it('create / update / pause / unleash return statuses with state and cost', async () => {
    const b = await svc.create({ name: 'x', charter: { role: 'r', sources: [] }, cwd: '/p', tier: 'cheap', policy: { rules: [] }, budget: {}, routines: [], outputs: [{ kind: 'inbox' }] });
    expect(b.state).toBe('idle'); expect(b.todayUsd).toBe(0);
    expect((await svc.pause(b.id, true)).state).toBe('paused');
    expect((await svc.unleash(b.id, true)).policy.unleashed).toBe(true);
    expect((await svc.update(b.id, { name: 'y' })).name).toBe('y');
  });
  it('runNow runs through the pool with the tier model and records cost from the ledger', async () => {
    const b = await svc.create({ name: 'x', charter: { role: 'r', sources: [] }, cwd: '/p', tier: 'best', policy: { rules: [] }, budget: {}, routines: [{ id: 'r1', name: 'n', prompt: 'p', enabled: true, everyMinutes: 60, acceptance: { kind: 'none' }, onFail: 'inbox' }], outputs: [{ kind: 'inbox' }] });
    const runs: any[] = []; svc.on('run', (r) => runs.push(r));
    svc.runNow(b.id, 'r1');
    await new Promise((r) => setTimeout(r, 50));
    expect([...pool.runners.values()][0].params.model).toBe(tierModel('best'));
    expect(runs.at(-1)).toMatchObject({ ok: true, costUsd: 0.5 });
    expect(svc.get(b.id).todayUsd).toBe(0.5);
  });
  it('an IM output gets new inbox items pushed with approve / reject buttons, and the callback answers', async () => {
    const b = await svc.create({ name: 'x', charter: { role: 'r', sources: [] }, cwd: '/p', tier: 'cheap', policy: { rules: [] }, budget: {}, routines: [{ id: 'r1', name: 'n', prompt: 'p', enabled: true, acceptance: { kind: 'none' }, onFail: 'inbox' }], outputs: [{ kind: 'im', gatewayId: 'tg', chatId: 'c1' }] });
    const item = await (svc as any).inbox.add({ kind: 'approval', botId: b.id, routineId: 'r1', sessionId: 's', title: 'git push', toolName: 'Bash', input: { command: 'git push' }, cls: 'send' });
    await new Promise((r) => setTimeout(r, 0));
    expect(im.sendTo).toHaveBeenCalledWith('tg', 'c1', expect.stringContaining('git push'), [expect.objectContaining({ id: `bots:approve:${item.id}` }), expect.objectContaining({ id: `bots:reject:${item.id}`, danger: true })]);
    expect(await im.handlers.get('bots')(['reject', item.id])).toContain('拒');
    expect(svc.inboxList(b.id, true)[0].done?.answer).toBe('reject');
  });
  it('quiet hours hold IM pushes', async () => {
    const b = await svc.create({ name: 'x', charter: { role: 'r', sources: [] }, cwd: '/p', tier: 'cheap', policy: { rules: [] }, budget: {}, routines: [], outputs: [{ kind: 'im', gatewayId: 'tg', chatId: 'c1' }], quiet: { from: '00:00', to: '23:59' } });
    await (svc as any).inbox.add({ kind: 'finding', botId: b.id, title: 'late' });
    await new Promise((r) => setTimeout(r, 0));
    expect(im.sendTo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — FAIL

- [ ] **Step 3: 实现** service.ts（按 Interfaces 节的描述；`tierModel` 放 `bots/types.ts` 并从 service.ts re-export；Task 11 的 `exec` 里加 `model: bot.model ?? tierModel(bot.tier)` 和 `isRunning / isQueued`）、hub、im/router、index.ts 的接线。

- [ ] **Step 4: 跑测试 + typecheck + 全量 server 测试**

Run: `npm test -w server -- bots/ && npm run typecheck && npm test -w server`
Expected: PASS；`node scripts/i18n/extract.mjs --check` 列出的新字已加进 `server/src/i18n/en.ts`。

- [ ] **Step 5: 提交**

```bash
git add server/src/bots/service.ts server/src/bots/service.test.ts server/src/bots/types.ts server/src/bots/scheduler.ts server/src/im/router.ts server/src/ws/hub.ts server/src/index.ts server/src/i18n/en.ts
git commit -m "feat(bots): BotService wired into the hub — bots.* requests and events, tier → routing policy, cost from the ledger, inbox items pushed to a bot's IM chat with approve / reject buttons, quiet hours, the manager bot"
```

---

### Task 14: 值班模式——无界面服务安装

桌面版「关窗口缩到托盘」（`ui.closeToTray`，默认开）和「开机自启」（`desktop:loginItem:set`）**已经存在**，不用再做；设置 → Bot 里只把它们链接过去（Task 20）。这个任务只做第三档：服务端注册成系统服务，没有界面也值班。

**Files:**
- Create: `server/src/bots/duty.ts`
- Test: `server/src/bots/duty.test.ts`
- Modify: `server/src/ws/hub.ts`（`bots.duty.install` 分支已在 Task 13 占位，这里接上）

**Interfaces:**
- Produces:

```ts
export interface DutyPlan { platform: 'win32' | 'darwin' | 'linux'; files: { path: string; content: string }[]; commands: string[]; uninstall: string[] }
export function dutyPlan(o: { platform: NodeJS.Platform; nodeBin: string; serverEntry: string; dataDir: string; port: number; home: string }): DutyPlan;   // pure
export async function installDuty(on: boolean): Promise<{ ok: boolean; detail: string }>;   // writes files, runs commands (windowsHide), returns what it did
export function dutyInstalled(): Promise<boolean>;
```

- win32：`schtasks /Create /TN "ClaudeWebDuty" /SC ONLOGON /RL LIMITED /F /TR "\"<nodeBin>\" \"<serverEntry>\""`（`uninstall`: `schtasks /Delete /TN ClaudeWebDuty /F`）；`dutyInstalled` = `schtasks /Query /TN ClaudeWebDuty` 退出码 0。
- darwin：写 `<home>/Library/LaunchAgents/app.claude-web.duty.plist`（`ProgramArguments: [nodeBin, serverEntry]`、`RunAtLoad: true`、`KeepAlive: true`、`EnvironmentVariables: { CLAUDE_WEB_DIR: dataDir, PORT }`、`StandardOutPath: <dataDir>/duty.log`），`launchctl load -w <plist>`；uninstall `launchctl unload -w` + 删文件。
- linux：写 `<home>/.config/systemd/user/claude-web-duty.service`（`[Service] ExecStart=<nodeBin> <serverEntry>`、`Restart=always`、`Environment=CLAUDE_WEB_DIR=…`），`systemctl --user enable --now claude-web-duty`；uninstall `disable --now` + 删文件。
- `serverEntry`：`path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js')`（dist 里 `bots/duty.js` 的上一级）；`nodeBin = process.execPath`（Electron 里会是 electron，所以 `installDuty` 在 `process.versions.electron` 时用 `ELECTRON_RUN_AS_NODE=1` 加到服务环境变量里）。

- [ ] **Step 1: 写失败的测试**（只测纯函数 `dutyPlan`）

```ts
// server/src/bots/duty.test.ts
import { describe, it, expect } from 'vitest';
import { dutyPlan } from './duty.js';
const o = { nodeBin: '/usr/bin/node', serverEntry: '/app/server/dist/index.js', dataDir: '/home/me/.claude-web', port: 3090, home: '/home/me' };
describe('dutyPlan', () => {
  it('windows: a logon task', () => {
    const p = dutyPlan({ ...o, platform: 'win32', nodeBin: 'C:\\node.exe', serverEntry: 'C:\\app\\index.js' });
    expect(p.files).toEqual([]);
    expect(p.commands[0]).toContain('schtasks /Create /TN "ClaudeWebDuty" /SC ONLOGON');
    expect(p.commands[0]).toContain('"C:\\node.exe" "C:\\app\\index.js"');
    expect(p.uninstall[0]).toContain('schtasks /Delete');
  });
  it('macos: a LaunchAgent plist loaded with launchctl', () => {
    const p = dutyPlan({ ...o, platform: 'darwin' });
    expect(p.files[0].path).toBe('/home/me/Library/LaunchAgents/app.claude-web.duty.plist');
    expect(p.files[0].content).toContain('<string>/app/server/dist/index.js</string>');
    expect(p.files[0].content).toContain('<key>KeepAlive</key>');
    expect(p.commands[0]).toBe('launchctl load -w /home/me/Library/LaunchAgents/app.claude-web.duty.plist');
  });
  it('linux: a systemd user unit', () => {
    const p = dutyPlan({ ...o, platform: 'linux' });
    expect(p.files[0].path).toBe('/home/me/.config/systemd/user/claude-web-duty.service');
    expect(p.files[0].content).toContain('ExecStart=/usr/bin/node /app/server/dist/index.js');
    expect(p.commands).toEqual(['systemctl --user daemon-reload', 'systemctl --user enable --now claude-web-duty']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — FAIL

- [ ] **Step 3: 实现** `duty.ts`（`dutyPlan` 按上面三段生成；`installDuty` 用 `fs.promises.writeFile` + `execFile`（shell 命令按空格拆或走 `spawn(cmd, { shell: true, windowsHide: true })`）；每条命令失败把 stderr 放进 `detail`）；hub 的 `bots.duty.install` → `installDuty(req.on)`。

- [ ] **Step 4: 跑测试** — PASS；typecheck 通过

- [ ] **Step 5: 提交**

```bash
git add server/src/bots/duty.ts server/src/bots/duty.test.ts server/src/ws/hub.ts
git commit -m "feat(bots): headless duty — register the server as a logon task / LaunchAgent / systemd user unit so bots run without a window"
```

---

### Task 15: 前端状态 state.ts + 分区注册 + 模型纯函数

**Files:**
- Create: `web/src/features/bots/state.ts`、`web/src/features/bots/model.ts`
- Modify: `web/src/features/sections/pages.ts:7`（`Section` 加 `'bots'`）
- Modify: `web/src/features/sections/index.ts`（import）
- Modify: `web/src/features/rail/rail-model.ts:9-15`、`web/src/features/rail/Rail.tsx:36-39`
- Test: `web/src/features/bots/model.test.ts`、`web/src/features/bots/state.test.ts`

**Interfaces:**
- Produces:

```ts
// state.ts
interface BotsState { open: boolean; seen: boolean; bots: BotStatus[]; selected?: string; tab: 'routines' | 'runs' | 'policy' | 'memory' | 'self'; inbox: InboxItem[]; runs: Record<string, BotRun[]>; load: BotLoad; creating: boolean; templates: BotTemplate[] }
export const useBots: UseBoundStore<StoreApi<BotsState>>;
export function openBots(id?: string): boolean; export function closeBots(): void; export function selectBot(id: string): void;
export function installBots(): void;      // hello → bots.list + bots.inbox.list + bots.load + bots.templates; events bots.changed / bots.run / bots.inbox / bots.load
export const useInboxPending = () => number;   // selector on inbox (count of !done) — memoised: keep `pending` as a number in state, updated when inbox changes
export async function answerInbox(a: InboxAnswer): Promise<void>;
export async function runNow(botId: string, routineId: string): Promise<void>;
export async function stopAll(): Promise<void>;
// model.ts (pure)
export function stateLabel(s: BotStatus['state']): string;      // tr: 空闲 / 在跑 / 排队 / 暂停 / 需要你
export function usd(n: number): string;                           // '$0.00' / '$1.23'
export function sortBots(bots: BotStatus[]): BotStatus[];         // manager first, then attention, running, queued, idle, paused; then by name
export function inboxKindLabel(k: InboxKind): string;             // 待批 / 发现 / 草稿 / 提议
export function groupInbox(items: InboxItem[]): Record<InboxKind, InboxItem[]>;
export function levelLabel(l: PolicyLevel): string;               // 直接做 / 做了告诉我 / 先问我 / 禁止
export function classLabel(c: ActionClass): string;               // 读 / 写本地 / 浏览器与电脑 / 对外发送 / 付款交易 / 不可恢复删除 / 装东西
export function monthlyEstimate(r: Routine, perRunUsd: number): number;   // runs per month × perRunUsd (cron: count in 30 days with nextCron-like stepping is heavy — approximate: cron with '*/N' minutes → 43200/N, hourly '0 *' → 720, daily → 30, else 30; everyMinutes → 43200/N)
```

- [ ] **Step 1: 写失败的测试**

```ts
// web/src/features/bots/model.test.ts
import { describe, it, expect } from 'vitest';
import { sortBots, usd, groupInbox, monthlyEstimate } from './model';
const b = (id: string, state: any, manager = false): any => ({ id, name: id, state, manager });
describe('bots model', () => {
  it('sortBots: manager, attention, running, queued, idle, paused', () => {
    expect(sortBots([b('p', 'paused'), b('i', 'idle'), b('m', 'idle', true), b('a', 'attention'), b('r', 'running'), b('q', 'queued')]).map((x) => x.id)).toEqual(['m', 'a', 'r', 'q', 'i', 'p']);
  });
  it('usd', () => { expect(usd(0)).toBe('$0.00'); expect(usd(1.2345)).toBe('$1.23'); });
  it('groupInbox keeps every kind present', () => {
    const g = groupInbox([{ id: '1', kind: 'draft', botId: 'b', at: 1, title: 't' }]);
    expect(g.draft).toHaveLength(1); expect(g.approval).toEqual([]);
  });
  it('monthlyEstimate', () => {
    expect(monthlyEstimate({ everyMinutes: 5 } as any, 0.05)).toBeCloseTo(432);
    expect(monthlyEstimate({ cron: '0 * * * *' } as any, 0.05)).toBeCloseTo(36);
    expect(monthlyEstimate({ cron: '30 7 * * 1-5' } as any, 0.05)).toBeCloseTo(1.5);
  });
});
```

```ts
// web/src/features/bots/state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useBots, openBots, closeBots } from './state';
import { currentSection } from '@/features/sections/pages';
describe('bots page state', () => {
  beforeEach(() => useBots.setState({ open: false, seen: false, bots: [], inbox: [], runs: {}, pending: 0 } as any));
  it('registers as a section: opening it is the current section, closing goes back to chat', () => {
    openBots(); expect(currentSection()).toBe('bots'); expect(useBots.getState().seen).toBe(true);
    closeBots(); expect(currentSection()).toBe('chat'); expect(useBots.getState().seen).toBe(true);
  });
  it('openBots(id) selects that bot', () => { openBots('b_1'); expect(useBots.getState().selected).toBe('b_1'); });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test -w web -- features/bots` → FAIL

- [ ] **Step 3: 实现**

`pages.ts`：`export type Section = 'chat' | 'background' | 'automation' | 'extensions' | 'gateway' | 'bots';`。`index.ts` 加 `import '@/features/bots/state';`。`rail-model.ts` 在 `automation` 后加 `{ id: 'bots', label: tr('Bot'), icon: 'bot', tip: tr('Bot：住在你电脑里的值班队友') }`（`icon` 用 `web/src/ui/icons.tsx` 里已有的名字；没有 `bot` 就先用 `office`，并在该文件加一个 `bot` 图标——一个带两只眼睛的圆角方块 path）。`Rail.tsx` 第 36–39 行的表加 `bots: () => { openBots(); }`。

`state.ts` 照 `features/background/state.ts` 的形状：`create<BotsState>`、`openBots` 里 `closeOtherPages('bots')` + `markPageOpened()`（从 automation/state import，和 background 一样）+ 手机时收侧栏；`registerPage('bots', { isOpen, close: closeBots, subscribe })`；`installBots()` 里 `ws.on` 处理四个事件，`hello` 时 refresh 四个请求（`.catch(() => {})`，老服务端没有 bots）；`pending` 字段随 `inbox` 一起更新（`inbox.filter(i => !i.done).length`）；`runs` 在 `bots.run` 事件时按 `run.botId` 把同 id 的替换 / 前插（最多 200）。`window.__cwBots = { inject, state, open }` 给 ui-smoke。

- [ ] **Step 4: 跑测试 + typecheck + selectors 测试**

Run: `npm test -w web -- features/bots store/selectors && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/features/bots/state.ts web/src/features/bots/model.ts web/src/features/bots/model.test.ts web/src/features/bots/state.test.ts web/src/features/sections/pages.ts web/src/features/sections/index.ts web/src/features/rail/rail-model.ts web/src/features/rail/Rail.tsx web/src/ui/icons.tsx
git commit -m "feat(bots): the Bot section — page state, inbox / runs / load from the server, a rail entry"
```

---

### Task 16: Bot 页——三栏壳、列表、负载条

**Files:**
- Create: `web/src/features/bots/BotsPage.tsx`、`BotList.tsx`、`LoadBar.tsx`、`bots.css`
- Modify: `web/src/features/workbench/Workbench.tsx:19-50`（lazy 挂 `BotsPage`，`botsSeen` 从 `useBots((s) => s.seen)`）
- Modify: `web/src/features/sections/SectionSide.tsx` 的调用方（找 `name="bg"` 那处——`grep -rn 'name="bg"' web/src` —— 同样加 `bots` 的侧栏：`<SectionSide name="bots" title={tr('Bot')} tab={selected} tabs={bots → OverTab(id, name, icon 'bot', count: pendingInbox)} onTab={selectBot} action={新建按钮}>`）
- Modify: `web/src/styles/index.css`（或样式入口，看 `docs/notes/ui-refresh.md` 「样式文件顺序」）import `bots.css`

**Interfaces:**
- Consumes: `useBots`、`sortBots / stateLabel / usd`、`OverPage`、`SectionSide`、`EmptyState` + `EMPTY`（`ui/terms.ts`，加一条 `EMPTY.bots = { title: tr('还没有 Bot'), hint: tr('从晨报、PR 巡检、收件箱分拣里挑一个开始') }`）。
- Produces: `BotsPage()`（`OverPage name="bots"`，左 `BotList`、中 `BotDetail`（Task 17）、右 `RunPane`（Task 17）、顶 `LoadBar`）；`LoadBar()`：`tr('在跑 {running} · 排队 {queued} · 今天 {today} · 本周 {week}')` + 「全部停」按钮（`dlg.confirm(tr('停下所有 Bot？'))` 后 `stopAll()`）。

- [ ] **Step 1: 写 BotsPage / BotList / LoadBar**

`BotsPage`：

```tsx
export function BotsPage() {
  const open = useBots((s) => s.open); const bots = useBots((s) => s.bots); const selected = useBots((s) => s.selected); const tab = useBots((s) => s.tab);
  const mobile = useStore((s) => s.mobile);
  const sorted = useMemo(() => sortBots(bots), [bots]);
  const bot = sorted.find((b) => b.id === selected) ?? sorted[0];
  const tabs: OverTab[] = sorted.map((b) => ({ id: b.id, label: b.name, icon: 'bot', count: b.pendingInbox || undefined, title: stateLabel(b.state) }));
  return (
    <OverPage name="bots" label={tr('Bot')} open={open} onClose={closeBots} title={tr('Bot')} desc={tr('住在你电脑里的值班队友')} tab={bot?.id ?? ''} tabs={tabs} showTabs={mobile} onTab={selectBot}
      actions={<button className="btn primary" onClick={() => useBots.setState({ creating: true })}>{tr('新建 Bot')}</button>}
      onEscape={() => { if (useBots.getState().creating) { useBots.setState({ creating: false }); return true; } return false; }}>
      <LoadBar />
      {!bots.length ? <EmptyState {...EMPTY.bots} action={<button className="btn primary" onClick={() => useBots.setState({ creating: true })}>{tr('新建 Bot')}</button>} /> : (
        <div className="bots-body">
          {!mobile && <BotList bots={sorted} selected={bot?.id} />}
          {bot && <BotDetail bot={bot} tab={tab} />}
          {bot && !mobile && <RunPane bot={bot} />}
        </div>
      )}
      {useBots((s) => s.creating) && <CreateBot onClose={() => useBots.setState({ creating: false })} />}
    </OverPage>
  );
}
```

（`EmptyState` 的 props 以 `web/src/ui/EmptyState.tsx` 实际签名为准；`BotDetail / RunPane / CreateBot` 先各写一个只渲染 `bot.name` 的占位组件，Task 17 / 18 填实。）

`BotList`：每行头像（`bot.avatar` 为网吧角色 id 时用 `features/cafe` 的小头像组件，否则首字）、名字、`charter.role` 一行、`stateLabel` 徽章、`usd(todayUsd)`、信任小图（`Object.keys(bot.trust).length` 个点）；总管行带 `tr('总管')` 标签；点击 `selectBot`；右键 / ⋯ 菜单用 `useAnchoredMenu`：暂停 / 继续、立即运行（弹 routine 列表）、放开全部 / 收回、删除（`dlg.confirm`，总管不可删）。

`bots.css`：`.bots-body { display: grid; grid-template-columns: 260px 1fr 380px; gap: 12px; height: 100% }`、`.bot-row`、`.bot-state[data-state=attention]` 用现有令牌（`--accent` / `--warn`）；手机下单栏。

- [ ] **Step 2: 挂进 Workbench；跑 typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 通过；`npm run dev` 开页面，图标栏出现「Bot」，空状态显示。

- [ ] **Step 3: i18n**

Run: `node scripts/i18n/extract.mjs --check`，把列出的新字加进 `web/src/i18n/en.ts`；`npm test -w web -- i18n wording`

- [ ] **Step 4: 提交**

```bash
git add web/src/features/bots/ web/src/features/workbench/Workbench.tsx web/src/ui/terms.ts web/src/i18n/en.ts web/src/styles
git commit -m "feat(bots): the Bot page — list with state and today's cost, load bar with stop-all, empty state"
```

---

### Task 17: Bot 详情——章程 / 例行表 / 运行记录 / 策略与信任 / 自建栏 + 右侧对话

**Files:**
- Create: `web/src/features/bots/BotDetail.tsx`、`RoutineTable.tsx`、`RunList.tsx`、`PolicyEditor.tsx`、`RunPane.tsx`
- Modify: `web/src/features/bots/state.ts`（加 `loadRuns(botId)`、`loadAudit(botId, runId)`、`updateBot(id, patch)`）

**Interfaces:**
- Consumes: `levelLabel / classLabel / monthlyEstimate / usd`、`ws.request`（`bots.update`、`bots.runs.list`、`bots.runs.audit`、`bots.runNow`、`bots.pause`、`bots.unleash`）、`dlg.confirm`、`Switch`/`Select`（`ui/`）、对话视图（右栏复用 `features/chat` 的会话视图组件：`grep -rn "export function ChatView\|export function Conversation" web/src/features/chat` 找到按 `sessionId` 渲染一个对话的组件；没有独立组件时用 `BackgroundSide` 里 `AgentDrawer` 打开对话的同一办法）。
- Produces: `BotDetail({ bot, tab })` 顶部：名字（可改，`dlg.prompt`）、章程折叠卡（role / audience / sources / report / done 五个可编辑字段，失焦保存）、档位 Segmented（省钱 / 均衡 / 最强）、预算两格、输出去向（inbox 固定；IM 从 `im.list` 挑一个网关 + 填 chatId；文件路径）、勿扰时段、「放开全部」开关（开时 `dlg.confirm(tr('放开全部后，发送、付款、删除都不再问你，只有停止和审计还在。确定？'))`，开着时名字旁 `tr('无闸')` 红标）；tab 行：例行 / 运行 / 策略 / 记忆 / 自建。

`RoutineTable`：每行 名字、节奏（cron 或 每 N 分钟）、预检有无（无 → `tr('每次都会唤醒模型')` + `monthlyEstimate(r, 0.05)` 的月估算，5 分钟以下红字）、验收、上次 / 下次、失败次数、开关、「立即运行」、编辑（弹一屏表单：name / prompt / cron | everyMinutes / precheck / acceptance script / timeoutMin / onFail）、删除；底部「添加例行」。
`RunList`：`loadRuns` 后时间线：触发源、跳过 / 跑了、`usedScript ? 脚本 : 模型`、`usd(costUsd)`、验收 ✓/✗、两栏「Bot 说的」（said 前 200）/「核实到的」（verified.note）、点开看审计（`loadAudit` → 表：时间 / 类别 / 档位 / 依据 / 摘要 / 结果）和「打开对话」（`sessionId` → 现有打开对话的 action）。
`PolicyEditor`：七个类别一行一个 Select（四档），带 scope 的规则列在类别下（显示范围、删除）；信任图：`bot.trust` 的 key → `cls|scope: n/3` 进度点；`autoPilot` 开关 + 范围表单（domains / channels / recipients / maxAmount / perDay / until，每项可勾「无限制」）。
「记忆」tab：`memory.search { scope: 'bot', botId }` 列表，每条可删（`memory.remove` 请求若已有；没有则 `memory.update` 置空——看 protocol 里 memory.* 有哪些）。
「自建」tab：`routines.filter(r => r.selfMade)` + 一期提示 `tr('二期起 Bot 会自己提议例行和脚本，都会列在这里，可一键撤回')`。
`RunPane`：显示 `runs[bot.id][0]?.sessionId` 对应的对话（在跑的那个；没有就 `EmptyState`「没有在跑的运行」）。

- [ ] **Step 1: 写组件**（按上面的规格；所有字 `tr()`；编辑都走 `updateBot` → `bots.update` → 服务端回 `bots.changed`，不本地乐观更新）
- [ ] **Step 2: typecheck + build + dev 里手工点一遍：改章程、加例行、立即运行、看运行记录、看审计、改档位、开放开全部**
- [ ] **Step 3: i18n extract --check，补 en.ts；`npm test -w web`**
- [ ] **Step 4: 提交**

```bash
git add web/src/features/bots/ web/src/i18n/en.ts
git commit -m "feat(bots): bot detail — charter, routines with cost estimates, runs with said-vs-verified and audit, policy levels with scopes and trust, unleash, the running conversation at the side"
```

---

### Task 18: 新建 Bot——三入口 + 一屏预览 + 影子跑

**Files:**
- Create: `web/src/features/bots/CreateBot.tsx`
- Modify: `web/src/features/bots/state.ts`（`createBot(draft)`、`generate(text, cwd)`）

**Interfaces:**
- Consumes: `bots.generate`、`bots.templates`、`bots.create`、`pickFolder()`（`web/src/ui/pick-folder.ts`，文件夹选择统一走它）、当前对话（从 `useStore` 的 `activeId` 取 cwd 作为默认）。
- Produces: `CreateBot({ onClose })`：模态（`.modal-bg` 容器，和设置里的对话框同一套样式），三步：
  1. 入口：三张卡——「一句话」（textarea + 「生成」，调 `generate` 期间显示进度，失败 toast）、「模板」（14 张卡：名字、desc、`risk` 时红字一行；点选）、「从当前对话」（把当前对话最近一条用户消息作为 text 走 `generate`；没有对话时禁用并说明）。
  2. 预览：草案的全部字段一屏可改（名字、工作目录（`pickFolder`）、章程五字段、例行列表（每条可改 prompt / 节奏 / 预检）、档位、预算、输出去向）；底部提示 `tr('默认只读、只起草；对外发送、付款、删除会先问你')`。
  3. 「先影子跑一次」：调 `bots.create` 后立刻 `bots.runNow` 第一条例行，并在按钮下写 `tr('已创建并开始第一次运行，去「运行」看它做了什么')`；或「保存」只创建。
- 首次（`bots.length === 1`，只有总管）打开 Bot 页：`EmptyState` 下直接列三张模板卡（morning / pr / inbox）。

- [ ] **Step 1: 写组件 + state 两个函数**
- [ ] **Step 2: dev 里走通：模板 → 预览 → 保存；一句话 → 生成（需要一个真供应商，用临时 `CLAUDE_WEB_DIR`）→ 预览 → 影子跑**
- [ ] **Step 3: i18n、`npm test -w web`、typecheck**
- [ ] **Step 4: 提交**

```bash
git add web/src/features/bots/CreateBot.tsx web/src/features/bots/state.ts web/src/i18n/en.ts
git commit -m "feat(bots): create a bot from one sentence, a template or the current conversation, review everything on one screen, run it once first"
```

---

### Task 19: 收件箱（总览栏 + 手机）

**Files:**
- Create: `web/src/features/bots/Inbox.tsx`
- Modify: `web/src/features/panels/MissionPanel.tsx:54,88-100`（「需要你」lane 顶部挂 `<Inbox />`；标题计数加 `pending`）
- Modify: `web/src/features/bots/BotsPage.tsx`（手机时 Bot 页第一屏是收件箱）
- Test: `web/src/features/bots/inbox-view.test.ts`（纯函数 `inboxActions(item)` 的按钮集）

**Interfaces:**
- Produces: `Inbox({ botId? })`：四组（`groupInbox`），每组标题 + 计数；条目：Bot 名、时间、标题、正文折叠、`undoable === false` 时红字 `tr('不可撤')`；按钮由 `inboxActions(item): { id: InboxAnswer['answer']; label: string; danger?: boolean; needsScope?: boolean }[]` 决定：approval → 批准 / 批并以后直接做（弹范围小表单：按 `targetOf` 的字段预填 domain / channel / recipient，可勾无限制）/ 拒绝 / 看对话；finding → 归档 / 看对话；draft → 复制并标为可发 / 归档；proposal → 采纳 / 忽略。多选 + 「批量批准 / 批量归档」。全部答复走 `answerInbox`。

- [ ] **Step 1: 测试 `inboxActions`**

```ts
import { describe, it, expect } from 'vitest';
import { inboxActions } from './Inbox';
describe('inboxActions', () => {
  it('approval: approve, approve_scope (needs scope), reject', () => expect(inboxActions({ id: '1', kind: 'approval', botId: 'b', at: 1, title: 't' }).map((a) => [a.id, !!a.needsScope])).toEqual([['approve', false], ['approve_scope', true], ['reject', false]]));
  it('draft: send, archive', () => expect(inboxActions({ id: '1', kind: 'draft', botId: 'b', at: 1, title: 't' }).map((a) => a.id)).toEqual(['send', 'archive']));
  it('proposal: adopt, archive', () => expect(inboxActions({ id: '1', kind: 'proposal', botId: 'b', at: 1, title: 't' }).map((a) => a.id)).toEqual(['adopt', 'archive']));
  it('finding: archive', () => expect(inboxActions({ id: '1', kind: 'finding', botId: 'b', at: 1, title: 't' }).map((a) => a.id)).toEqual(['archive']));
});
```

- [ ] **Step 2: 跑测试确认失败；写组件与纯函数；跑测试 PASS**
- [ ] **Step 3: MissionPanel 接入；手机壳（`web/src/shell/`）的 Bot 分区同样挂 `Inbox`；dev + 手机宽度各看一遍**
- [ ] **Step 4: i18n、`npm test -w web`、typecheck；提交**

```bash
git add web/src/features/bots/Inbox.tsx web/src/features/bots/inbox-view.test.ts web/src/features/panels/MissionPanel.tsx web/src/features/bots/BotsPage.tsx web/src/shell web/src/i18n/en.ts
git commit -m "feat(bots): the inbox — approvals (approve / approve with a scope / reject), findings, drafts, proposals; in the mission panel's 需要你 lane and first on the phone"
```

---

### Task 20: 设置 → Bot

**Files:**
- Modify: `web/src/features/settings/catalog.ts`（新 section `bots`，entries：`bots.concurrency`、`bots.globalBudgetUsd`、`bots.defaultProvider`、`bots.defaultTier`、`ui.closeToTray`（已有，链接）、开机自启（已有 `desktop:loginItem`，链接）、`bots.duty.service`、`bots.unleashAll`）
- Modify: `web/src/features/settings/SettingsModal.tsx`（每个 entry 的控件）
- Create: `web/src/features/settings/BotsSection.tsx`

**Interfaces:**
- 值都走 `settings.set`；`bots.duty.service` 是一个开关：开 → `bots.duty.install { mode: 'service', on: true }`，结果 toast `detail`；桌面版里显示 `tr('桌面版关窗口会缩到托盘继续值班；开机自启在「应用」里')`。
- `bots.defaultProvider`：从 `providers.list`（已有）挑；说明文字：`tr('Bot 7×24 小时跑，默认走 API / 网关来源，不用 Claude 订阅登录（2026-04 起条款可能禁止这样用订阅，有封号风险）')`。
- `bots.unleashAll`：按钮「放开全部 Bot」→ `dlg.confirm` 后对每个 Bot `bots.unleash on`；旁边「收回」。

- [ ] **Step 1: 加 catalog 条目与控件（照 `catalog.ts` 现有 section 的形状；`wording.test.ts` 和 settings 的 catalog 测试要过）**
- [ ] **Step 2: `npm test -w web`、typecheck、i18n；dev 里改并发和预算，服务端 `bots.load` 的 `concurrency` 跟着变**
- [ ] **Step 3: 提交**

```bash
git add web/src/features/settings/ web/src/i18n/en.ts
git commit -m "feat(bots): settings — concurrency, global budget, default source (API, not the subscription), tier, headless duty service, unleash all"
```

---

### Task 21: e2e 阶段 + ui-smoke 段 + 笔记

**Files:**
- Modify: `scripts/e2e.mjs`（新阶段 `42`，加进第 13 行默认列表）
- Modify: `scripts/ui-smoke.cjs`（Bot 页与收件箱一段，用 `window.__cwBots.inject`）
- Create: `docs/notes/duty-bots.md`；Modify: `CLAUDE.md` 笔记索引加一行

**e2e 阶段 42（临时 HOME，不花 token：用 e2e 已有的假引擎 / `CW_FAKE_ENGINE` 之类——看文件里别的阶段怎么让对话不打真模型，照用）**：
1. `bots.templates` → 14 条。
2. `bots.create`（`fromTemplate('pr')` 的内容，cwd 指向 e2e 的临时仓库，routine 改成 `everyMinutes: 60`、`precheck` 删掉）→ 状态 `idle`，`bots.list` 里有总管 + 它。
3. `bots.runNow` → 等 `bots.run` 事件 `endedAt` 出现 → `bots.runs.list` 一条，`costUsd` 是数字；`bots.inbox.list` 有一条 `finding`。
4. 假引擎里让对话发一个 `Bash git push`（e2e 的假引擎若能按提示词回放工具调用就用；不能就跳过这步并在阶段说明里写明）→ 收件箱出现 `approval`；`bots.inbox.answer approve` → 新的 `bots.run`（`trigger: 'resume'`）。
5. `bots.unleash on` → 再跑一次 → 没有新的 `approval`。
6. `bots.runNow` 后立刻 `bots.stop` → 该运行 `ok === false`，`error` 有「超时」或中断字样，`bots.load.running === 0`。
7. `bots.delete` 总管 → 报错；删普通 Bot → 列表只剩总管。

**ui-smoke 段**：`openBots()`（`window.__cwBots.open()`）→ 注入两个 Bot（一个 `attention` 带 2 条 approval、一个 `running`）和 load → 断言 `.bot-row` 两行、负载条文字含「在跑 1」、收件箱里 2 条带「批准」按钮；点「新建 Bot」→ 模板卡出现 14 张 → Esc 关闭；任何 console 错误即失败（脚本已有的规则）。

**笔记 `docs/notes/duty-bots.md`**（设计决定、坑、调试）：gate 为什么「拒绝并排队」而不是挂起；`drivenBy: 'schedule'` 复用的含义；运行记录在 `bots/<id>/runs/`；预检脚本 Windows 走 PowerShell；总管一期只是占位；调试：`CLAUDE_WEB_DIR=/tmp/x npm start` 后 `bots.runNow`，看 `runs/*.audit.jsonl`。CLAUDE.md 索引表加 `| [duty-bots](docs/notes/duty-bots.md) | 值班 Bot（2026-10-30） | Bot 目录、流水线、策略闸、收件箱、调度与预算、值班模式、调试 |`。

- [ ] **Step 1: 写 e2e 阶段，跑 `npm run e2e -- 42`** → 全部断言通过
- [ ] **Step 2: 写 ui-smoke 段，`env -u ELECTRON_RUN_AS_NODE node scripts/ui-smoke.cjs`** → 通过
- [ ] **Step 3: 写笔记、改 CLAUDE.md 索引**
- [ ] **Step 4: 全量：`npm run typecheck && npm test && npm run build:all && npm run e2e`**
- [ ] **Step 5: 提交**

```bash
git add scripts/e2e.mjs scripts/ui-smoke.cjs docs/notes/duty-bots.md CLAUDE.md
git commit -m "test(bots): e2e phase 42 (create → run → inbox → approve → resume → unleash → stop → delete) and a ui-smoke section; notes"
```

---

### Task 22: 一期验收——真机跑一天

不是代码任务，是一期的收尾门（memory：要真测试，给数字）。

- [ ] 临时 `CLAUDE_WEB_DIR`，接一个真中转供应商设为 `bots.defaultProvider`；用模板 `pr` 对 claude-web 仓库建一个 Bot，`everyMinutes: 60`，预检保留。
- [ ] 跑 24 小时（或至少 6 次运行），记录：运行几次 / 跳过几次 / 每次费用 / 验收通过率 / 收件箱里 finding 与 approval 条数 / 一次 approve → resume 是否接上 / 一次 stop 是否 5 秒内结束。
- [ ] 第二个供应商重复 3 次运行，确认 `tierModel` 的路由组在那边也能解析（不能的话 `bots.defaultProvider` 的说明里要写清需要路由组）。
- [ ] 数字写进 `docs/notes/duty-bots.md` 「真机实测」段。

---

## 一期完成后

- 整体审查（最强模型）+ verification 代理并行，点名看：`gate.ts`（闸是否真的在每个工具调用前）、`pipeline.ts` 的 resume 路径、`service.ts` 的 IM 推送与勿扰、`duty.ts` 写的服务文件、`interrupt` 是否真的杀掉子进程（`session-runner.ts` 的 `forceStop`）。
- 一轮修正 → 范围复审 → 汇报（做了什么 / 真测了什么 / 没验的）。
- 不发版（spec §11：三期全部完成再发）。然后按当时的代码写二期计划（脚本固化与自愈、双模型隔离、模型验收、探索 Routine、全自动档、快照与撤回、独立 profile + 保险库 + 接管）。

## 自查记录

- spec 覆盖（一期范围）：§1 架构与协议 → Task 1、13；§2 Bot 档案与三入口（录屏入口三期）、总管 → Task 2、12、13、18；§3 流水线七步 → Task 9、10、11（第 4 步脚本优先是二期，一期 `usedScript` 字段先留）；§5 归类 / 四档 + 范围 / 信任 / 全自动 / 硬停止 / 审计 / 署名（`signOff` 字段一期只存不用——真正外发在二期）→ Task 3–8、11、13；§6 Bot 页 / 收件箱 / 手机 IM / 创建 / 运行记录 / 设置 → Task 15–20；§7 值班模式与负载 → Task 11、14、16、20（托盘与自启已有）；§10 旋钮：放开全部、deny 可设、范围无限制 → Task 4、13、17、20；§11 一期清单全部有任务；§12 测试 → 每个任务 + Task 21、22。隔离读取器、Rule of Two、脚本固化、探索、快照撤回、独立 profile、保险库、接管、事件源、联邦接力 = 二 / 三期。
- 类型一致：`BotStatus.trust` 与 `TrustMap` 同形；`InboxAnswer.answer` 六个值在 Task 11 `onInboxAnswer` 与 Task 19 `inboxActions` 一致；`tierModel` 定义在 `bots/types.ts`、service.ts re-export，scheduler 与 service 都从 types 导入；`PipelineDeps.open` 返回 `AgentDriver`，fake runner 以 `any` 充当。
- 已知取舍：「先问我」实现为「拒绝并排队，批后续跑」——SDK 的 canUseTool 挂起会卡整轮，spec §3 末段「不阻塞」正是这个意思；一期 `approve` 之后模型再次请求同一调用才会放行，若模型换了参数（比如 commit 信息变了）会再次进收件箱，二期在 gate 里加「同类同目标一次放行」缓解。

