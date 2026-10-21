# 字符画主题 · 第 1 步：骨架 + 磷光 / 纸刊 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通「主题包 → 配色 / 背景 / 过程动画」整条链路，并交付磷光（暗）和纸刊（亮）两套内置字符画主题。

**Architecture:** 主题包（theme.json + backdrop.js + theme.css）在 `web/src/themes/` 下解析成 `ThemePack`；
选中 `ui.theme = 'ascii:<id>'` 时，`data-theme` 取包的亮暗（dark / light，现有亮暗规则全部照用），另设 `html[data-ascii="<id>"]`，
并注入 `<style id="cw-ascii-theme">`（配色块 + theme.css）。背景由 `<Backdrop>` 把 canvas 交给模块 Worker，Worker 里先拆掉联网能力再跑 backdrop 源码；
宿主看门狗。过程动画由纯函数 `processOf / runProcess` 判定，`<ProcessGlyph>` 用一个共享时钟直接改 DOM 文本播放帧表。

**Tech Stack:** React 18 + zustand、Vite（`?raw` 导入、`new Worker(new URL(...), { type: 'module' })`）、OffscreenCanvas、vitest（node 环境）。

## Global Constraints

- 用户看得见的字一律 `tr('中文')`，英文进 `web/src/i18n/en.ts`；改完跑 `node scripts/i18n/extract.mjs --check`。
- 不出现 档案 / 引擎 / 窗格 / 停靠 / effort / ultracode / ACP；叫「对话」不叫「会话」。
- UI 设置存 meta.json（`settings.set`），不新增 localStorage（已有的 `cw.theme` 首帧缓存不动）。
- zustand 选择器返回稳定引用。
- 相对设计文档的变更（已写回 spec）：钩子用 `html[data-ascii]`，`data-theme` 仍是 dark / light；「字流 / 字场」不迁移，经典主题和背景兜底继续用现有组件。
- 跑测试前 `env -u CLAUDE_CODE_ENTRYPOINT -u ELECTRON_RUN_AS_NODE`（见 CLAUDE.md）。
- 提交身份 `ypyik0669`；不提交 `web/src/features/gateway/AccountsTab.tsx`（用户未提交的改动）。

---

### Task 1: 过程判定 `processOf` / `runProcess`

**Files:**
- Create: `web/src/themes/process.ts`
- Create: `web/src/themes/process.test.ts`
- Modify: `web/src/features/chat/run-status.ts`（RunStatus 加 `process` 字段）

**Interfaces:**
- Produces: `type Process`、`PROCESSES`、`processOf(name: string, input: Record<string, unknown> | undefined): Process`、
  `RunStatus.process: Process`（thinking 且本回合还没有 assistant 输出 → `start`）。

- [ ] **Step 1: 写失败的测试** `process.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { PROCESSES, processOf } from './process';

describe('processOf', () => {
  const cmd = (command: string) => processOf('Bash', { command });
  it('maps tools by name', () => {
    expect(processOf('Read', {})).toBe('read');
    expect(processOf('Grep', {})).toBe('search');
    expect(processOf('Glob', {})).toBe('search');
    expect(processOf('Edit', {})).toBe('edit');
    expect(processOf('Write', {})).toBe('edit');
    expect(processOf('MultiEdit', {})).toBe('edit');
    expect(processOf('NotebookEdit', {})).toBe('edit');
    expect(processOf('WebSearch', {})).toBe('web');
    expect(processOf('WebFetch', {})).toBe('web');
    expect(processOf('mcp__web__search', {})).toBe('web');
    expect(processOf('Agent', {})).toBe('agent');
    expect(processOf('Task', {})).toBe('agent');
    expect(processOf('Workflow', {})).toBe('agent');
    expect(processOf('TodoWrite', {})).toBe('plan');
    expect(processOf('ExitPlanMode', {})).toBe('plan');
    expect(processOf('mcp__github__create_issue', {})).toBe('tool');
    expect(processOf('Skill', {})).toBe('tool');
  });
  it('reads a command for test / git / install', () => {
    expect(cmd('npm test -w web')).toBe('test');
    expect(cmd('cd web && npx vitest run')).toBe('test');
    expect(cmd('pytest -q')).toBe('test');
    expect(cmd('cargo test')).toBe('test');
    expect(cmd('git push origin main')).toBe('git');
    expect(cmd('git commit -m "x" && npm test')).toBe('git');
    expect(cmd('npm install')).toBe('install');
    expect(cmd('npm i -D vitest')).toBe('install');
    expect(cmd('pip install requests')).toBe('install');
    expect(cmd('ls -la')).toBe('cmd');
    expect(processOf('PowerShell', { command: 'Get-ChildItem' })).toBe('cmd');
    expect(processOf('Bash', undefined)).toBe('cmd');
  });
  it('has sixteen processes', () => expect(PROCESSES.length).toBe(16));
});
```

- [ ] **Step 2: 跑测试确认失败**：`npm test -w web -- src/themes/process.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 实现** `process.ts`

```ts
// What a running step is doing, in the sixteen words the process animations are drawn for (spec 2026-10-22 §3).
export const PROCESSES = ['start', 'think', 'read', 'search', 'edit', 'cmd', 'test', 'git', 'install', 'web', 'agent', 'plan', 'tool', 'wait', 'compact', 'connect'] as const;
export type Process = (typeof PROCESSES)[number];

const BY_NAME: Record<string, Process> = {
  Read: 'read', NotebookRead: 'read', Grep: 'search', Glob: 'search', LS: 'search',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  WebSearch: 'web', WebFetch: 'web', WebBrowser: 'web',
  Agent: 'agent', Task: 'agent', Workflow: 'agent',
  TodoWrite: 'plan', EnterPlanMode: 'plan', ExitPlanMode: 'plan',
};
const SHELLS = new Set(['Bash', 'PowerShell', 'BashOutput']);
const GIT = /^\s*git\s/;
const TEST = /\b(npm (run )?test|pnpm (run )?test|yarn test|bun test|deno test|vitest|jest|pytest|mocha|playwright test|cargo test|go test|dotnet test|mvn test|gradle test|phpunit|rspec)\b/;
const INSTALL = /\b(npm (i|install|ci)|pnpm (i|install|add)|yarn (add|install)|pip3? install|uv (add|sync|pip install)|cargo (add|install)|go get|bun (i|install|add)|brew install|apt(-get)? install|winget install)\b/;

export function processOf(name: string, input: Record<string, unknown> | undefined): Process {
  const byName = BY_NAME[name];
  if (byName) return byName;
  if (SHELLS.has(name)) {
    const c = typeof input?.command === 'string' ? input.command : '';
    if (GIT.test(c)) return 'git';
    if (TEST.test(c)) return 'test';
    if (INSTALL.test(c)) return 'install';
    return 'cmd';
  }
  if (name.startsWith('mcp__web__') || name.startsWith('mcp__browser')) return 'web';
  return 'tool';
}
```

- [ ] **Step 4: RunStatus 加 `process`**：`run-status.ts` 里 import `processOf, type Process`；`RunStatus` 加 `process: Process`；
  在已有的 `done/total` 循环里记 `outSinceUser`（遇到 user 非 meta 置 false，遇到 assistant 置 true）；
  `process = kind === 'compacting' ? 'compact' : kind === 'waiting' ? 'wait' : kind === 'tool' ? processOf(rt!.name, rt!.input) : outSinceUser ? 'think' : 'start'`。
  在 `run-status.test.ts` 加两条：没有 assistant 项时 process 为 `start`；runningTool 是 Edit 时为 `edit`。

- [ ] **Step 5: 跑测试**：`npm test -w web -- src/themes src/features/chat/run-status` → PASS。

- [ ] **Step 6: Commit** `feat(themes): 过程判定（16 个过程）`

### Task 2: 帧表格式与校验

**Files:**
- Create: `web/src/themes/frames.ts`、`web/src/themes/frames.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Frame = string[];                                   // 1–2 行
  interface InlineClip { fps?: number; loop: string[]; done?: string[]; fail?: string[] }
  interface ProcessAnim { fps: number; loop: Frame[]; done?: Frame[]; fail?: Frame[]; color?: Record<string, ColorToken>; inline?: InlineClip }
  const STAGE_ROWS = 2, STAGE_COLS = 14, INLINE_COLS = 3;
  const COLOR_TOKENS: readonly string[];                  // accent accent-text green red yellow blue fg fg-1 fg-2 fg-3 agent-1..10
  function strWidth(s: string): number;                    // 等宽格数，CJK / 全角算 2
  function checkAnim(a: unknown): string[];                // 空数组 = 合规
  ```

- [ ] **Step 1: 测试**

```ts
import { describe, expect, it } from 'vitest';
import { checkAnim, strWidth } from './frames';

const ok = { fps: 8, loop: [['✎  ', '───'], ['a✎ ', '───']], done: [['a ✓', '───']], color: { '✓': 'green' }, inline: { loop: ['✎', '✐'] } };
describe('frames', () => {
  it('measures cells', () => { expect(strWidth('ab')).toBe(2); expect(strWidth('字')).toBe(2); expect(strWidth('▓░')).toBe(2); });
  it('accepts a good clip', () => expect(checkAnim(ok)).toEqual([]));
  it('rejects uneven frames', () => expect(checkAnim({ ...ok, loop: [['ab'], ['abc']] }).join()).toMatch(/宽度/));
  it('rejects too wide / too tall', () => {
    expect(checkAnim({ ...ok, loop: [['x'.repeat(15)]] }).join()).toMatch(/14/);
    expect(checkAnim({ ...ok, loop: [['a', 'b', 'c']] }).join()).toMatch(/2 行/);
  });
  it('rejects an unknown colour and a missing loop', () => {
    expect(checkAnim({ ...ok, color: { x: '#f00' } }).join()).toMatch(/颜色/);
    expect(checkAnim({ fps: 8 }).join()).toMatch(/loop/);
  });
  it('rejects a wide inline frame and a silly fps', () => {
    expect(checkAnim({ ...ok, inline: { loop: ['abcd'] } }).join()).toMatch(/3/);
    expect(checkAnim({ ...ok, fps: 0 }).join()).toMatch(/fps/);
  });
});
```

- [ ] **Step 2: 确认失败。**
- [ ] **Step 3: 实现** `frames.ts`：`strWidth` 用码点区间（U+1100–115F、U+2E80–A4CF、U+AC00–D7A3、U+F900–FAFF、U+FE30–FE4F、U+FF00–FF60、U+FFE0–FFE6、U+20000+ 算 2；U+0300–036F、U+200B–200F、U+FE0F 算 0；其余 1）。
  `checkAnim`：fps 为 1–30 的数；loop 非空数组；loop/done/fail 每帧是 1–2 个字符串，同一个动画里所有帧行数相同、每行宽度相同、宽度 ≤14；
  color 的值都在 COLOR_TOKENS 里；inline.loop 非空、每帧宽度 ≤3、inline.fps 若有须 1–30。错误信息中文（这是给 skill 看的，不进 `tr`）。
- [ ] **Step 4: PASS。**
- [ ] **Step 5: Commit** `feat(themes): 帧表格式与校验`

### Task 3: 主题包解析、配色块、内置注册表、默认帧表

**Files:**
- Create: `web/src/themes/pack.ts`、`web/src/themes/pack.test.ts`
- Create: `web/src/themes/default-anims.ts`（16 个过程的默认帧，经典主题用、主题缺项时兜底）
- Create: `web/src/themes/builtin/index.ts`（先空数组 `BUILTIN: ThemePack[] = []`，Task 7/8 往里加）
- Create: `web/src/themes/registry.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ThemePack { id: string; name: { zh: string; en: string }; mode: 'dark' | 'light'; colors: Record<string, string>;
    chatDim: { opacity: number; speed: number }; processes: Partial<Record<Process, ProcessAnim>>; backdrop?: string; css?: string }
  const REQUIRED_COLORS: readonly string[];  // bg bg-1 bg-2 bg-3 bg-elev fg fg-1 fg-2 fg-3 accent accent-text accent-fg primary primary-fg user-bg green red yellow blue agent-1..10
  function parsePack(raw: unknown, extra?: { backdrop?: string; css?: string }): { pack?: ThemePack; errors: string[] }
  function paletteCss(p: ThemePack): string     // `:root[data-ascii='<id>'] { --bg: …; …; color-scheme: dark; }`
  function sanitizeCss(css: string): string     // 去掉 @import 远程、url(http…) / url(//…)
  function animFor(p: ThemePack | null, proc: Process): ProcessAnim   // 合规的包内动画，否则 DEFAULT_ANIMS[proc]；inline 缺省取默认的 inline
  // registry.ts
  function asciiId(v: unknown): string | null   // 'ascii:phosphor' → 'phosphor'
  function getPack(id: string | null): ThemePack | null
  function listPacks(): ThemePack[]
  ```
- `DEFAULT_ANIMS: Record<Process, ProcessAnim>`：只用 accent / fg-2 / green / red / yellow，每个有 inline。

- [ ] **Step 1: 测试** `pack.test.ts`：
  - 一份合规的最小包（全部 REQUIRED_COLORS 为 hex，processes 为空）→ `errors` 为空，`chatDim` 缺省为 `{ opacity: 0.12, speed: 0.33 }`。
  - 缺 `--fg`、颜色不是 hex、id 含大写或空格、mode 不是 dark/light → 各自报错。
  - processes 里一个坏动画 → 报错带过程名，且 `animFor(pack, 'edit')` 回到 `DEFAULT_ANIMS.edit`。
  - 未知过程名 → 报错。
  - `paletteCss` 输出包含 `:root[data-ascii='mini']`、`--bg: #000000;`、`color-scheme: dark`。
  - `sanitizeCss('@import url(https://x/y.css); a{background:url(http://x/a.png)} b{background:url(data:image/png;base64,AA)}')`
    不含 `https://x` / `http://x`，保留 `data:`。
  - `DEFAULT_ANIMS` 的 16 个过程 `checkAnim` 都为空、都有 inline。
- [ ] **Step 2: 确认失败。**
- [ ] **Step 3: 实现**。hex 正则 `/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i`；id 正则 `/^[a-z0-9][a-z0-9-]{0,31}$/`；
  可选颜色（shade、shade-a、line、line-1、e1–e3 等）允许任意不含 `;{}<>` 的字符串，也写进配色块。
  `sanitizeCss`：`css.replace(/@import\s+(url\()?\s*['"]?\s*(https?:)?\/\/[^;]*;?/gi, '').replace(/url\(\s*['"]?\s*(https?:)?\/\/[^)]*\)/gi, 'none')`。
  默认帧示意（编辑）：`loop: [['▏      '], ['▍▏     '], ['▍▍▏    '], ['▍▍▍▏   ']], done: [['▍▍▍ ✓  ']], inline: { loop: ['✎', '✐'], done: ['✓'] }`，其余 15 个照「设计第 2 段」的叙事画朴素版。
- [ ] **Step 4: PASS。**
- [ ] **Step 5: Commit** `feat(themes): 主题包解析、配色块、默认过程动画`

### Task 4: 主题接入设置与对比度测试

**Files:**
- Modify: `web/src/features/settings/ui-settings.ts`（`UiTheme` 加 `` `ascii:${string}` ``；`resolveTheme` 对 ascii 返回包的 mode；`applyUiSettings` 设 / 删 `data-ascii`，调 `applyAscii`）
- Create: `web/src/themes/apply.ts`（`applyAscii(id: string | null)`：维护 `<style id="cw-ascii-theme">` 的内容 = `paletteCss + sanitizeCss(css)`；
  救命开关 `setSafeMode()` / `isSafeMode()`，安全模式下 `applyAscii` 一律当 null）
- Modify: `web/src/store/index.ts`（store 加 `ascii: string | null`，在设置载入 / `ui.theme` 变化时更新，选择器 `useStore(s => s.ascii)`）
- Modify: `web/src/features/settings/ThemePicker.tsx`（`ThemeSwatches` 下面加「字符画」一行，色块取 `pack.colors` 的 bg / bg-1 / fg / accent，`pick('ascii:' + id)`）
- Modify: `web/src/ui/contrast.test.ts`（内置包纳入：完整 RULES 表 + 「every theme」三组）
- Modify: `web/src/App.tsx` 或已有的全局快捷键处：`Ctrl+Shift+0` → `setSafeMode()` 后重新 apply（不写设置）

- [ ] **Step 1: 测试**：`contrast.test.ts` 末尾加
  ```ts
  import { listPacks } from '@/themes/registry';
  describe('字符画主题：完整对比度表', () => {
    for (const p of listPacks()) {
      const t = { ...dark, ...p.colors };
      describe(p.id, () => {
        for (const r of RULES) for (const g of GROUNDS) it(`--${r.ink} on --${g} ≥ ${r.min}`, () => expect(pair(t, r.ink, g)).toBeGreaterThanOrEqual(r.min));
        it('ink order', () => { expect(pair(t, 'fg-1', 'bg')).toBeGreaterThan(pair(t, 'fg-2', 'bg')); expect(pair(t, 'fg-2', 'bg')).toBeGreaterThan(pair(t, 'fg-3', 'bg')); });
        for (let i = 1; i <= 10; i++) for (const g of ['bg', 'bg-1']) it(`--agent-${i} on --${g} ≥ 3`, () => expect(pair(t, `agent-${i}`, g)).toBeGreaterThanOrEqual(3));
      });
    }
  });
  ```
  加 `web/src/themes/registry.test.ts`：`asciiId('ascii:x') === 'x'`、`asciiId('dark') === null`；每个内置包 `parsePack` 无错、16 个过程齐全且合规（此时 BUILTIN 为空，Task 7 起生效）。
- [ ] **Step 2: 实现上面各文件**。store 里 `setSetting('ui.theme', v)` 现有路径调 `setTheme(resolveTheme(v), true)` —— 确认 `fromSettings=true`，否则会把 `ascii:x` 覆盖成 `dark`。
- [ ] **Step 3: `npm run typecheck` + `npm test -w web -- src/ui/contrast src/themes` PASS。**
- [ ] **Step 4: Commit** `feat(themes): ui.theme 支持 ascii:<id>，配色注入与救命开关`

### Task 5: `<ProcessGlyph>` 与替换现有转圈

**Files:**
- Create: `web/src/themes/ticker.ts`（共享时钟：注册 `{ el, frames: string[] /* 预渲染的 HTML */, fps, once, onEnd }`，有登记时每 1000/30 ms 跑一次，只在帧号变化时写 `el.innerHTML`）
- Create: `web/src/themes/render.ts`（纯函数 `frameHtml(frame: Frame, color?: Record<string,string>): string`：逐字转义，带色字符包 `<b style="color:var(--x)">`，行之间 `\n`）+ 测试
- Create: `web/src/themes/ProcessGlyph.tsx`
- Create: `web/src/styles/process-glyph.css`（在 `main.tsx` 里 chat.css 之后 import）
- Modify: `web/src/features/chat/ToolCard.tsx`（StepGlyph：运行中 → `<ProcessGlyph process={processOf(t.name, t.input)} />`；在视野里刚完成（`pop`）→ 先播 `phase="done"`，`onEnd` 后显示原图标；失败同理 `fail`）
- Modify: `web/src/features/chat/ChatView.tsx:208`（思考行 → `process="think"`；773「处理中」→ think，778 → think，783「正在启动」→ start，746「加载历史」→ read）
- Modify: `web/src/features/chat/RunCard.tsx`（`.pip.spark` → `<ProcessGlyph process={st.process} size="stage" />`）
- Modify: `web/src/features/composer/Composer.tsx:898`（发送键 `working` → `<ProcessGlyph process="start" />`）
- Modify: `web/src/features/chat/tools/AgentTool.tsx:36`（→ `process="agent"`）
- 断线条：grep 断线提示组件，把它的转圈换成 `process="connect"`

**Interfaces:**
- Consumes: `animFor`、`getPack`、store 的 `ascii`、`processOf`、`RunStatus.process`
- Produces: `ProcessGlyph({ process, size = 'inline', phase = 'loop', onEnd }: { process: Process; size?: 'inline' | 'stage'; phase?: 'loop' | 'done' | 'fail'; onEnd?: () => void })`

- [ ] **Step 1: 测试** `render.test.ts`：`frameHtml(['a<b'])` 转义成 `a&lt;b`；`frameHtml(['✓ '], { '✓': 'green' })` 含 `color:var(--green)`；两行用 `\n` 连接。
- [ ] **Step 2: 实现**。ProcessGlyph：`useStore(s => s.ascii)` → `getPack` → `animFor`；size=inline 用 `anim.inline`，stage 用整段；
  reduced motion（`matchMedia('(prefers-reduced-motion: reduce)')` 或 `data-reduce-motion='1'`）只画第一帧、done/fail 立即 onEnd；
  `aria-hidden`；`useLayoutEffect` 里向 ticker 登记，卸载时注销。`once` 段（done/fail）播完停在最后一帧再调 `onEnd`（多停 250 ms）。
  CSS：`.pg { font-family: var(--font-mono); white-space: pre; color: var(--accent-text); line-height: 1; user-select: none }`，
  `.pg.inline { font-size: 12px; display: inline-flex; justify-content: center; min-width: 16px }`，
  `.pg.stage { font-size: 8.5px; line-height: 9px; letter-spacing: 0 }`；
  把 `.work-dots` 的样式和 `WorkDots` 组件删掉（不再有引用后）。
- [ ] **Step 3: typecheck + `npm test -w web` PASS**；`npm run dev` 起来看一眼步骤行、思考行、状态条（经典深色主题下是默认帧）。
- [ ] **Step 4: Commit** `feat(themes): 过程动画替换转圈和四点`

### Task 6: 背景宿主、Worker 沙箱、看门狗、对话页淡背景

**Files:**
- Create: `web/src/themes/backdrop-worker.ts`、`web/src/themes/backdrop-protocol.ts`（消息类型）、`web/src/themes/sandbox.ts`（`lockdown(scope)`：拆网络 API；`loadBackdrop(source): BackdropModule`）+ `sandbox.test.ts`
- Create: `web/src/themes/watchdog.ts`（纯状态机）+ `watchdog.test.ts`
- Create: `web/src/themes/Backdrop.tsx`
- Modify: `web/src/features/workbench/Welcome.tsx:38-40`（ascii 主题且有 backdrop → `<Backdrop scene="welcome" />`，否则原逻辑）
- Modify: 对话视图容器（ChatView 的根）：`ui.backdropInChat !== false` 且 ascii 主题有 backdrop 时垫一层 `<Backdrop scene="chat" />`（`position:absolute; inset:0; pointer-events:none; z-index:0; opacity: chatDim.opacity`，内容层 `position:relative; z-index:1`）
- Modify: `web/src/features/settings/catalog.ts`（`SettingId` 加 `'ui.backdropInChat'`，条目放在 `ui.welcomeBackdrop` 后面：label `tr('对话里的淡背景')`，hint `tr('用字符画主题时，对话后面也垫一层很淡、很慢的背景；关掉就是纯色。')`）+ en.ts

**Interfaces:**
- backdrop 源码约定：`export default { init(ctx), frame(f), event(e), resize(r), theme(t) }`；`loadBackdrop` 把开头的 `export default` 换成 `return`，用 `new Function` 求值，缺 `frame` 报错。
- Worker 收：`init { canvas, source, width, height, dpr, colors, scene, reduce }`、`resize`、`pointer {x,y,down}`、`type {text}`、`process {process}`、`scene`、`colors`、`pause`、`resume`。
  Worker 发：`stats { avgMs }`（每秒一次）、`error { message }`。
- `frame({ t, dt, mouse, process, scene, speed })`：scene=chat 时 `speed = pack.chatDim.speed`、帧率上限 15，否则 30。
- watchdog：`feed(event, now)` → `'ok' | 'fail'`；`error` → fail；`stats.avgMs > 50` 连续两次 → fail；距上次 stats 超过 3000 ms（`tick(now)`）→ fail。
- 失败：terminate Worker，改画 `<LetterFlow />`，并用现有 toast 提示 `tr('这个主题的背景出了问题，已暂时换回默认')`。

- [ ] **Step 1: 测试**：
  - `sandbox.test.ts`：`lockdown(globalThis 的浅拷贝对象)` 后 `fetch / WebSocket / XMLHttpRequest / importScripts / EventSource` 为 undefined；
    `loadBackdrop('export default { frame(){} }')` 返回含 frame 的对象；`loadBackdrop('export default {}')` 抛错；语法错误抛错。
  - `watchdog.test.ts`：一次 error → fail；avgMs 60、60 → fail；60、20、60 → ok；3 秒无 stats → fail。
- [ ] **Step 2: 实现**。Worker 里帧循环用 `self.requestAnimationFrame`（缺则 `setTimeout`），按帧率上限跳帧；每帧 `performance.now()` 计时；
  `pause` 停循环。Backdrop.tsx：`canvas.transferControlToOffscreen()`，颜色用 `getComputedStyle(document.documentElement)` 读 REQUIRED_COLORS；
  `ResizeObserver`、`IntersectionObserver`、`visibilitychange` → pause/resume；`window` 的 `pointermove/pointerdown`（换算成 canvas 坐标）；
  composer 文本框 `input` 事件 → `type`（只取新增的字）；store 当前对话的 `runStatus(...).process`（没有在跑 → `'idle'` 不发）→ `process`；
  `key={pack.id}` 换主题即重建。
- [ ] **Step 3: typecheck + test PASS；i18n check。**
- [ ] **Step 4: Commit** `feat(themes): 背景跑在 Worker 里，带沙箱和看门狗；对话页淡背景`

### Task 7: 磷光主题

**Files:**
- Create: `web/src/themes/builtin/phosphor/theme.json`、`backdrop.js`、`theme.css`
- Modify: `web/src/themes/builtin/index.ts`（`import json from './phosphor/theme.json'`、`backdrop.js?raw`、`theme.css?raw` → `parsePack`）

内容要求：
- 配色：黑底磷光绿（bg `#040805` 一档档提亮到 bg-elev），accent 磷光绿，红 / 黄 / 蓝取偏亮的 CRT 色；必须通过 Task 4 的完整对比度表。
- backdrop：按列下落的字符雨，字符取 ` .:-=+*#%@` 按亮度；余辉（每帧盖一层半透明底色）；静态扫描线由 theme.css 的 `repeating-linear-gradient` 画在 `.welcome::after`（不进 Worker）；
  鼠标附近的列加亮成一个光圈；打的字出现在左下角 `> text█`，再碎成雨落下；`think` 时雨变密；`fail` 不需要。
- 16 个过程全部手画，stage 2 行 × ≤14 格，inline ≤2 格。招牌：think `[■□□□]` 内存条跳动；cmd `$ ls█` 光标打字；connect `NO CARRIER` → `CONNECT 9600`。
- theme.css：标题字体用 `ui-monospace` 加大字距（第 4 步再引入 VT323）；输入框 / 卡片 1px 磷光边 + 外发光；`.run-card` 方角。
- [ ] Step 1: 写三件套。 Step 2: `npm test -w web -- src/themes src/ui/contrast` PASS。 Step 3: dev 里切到磷光看欢迎页 / 对话页 / 步骤行。 Step 4: Commit `feat(themes): 磷光`

### Task 8: 纸刊主题（亮）

**Files:** `web/src/themes/builtin/paper/{theme.json,backdrop.js,theme.css}`，`builtin/index.ts` 加入（id `paper`，钩子 `data-ascii='paper'`，与经典 `data-theme='paper'` 不冲突）。

内容要求：
- 配色：米白纸、锈橙 accent、墨色正文；mode light；过完整对比度表。
- backdrop：字符点画的太阳（`·:*✳` 按半径分层）缓慢转动的光线、地平线细线、右上角 5×7 点阵数字时钟（当前时刻 HH:MM）；
  鼠标附近的光线弯向指针；打的字像铅字一样一个个印在地平线上方再淡去；`think` 时光线一明一暗。
- 16 个过程：招牌 edit 铅笔 `✎` 写字 → `✓`；read 书翻页 `[|=]` `[/=]` `[-=]` `[\=]`；git 信封封口盖章。
- theme.css：卡片锈橙细线、标题带装订孔装饰（`::before` 三个小圆）。
- [ ] Step 1–4 同 Task 7。 Commit `feat(themes): 纸刊`

### Task 9: 整体验证与笔记

- [ ] `npm run typecheck`、`env -u CLAUDE_CODE_ENTRYPOINT -u ELECTRON_RUN_AS_NODE npm test`、`node scripts/i18n/extract.mjs --check`、`npm run build:all`。
- [ ] `env -u ELECTRON_RUN_AS_NODE node scripts/ui-smoke.cjs`（控制台零报错）；在 dev 里两套主题各截欢迎页 / 对话页。
- [ ] 写 `docs/notes/ascii-themes.md`（结构、钩子、帧表格式、沙箱、坑），CLAUDE.md 索引加一行。
- [ ] 派 verification 子代理独立验收；Commit `docs(notes): 字符画主题`
