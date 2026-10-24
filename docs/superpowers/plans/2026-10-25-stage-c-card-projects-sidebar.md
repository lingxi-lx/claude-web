# 阶段 C：问答卡、项目多文件夹、侧栏显示菜单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AskUserQuestion 从输入框上方移到对话里（这一轮末尾、计划卡上面），一页一题、能翻页、键盘可用，答案格式不变；一个项目可以有多个文件夹，新对话带 `additionalDirectories`，文件 / 搜索 / Git / @文件 列出全部文件夹；侧栏「项目」标题行只留一个「显示」按钮，菜单里有分组、排序、显示、自建分区，并收进原来漏斗里的筛选。

**Architecture:** 纯逻辑先写、单独测：`web/src/features/chat/ask-card.ts`（答案拼装、翻页、按键）、`server/src/meta/workspace-folders.ts`（folders 规整、项目判定）、`web/src/features/sidebar/view.ts`（读设置、排序、分组、自建分区）。然后服务端：`Workspace.folders`、`workspaces.update`、pool 把项目的额外文件夹交给 `SessionRunner`（作为 SDK 的 `additionalDirectories`）和 Codex 驱动。最后界面：`AskCard`（ChatView）、项目编辑对话框、多文件夹分组（`RootGroups`）、`ViewMenu` 替换 `FilterMenu`。

**Tech Stack:** React + zustand、vitest、`@anthropic-ai/claude-agent-sdk` 的 `Options.additionalDirectories`、Codex app-server JSON-RPC、ui-smoke（Electron）、e2e（`server/ws-phaseN.mjs`，用假上游）。

Spec：`docs/superpowers/specs/2026-10-24-desktop-parity-design.md` 的「C」一节（C1 / C2 / C3），以及开头的「实现方式与顺序」和「跨期规则」。

## Global Constraints

- 用户看得见的字全走 `tr('中文')`，英文用仓库的 i18n 工具加进目录（见 `docs/notes/i18n.md`），加完跑 `node scripts/i18n/extract.mjs --check`。不出现：会话 / 引擎 / 窗格 / 停靠 / effort / ultracode / ACP（`wording.test.ts` 会拦）；叫「对话」。
- 新 UI 状态存 meta.json（`settings.set` / store 的 `setSetting`），**不用 localStorage**。本阶段新键：`ui.sidebar.view`（`{ groupBy, sortBy, show }`）、`ui.sidebar.sections`（`{ id, name, ids }[]`）。
- zustand 选择器返回稳定引用：不要 `?? []`、`.filter()`、`({…})`；要派生就在组件里 `useMemo`。`store/selectors.test.ts` 会查。
- 文本框和卡片的 Enter / Escape 先问 `ui/ime.ts` 的 `imeComposing()`。
- 菜单用 `useAnchoredMenu`（`sidebar/menus.tsx` 的 `Menu`）/ `composer/Popover` / `useDropdown`，别自己挂 window 监听。全局同时只有一个锚定菜单，所以不嵌套子菜单：「分组方式 ›」这类行在同一个菜单里原地展开。
- 原生对话框用 `web/src/ui/dialog.tsx` 的 `dlg.*`（confirm / prompt）。
- 新加带 `sessionId` 的请求要进 `server/src/federation/rewrite.ts` 路由表。本阶段新加的 `workspaces.update` 不带 sessionId，不进表；问答卡沿用已经路由的 `permission.respond`。
- 子进程 spawn 显式写 `windowsHide: true`。
- 绝不 `git add -A` / `git add .`（`site/package.json`、`site/package-lock.json` 是用户没提交的改动），每次只 add 列出的路径。
- 测试命令前加：`env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_WEB_DIST -u ANTHROPIC_DEFAULT_OPUS_MODEL -u ANTHROPIC_DEFAULT_SONNET_MODEL -u ANTHROPIC_DEFAULT_HAIKU_MODEL -u CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION -u CLAUDE_WEB_THINKING_DISPLAY -u CLAUDE_WEB_CONTEXT_WINDOWS -u CLAUDE_WEB_MODEL_CAPS -u ELECTRON_RUN_AS_NODE -u CLAUDE_CODE_AUTO_COMPACT_WINDOW`（下文写作 `$CLEAN`）。
- Electron 只用临时 `--user-data-dir` + 临时 `HOME` + 临时 `CLAUDE_WEB_DIR` 启动，别碰用户的 `~/.claude-web`，也别用正在跑的已装版的数据目录。
- 停靠面板 / 右侧面板 / 分区页不卸载，只 `hidden`。
- 顺序：阶段 B 合并之后才开始 C（spec「上一期没过不开下一期」）。B 期间 `server/src/protocol.ts`、`server/src/web/*`、`web/src/features/browser/*` 有人在改。Task 2 要动 `protocol.ts`，动手前先 `git log -1 -- server/src/protocol.ts`，确认 B 已经提交。

现有锚点（写计划时核对过）：

- 问答卡：`web/src/features/chat/PermissionCards.tsx:186-256` `AskQuestion`（`sel` / `other` 状态；`submit` 在 :200-209 拼 `answers[q.question] = [...chosen, other].join(', ')`，然后 `send({ behavior: 'allow', updatedInput: { ...p.input, answers } })`；「跳过」= `denyResponse`，:211；`preview` 现在是选项里的 `<pre>`，:239）。`usePrimary` :30-39，`useRespond` :42-52，`CardProps` :54，`PermissionDock` :278-296（:294 按 `kind === 'ask'` 渲染 `AskQuestion`）。
- `web/src/features/chat/permission-dock.ts`：`dockKind` :14，`dockDecide` :48，`DENY_DEFAULT` ask = `tr('用户取消了提问')`，`denyResponse`，`waitingToolIds`（文件末尾）。测试 `permission-dock.test.ts:35-36` 断言空 Enter 在问答卡上 → `primary`。
- 注册表 `web/src/features/chat/tools/registry.tsx:58` `AskUserQuestion → AskUserBody`；`tools/AgentTool.tsx:105-119` `AskUserBody` 从 `input.answers ?? result.structured.answers` 读答案（历史回放不用改）。
- 回合：`web/src/features/chat/ChatView.tsx` `TurnView` :520-605；`TurnList` :610-625（:623 把 `PlanDock` 画在所有回合后面）；`planShown` :636；`PlanDock` :643；`ChatView` 里 `pane = usePaneCtx()` :665，`pending` :666，`waitingToolIds` :671，`<TurnList …>` :768。
- 输入框：`web/src/features/composer/Composer.tsx` `docked = … active.pending[0]` :392，`dockScope` :409，`dockDecide` / `runDockPrimary` :697-699，`<PermissionDock …>` / `<RunCard>` :1119-1121，`atRoot` :362，`fs.findFiles` :371。
- 侧栏状态：`web/src/features/sidebar/status.ts:22` `ASK_TOOLS`，:30 `{ kind: 'ask', label: tr('提问') }`；`attention.tsx:25`（「需要你」）。
- Workspace：`server/src/meta/store.ts:12` `Workspace { id, path, name, addedAt, order }`，`workspaces()` :97，`addWorkspace` :100，`removeWorkspace` :111，`renameWorkspace` :115，`reorderWorkspaces` :119；`server/src/protocol.ts:375` 同名类型，:540-544 `workspaces.*` 请求，:504 `fs.findFiles`，`SessionSummary` :45（`createdAt?` :50）；`server/src/ws/hub.ts:535-547` `workspaces.*` 分支，:930 `fs.findFiles`（`pathAllowed` 检查），:619 `settings.set`。
- runner：`server/src/runtime/session-runner.ts` 构造函数 `(params, provider, opts: { thinkingLanguage?, account? })` 在 :218 附近；`const options: Options = { cwd: this.cwd, …, ...extra }` 在 :532-578（现在没有 `additionalDirectories`）。`pool.ts` `open()` :127，`new SessionRunner(params, sp, { thinkingLanguage, ...account })` :174，其它 agent 分支（Codex 驱动）在后面 :185-205。
- Codex：`server/src/agents/codex-driver.ts` 构造函数 :61（`hooks: { beforeResume?, onModels? }`），`policy()` :87，`thread/resume` :127，`thread/start` :136。
- UNC 信任根：`server/src/files/service.ts:92` `workspaceRoots(workspaces)` 已经会读 `folders`（字符串或 `{ path }`）；`server/src/index.ts:326` `new FilesService(() => workspaceRoots(meta.workspaces()))`。所以 `folders` 存进 meta 后自动成为信任根，只需要测试锁住。
- web 路径：`web/src/features/paths.ts:30` `samePath`，:37 `projectFor(cwd, workspaces)`（只认主文件夹相等）。
- 面板：`workbench/FilesView.tsx:77/79`（`FileTree root={cwd}` / `SearchView root={cwd}`），`workbench/tiles/ChatTile.tsx:280-282`（git / files / search），`workbench/ReviewView.tsx:414`（`GitView cwd={cwd}`）。
- 侧栏：`sidebar/Sidebar.tsx` 分组 :129-144，`foldDefault` :154，`renderedRows` :172-179，漏斗按钮 + `FilterMenu` :293-307，项目循环 :316-362，文件夹区 :364-389，其它电脑 :390-409；`sidebar/filter-menu.tsx`（整个文件 87 行）；`sidebar/filter.ts:43` `filterSessions`；`sidebar/groups.tsx` `ProjectMenu` :16-43（重命名 :36，移除 :40），`PAGE_FIRST = 5` :45，`Group` :86-117；`sidebar/rows.tsx:169-170` 行可拖（`MIME_SESSION`，`workbench/dnd.ts:2`）；`sidebar/entries.ts` `PROJECTS_HEAD = ['filter','add-project']`、`FILTER = ['query','source','machine','archived','select','library']`、`PLACES` / `LEGACY` / `ADDED`；`entries.test.ts`。
- store：`web/src/store/index.ts` `showArchived` :125/:446，`sourceFilter` :173/:978，`setSetting` :473，`loadMeta` :488-508；另外两处改 `showArchived` 的地方：`features/palette/CommandPalette.tsx:73`、`features/home/HomeLists.tsx:61`（:62 的「查看全部」= `paletteOpen: true`）。
- 外框控件计数：`docs/notes/ui-redesign-0-1.md:23` 记的是 16（终审探针 `countCtl` 的口径，没有自动化断言）。漏斗和 + 静止时透明，ui-smoke 在 `scripts/ui-smoke.cjs:2339` 断言。ui-smoke 侧栏段 :2255-2400，用到 `[data-id="filter"]` 的行：:2271、:2290、:2336、:2339、:2369、:2392、:2801、:2811。
- e2e：`scripts/e2e.mjs:13` 期号表到 32；`server/ws-phase32.mjs` 是「真引擎 + 假 Anthropic 上游」的模板。

---

### Task 1: 问答卡的纯逻辑

**Files:**
- Create: `web/src/features/chat/ask-card.ts`
- Create: `web/src/features/chat/ask-card.test.ts`
- Modify: `web/src/features/chat/permission-dock.ts`（在 `dockKind` 下面，:14 之后，加 `splitPending`）
- Modify: `web/src/features/chat/permission-dock.test.ts`（加一个 `describe('splitPending')`）

**Interfaces:**
- Consumes: `PermissionRequestEvent`（`@shared`）、`tr`（`@/i18n`）、`dockKind`。
- Produces:
  - `interface AskOption { label: string; description?: string; preview?: string }`
  - `interface AskQ { question: string; header?: string; options: AskOption[]; multiSelect: boolean }`
  - `interface AskDraft { picked: string[]; otherOn: boolean; other: string; skipped: boolean }`
  - `const EMPTY_DRAFT: AskDraft`，`const OTHER = '\u0000other'`，`skippedAnswer(): string`（= `tr('（用户跳过）')`）
  - `askQuestions(input: unknown): AskQ[]`
  - `pick(q: AskQ, d: AskDraft, label: string): AskDraft`，`skip(d: AskDraft): AskDraft`
  - `answerOf(q: AskQ, d: AskDraft | undefined): string | null`
  - `type Assembled = { kind: 'allow'; answers: Record<string, string> } | { kind: 'deny' } | { kind: 'incomplete'; first: number }`；`assemble(qs: AskQ[], drafts: readonly (AskDraft | undefined)[]): Assembled`
  - `type Step = { t: 'goto'; index: number } | { t: 'send'; result: Exclude<Assembled, { kind: 'incomplete' }> } | { t: 'stay' }`；`step(qs: AskQ[], drafts: readonly (AskDraft | undefined)[], cur: number): Step`
  - `type AskKeyAct = { t: 'move'; by: 1 | -1 } | { t: 'pick'; index: number } | { t: 'next' } | null`；`askKey(k: { key: string; ctrl?: boolean; meta?: boolean; shift?: boolean; composing?: boolean; inText?: boolean }, optionCount: number): AskKeyAct`
  - `permission-dock.ts`：`splitPending<P extends { toolName: string }>(pending: readonly P[]): { dock?: P; ask?: P }`

- [ ] **Step 1: 写失败测试** `web/src/features/chat/ask-card.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { askQuestions, assemble, askKey, answerOf, EMPTY_DRAFT, OTHER, pick, skip, skippedAnswer, step, type AskQ } from './ask-card';

const single: AskQ = { question: '用哪个库？', header: '库', options: [{ label: 'zod' }, { label: 'yup', description: '老一点' }], multiSelect: false };
const multi: AskQ = { question: '要哪些检查？', options: [{ label: 'lint' }, { label: 'test' }, { label: 'build' }], multiSelect: true };

describe('askQuestions', () => {
  it('keeps well-formed questions, drops junk, defaults multiSelect to false', () => {
    const qs = askQuestions({ questions: [{ question: 'A?', options: [{ label: 'x', preview: 'p' }, { nope: 1 }] }, { header: 'no question' }, null] });
    expect(qs).toEqual([{ question: 'A?', header: undefined, options: [{ label: 'x', description: undefined, preview: 'p' }], multiSelect: false }]);
    expect(askQuestions(undefined)).toEqual([]);
  });
});

describe('pick / answerOf', () => {
  it('single choice: one label; picking another replaces it; 其它 clears the pick', () => {
    let d = pick(single, EMPTY_DRAFT, 'zod');
    d = pick(single, d, 'yup');
    expect(answerOf(single, d)).toBe('yup');
    d = pick(single, d, OTHER);
    expect(d.picked).toEqual([]);
    expect(answerOf(single, d)).toBeNull(); // 其它 on, nothing typed yet
    expect(answerOf(single, { ...d, other: '  valibot ' })).toBe('valibot');
  });
  it('multi choice: toggles, joined in option order with ", ", 其它 last', () => {
    let d = pick(multi, EMPTY_DRAFT, 'build');
    d = pick(multi, d, 'lint');
    d = pick(multi, d, OTHER);
    expect(answerOf(multi, { ...d, other: 'e2e' })).toBe('lint, build, e2e');
    d = pick(multi, d, 'lint');
    expect(answerOf(multi, { ...d, other: 'e2e' })).toBe('build, e2e');
  });
  it('nothing picked → null; skipped → 「（用户跳过）」', () => {
    expect(answerOf(single, EMPTY_DRAFT)).toBeNull();
    expect(answerOf(single, undefined)).toBeNull();
    expect(answerOf(single, skip(EMPTY_DRAFT))).toBe(skippedAnswer());
  });
  it('picking after a skip un-skips', () => {
    expect(pick(single, skip(EMPTY_DRAFT), 'zod').skipped).toBe(false);
  });
});

describe('assemble', () => {
  it('every question answered → allow with question → answer', () => {
    expect(assemble([single, multi], [pick(single, EMPTY_DRAFT, 'zod'), pick(multi, EMPTY_DRAFT, 'test')])).toEqual({ kind: 'allow', answers: { '用哪个库？': 'zod', '要哪些检查？': 'test' } });
  });
  it('one skipped, one answered → allow, the skipped one says so', () => {
    const r = assemble([single, multi], [skip(EMPTY_DRAFT), pick(multi, EMPTY_DRAFT, 'lint')]);
    expect(r).toEqual({ kind: 'allow', answers: { '用哪个库？': skippedAnswer(), '要哪些检查？': 'lint' } });
  });
  it('all skipped → deny (the old 跳过)', () => {
    expect(assemble([single, multi], [skip(EMPTY_DRAFT), skip(EMPTY_DRAFT)])).toEqual({ kind: 'deny' });
  });
  it('an unanswered question → incomplete at the first one', () => {
    expect(assemble([single, multi], [pick(single, EMPTY_DRAFT, 'zod'), undefined])).toEqual({ kind: 'incomplete', first: 1 });
  });
});

describe('step (下一题 / 提交)', () => {
  it('stays on an unanswered page, goes to the next one when answered, sends on the last', () => {
    const qs = [single, multi];
    expect(step(qs, [], 0)).toEqual({ t: 'stay' });
    expect(step(qs, [pick(single, EMPTY_DRAFT, 'zod')], 0)).toEqual({ t: 'goto', index: 1 });
    expect(step(qs, [pick(single, EMPTY_DRAFT, 'zod'), pick(multi, EMPTY_DRAFT, 'lint')], 1)).toEqual({ t: 'send', result: { kind: 'allow', answers: { '用哪个库？': 'zod', '要哪些检查？': 'lint' } } });
  });
  it('the last page answered but an earlier one left open (paged back and cleared) → back to it', () => {
    const d0 = pick(single, pick(single, EMPTY_DRAFT, OTHER), OTHER); // 其它 with no text
    expect(step([single, multi], [d0, pick(multi, EMPTY_DRAFT, 'lint')], 1)).toEqual({ t: 'stay' }.t === 'stay' && answerOf(single, d0) === null ? { t: 'goto', index: 0 } : { t: 'stay' });
  });
  it('all skipped on the last page → send deny', () => {
    expect(step([single], [skip(EMPTY_DRAFT)], 0)).toEqual({ t: 'send', result: { kind: 'deny' } });
  });
});

describe('askKey', () => {
  it('↑↓ move, 1–9 pick (index = option count is 其它), Enter / Ctrl+Enter next', () => {
    expect(askKey({ key: 'ArrowDown' }, 2)).toEqual({ t: 'move', by: 1 });
    expect(askKey({ key: 'ArrowUp' }, 2)).toEqual({ t: 'move', by: -1 });
    expect(askKey({ key: '1' }, 2)).toEqual({ t: 'pick', index: 0 });
    expect(askKey({ key: '3' }, 2)).toEqual({ t: 'pick', index: 2 });
    expect(askKey({ key: '4' }, 2)).toBeNull();
    expect(askKey({ key: 'Enter' }, 2)).toEqual({ t: 'next' });
    expect(askKey({ key: 'Enter', ctrl: true }, 2)).toEqual({ t: 'next' });
    expect(askKey({ key: 'Enter', shift: true }, 2)).toBeNull();
  });
  it('nothing while the IME composes; in the 其它 box only Enter counts', () => {
    expect(askKey({ key: 'Enter', composing: true }, 2)).toBeNull();
    expect(askKey({ key: '1', inText: true }, 2)).toBeNull();
    expect(askKey({ key: 'ArrowDown', inText: true }, 2)).toBeNull();
    expect(askKey({ key: 'Enter', inText: true }, 2)).toEqual({ t: 'next' });
  });
});
```

（「翻回去清掉了前面的答案」那条用例写简单些：直接断言 `step([single, multi], [{ ...EMPTY_DRAFT, otherOn: true }, pick(multi, EMPTY_DRAFT, 'lint')], 1)` 等于 `{ t: 'goto', index: 0 }`，上面三元式的写法不要照抄。）

在 `permission-dock.test.ts` 末尾加：

```ts
describe('splitPending: the question goes in the conversation, everything else docks', () => {
  it('splits by kind and keeps the first of each', () => {
    const a = req('AskUserQuestion', { questions: [] });
    const b = req('Bash', { command: 'ls' });
    const c = req('ExitPlanMode', { plan: 'x' });
    expect(splitPending([a, b, c])).toEqual({ dock: b, ask: a });
    expect(splitPending([c])).toEqual({ dock: c, ask: undefined });
    expect(splitPending([])).toEqual({ dock: undefined, ask: undefined });
  });
});
```
（把 `splitPending` 加进文件第 4 行的 import。）

- [ ] **Step 2: 确认失败** — `cd web && $CLEAN npx vitest run src/features/chat/ask-card.test.ts src/features/chat/permission-dock.test.ts`（期望：找不到模块 / `splitPending` 不是函数）

- [ ] **Step 3: 实现** `web/src/features/chat/ask-card.ts`

```ts
// The question card in the conversation (stage C1): one question a page, answers kept while paging, the answer
// format the CLI expects unchanged (`updatedInput.answers`: question → the chosen labels joined with ", ").
// Pure; the card is AskCard.tsx.
import { tr } from '@/i18n';

export interface AskOption { label: string; description?: string; preview?: string }
export interface AskQ { question: string; header?: string; options: AskOption[]; multiSelect: boolean }
export interface AskDraft { picked: string[]; otherOn: boolean; other: string; skipped: boolean }
export const EMPTY_DRAFT: AskDraft = { picked: [], otherOn: false, other: '', skipped: false };
/** the 其它 row's key (never a real label) */
export const OTHER = '\u0000other';
export const skippedAnswer = () => tr('（用户跳过）');

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export function askQuestions(input: unknown): AskQ[] {
  const qs = (input as { questions?: unknown } | null | undefined)?.questions;
  if (!Array.isArray(qs)) return [];
  return qs
    .filter((q): q is Record<string, any> => !!q && typeof q === 'object' && typeof q.question === 'string')
    .map((q) => ({
      question: q.question,
      header: str(q.header),
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o: any) => !!o && typeof o.label === 'string')
        .map((o: any) => ({ label: o.label, description: str(o.description), preview: str(o.preview) })),
      multiSelect: q.multiSelect === true,
    }));
}

export function pick(q: AskQ, d: AskDraft, label: string): AskDraft {
  if (label === OTHER) return q.multiSelect ? { ...d, otherOn: !d.otherOn, skipped: false } : { ...d, picked: [], otherOn: true, skipped: false };
  if (q.multiSelect) return { ...d, picked: d.picked.includes(label) ? d.picked.filter((x) => x !== label) : [...d.picked, label], skipped: false };
  return { ...d, picked: [label], otherOn: false, skipped: false };
}

export const skip = (d: AskDraft): AskDraft => ({ ...d, skipped: true });

export function answerOf(q: AskQ, d: AskDraft | undefined): string | null {
  if (!d) return null;
  if (d.skipped) return skippedAnswer();
  const chosen = q.options.map((o) => o.label).filter((l) => d.picked.includes(l));
  const other = d.otherOn ? d.other.trim() : '';
  if (d.otherOn && !other) return null;
  const all = other ? [...chosen, other] : chosen;
  return all.length ? all.join(', ') : null;
}

export type Assembled = { kind: 'allow'; answers: Record<string, string> } | { kind: 'deny' } | { kind: 'incomplete'; first: number };

export function assemble(qs: AskQ[], drafts: readonly (AskDraft | undefined)[]): Assembled {
  if (qs.length > 0 && qs.every((_, i) => drafts[i]?.skipped)) return { kind: 'deny' };
  const answers: Record<string, string> = {};
  for (let i = 0; i < qs.length; i++) {
    const a = answerOf(qs[i], drafts[i]);
    if (a === null) return { kind: 'incomplete', first: i };
    answers[qs[i].question] = a;
  }
  return { kind: 'allow', answers };
}

export type Step = { t: 'goto'; index: number } | { t: 'send'; result: Exclude<Assembled, { kind: 'incomplete' }> } | { t: 'stay' };

export function step(qs: AskQ[], drafts: readonly (AskDraft | undefined)[], cur: number): Step {
  if (!qs[cur] || answerOf(qs[cur], drafts[cur]) === null) return { t: 'stay' };
  if (cur < qs.length - 1) return { t: 'goto', index: cur + 1 };
  const r = assemble(qs, drafts);
  return r.kind === 'incomplete' ? { t: 'goto', index: r.first } : { t: 'send', result: r };
}

export type AskKeyAct = { t: 'move'; by: 1 | -1 } | { t: 'pick'; index: number } | { t: 'next' } | null;

export function askKey(k: { key: string; ctrl?: boolean; meta?: boolean; shift?: boolean; composing?: boolean; inText?: boolean }, optionCount: number): AskKeyAct {
  if (k.composing) return null;
  if (k.key === 'Enter') return k.shift && !k.ctrl && !k.meta ? null : { t: 'next' };
  if (k.inText) return null;
  if (k.key === 'ArrowDown') return { t: 'move', by: 1 };
  if (k.key === 'ArrowUp') return { t: 'move', by: -1 };
  if (/^[1-9]$/.test(k.key)) {
    const i = Number(k.key) - 1;
    return i <= optionCount ? { t: 'pick', index: i } : null;
  }
  return null;
}
```

`permission-dock.ts`，在 `dockKind` 之后加：

```ts
/** A conversation's waiting requests as the composer sees them: the question card lives in the conversation (stage C1), the rest dock. */
export function splitPending<P extends { toolName: string }>(pending: readonly P[]): { dock?: P; ask?: P } {
  return { dock: pending.find((p) => dockKind(p) !== 'ask'), ask: pending.find((p) => dockKind(p) === 'ask') };
}
```

- [ ] **Step 4: 跑通过** — 同 Step 2 的命令，再跑 `cd web && $CLEAN npx tsc --noEmit -p .`
- [ ] **Step 5: Commit**
  `git add web/src/features/chat/ask-card.ts web/src/features/chat/ask-card.test.ts web/src/features/chat/permission-dock.ts web/src/features/chat/permission-dock.test.ts`
  `git commit -m "feat(chat): question-card logic — paged answers, skip / other / multi-select, keys; splitPending"`

---

### Task 2: 项目的额外文件夹：存储、规整、`workspaces.update`

**Files:**
- Create: `server/src/meta/workspace-folders.ts`、`server/src/meta/workspace-folders.test.ts`
- Modify: `server/src/meta/store.ts:12`（`Workspace` 加 `folders?: string[]`）、:97 `workspaces()`（返回时补 `folders: normFolders(...)`）、:115 后面加 `updateWorkspace`
- Modify: `server/src/meta/store.test.ts`（旧数据、增删）
- Modify: `server/src/protocol.ts:375`（`Workspace` 加 `folders: string[]`）、:544 后面加 `| { kind: 'workspaces.update'; id: string; name?: string; folders?: string[] }`
- Modify: `server/src/ws/hub.ts:547` 后面（新 case）
- Modify: `server/src/files/service.test.ts:118` 附近（锁住「额外文件夹是 UNC 信任根」）

**Interfaces:**
- Produces:
  - `normFolders(main: string, folders: unknown, o?: { caseless?: boolean; resolve?: (p: string) => string }): string[]`：只留字符串，`resolve`（默认 `path.resolve`），去掉跟 `main` 相同的，按 caseless（默认 `process.platform === 'win32'`）去重，保持原顺序。
  - `sameDir(a: string, b: string, caseless?: boolean): boolean`
  - `projectFolders(cwd: string, workspaces: readonly { path: string; folders?: unknown }[], caseless?: boolean): string[]`：`cwd` 跟某个项目的 `path` 相同（同 web 的 `projectFor`）时返回它规整后的 `folders`，否则 `[]`。
  - `MetaStore.updateWorkspace(id: string, patch: { name?: string; folders?: string[] }): Promise<Workspace | null>`
  - 线上：`Workspace.folders: string[]`（一定有值，读的时候补 `[]`，不写迁移脚本）；请求 `workspaces.update` → 返回更新后的 `Workspace`。
- Consumes: `server/src/files/service.ts:92` `workspaceRoots`（已经会读 `folders`）。

- [ ] **Step 1: 写失败测试**

`server/src/meta/workspace-folders.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { normFolders, projectFolders, sameDir } from './workspace-folders.js';

const id = (p: string) => p;
describe('normFolders', () => {
  it('old data (no folders) → []', () => {
    expect(normFolders('C:\\a', undefined, { resolve: id })).toEqual([]);
    expect(normFolders('C:\\a', 'C:\\b', { resolve: id })).toEqual([]);
  });
  it('drops non-strings, the main folder and duplicates (caseless on Windows), keeps order', () => {
    expect(normFolders('C:\\a', ['C:\\B', 3, null, 'c:\\a\\', 'C:\\b', 'D:\\x'], { caseless: true, resolve: id })).toEqual(['C:\\B', 'D:\\x']);
  });
  it('case matters off Windows', () => {
    expect(normFolders('/a', ['/B', '/b'], { caseless: false, resolve: id })).toEqual(['/B', '/b']);
  });
  it('resolves relative paths with the given resolver', () => {
    expect(normFolders('/a', ['x'], { caseless: false, resolve: (p) => path.posix.resolve('/root', p) })).toEqual(['/root/x']);
  });
});

describe('projectFolders', () => {
  const ws = [{ path: 'C:\\proj', folders: ['D:\\lib', 'E:\\docs'] }, { path: 'C:\\other' }];
  it('a conversation in the project folder gets its extra folders', () => {
    expect(projectFolders('c:\\proj\\', ws, true)).toEqual(['D:\\lib', 'E:\\docs']);
  });
  it('a subfolder of the project, an unknown folder, or a project without folders → []', () => {
    expect(projectFolders('C:\\proj\\sub', ws, true)).toEqual([]);
    expect(projectFolders('C:\\nowhere', ws, true)).toEqual([]);
    expect(projectFolders('C:\\other', ws, true)).toEqual([]);
    expect(projectFolders('', ws, true)).toEqual([]);
  });
  it('sameDir ignores separators and a trailing slash', () => {
    expect(sameDir('C:/proj/', 'c:\\proj', true)).toBe(true);
    expect(sameDir('/a', '/A', false)).toBe(false);
  });
});
```

`server/src/meta/store.test.ts` 加：

```ts
  it('workspaces: old data has no folders → [] on read; updateWorkspace adds and removes them', async () => {
    const file = await tmpFile();
    const main = path.join(path.dirname(file), 'proj');
    const extra = path.join(path.dirname(file), 'lib');
    await fs.writeFile(file, JSON.stringify({ version: 1, workspaces: [{ id: 'w1', path: main, name: 'proj', addedAt: 1, order: 0 }], sessions: {}, schedules: [], scheduleRuns: [], settings: {}, providers: [], feedback: {}, drafts: {}, devices: [], remoteHosts: [], imGateways: [], imBindings: [], goals: [] }), 'utf8');
    const m = new MetaStore(file);
    await m.load();
    expect(m.workspaces()[0].folders).toEqual([]);
    const w = await m.updateWorkspace('w1', { folders: [extra, main, extra] });
    expect(w?.folders).toEqual([extra]);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).workspaces[0].folders).toEqual([extra]);
    await m.updateWorkspace('w1', { name: '新名字', folders: [] });
    expect(m.workspaces()[0]).toMatchObject({ name: '新名字', folders: [] });
    expect(await m.updateWorkspace('nope', { name: 'x' })).toBeNull();
  });
```

`server/src/files/service.test.ts` 在 :118 那条测试旁边加：

```ts
    it('an extra project folder on a share is trusted like the main one', () => {
      const roots = workspaceRoots([{ path: 'C:\\proj', folders: ['\\\\nas\\more'] }]);
      expect(uncAllowed('\\\\nas\\more\\a.txt', roots, true)).toBe(true);
      expect(uncAllowed('\\\\nas\\other\\a.txt', roots, true)).toBe(false);
    });
```

- [ ] **Step 2: 确认失败** — `cd server && $CLEAN npx vitest run src/meta src/files/service.test.ts`

- [ ] **Step 3: 实现**

`server/src/meta/workspace-folders.ts`：

```ts
// A project's extra folders (stage C2): stored on the workspace as `folders` (never the main `path`), read with
// `folders ?? []` — old meta.json files need no migration. Pure.
import path from 'node:path';

const key = (p: string, caseless: boolean) => {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return caseless ? s.toLowerCase() : s;
};

export const sameDir = (a: string, b: string, caseless = process.platform === 'win32') => !!a && !!b && key(a, caseless) === key(b, caseless);

export function normFolders(main: string, folders: unknown, o: { caseless?: boolean; resolve?: (p: string) => string } = {}): string[] {
  const caseless = o.caseless ?? process.platform === 'win32';
  const resolve = o.resolve ?? ((p: string) => path.resolve(p));
  if (!Array.isArray(folders)) return [];
  const seen = new Set<string>([key(main, caseless)]);
  const out: string[] = [];
  for (const f of folders) {
    if (typeof f !== 'string' || !f.trim()) continue;
    const p = resolve(f.trim());
    const k = key(p, caseless);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export function projectFolders(cwd: string, workspaces: readonly { path: string; folders?: unknown }[], caseless = process.platform === 'win32'): string[] {
  if (!cwd) return [];
  const w = workspaces.find((x) => sameDir(cwd, x.path, caseless));
  return w ? normFolders(w.path, w.folders, { caseless, resolve: (p) => p }) : [];
}
```

`store.ts`：
- :12 改成 `export interface Workspace { id: string; path: string; name: string; addedAt: number; order: number; /** extra folders (stage C2), never the main path; absent in old files */ folders?: string[] }`
- `workspaces()` 改成 `return [...this.data.workspaces].sort((a, b) => a.order - b.order).map((w) => ({ ...w, folders: normFolders(w.path, w.folders, { resolve: (p) => p }) }));`。`index.ts:326` 的 `workspaceRoots(meta.workspaces())` 拿到的就是规整过的。
- 新方法：

```ts
  async updateWorkspace(id: string, patch: { name?: string; folders?: string[] }) {
    const w = this.data.workspaces.find((x) => x.id === id);
    if (!w) return null;
    if (typeof patch.name === 'string' && patch.name.trim()) w.name = patch.name.trim();
    if (patch.folders) w.folders = normFolders(w.path, patch.folders);
    await this.queueSave();
    return { ...w, folders: w.folders ?? [] };
  }
```

`protocol.ts`：:375 加 `folders: string[]`；:544 后面加请求。
`hub.ts`，在 `workspaces.reorder` 后面：

```ts
      case 'workspaces.update': {
        // the folders must exist and be folders: checked here (the page cannot), one sentence naming the first that is not
        if (Array.isArray(req.folders)) {
          for (const f of req.folders) {
            const ok = typeof f === 'string' && path.isAbsolute(f) && (await fs.promises.stat(f).then((st) => st.isDirectory(), () => false));
            if (!ok) throw new Error(tr('找不到这个文件夹：{f}', { f: String(f) }));
          }
        }
        const w = await s.meta.updateWorkspace(req.id, { name: req.name, folders: req.folders });
        if (!w) throw new Error(tr('这个项目已经不在了'));
        return w;
      }
```
（hub 已经 import 了 `fs`、`path`，`fs.findFiles` 那段在用；`tr` 跟别的分支用的是同一个。）

- [ ] **Step 4: 跑通过** — `cd server && $CLEAN npx vitest run src/meta src/files/service.test.ts && $CLEAN npx tsc --noEmit -p .`；然后 `node scripts/i18n/extract.mjs --check`（两句新的服务端文案要有英文）
- [ ] **Step 5: Commit**
  `git add server/src/meta/workspace-folders.ts server/src/meta/workspace-folders.test.ts server/src/meta/store.ts server/src/meta/store.test.ts server/src/protocol.ts server/src/ws/hub.ts server/src/files/service.test.ts`，再加上 extract 改过的英文目录文件（逐个写路径）
  `git commit -m "feat(projects): a project can have extra folders (meta folders, read as [] for old data); workspaces.update checks they exist"`

---

### Task 3: 新对话带上额外文件夹（Claude 的 `additionalDirectories`、Codex）

**Files:**
- Modify: `server/src/runtime/session-runner.ts`（构造函数的 `opts` 加 `additionalDirectories?: string[]`，存成 `private extraDirs: string[]`；`options` 在 :532-578 里，`cwd: this.cwd` 后面加 `...(this.extraDirs.length ? { additionalDirectories: this.extraDirs } : {})`）
- Modify: `server/src/runtime/pool.ts:174`（Claude 分支），以及 :185-205 的 Codex 分支
- Modify: `server/src/agents/codex-driver.ts`（hooks 加 `extraDirs?: string[]`；`thread/start` :136 和 `thread/resume` :127 带上）
- Modify: `server/src/runtime/session-runner.test.ts`（新用例）、`server/src/runtime/pool.test.ts`（新用例）
- Create: `server/ws-phase33.mjs`（如果阶段 B 已经占了 33，用下一个空号，见 `ls server/ws-phase*.mjs`），并登记进 `scripts/e2e.mjs:13`

**Interfaces:**
- Consumes: `projectFolders(cwd, meta.workspaces())`（Task 2）。
- Produces: `new SessionRunner(params, provider, { thinkingLanguage?, account?, additionalDirectories?: string[] })`；`CodexDriver` 的 hooks 多一个 `extraDirs?: string[]`。不改 `OpenSessionParams` / `protocol.ts`（pool 在服务端自己查，IM / 定时任务 / 目标 / 交接打开的对话也一样生效）。

规则：只有 cwd 等于某个项目主文件夹的对话才带（`projectFolders`，跟 web 的 `projectFor` 判定一致）。对话启动时读一次；在跑的对话不中途改，下次进程启动时生效（重启 / respawn 用的是同一个 `this.extraDirs`，所以 respawn 也不变；新开或重新打开才读新值）。

- [ ] **Step 1: 写失败测试**

`session-runner.test.ts`（在 `describe('SessionRunner')` 里面）：

```ts
  it('extra project folders go to the SDK as additionalDirectories; none → the option is absent', async () => {
    queries.length = 0;
    const a = new SessionRunner({ sessionId: 'dirs1', cwd: '/proj' } as any, undefined, { additionalDirectories: ['/lib', '/docs'] });
    await tick();
    expect(queries[0].options.additionalDirectories).toEqual(['/lib', '/docs']);
    expect(queries[0].options.cwd).toBe('/proj');
    await a.close();
    queries.length = 0;
    const b = new SessionRunner({ sessionId: 'dirs2', cwd: '/proj' } as any);
    await tick();
    expect('additionalDirectories' in queries[0].options).toBe(false);
    await b.close();
  });
```

`pool.test.ts`：照这个文件里已有的、mock 了 `SessionRunner` 构造函数的方式，加一条：meta 里 `workspaces()` 返回 `[{ id: 'w', path: '/proj', name: 'p', addedAt: 0, order: 0, folders: ['/lib'] }]`，`pool.open({ cwd: '/proj' })` 传给 `SessionRunner` 的第三个参数里 `additionalDirectories` 是 `['/lib']`；`pool.open({ cwd: '/proj/sub' })` 是 `[]` 或者没有这个字段。（先读 `pool.test.ts` 开头的 mock 怎么建；如果它不 mock `SessionRunner`，就改成断言 runner 里 `queries[0].options.additionalDirectories`，跟上一条一样。）

- [ ] **Step 2: 确认失败** — `cd server && $CLEAN npx vitest run src/runtime/session-runner.test.ts src/runtime/pool.test.ts`

- [ ] **Step 3: 实现**
  - runner：构造函数里 `this.extraDirs = (opts.additionalDirectories ?? []).filter((d) => typeof d === 'string' && d);`；`options` 照上面写。
  - pool :174：`const extra = m ? projectFolders(params.cwd, m.workspaces()) : [];` 然后 `new SessionRunner(params, sp, { thinkingLanguage, ...(account ? { account } : {}), ...(extra.length ? { additionalDirectories: extra } : {}) })`。
  - Codex：pool 的 Codex 分支用同样的办法算出 `extra`，作为 `{ beforeResume, onModels, extraDirs: extra }` 传进去。`codex-driver.ts` 的 `thread/start` / `thread/resume` 参数里，在 `extraDirs.length && pol.sandbox === 'workspace-write'` 时加 `config: { 'sandbox_workspace_write.writable_roots': extraDirs }`。**先核对参数名**：在临时目录跑 `codex app-server generate-ts --out <临时目录>`，然后 grep `ThreadStartParams` / `ThreadResumeParams` 里的 `config`。有 `config`（按点分 key 覆盖配置）就这样带；没有的话不带，Codex 在 Task 6 的对话框里列成「只用主文件夹」，并写进笔记。
  - ACP agent（Gemini / Qwen / OpenCode 等）：不带，对话框里注明。
  - e2e `server/ws-phase33.mjs`，照 `ws-phase32.mjs` 的写法：临时 HOME、假 Anthropic 上游、真引擎、自己起 server。建两个临时文件夹 `main`、`extra`，`workspaces.add main`，`workspaces.update { id, folders: [extra] }`，`session.open { cwd: main }` 发一句话。**PASS 条件**：假上游收到的第一个请求里，system 文本或 messages 里出现 `extra` 的路径（Claude Code 会把额外工作目录写进环境说明）。第二个对话 `cwd: extra`（不是项目主文件夹）的请求里不出现 `main` 以外的额外目录。再断言 `workspaces.update` 给一个不存在的文件夹时报「找不到这个文件夹」。把 `'33'` 加进 `scripts/e2e.mjs:13` 的期号表。
- [ ] **Step 4: 跑通过** — 同 Step 2；然后 `$CLEAN npm run build:all && $CLEAN node scripts/e2e.mjs 33`
- [ ] **Step 5: Commit**
  `git add server/src/runtime/session-runner.ts server/src/runtime/pool.ts server/src/agents/codex-driver.ts server/src/runtime/session-runner.test.ts server/src/runtime/pool.test.ts server/ws-phase33.mjs scripts/e2e.mjs`
  `git commit -m "feat(projects): conversations opened in a project get its extra folders (SDK additionalDirectories; Codex writable roots)"`

---

### Task 4: 侧栏的分组 / 排序 / 自建分区纯函数

**Files:**
- Create: `web/src/features/sidebar/view.ts`、`web/src/features/sidebar/view.test.ts`
- Modify: `web/src/features/sidebar/filter.ts:4-11`（`SessionFilter` 加 `otherAgents?: boolean`）、:43-52（`filterSessions`）
- Modify: `web/src/features/sidebar/filter.test.ts`（新用例）
- Modify: `web/src/features/paths.ts`（加 `projectRoots`）、`web/src/features/paths.test.ts`

**Interfaces:**
- Produces（`view.ts`）：
  - `type GroupBy = 'project' | 'folder' | 'date' | 'none'`；`type SortBy = 'updated' | 'created' | 'name'`；`type PerGroup = 5 | 10 | 'all'`
  - `interface SidebarView { groupBy: GroupBy; sortBy: SortBy; show: { archived: boolean; otherAgents: boolean; perGroup: PerGroup } }`
  - `VIEW_KEY = 'ui.sidebar.view'`，`SECTIONS_KEY = 'ui.sidebar.sections'`，`DEFAULT_VIEW: SidebarView`（`project / updated / { archived: false, otherAgents: true, perGroup: 5 }`）
  - `readView(raw: unknown): SidebarView`；`perGroupLimit(v: SidebarView): number`（`'all'` → `Infinity`）
  - `sortSessions(list: readonly SessionSummary[], by: SortBy): SessionSummary[]`
  - `type DateBucket = 'today' | 'yesterday' | 'week' | 'month' | 'older'`；`dateBucket(ts: number, now: number): DateBucket`
  - `interface ViewGroup { key: string; kind: 'project' | 'folder' | 'date' | 'all' | 'peer'; workspaceId?: string; cwd?: string; bucket?: DateBucket; peerId?: string; items: SessionSummary[] }`
  - `groupSessions(list: readonly SessionSummary[], v: SidebarView, c: { workspaces: readonly { id: string; path: string }[]; meta: Record<string, SessionMeta>; now: number }): ViewGroup[]`
  - `interface CustomSection { id: string; name: string; ids: string[] }`；`readSections(raw: unknown): CustomSection[]`；`addSection(list, id: string, name: string)`；`renameSection(list, id, name)`；`deleteSection(list, id)`；`addToSection(list, sectionId, sessionId)`；`removeFromSection(list, sectionId, sessionId)`，都返回 `CustomSection[]`
  - `filter.ts`：`otherAgents === false` 且 `source === 'all'` 时去掉 `agentOf(s) !== 'claude'` 的对话（明确选了某个来源时，来源筛选优先）
  - `paths.ts`：`projectRoots(cwd: string, workspaces: readonly { path: string; folders?: string[] }[]): string[]`，返回 `[cwd, ...额外文件夹]`（cwd 是项目主文件夹时），否则 `cwd ? [cwd] : []`

- [ ] **Step 1: 写失败测试** `web/src/features/sidebar/view.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@shared';
import { addSection, addToSection, dateBucket, DEFAULT_VIEW, deleteSection, groupSessions, perGroupLimit, readSections, readView, removeFromSection, renameSection, sortSessions } from './view';

const s = (id: string, o: Partial<SessionSummary> = {}): SessionSummary => ({ sessionId: id, title: id, cwd: 'C:\\a', lastModified: 0, ...o });
const now = new Date(2026, 9, 24, 15, 0).getTime();
const at = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();

describe('readView', () => {
  it('defaults for nothing / junk, keeps what is valid', () => {
    expect(readView(undefined)).toEqual(DEFAULT_VIEW);
    expect(readView({ groupBy: 'zzz', sortBy: 'name', show: { archived: true, perGroup: 10, otherAgents: false } })).toEqual({ groupBy: 'project', sortBy: 'name', show: { archived: true, otherAgents: false, perGroup: 10 } });
    expect(readView({ show: { perGroup: 7 } }).show.perGroup).toBe(5);
  });
  it('perGroupLimit', () => {
    expect(perGroupLimit(DEFAULT_VIEW)).toBe(5);
    expect(perGroupLimit({ ...DEFAULT_VIEW, show: { ...DEFAULT_VIEW.show, perGroup: 'all' } })).toBe(Infinity);
  });
});

describe('sortSessions', () => {
  const list = [s('b', { title: 'Beta', lastModified: 3, createdAt: 1 }), s('a', { title: 'alpha', lastModified: 1, createdAt: 3 }), s('c', { title: 'Gamma', lastModified: 2 })];
  it('updated: newest first', () => expect(sortSessions(list, 'updated').map((x) => x.sessionId)).toEqual(['b', 'c', 'a']));
  it('created: newest first, no createdAt → lastModified', () => expect(sortSessions(list, 'created').map((x) => x.sessionId)).toEqual(['a', 'c', 'b']));
  it('name: case-insensitive', () => expect(sortSessions(list, 'name').map((x) => x.sessionId)).toEqual(['a', 'b', 'c']));
  it('does not touch the input', () => { sortSessions(list, 'name'); expect(list[0].sessionId).toBe('b'); });
});

describe('dateBucket', () => {
  it('today / yesterday / this week / this month / older, by local calendar days', () => {
    expect(dateBucket(at(24, 1), now)).toBe('today');
    expect(dateBucket(at(23, 23), now)).toBe('yesterday');
    expect(dateBucket(at(19), now)).toBe('week');
    expect(dateBucket(at(1), now)).toBe('month');
    expect(dateBucket(new Date(2026, 7, 1).getTime(), now)).toBe('older');
  });
});

describe('groupSessions', () => {
  const workspaces = [{ id: 'w1', path: 'C:\\proj' }];
  const list = [
    s('p1', { cwd: 'C:\\proj', lastModified: at(24) }),
    s('f1', { cwd: 'C:\\x', lastModified: at(23) }),
    s('f2', { cwd: 'C:\\y', lastModified: at(10) }),
    s('pin', { cwd: 'C:\\x', lastModified: at(24, 14) }),
    s('r1', { cwd: '/srv', lastModified: at(24), peer: { id: 'box', name: 'Box' } as any }),
  ];
  const meta = { pin: { pinned: true } };
  const g = (v = DEFAULT_VIEW) => groupSessions(list, v, { workspaces, meta, now });
  it('project: every project (even empty), then folders newest first, then other machines; pinned left out', () => {
    expect(g().map((x) => [x.kind, x.key, x.items.map((i) => i.sessionId)])).toEqual([
      ['project', 'w1', ['p1']], ['folder', 'C:\\x', ['f1']], ['folder', 'C:\\y', ['f2']], ['peer', 'peer:box', ['r1']],
    ]);
  });
  it('folder: every folder its own group, the project folder too', () => {
    expect(g({ ...DEFAULT_VIEW, groupBy: 'folder' }).map((x) => x.key)).toEqual(['C:\\proj', 'C:\\x', 'C:\\y', 'peer:box']);
  });
  it('date: buckets in order, only the ones with conversations', () => {
    expect(g({ ...DEFAULT_VIEW, groupBy: 'date' }).map((x) => [x.key, x.items.map((i) => i.sessionId)])).toEqual([
      ['date:today', ['p1']], ['date:yesterday', ['f1']], ['date:month', ['f2']], ['peer:box', ['r1']],
    ]);
  });
  it('none: one list in the chosen order', () => {
    expect(g({ ...DEFAULT_VIEW, groupBy: 'none', sortBy: 'name' }).map((x) => [x.key, x.items.map((i) => i.sessionId)])).toEqual([['__all', ['f1', 'f2', 'p1']], ['peer:box', ['r1']]]);
  });
  it('orchestration worktrees group under their run (meta.groupCwd)', () => {
    const r = groupSessions([s('wt', { cwd: 'C:\\tmp\\wt' })], DEFAULT_VIEW, { workspaces, meta: { wt: { groupCwd: 'C:\\proj' } }, now });
    expect(r[0]).toMatchObject({ kind: 'project', key: 'w1' });
  });
});

describe('custom sections', () => {
  it('read tolerates junk; add / rename / put in / take out / delete', () => {
    expect(readSections([{ id: 'a', name: 'A', ids: ['x', 3] }, { name: 'no id' }, null])).toEqual([{ id: 'a', name: 'A', ids: ['x'] }]);
    let l = addSection([], 's1', '本周要交');
    l = addToSection(l, 's1', 'x');
    l = addToSection(l, 's1', 'x');
    l = addToSection(l, 's1', 'y');
    expect(l).toEqual([{ id: 's1', name: '本周要交', ids: ['x', 'y'] }]);
    l = renameSection(removeFromSection(l, 's1', 'x'), 's1', '下周');
    expect(l).toEqual([{ id: 's1', name: '下周', ids: ['y'] }]);
    expect(deleteSection(l, 's1')).toEqual([]);
  });
});
```

`filter.test.ts` 加：

```ts
  it('otherAgents off hides other agents\' conversations unless a source is picked', () => {
    const all = [{ sessionId: 'c', title: 'c', cwd: '', lastModified: 0 }, { sessionId: 'x', title: 'x', cwd: '', lastModified: 0, agent: 'codex' }] as any;
    expect(filterSessions(all, { source: 'all', query: '', showArchived: false, meta: {}, otherAgents: false }).map((s) => s.sessionId)).toEqual(['c']);
    expect(filterSessions(all, { source: 'codex', query: '', showArchived: false, meta: {}, otherAgents: false }).map((s) => s.sessionId)).toEqual(['x']);
  });
```

`paths.test.ts` 加：

```ts
  it('projectRoots: a project folder lists its extra folders after it; anything else is just itself', () => {
    const ws = [{ path: 'C:\\proj', folders: ['D:\\lib'] }];
    expect(projectRoots('c:\\proj', ws)).toEqual(['c:\\proj', 'D:\\lib']);
    expect(projectRoots('C:\\proj\\sub', ws)).toEqual(['C:\\proj\\sub']);
    expect(projectRoots('', ws)).toEqual([]);
  });
```

- [ ] **Step 2: 确认失败** — `cd web && $CLEAN npx vitest run src/features/sidebar/view.test.ts src/features/sidebar/filter.test.ts src/features/paths.test.ts`

- [ ] **Step 3: 实现** `web/src/features/sidebar/view.ts`

```ts
// The sidebar's 显示 menu (stage C3): how the list is grouped and ordered, what it shows, the user's own sections.
// Stored in meta.json (ui.sidebar.view / ui.sidebar.sections), read tolerantly. Pure.
import type { SessionMeta, SessionSummary } from '@shared';
import { projectFor } from '@/features/paths';

export type GroupBy = 'project' | 'folder' | 'date' | 'none';
export type SortBy = 'updated' | 'created' | 'name';
export type PerGroup = 5 | 10 | 'all';
export interface SidebarView { groupBy: GroupBy; sortBy: SortBy; show: { archived: boolean; otherAgents: boolean; perGroup: PerGroup } }
export const VIEW_KEY = 'ui.sidebar.view';
export const SECTIONS_KEY = 'ui.sidebar.sections';
export const DEFAULT_VIEW: SidebarView = { groupBy: 'project', sortBy: 'updated', show: { archived: false, otherAgents: true, perGroup: 5 } };

const GROUPS: readonly GroupBy[] = ['project', 'folder', 'date', 'none'];
const SORTS: readonly SortBy[] = ['updated', 'created', 'name'];

export function readView(raw: unknown): SidebarView {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const sh = (r.show && typeof r.show === 'object' ? r.show : {}) as Record<string, any>;
  return {
    groupBy: GROUPS.includes(r.groupBy) ? r.groupBy : DEFAULT_VIEW.groupBy,
    sortBy: SORTS.includes(r.sortBy) ? r.sortBy : DEFAULT_VIEW.sortBy,
    show: { archived: sh.archived === true, otherAgents: sh.otherAgents !== false, perGroup: sh.perGroup === 10 || sh.perGroup === 'all' ? sh.perGroup : 5 },
  };
}
export const perGroupLimit = (v: SidebarView): number => (v.show.perGroup === 'all' ? Infinity : v.show.perGroup);

const titleOf = (s: SessionSummary) => (s.customTitle || s.title || '').toLocaleLowerCase();
const timeOf = (s: SessionSummary, by: SortBy) => (by === 'created' ? s.createdAt ?? s.lastModified : s.lastModified);

export function sortSessions(list: readonly SessionSummary[], by: SortBy): SessionSummary[] {
  const a = [...list];
  if (by === 'name') return a.sort((x, y) => titleOf(x).localeCompare(titleOf(y), undefined, { numeric: true }) || y.lastModified - x.lastModified);
  return a.sort((x, y) => timeOf(y, by) - timeOf(x, by));
}

export type DateBucket = 'today' | 'yesterday' | 'week' | 'month' | 'older';
const BUCKETS: readonly DateBucket[] = ['today', 'yesterday', 'week', 'month', 'older'];
export function dateBucket(ts: number, now: number): DateBucket {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const today = d.getTime();
  const day = 86_400_000;
  if (ts >= today) return 'today';
  if (ts >= today - day) return 'yesterday';
  if (ts >= today - 6 * day) return 'week';
  if (ts >= today - 29 * day) return 'month';
  return 'older';
}

export interface ViewGroup { key: string; kind: 'project' | 'folder' | 'date' | 'all' | 'peer'; workspaceId?: string; cwd?: string; bucket?: DateBucket; peerId?: string; items: SessionSummary[] }

const push = <K>(m: Map<K, SessionSummary[]>, k: K, s: SessionSummary) => { const a = m.get(k); if (a) a.push(s); else m.set(k, [s]); };
const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;

export function groupSessions(list: readonly SessionSummary[], v: SidebarView, c: { workspaces: readonly { id: string; path: string }[]; meta: Record<string, SessionMeta>; now: number }): ViewGroup[] {
  const sorted = sortSessions(list.filter((s) => !c.meta[s.sessionId]?.pinned), v.sortBy);
  const peers = new Map<string, SessionSummary[]>();
  const local: SessionSummary[] = [];
  for (const s of sorted) { if (s.peer) push(peers, s.peer.id, s); else local.push(s); }
  const peerGroups: ViewGroup[] = [...peers].map(([id, items]) => ({ key: `peer:${id}`, kind: 'peer', peerId: id, items }));
  const cwdOf = (s: SessionSummary) => c.meta[s.sessionId]?.groupCwd ?? s.cwd ?? '';
  let out: ViewGroup[];
  if (v.groupBy === 'none') out = local.length ? [{ key: '__all', kind: 'all', items: local }] : [];
  else if (v.groupBy === 'date') {
    const m = new Map<DateBucket, SessionSummary[]>();
    for (const s of local) push(m, dateBucket(timeOf(s, v.sortBy === 'created' ? 'created' : 'updated'), c.now), s);
    out = BUCKETS.filter((b) => m.has(b)).map((b) => ({ key: `date:${b}`, kind: 'date', bucket: b, items: m.get(b)! }));
  } else {
    const byWs = new Map<string, SessionSummary[]>();
    const byCwd = new Map<string, SessionSummary[]>();
    for (const s of local) {
      const cwd = cwdOf(s);
      const w = v.groupBy === 'project' ? projectFor(cwd, c.workspaces) : undefined;
      if (w) push(byWs, w.id, s); else push(byCwd, cwd, s);
    }
    const projects: ViewGroup[] = v.groupBy === 'project' ? c.workspaces.map((w) => ({ key: w.id, kind: 'project', workspaceId: w.id, items: byWs.get(w.id) ?? [] })) : [];
    let folders: ViewGroup[] = [...byCwd].map(([cwd, items]) => ({ key: cwd || '__unknown', kind: 'folder', cwd, items }));
    if (v.sortBy === 'name') folders = folders.sort((a, b) => base(a.cwd ?? '').localeCompare(base(b.cwd ?? ''), undefined, { numeric: true }));
    out = [...projects, ...folders];
  }
  return [...out, ...peerGroups];
}

export interface CustomSection { id: string; name: string; ids: string[] }
export function readSections(raw: unknown): CustomSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Record<string, any> => !!x && typeof x.id === 'string' && typeof x.name === 'string')
    .map((x) => ({ id: x.id, name: x.name, ids: Array.isArray(x.ids) ? x.ids.filter((i: unknown): i is string => typeof i === 'string') : [] }));
}
export const addSection = (l: CustomSection[], id: string, name: string): CustomSection[] => [...l, { id, name, ids: [] }];
export const renameSection = (l: CustomSection[], id: string, name: string): CustomSection[] => l.map((x) => (x.id === id ? { ...x, name } : x));
export const deleteSection = (l: CustomSection[], id: string): CustomSection[] => l.filter((x) => x.id !== id);
export const addToSection = (l: CustomSection[], id: string, sid: string): CustomSection[] => l.map((x) => (x.id === id && !x.ids.includes(sid) ? { ...x, ids: [...x.ids, sid] } : x));
export const removeFromSection = (l: CustomSection[], id: string, sid: string): CustomSection[] => l.map((x) => (x.id === id ? { ...x, ids: x.ids.filter((i) => i !== sid) } : x));
```

`filter.ts`：`SessionFilter` 加 `/** 显示 → 其它 agent 的对话 (off: Claude's only, unless a source is picked) */ otherAgents?: boolean;`，`filterSessions` 里来源那行后面加 `if (o.source === 'all' && o.otherAgents === false && agentOf(s) !== 'claude') return false;`。

`paths.ts`：

```ts
/** The folders a conversation in `cwd` works in: its own, then — in a project's folder — the project's extra folders (stage C2). */
export function projectRoots(cwd: string, workspaces: readonly { path: string; folders?: string[] }[]): string[] {
  if (!cwd) return [];
  const w = projectFor(cwd, workspaces);
  return [cwd, ...(w?.folders ?? []).filter((f) => !samePath(f, cwd))];
}
```

- [ ] **Step 4: 跑通过** — 同 Step 2，再跑 `cd web && $CLEAN npx tsc --noEmit -p .`
- [ ] **Step 5: Commit**
  `git add web/src/features/sidebar/view.ts web/src/features/sidebar/view.test.ts web/src/features/sidebar/filter.ts web/src/features/sidebar/filter.test.ts web/src/features/paths.ts web/src/features/paths.test.ts`
  `git commit -m "feat(sidebar): view logic — group by project / folder / date / none, sort, per-group, own sections; projectRoots"`

---

### Task 5: 问答卡放进对话里

**Files:**
- Create: `web/src/features/chat/AskCard.tsx`
- Modify: `web/src/features/chat/PermissionCards.tsx`（删掉 `AskQuestion` :186-256；`PermissionDock` :278-296 改成渲染 `splitPending(o.pending).dock`，`more` = 非问答卡的请求数 − 1；:294 去掉 `ask` 分支；导出 `usePrimary` 和 `useRespond`，给 `AskCard` 用）
- Modify: `web/src/features/chat/ChatView.tsx`（`TurnList` :610-625 多一个 `ask?: PermissionRequestEvent` 属性，画在所有回合后面、`PlanDock` 前面；`ChatView` :666 附近用 `splitPending(pending).ask`，在 :768 传进去）
- Modify: `web/src/features/composer/Composer.tsx`（:392 `docked`；:1119-1121）
- Modify: `web/src/features/chat/permission-dock.ts`（`DockWhy` 不变；`DOCK_STATUS` / `DOCK_HINT` 不动）
- Modify: CSS：对话样式所在的文件（`.pd-*` 停靠卡的样式在 `floating.css`，回合在 `styles.css`）。新的 `.ask-card` 规则放在 `styles.css` 的 redesign phase 5 那一段旁边
- Modify: 英文目录（extract 工具）

**Interfaces:**
- Consumes: Task 1 全部；`useStore((s) => s.respondPermission)`；`denyResponse`；`primaryKey`；`usePaneCtx()`（ChatView :665）；`imeComposing`。
- Produces: `export function AskCard({ p, sessionId, scope }: { p: PermissionRequestEvent; sessionId: string; scope: string }): JSX.Element`。

做法（照 spec C1）：
- [ ] **Step 1: 失败测试**：Task 1 的单测已经覆盖逻辑。这里把 `permission-dock.test.ts:35-36` 保持原样（问答卡空 Enter 仍然 → `primary`，见下文 Composer），并在 `scripts/ui-smoke.cjs` 的 chat-permission 段先写好 Task 8 要跑的断言骨架（不在这一步跑）。
- [ ] **Step 2: Composer**：
  - :392 改成 `const { dock, ask } = splitPending(active?.pending ?? NO_PENDING_LOCAL)`，`const docked = !welcome && !disabled && active ? dock ?? ask : undefined;`（`NO_PENDING_LOCAL` 是模块级常量 `[]`，保证引用稳定）。按键逻辑不变：问答卡在等时，输入框里打字 Enter = 用这些字拒绝这次提问（原来「跳过」的含义，`denyResponse`）；空输入框 Enter（冷却 600 ms 后）= `runDockPrimary`，问答卡把它注册成「把焦点移到卡片当前题的选中项 / 第一项」，不会提交。
  - :1119-1121：只有 `dock` 存在时渲染 `PermissionDock`，否则渲染 `RunCard`。问答卡等待时 RunCard 照常显示（用户在对话里回答）。
- [ ] **Step 3: AskCard.tsx**：
  - 状态：`cur: number`，`drafts: AskDraft[]`（翻回去还在），`focus: number`（当前题里获得焦点的行，`options.length` 那一行是「其它」）。`qs = useMemo(() => askQuestions(p.input), [p.input])`。
  - 结构：`<section className="ask-card" data-request={p.requestId} role="group" aria-label={permissionTitle(p)}>`
    - 顶行：`header` 徽标 + 问题原文；右边 `‹`、`{cur+1} / {qs.length}`、`›`（`button`，到头时 disabled，`aria-label` 是 `tr('上一题')` / `tr('下一题')`；只有一题时不画翻页）。
    - 选项：`button role={multi ? 'checkbox' : 'radio'} aria-checked`，左边圆圈（多选是方框：`Icon` 用 `circle` / `checkCircle`，多选用方框图标；没有方框图标就用 `check` 加一个 `.box` 外框样式），粗体 `label` + 灰色 `description`。有 `preview` 的选项获得焦点（或被选中）时，右侧 `.ask-preview` 用 `<pre>` 显示它（窄于 560px 时放到选项下面）。
    - 最后一行「其它」：`button`，选中后下面出 `<input className="ask-other">` 并 `focus()`。
    - 底部：左边 `.ask-need` 橙色标记 `tr('需要你回答')`；右边按钮 `tr('跳过')`，以及主按钮：不是最后一题时是 `tr('下一题')` 加 `<kbd>Ctrl ↵</kbd>`，最后一题是 `tr('提交')`。主按钮在 `answerOf(qs[cur], drafts[cur]) === null` 时 disabled。
  - 动作：`next = () => { const r = step(qs, drafts, cur); if (r.t === 'goto') setCur(r.index); else if (r.t === 'send') send(r.result.kind === 'allow' ? { behavior: 'allow', updatedInput: { ...p.input, answers: r.result.answers } } : denyResponse(p, '')); }`。`skipCur = () => { const d = [...drafts]; d[cur] = skip(d[cur] ?? EMPTY_DRAFT); setDrafts(d); 然后用 d 走一次 step }`。
  - 键盘：卡片根节点 `onKeyDown`，用 `askKey({ key, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, composing: imeComposing(e.nativeEvent), inText: e.target instanceof HTMLInputElement }, options.length)`：`move` 在选项里移焦点（到头循环），`pick` 选第 n 项（多选是切换），`next` 调 `next()`。不响应时不 `preventDefault`。
  - 防误触：卡片出现时**不抢焦点**（用户可能正在输入框里打字）；只有 `usePrimary(scope, p.requestId, focusCard)` 注册的函数在输入框空 Enter 时把焦点移进卡片。`scope` = ChatView 里 `pane ? \`${pane.paneId}|${pane.tileId}\` : 'none'`（跟 Composer :409 的 `dockScope` 一样）。
  - `useRespond(p)` 防重复提交（`busy`）。请求在别处被回答（Mission Control / IM / 另一个窗口）后 `pending` 里没有它，卡片自然消失。
  - 位置：ChatView 的 `TurnList` 里 `{ask && <AskCard key={ask.requestId} p={ask} sessionId={sessionId} scope={scope} />}`，放在 `turns.map` 之后、`{plan && <PlanDock …/>}` 之前（spec：这一轮末尾、任务清单上面）。工具步骤里那一步仍显示「等你确认」（`waitingToolIds` 不变）。
  - 侧栏：`status.ts:30` 的 `ask` 状态不变（照旧进「需要你」）。
- [ ] **Step 4: 跑** — `cd web && $CLEAN npx vitest run src/features/chat && $CLEAN npx tsc --noEmit -p .`；`node scripts/i18n/extract.mjs --check`（新文案：需要你回答、上一题、下一题、提交、其它、（用户跳过）、跳过）
- [ ] **Step 5: Commit**
  `git add web/src/features/chat/AskCard.tsx web/src/features/chat/PermissionCards.tsx web/src/features/chat/ChatView.tsx web/src/features/composer/Composer.tsx web/src/styles.css`，再加上 extract 改过的英文目录文件（逐个写路径）
  `git commit -m "feat(chat): AskUserQuestion is a card in the conversation — one question a page, paging, keys, 其它, preview; permission cards stay above the box"`

---

### Task 6: 编辑项目对话框 + 文件 / 搜索 / Git / @文件 列出全部文件夹

**Files:**
- Create: `web/src/features/sidebar/ProjectDialog.tsx`
- Create: `web/src/features/workbench/RootGroups.tsx`
- Modify: `web/src/features/sidebar/groups.tsx:16-43`（`ProjectMenu` 加「编辑项目…」，`data-id={id('edit')}`）
- Modify: `web/src/features/sidebar/entries.ts`（`PROJECT_MENU` 加 `'edit'`，`ADDED` 加 `'project:edit'`）
- Modify: `web/src/store/index.ts`（加 `updateWorkspace(id: string, patch: { name?: string; folders?: string[] }): Promise<void>`，挨着 :514-520 的 `reorderWorkspaces` / `addWorkspace`）
- Modify: `web/src/features/workbench/FilesView.tsx:77,79`、`web/src/features/workbench/tiles/ChatTile.tsx:280-282`、`web/src/features/workbench/ReviewView.tsx:414`
- Modify: `web/src/features/composer/Composer.tsx:362-376`（@文件）

**Interfaces:**
- Consumes: `projectRoots`（Task 4）、`workspaces.update`（Task 2）、`desktop.pickDir()` / `fs.pickDir`（照 `Sidebar.tsx:210-213`）、`dlg.confirm`、`joinPath`（`paths.ts`）。
- Produces: `openProjectDialog(w: Workspace): void`（模块级小 store 或 store 字段 `projectDialog: string | null` = 正在编辑的项目 id；`App` 里挂一次 `<ProjectDialog />`）；`RootGroups({ roots, children }: { roots: string[]; children: (root: string) => React.ReactNode })`。

- [ ] **Step 1: 失败测试**：`entries.test.ts` 已经会因为 `PROJECT_MENU` 多了 `edit` 但 `ADDED` 里没有而失败，先只改 `PROJECT_MENU`，跑一次看它失败：`cd web && $CLEAN npx vitest run src/features/sidebar/entries.test.ts`。再在 `ADDED` 加 `'project:edit'`。
- [ ] **Step 2: ProjectDialog**（模态，外壳跟 `ui/dialog.tsx` 的宿主一样：`.modal-bg` 包 `.modal`，它导出什么壳就复用什么，没有就照它的标记和 Escape 处理写一份。Escape / Enter 先问 `imeComposing()`）：
  - 标题 `tr('编辑项目')`；「名字」输入框；「源文件夹」列表：第一行主文件夹（灰色 `tr('主文件夹')` 标签，不能删），其余每行路径 + `×`（`aria-label={tr('移除 {path}', …)}`），列表下面「添加文件夹」按钮（桌面版 `desktop.pickDir()`，网页版 `ws.request({ kind: 'fs.pickDir' })`；跟已有的重复或等于主文件夹时 toast `tr('这个文件夹已经在项目里了')`）。
  - 说明一行：`tr('新开的对话会同时看到这些文件夹；正在运行的对话下次打开时生效。')`，以及 `tr('Claude 和 Codex 能用额外的文件夹，其它 agent 只用主文件夹。')`（Task 3 核对后 Codex 不支持的话，这句改成只写 Claude）。
  - 左下红色 `tr('从侧栏移除项目')`：`dlg.confirm(tr('从侧栏移除「{name}」？'), { message: tr('只移除侧栏里的这条记录，不动磁盘上的文件。') })` → `ws.request({ kind: 'workspaces.remove', id })`。
  - 右下 `tr('取消')` / `tr('保存')`：保存 = `updateWorkspace(id, { name, folders })`，服务端报错（文件夹不存在）就 toast，对话框不关。
  - `store.updateWorkspace`：`await ws.request({ kind: 'workspaces.update', id, ...patch })`，然后用返回值替换 `workspaces` 里那一项（新数组，引用稳定的写法跟 `reorderWorkspaces` 一样）；失败时 toast 并 `loadMeta()`。
- [ ] **Step 3: RootGroups + 面板**：`roots.length <= 1` 时直接 `children(roots[0] ?? '')`；多个时每个文件夹一个可折叠组（头部是文件夹名 `basename` + 完整路径做 tooltip，默认展开，折叠状态用组件 state，不持久化），组内 `children(root)`。
  - `FilesView.tsx:77`：`<RootGroups roots={roots}>{(r) => <FileTree root={r} gitStatus={r === cwd ? gitStatus : undefined} />}</RootGroups>`，其中 `roots = useMemo(() => projectRoots(cwd, workspaces), [cwd, workspaces])`，`workspaces = useStore((s) => s.workspaces)`。:79 的 `SearchView` 同样每个根一个。
  - `ChatTile.tsx:280-282` 三处同样包 `RootGroups`；`ReviewView.tsx:414` 的 `GitView` 也包（每个文件夹各自 `git.status`，不是 git 仓库的组显示 `tr('{cwd} 不是 git 仓库。')`，跟 :415 一样）。
  - 远端对话（`peer`）不变：只看主文件夹（`FilesView` 在 :52 已经提前返回了）。
- [ ] **Step 4: @文件**（Composer :362-376）：`const atRoots = useMemo(() => (atRoot ? projectRoots(atRoot, workspaces) : []), [atRoot, workspaces])`；effect 里对每个根并行发 `fs.findFiles`（每个 `limit: 30`）。主文件夹的结果保持相对路径，额外文件夹的结果用 `joinPath(root, f)` 变成绝对路径，合并后取前 30 条。依赖里加 `atRoots.join('\u0000')`。
- [ ] **Step 5: 跑** — `cd web && $CLEAN npx vitest run src/features && $CLEAN npx tsc --noEmit -p .`；`node scripts/i18n/extract.mjs --check`
- [ ] **Step 6: Commit**
  `git add web/src/features/sidebar/ProjectDialog.tsx web/src/features/workbench/RootGroups.tsx web/src/features/sidebar/groups.tsx web/src/features/sidebar/entries.ts web/src/store/index.ts web/src/features/workbench/FilesView.tsx web/src/features/workbench/tiles/ChatTile.tsx web/src/features/workbench/ReviewView.tsx web/src/features/composer/Composer.tsx web/src/App.tsx`（`ProjectDialog` 挂在哪个外壳文件就写哪个），再加上英文目录文件
  `git commit -m "feat(projects): 编辑项目 dialog (name, folders, remove from sidebar); files / search / git / @file list every folder of the project"`

---

### Task 7: 侧栏「显示」菜单

**Files:**
- Create: `web/src/features/sidebar/view-menu.tsx`（取代 `filter-menu.tsx`）
- Delete: `web/src/features/sidebar/filter-menu.tsx`（`SourceChip` 类型挪进 `view-menu.tsx`）
- Modify: `web/src/features/sidebar/Sidebar.tsx`（:107-109 `filterSessions` 带 `otherAgents`；:129-150 改用 `groupSessions`；:172-179 `renderedRows` 用 `perGroupLimit`；:293-307 漏斗换成「显示」按钮 + `ViewMenu`；按 `groupBy` 画区；自建分区）
- Modify: `web/src/features/sidebar/groups.tsx:45` 附近（`Group` 加 `first?: number` 属性，默认 `PAGE_FIRST`，用来代替 `PAGE_FIRST`）
- Modify: `web/src/features/sidebar/entries.ts`（见下）、`entries.test.ts`（不用改代码，表要自洽）
- Modify: `web/src/store/index.ts`（加 `setShowArchived(v: boolean): void`；`loadMeta` :508 在 `set` 里补 `showArchived: readView(settings[VIEW_KEY]).show.archived`）
- Modify: `web/src/features/palette/CommandPalette.tsx:73`、`web/src/features/home/HomeLists.tsx:61`（改调 `setShowArchived`）

**Interfaces:**
- Consumes: Task 4 全部；`setSetting`；`Menu`（`menus.tsx`）；`MIME_SESSION`（`workbench/dnd.ts:2`）；`dlg.prompt` / `dlg.confirm`。
- Produces: `ViewMenu(props: { onClose(): void; view: SidebarView; setView(v: SidebarView): void; query: string; setQuery(q: string): void; sources: SourceChip[]; counts: Record<string, number>; total: number; source: AgentKind | 'all'; setSource(k: AgentKind | 'all'): void; machines: MachineCount[]; machine: string; setMachine(id: string): void; showMachines: boolean; onSelect(): void; onNewSection(): void; onReset(): void; onAll(): void })`；store `setShowArchived(v: boolean)`：`set({ showArchived: v })`，并 `setSetting(VIEW_KEY, { ...readView(get().settings[VIEW_KEY]), show: { ...…show, archived: v } })`。
- `entries.ts`：`PROJECTS_HEAD = ['view', 'add-project']`；`FILTER` 改名 `VIEW = ['query', 'source', 'machine', 'group-by', 'sort-by', 'archived', 'other-agents', 'per-group', 'select', 'new-section', 'reset', 'all', 'library']`；`PLACES.filter` 改成 `PLACES.view`；新增一个 place `custom: ['custom-section', 'custom-rename', 'custom-delete', 'custom-out']`；`SECTIONS` 加 `'custom'`；`LEGACY` 里原来指向 `filter:*` 的四条（显示已归档、来源 chip 行、机器 chip 行、筛选会话…）改指 `view:*`，「选择（多选）…」改成 `['view:select', 'row:select-bar']`；`ADDED` 里 `'head:filter'` 换成 `'head:view'`，`'filter:library'` 换成 `'view:library'`，再加上 `'view:group-by'`、`'view:sort-by'`、`'view:other-agents'`、`'view:per-group'`、`'view:new-section'`、`'view:reset'`、`'view:all'`、`'section:custom'`，以及四个 `custom:*`。类型 `FilterId` 改名 `ViewId`，再加 `CustomId`。

- [ ] **Step 1: 失败测试**：先只改 `entries.ts`，然后跑 `cd web && $CLEAN npx vitest run src/features/sidebar/entries.test.ts`，在表补齐之前应该失败；补齐后通过。`tsc` 会在 `filter-menu.tsx` 的 `FilterId` 上报错，这样就能确认旧引用一个不落。

- [ ] **Step 2: ViewMenu**（`<Menu className="sb-view" label={tr('显示')}>`，一个菜单装下全部，没有嵌套菜单）：
  - 筛选框 `data-id="query"`：沿用 `filter-menu.tsx:45-49`，包括挂载后 `focus({ preventScroll: true })`。
  - 「分组方式 ›」`data-id="group-by"`：按钮带 `aria-expanded`，点开后在下面原地展开四个 `menuitemradio`：文件夹 / 项目 / 日期 / 不分组。行尾灰字显示当前选项。
  - 「排序 ›」`data-id="sort-by"`：同样原地展开：最近更新 / 创建时间 / 名称。
  - 「显示」标签下：`menuitemcheckbox` 显示已归档的对话 `data-id="archived"`（调 `setShowArchived`）；其它 agent 的对话 `data-id="other-agents"`；「每组 ›」`data-id="per-group"` 原地展开 5 / 10 / 全部。
  - 来源 `data-id="source"`、机器 `data-id="machine"`（只在 `showMachines` 时出现）：沿用 `filter-menu.tsx:50-75`。
  - 分隔线以下：选择多个… `data-id="select"`；新建分区… `data-id="new-section"`；恢复默认 `data-id="reset"`；查看全部 `data-id="all"`（`onAll` = `useStore.setState({ paletteOpen: true })`，跟 `HomeLists.tsx:62` 一样）；管理对话来源… `data-id="library"`。
  - 选项点了立刻生效，菜单不关。只有「选择多个」「新建分区」「查看全部」「管理对话来源」会关菜单。
  - `setView(v)` = `setSetting(VIEW_KEY, v)`。`onReset` 写 `DEFAULT_VIEW`，并调 `setShowArchived(false)`。自建分区不会被「恢复默认」清掉。

- [ ] **Step 3: Sidebar.tsx**：
  - `view = useMemo(() => readView(rawView), [rawView])`，其中 `rawView = useStore((s) => s.settings[VIEW_KEY])`。设置对象里的值引用是稳定的，所以可以直接选。`sections` 同理：`readSections(s.settings[SECTIONS_KEY])`。
  - :107/:109/:111 三处 `filterSessions` 都带上 `otherAgents: view.show.otherAgents`。
  - :129-144 换成 `const groups = useMemo(() => groupSessions(visible, view, { workspaces, meta: sessionMeta, now: Date.now() }), [visible, view, workspaces, sessionMeta])`。按 `kind` 分成 `projects`、`folders`（`[cwd, items][]`，继续喂给 `splitFolders` / `folderLabels`）、`dates`、`all`、`peers`。
  - 画法：
    - `groupBy === 'project'`：跟现在一样，项目区 + 文件夹区 + 其它电脑。
    - `'folder'`：没有项目区，只有一个「文件夹」区放全部文件夹。某个文件夹等于项目主文件夹时，组名用项目名，组头上还是项目菜单。
    - `'date'`：一个区，组名分别是 `tr('今天')`、`tr('昨天')`、`tr('最近 7 天')`、`tr('最近 30 天')`、`tr('更早')`，`Group` 的 `icon="clock"`（没有这个图标就用 `history`，先在 `ui/icons` 里确认）。
    - `'none'`：一个区，平铺所有行（`Group section`）。
  - 「项目」标题行换成「对话」的写法：`groupBy === 'project'` 时标题仍是 `trAs('项目', 'Projects')`，其它情况是 `tr('对话')`。行里只留「显示」按钮 `data-id={head('view')}`（`Icon name="filter"`，有筛选、显示已归档或视图不是默认值时带 `.fdot`，静止时透明，规则跟原来的漏斗一样）和 `add-project`。外框控件数量不变，仍是 16。
  - `renderedRows` :172-179 的 `PAGE_FIRST` 换成 `perGroupLimit(view)`，组的列表跟画出来的一致（日期组、平铺组、自建分区都要算进去）。`Group` 传 `first={perGroupLimit(view)}`。`groups.tsx` 里 `limit > PAGE_FIRST` 改成 `limit > first`（`first` 是 `Infinity` 时不出「收起」）。
  - 自建分区画在置顶下面、主分组上面。区头 `data-id="custom-section"`，接受 `MIME_SESSION` 的拖放：`onDragOver` 里 `preventDefault`，`onDrop` 里 `setSetting(SECTIONS_KEY, addToSection(sections, id, sid))`。区头右键或 ··· 打开 `Menu`，里面有重命名 `data-id="custom-rename"`（`dlg.prompt`）和删除分区 `data-id="custom-delete"`（`dlg.confirm`，提示 `tr('只删除这个分区，对话还在原来的分组里')`）。分区里每一行悬停时出现 × `data-id="custom-out"`（`removeFromSection`）。分区里的对话仍然出现在原来的分组里。分区内的行按 `view.sortBy` 排序，被筛掉或已删除的 id 不画。
  - 新建分区：`dlg.prompt(tr('分区名称'))`，id 用 `` `sec-${Date.now().toString(36)}` ``，再用 `addSection` 写回。
  - 侧栏的 `menu` 状态键从 `'filter'` 改成 `'view'`，新增 `'custom:<id>'`。
- [ ] **Step 4: store 和其它调用方**：加 `setShowArchived`，在 `loadMeta` 里回填 `showArchived`；`CommandPalette.tsx:73` 和 `HomeLists.tsx:61` 改调 `useStore.getState().setShowArchived(…)`（HomeLists 还要同时设 `sidebarOpen: true`）。
- [ ] **Step 5: 跑** — `cd web && $CLEAN npx vitest run src/features/sidebar src/store && $CLEAN npx tsc --noEmit -p .`；`node scripts/i18n/extract.mjs --check`
- [ ] **Step 6: Commit**
  `git add web/src/features/sidebar/view-menu.tsx web/src/features/sidebar/filter-menu.tsx web/src/features/sidebar/Sidebar.tsx web/src/features/sidebar/groups.tsx web/src/features/sidebar/entries.ts web/src/store/index.ts web/src/features/palette/CommandPalette.tsx web/src/features/home/HomeLists.tsx web/src/styles.css`，再加上英文目录文件（`filter-menu.tsx` 已删除，`git add` 会把删除一起记下）
  `git commit -m "feat(sidebar): one 显示 menu — group by / sort / show / per group, own sections, the old funnel's filters folded in"`

---

### Task 8: ui-smoke、e2e、全量测试、笔记

**Files:**
- Modify: `scripts/ui-smoke.cjs`（侧栏段 :2255-2400 和 :2801-2811；chat-permission 段；新段 `stage-c`）
- Modify: `docs/notes/ui-redesign-5-chat.md`（问答卡）、`docs/notes/ui-redesign-4-sidebar.md`（显示菜单、入口表）、`docs/notes/ui-redesign-0-1.md:23`（外框控件计数）、`docs/notes/phase03-files-git.md`（多根面板）、`docs/notes/mirasim.md`（meta.json 新键 `folders`、`ui.sidebar.view`、`ui.sidebar.sections`）、`docs/notes/phase05-agents.md`（Codex / ACP 额外文件夹）
- Modify: spec 末尾加一节「阶段 C 完成后留下的」

- [ ] **Step 1: 改 ui-smoke 的旧选择器**：用 `grep -n 'data-id="filter"\|sb-filter\|filter:' scripts/ui-smoke.cjs` 找到所有位置（已知 :2271、:2290、:2336、:2339、:2369、:2392、:2801、:2811），全部改成 `data-id="view"` 和 `.menu.sb-view`；`SCOPES` 里 `filter` 改成 `view`，再加 `custom: '.sidebar [data-id="custom-section"], .sidebar .sb-custom [data-id], .menu.sb-custom-menu [data-id]'`；:2336 的 `has(sb.head, ['filter', …])` 改成 `['view', 'add-project']`；:2361 那条 funnel 菜单断言改成 `has(fm, ['query', 'source', 'group-by', 'sort-by', 'archived', 'other-agents', 'per-group', 'select', 'new-section', 'reset', 'all', 'library'])`，并确认菜单在窗口内。
- [ ] **Step 2: 新段 `stage-c`**：
  - 问答卡：往 `open[SID].pending` 注入一个两题的 AskUserQuestion（第二题多选，选项带 `preview`），页面里包一层 `WebSocket#send` 记下 `permission.respond` 帧（照 chat-permission 段的写法）。断言：
    - 卡片在 `.chat-inner` 里、在 `.plan-dock` 前面，不在 `.pdock` 里，输入框上方仍是 RunCard。
    - 显示「1 / 2」，按数字 `1` 选中第一项，`Enter` 翻到「2 / 2」，`‹` 回去后第一题的选择还在。
    - 预览：焦点移到带 `preview` 的选项时，`.ask-preview` 出现。
    - 「其它」被选中后输入框出现并获得焦点。
    - IME：派发 `isComposing: true` 的 Enter，页码不变。
    - Ctrl+Enter 在最后一题上发出 `permission.respond`，`updatedInput.answers` 等于预期字符串（多选是用逗号连接的标签，跳过的题是 `（用户跳过）`）。
    - 再注入一张卡，两题都点「跳过」，发出的是 `behavior: 'deny'`。
    - 卡片在场时侧栏「需要你」有这一行，回答后消失。
    - 输入框空着按 Enter（等过 600 ms 冷却）时焦点进卡片，没有发出任何帧。
  - 项目对话框：右键项目 → `[data-id="edit"]`，对话框里有主文件夹行（没有 ×）；用 `ws.request workspaces.update` 加一个临时文件夹后，文件面板出现两个 `.root-group`；对话框的「取消」不发请求；「从侧栏移除项目」弹出 `dlg` 确认，取消后项目还在。
  - 显示菜单：分组依次切到项目 / 文件夹 / 日期 / 不分组，每次断言组的结构（日期组名是「今天」等，不分组时没有 `.sb-group-head`）；排序切到「名称」后行按标题排序；「每组 10」后能看到更多行；「其它 agent 的对话」关掉后注入的 codex 行消失；「显示已归档」打开后 `__store.getState().showArchived` 为真，`settings['ui.sidebar.view']` 也写进去了；新建分区（拦截 `dlg.prompt` 返回名字），把一行拖进去（`DataTransfer` 带 `MIME_SESSION`，派发 `drop`），这一行同时出现在分区和原分组里，× 移出；「恢复默认」后视图回到默认值，分区还在；「查看全部」打开命令面板。
  - 收集 `custom` 和 `view` 两个 place 的 id，最后的 `PLACES` 全覆盖断言照常跑。
  - 静止时透明那条（:2339）改断言 `[data-id="view"]`。
- [ ] **Step 3: 全量**：
  - `$CLEAN npm run typecheck`
  - `$CLEAN npm test`
  - `$CLEAN npm run build:all`
  - `$CLEAN npm run e2e`
  - `$CLEAN node scripts/ui-smoke.cjs`
  - `node scripts/i18n/extract.mjs --check`

  ui-smoke 只用临时 `--user-data-dir`、`HOME`、`CLAUDE_WEB_DIR` 启动（脚本自带）。已知偶发：ui-smoke 审阅评论那条、e2e 第 6 期端口被占，遇到时单独重跑那一项，并在交付时写明。
- [ ] **Step 4: 真机走一遍**（临时 HOME）：建一个两个文件夹的项目，在项目里开对话，让 Claude 读额外文件夹里的文件（没有真模型就看 e2e 33 的假上游请求，并写明）；Claude 问一个三题的问题，用键盘答完。
- [ ] **Step 5: 笔记**：
  - 问答卡：在对话里、防误触（不抢焦点，空 Enter 只把焦点移进卡片）、答案格式、全部跳过 = 拒绝。
  - 项目：`folders` 读的时候补 `[]`、`workspaces.update` 检查路径、只在新开的对话里生效、Codex 的参数名核对结果、ACP 不支持、额外文件夹是 UNC 信任根。
  - 侧栏：显示菜单在同一个菜单里原地展开（因为全局只能有一个锚定菜单）、入口表的改名（filter → view，新增 custom）、外框控件计数仍是 16（一个按钮换一个按钮）、`showArchived` 现在会持久化。
  - spec 末尾写验证缺口：mac 没有真机；Codex 没有 e2e。
- [ ] **Step 6: Commit**
  `git add scripts/ui-smoke.cjs docs/notes/ui-redesign-5-chat.md docs/notes/ui-redesign-4-sidebar.md docs/notes/ui-redesign-0-1.md docs/notes/phase03-files-git.md docs/notes/mirasim.md docs/notes/phase05-agents.md docs/superpowers/specs/2026-10-24-desktop-parity-design.md`
  `git commit -m "test: stage C ui-smoke (question card, project dialog, 显示 menu); notes"`
