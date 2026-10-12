# 后台（代理办公室 + 指挥台）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 claude-web 看得见每个对话在跑的子代理、工作流和后台命令：图标栏「后台」整页（代理卡片 + 办公室 + 关系图 + 事件流）、右侧面板「任务」里缩小的指挥台、输入框上方的「后台」胶囊、对话里 Workflow 卡片的实时子代理；「停止」只停这一轮。

**Architecture:** 服务端 `BackgroundService` 订阅对话池的 SDK 消息（`task_*`，工作流的 `workflow_progress`），按对话维护登记表，每个对话 ≤ 1 次/秒推 `background.changed`；跑完的工作流和子代理 transcript 从 `~/.claude/projects/<dir>/<sid>/` 读。前端一个小 zustand store 收快照，`features/background/` 画页面；办公室是纯函数排位 + SVG。我们的引擎（ccb fork）补发同样形状的 `workflow_progress`。

**Tech Stack:** TypeScript、Node（server，vitest）、React 18 + zustand（web，vitest）、SVG/CSS 动画、Electron ui-smoke、engine fork（bun 构建）。

## Global Constraints

- 设计：`docs/superpowers/specs/2026-10-12-background-office-design.md`。
- 界面文字一律「对话」不说「会话」；不出现 档案 / 引擎 / 窗格 / 停靠 / effort / ultracode / ACP / worktree（tooltip 除外）；`web/src/features/settings/wording.test.ts` 扫整个 `web/src`。
- 新 IME 文本框的 Enter / Escape 先问 `imeComposing(e.nativeEvent)`。
- zustand 选择器返回稳定引用（`web/src/store/selectors.test.ts`）。
- 颜色 / 圆角 / 时长用 `tokens.css` 的令牌；`--accent` 只做填充，文字用 `--accent-text`。
- 动画只动 transform / opacity / 颜色；「减少动画」（`html[data-reduce-motion]` + `prefers-reduced-motion`）下不动。
- 只有眼前实时发生的才有进场动画（加载历史不播）。
- 新加的锚定菜单用 `useMenuClaim` / `useDropdown`。
- 远端（`peer_`）对话不进「后台」页（v1）。
- 改文件用 Edit / Write，不在 bash 里用 heredoc / `node -e` 写带反斜杠或反引号的内容。

---

## File Structure

**Server** (`server/src/background/`)
- `types.ts` — 协议类型（`BgSession / BgTask / BgAgent / BgEvent / BgRunSummary`、请求、事件）；`protocol.ts` `export *`。
- `registry.ts` — 纯函数：一条 SDK 消息 → 改登记表 + 生成事件；进程结束；快照。
- `disk.ts` — 找对话目录、读跑完的工作流（`workflows/*.json` → `BgTask`）、读子代理 transcript。
- `service.ts` — `BackgroundService`：订阅 pool、节流推送、请求入口。
- `handlers.ts` — `isBackgroundRequest` + `handleBackground`（hub 一行分发）。
- 改：`ws/hub.ts`（分发 + 广播）、`index.ts`（建服务）、`runtime/session-runner.ts`（`perTaskStopAffordance`、在跑的后台任务计数）、`runtime/pool.ts`（有后台任务时不回收）、`federation/rewrite.ts`（路由表）。

**Engine fork** (`C:\Users\YPY\claude-web-engine`, branch `claude-web`)
- 工作流发官方形状的 `workflow_progress`；`task_started` 带 `task_type:'local_workflow'` + `workflow_name`；认 `perTaskStopAffordance`。`CLAUDE-WEB.md` 记一条。版本 `2.8.4-cw.3`。

**Web** (`web/src/features/background/`)
- `state.ts` — store + `installBackground()` + `openBackground()` + `registerPage('background')`。
- `model.ts` — 纯：计数、胶囊文字、状态文字、颜色变量、事件文字。
- `office-layout.ts` — 纯：办公室排位。
- `Character.tsx`、`Office.tsx`、`CommandGraph.tsx`、`AgentCards.tsx`、`EventFeed.tsx`、`AgentDrawer.tsx`、`BackgroundPage.tsx`、`BackgroundSide.tsx`、`BackgroundPill.tsx`、`WorkflowLive.tsx`。
- `web/src/styles/background.css`（`main.tsx` 里排在 `rail.css` 之后）。
- 改：`sections/pages.ts` + `sections/index.ts`、`rail/rail-model.ts`、`app/App.tsx`（侧栏列）、`workbench/Workbench.tsx`（页）、`sidebar/Sidebar.tsx` + `entries.ts`（手机抽屉一行）、`chat/tools/AgentTool.tsx`（WorkflowBody）、`panels/TasksPanel.tsx`、`composer/Composer.tsx`（胶囊）、`store/index.ts` 的 `interrupt`（toast）、`tokens.css`（`--agent-1..10`）、`ui/icon-map.json`、`ui/heading-text.ts`（+ 重新裁字体）。

---

### Task 1: 服务端类型 + 登记表（纯）

**Files:** Create `server/src/background/types.ts`, `server/src/background/registry.ts`, `server/src/background/registry.test.ts`; Modify `server/src/protocol.ts`（`export * from './background/types.js'`，`ClientRequest` / `ServerEvent` 加上 Bg 的联合）。

**Produces:**
```ts
export type BgKind = 'workflow' | 'agent' | 'shell' | 'other';
export type BgStatus = 'running' | 'completed' | 'failed' | 'stopped';
export type BgAgentState = 'queued' | 'running' | 'done' | 'failed';
export interface BgAgent { key: string; color: number; label: string; phase?: number; phaseTitle?: string; agentId?: string; agentType?: string; model?: string; state: BgAgentState; queuedAt?: number; startedAt?: number; endedAt?: number; tokens?: number; toolCalls?: number; lastTool?: string; lastSummary?: string; cached?: boolean; error?: string; attempt?: number; beats: number[] }
export interface BgPhase { index: number; title: string }
export interface BgTask { id: string; toolUseId?: string; kind: BgKind; type?: string; description: string; name?: string; status: BgStatus; backgrounded?: boolean; startedAt: number; endedAt?: number; summary?: string; lastTool?: string; tokens?: number; toolUses?: number; phases?: BgPhase[]; agents: BgAgent[]; reason?: string; runId?: string }
export interface BgEvent { at: number; taskId: string; agent?: string; who: string; color?: number; text: string; tone: 'start' | 'tool' | 'done' | 'error' | 'stop' }
export interface BgSession { sessionId: string; updatedAt: number; tasks: BgTask[]; events: BgEvent[] }
export interface BgRunSummary { runId: string; name: string; status: string; startedAt: number; durationMs?: number; agentCount: number; tokens?: number; taskId?: string }
export type BackgroundRequest =
  | { kind: 'background.list' }
  | { kind: 'background.history'; sessionId: string }
  | { kind: 'background.run'; sessionId: string; runId: string }
  | { kind: 'background.transcript'; sessionId: string; agentId: string };
export type BackgroundEvent = { kind: 'background.changed'; session: BgSession };
// registry.ts
export interface BgState extends BgSession { nextColor: number; allEvents: BgEvent[] }
export function createBgState(sessionId: string): BgState;
export function applyBg(s: BgState, m: any, now: number): boolean;   // true = changed
export function endRunning(s: BgState, reason: string, now: number): boolean;
export function snapshotBg(s: BgState): BgSession;                   // events: last 50, newest last
export const AGENT_COLORS = 10, MAX_EVENTS = 200, SNAPSHOT_EVENTS = 50, MAX_BEATS = 24;
```

规则（测试逐条覆盖）：
- `task_started`：`ambient` / `skip_transcript` 的忽略。`task_type` `local_workflow` → workflow（`name = workflow_name`），`local_agent` 或带 `subagent_type` → agent（建一个 `BgAgent`：`key = task_id`、`agentId = task_id`、`label = description`、`agentType = subagent_type`、`state:'running'`），`local_bash` → shell，其它 → other。事件「开始：<description>」（workflow 写「工作流 <name> 开始」）。
- `task_progress`：更新 `tokens / toolUses / lastTool / summary`；agent 任务同步到它那个 `BgAgent`（`toolCalls` 变多时往 `beats` 推 `now`，`summary` 或 `last_tool_name` 变了出一条 tool 事件，文字 = summary ?? 工具名）。带 `workflow_progress`：`workflow_phase` → `phases`（按 index 去重）；`workflow_agent` 按 `index` 合并成 `BgAgent`（`key = 'w' + index`；状态映射 `start`→ 没有 `startedAt` 是 queued 否则 running、`progress`→running、`done`→done、`error`→failed；新出现的子代理按顺序拿颜色 `nextColor++ % 10 + 1`）；状态变化 / `lastToolSummary` 变化出事件（开始 / 完成（`cached` 写「用了上次的结果」）/ 失败：<error> / tool）。
- `task_updated`：`patch.status` 映射（killed → stopped，paused 不变），`description`、`is_backgrounded`。
- `task_notification`：状态、`endedAt`、`summary`；workflow 的仍在 queued/running 的子代理按任务结局收尾（completed → done，否则 failed + 「工作流停了」）；事件「完成 / 失败 / 已停止」。
- `endRunning`：所有 running 的任务 → stopped、`reason`，子代理同上；每个任务一条 stop 事件。
- `allEvents` 只留最近 200 条；同一子代理同样的 tool 文字不重复出。

- [ ] Step 1: 写 `registry.test.ts`（官方形状的序列：工作流 2 个阶段 5 个子代理从排队到完成；local_agent 前台；local_bash；ambient 忽略；进度节流里的重复 summary 不出重复事件；`endRunning`；快照只带 50 条事件；颜色按出现顺序循环）。
- [ ] Step 2: `npx vitest run src/background/registry.test.ts`（在 `server/` 下）→ FAIL。
- [ ] Step 3: 实现 `types.ts`、`registry.ts`，`protocol.ts` 接上。
- [ ] Step 4: 测试通过；`npm run typecheck -w server`。
- [ ] Step 5: Commit `feat(server): background registry — tasks, workflow agents and events from the SDK stream`。

### Task 2: 磁盘（跑完的工作流 + 子代理 transcript）

**Files:** Create `server/src/background/disk.ts`, `server/src/background/disk.test.ts`, fixture `server/src/background/__fixtures__/wf_test.json`。

**Produces:**
```ts
export function sessionDirOf(sessionId: string): string | null;   // findClaudeTranscript(sid) 去掉 .jsonl
export async function listRuns(dir: string): Promise<BgRunSummary[]>;          // workflows/*.json，新的在前，最多 50
export async function readRun(dir: string, runId: string): Promise<BgTask | null>; // runId 只收 /^wf_[\w-]+$/
export function taskFromRun(j: any): BgTask;                                    // 复用 registry 的 workflow_agent 合并
export async function readAgentTranscript(dir: string, agentId: string): Promise<unknown[]>; // agentId 只收 /^a?[0-9a-f]{6,}$/i
```
- `readAgentTranscript`：先找 `subagents/agent-<id>.jsonl`，再找 `subagents/workflows/*/agent-<id>.jsonl`；每行 JSON，留 `type` 为 user / assistant 的，形状 `{type, uuid, session_id, message, parent_tool_use_id: null, timestamp}`（和 `getSubagentMessages` 一样，web 的 `applyTranscript` 认）。

- [ ] Step 1: 测试（临时目录里放 fixture JSON 和两份 agent jsonl：列表、读一份、非法 runId / agentId 被拒、找不到返回空）。
- [ ] Step 2: FAIL → Step 3: 实现 → Step 4: PASS → Step 5: Commit `feat(server): finished workflows and subagent transcripts from disk`。

### Task 3: `BackgroundService` + hub + runner + pool + 联邦

**Files:** Create `server/src/background/service.ts`, `service.test.ts`, `handlers.ts`; Modify `server/src/ws/hub.ts`, `server/src/index.ts`, `server/src/runtime/session-runner.ts`, `server/src/runtime/pool.ts`, `server/src/federation/rewrite.ts` (+ `rewrite.test.ts` 的逐个列举)。

**Produces:**
```ts
export class BackgroundService extends EventEmitter {   // 'changed' (session: BgSession)
  constructor(o: { pool: { on(e: 'message', f: (sid: string, m: unknown) => void): unknown; on(e: 'state', f: (sid: string, st: string) => void): unknown }; now?: () => number; flushMs?: number });
  list(): BgSession[];                              // 有任务的对话；全部结束超过 24 h 的丢掉；最多 50 个
  history(sessionId: string): Promise<BgRunSummary[]>;
  run(sessionId: string, runId: string): Promise<BgTask | null>;
  transcript(sessionId: string, agentId: string): Promise<unknown[]>;
}
export function isBackgroundRequest(req: { kind: string }): req is BackgroundRequest;
export function handleBackground(s: BackgroundService, req: BackgroundRequest): Promise<unknown>;
```
- pool `state`：`closed` / `error` / `starting` → `endRunning(s, '进程结束了')`。
- 推送：每个对话变了以后 `flushMs`（默认 1000）内最多一次 `changed`（第一次立刻，之后攒着）。
- runner：`options.perTaskStopAffordance = true`；`liveBackground` = 最近一次 `background_tasks_changed` 的非 ambient 数（`task_started` 后台的 +1、`task_notification` −1 兜底）；`hasBackgroundWork(): boolean`。
- pool `reap()`：`r instanceof SessionRunner && r.hasBackgroundWork()` 跳过。
- 联邦：`background.list` LOCAL；`background.history / run / transcript` FORWARD。

- [ ] Step 1: `service.test.ts`（假 pool 发消息 → 节流的 `changed`；`closed` → 任务停；`list` 过滤）+ pool 回收测试（有后台任务的不回收）。
- [ ] Step 2: FAIL → Step 3: 实现与接线 → Step 4: `npm test -w server`、`npm run typecheck`。
- [ ] Step 5: Commit `feat(server): 后台 service — background.* requests, pushes, stop only the turn`。

### Task 4: 引擎发 `workflow_progress`（fork，子代理做）

**Files:** fork 里的 `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts`、`src/workflow/**`、`src/utils/task/sdkProgress.ts`、SDK 初始化处理（`perTaskStopAffordance`）、`CLAUDE-WEB.md`、`package.json`（`2.8.4-cw.3`）。

- [ ] 工作流开始发 `task_started {task_type:'local_workflow', workflow_name, description, tool_use_id}`；每次子代理事件后发 `task_progress {workflow_progress:[...phases, ...agents]}`（官方形状，见设计 §1；状态变化立刻发，只有进度时 ≥ 1 s 一次）；结束发 `task_notification`。
- [ ] `perTaskStopAffordance:true` 时打断不杀后台任务（和官方一样）；没声明时照旧。
- [ ] 构建 `bun run build:vite`、构建后检查脚本通过、`npm pack --ignore-scripts`；本地 `CLAUDE_CODE_SKIP_CHROME_MCP_SETUP=1 npm install "claude-web-engine@file:../claude-web-engine/claude-web-engine-2.8.4-cw.3.tgz"` 联调。
- [ ] fork 提交；发布 Release 前先问用户。

### Task 5: web store + 纯模型

**Files:** Create `web/src/features/background/state.ts`, `model.ts`, `model.test.ts`; Modify `web/src/features/sections/pages.ts`（`Section` 加 `'background'`）、`sections/index.ts`（import state）、`app/App.tsx`（`installBackground()`）。

**Produces:**
```ts
// model.ts
export const BG_TITLE = '后台';
export function liveCounts(s: BgSession | undefined): { tasks: number; workflows: number; agents: number; shells: number; running: number };
export function pillText(s: BgSession | undefined): string | null;   // null = 不显示；「后台 · 1 个工作流 · 2 个在跑」
export function agentStateText(a: BgAgent): string;                 // 排队 / 在跑 / 完成 / 用了上次的结果 / 失败
export function taskTitle(t: BgTask): string;                       // workflow: name ?? description
export const agentColor = (n: number) => `var(--agent-${((n - 1) % 10) + 1})`;
export function sortSessions(list: BgSession[]): BgSession[];       // 有在跑的在前，各自按 updatedAt 新的在前
export function stopNote(s: BgSession | undefined): string | null;  // 「后台还有 N 个任务在跑，在「后台」里停」
// state.ts
export const useBackground: UseBoundStore<StoreApi<{ open: boolean; sessions: Record<string, BgSession>; selected?: string; view?: { runId?: string; taskId?: string }; drawer?: { sessionId: string; agentKey: string; taskId: string; runId?: string }; seen: boolean }>>;
export function openBackground(sessionId?: string, taskId?: string): boolean;
export function closeBackground(): void;
export function installBackground(): () => void;   // ws 连上 / 重连时 background.list；收 background.changed
```

- [ ] TDD `model.test.ts` → 实现 → `npm test -w web` 相关文件 → Commit。

### Task 6: 办公室 / 角色 / 关系图 / 卡片 / 事件流（视觉组件，子代理做）

**Files:** Create `web/src/features/background/office-layout.ts`（+ test）、`Character.tsx`、`Office.tsx`、`CommandGraph.tsx`、`AgentCards.tsx`、`EventFeed.tsx`、`web/src/styles/background.css`；Modify `web/src/tokens.css`（每个主题块加 `--agent-1..10`，`web/src/ui/contrast.test.ts` 加「对 `--bg` 和 `--bg-1` ≥ 3:1」）、`web/src/main.tsx`（import css）。

**Produces:**
```ts
export interface DeskSpot { key: string; taskId: string; x: number; y: number; row: number; kind: 'agent' | 'shell' }
export interface OfficeLayout { width: number; height: number; screen: { x: number; y: number; w: number; h: number }; door: { x: number; y: number }; rows: { label: string; y: number; x: number }[]; desks: DeskSpot[]; overflow: { row: number; more: number; x: number; y: number }[] }
export function layoutOffice(tasks: BgTask[], o?: { perRow?: number; maxPerPhase?: number }): OfficeLayout;
// components (props)
<Office session={BgSession} task?: string onPick(agentKey, taskId) />
<CommandGraph session={BgSession} compact?: boolean onPick(...) />
<AgentCards session={BgSession} onPick(...) />
<EventFeed events={BgEvent[]} onPick(...) />
<Character color={number} type?: string state={BgAgentState} size?: number />
```
排位规则：每个工作流阶段一排（`phaseTitle`），local_agent 子代理一排「子代理」，shell 在右后角的机器位；每排最多 `perRow`（默认 6）个、一个阶段最多 `maxPerPhase`（默认 24）个，多出来记 `overflow`；排队的角色站在门口（Office 自己按 state 决定角色在工位还是门口）。

- [ ] TDD `office-layout.test.ts` → 组件 → `npm test -w web`、`npm run typecheck` → Commit。

### Task 7: 页面 + 接线

**Files:** Create `BackgroundPage.tsx`、`BackgroundSide.tsx`、`AgentDrawer.tsx`、`BackgroundPill.tsx`、`WorkflowLive.tsx`；Modify `rail/rail-model.ts`（`RAIL_SECTIONS` 在对话后插 `{ id:'background', label:'后台', icon:'office', tip:'后台：在跑的子代理和工作流' }`）、`rail/Rail.tsx`（`OPEN.background`）、`app/App.tsx`（`SidebarColumn` 的 `background` 分支）、`workbench/Workbench.tsx`（页）、`sidebar/Sidebar.tsx` + `sidebar/entries.ts`（手机抽屉 `background` 一行）、`chat/tools/AgentTool.tsx`（`WorkflowBody` 顶上 `WorkflowLive`，脚本折叠）、`panels/TasksPanel.tsx`（缩小的指挥台 + 列表代替调用树）、`composer/Composer.tsx`（胶囊）、`store/index.ts` `interrupt`（`stopNote` toast）、`ui/icon-map.json`（`office` → lucide 的 `radar`，跑 `node scripts/gen-icons.mjs`）、`ui/heading-text.ts`（`BG_TITLE`）+ `npx tsx scripts/subset-heading-font.ts`。

- [ ] 页：标题行、卡片、办公室 + 关系图 / 事件流、右侧抽屉（`background.transcript` → `applyTranscript` → `ItemList`）、历史（`background.history` / `background.run`）、停止（`session.stopTask`）。
- [ ] 胶囊、Workflow 卡片、任务面板、停止 toast。
- [ ] `npm test -w web`（含 wording / selectors / heading-text / icons / contrast）、`npm run typecheck`、`npm run build:all` → Commit。

### Task 8: e2e + ui-smoke + 文档

- [ ] `server/ws-phase25.mjs`（真引擎 + 假上游：主对话回 Workflow 工具调用，子代理回固定文字；断言 `background.changed` 有阶段 / 子代理、走完、`background.transcript` 有内容、`session.interrupt` 后工作流还在、`session.stopTask` 停得掉），加进 `scripts/e2e.mjs` 默认列表。
- [ ] ui-smoke「background」一段（注入快照：`window.__cwBackground.inject(session)`；页面、角色、抽屉、胶囊、Workflow 卡片、任务面板、手机宽度）。
- [ ] 真机：官方二进制 + 供应商跑两个 haiku 子代理的小工作流。
- [ ] `CLAUDE.md` 加「后台」一节；设计文档末尾写实施记录；`CHANGELOG.md`「未发布」。
