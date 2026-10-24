# 阶段 D：节点图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个共用的节点图组件，样子照用户的 mp4：画布很暗、带点阵；左上是标题和一行小字，右上是状态标签；卡片依次淡入，连线跟着画出来；`strong` / `error` 线发光，有光点沿线流动；普通线灰色，断开的线是虚线；线上有小标签；卡片里的行带下拉框，改了会给线换样式，状态标签也跟着重算；卡片下可以挂小列表；右下是缩放控件「− 116% +」；可以拖画布、拖卡片。这个组件用在三处：后台页的关系图（D2）、编排的执行图和编辑器预览（D3）、回答里的 ```nodegraph 代码块，以及 Mermaid flowchart 的「节点图 / 原图」切换（D4）。另外在 Claude Web 附加给 Claude 的说明里加几行格式说明，由设置 `ui.nodegraphHint` 控制，默认开。

**Architecture:** 纯逻辑先写，单独测，全放在 `web/src/ui/node-graph/`：`schema.ts`（格式校验、补默认值）、`marks.ts`（下拉框 marks 怎么给线换样式、状态标签怎么算、「把改动发给 Claude」那句话）、`layout.ts`（拓扑分列，从 `orchestra/graph-layout.ts` 挪过来；卡片尺寸、贝塞尔连线、标签位置）、`viewport.ts`（适应窗口、以指针为中心缩放、百分比、入场时间表、超过 150 张卡片不放动画）、`mermaid-flow.ts`（flowchart 转成图）。然后是组件 `NodeGraph.tsx` + `node-graph.css`，经 `index.tsx` 的 `LazyNodeGraph` 懒加载。原因是 `boot` 包离 1.9 MB 上限只剩约 85 KB（`docs/notes/i18n.md:10`），后台面板和编排都在 boot 里。三处用法各有一个纯的数据适配：`background/graph-data.ts`、`orchestra/orch-graph.ts`，以及 `chat/NodegraphBlock.tsx`。最后是服务端的提示：`runtime/nodegraph-hint.ts`，拼进 `session-runner.ts` 的 `append`，设置项走现有 settings 通道。卡片是 HTML（绝对定位），连线是同一个变换层里的 SVG。这样下拉框、文字截断、Tab 焦点都用现成的 HTML 能力；连线、发光、光点、标签全在 SVG 里。

**Tech Stack:** React 19 + zustand、vitest（node 环境；组件快照测用 `react-dom/server`）、SVG `<animateMotion>`、CSS 关键帧（`stroke-dashoffset` 画线）、共用 `ui/wheel-zoom.ts`、`ui/Select.tsx`、ui-smoke（Electron `sendInputEvent`）、e2e（`server/ws-phaseN.mjs`：真引擎 + 假 Anthropic 上游）。

Spec：`docs/superpowers/specs/2026-10-24-desktop-parity-design.md` 的「D」一节（:266-302），以及开头的「实现方式与顺序」（:15-20）和「跨期规则」（:22-29）。不保存拖动后的位置（:409）。

## Global Constraints

- 用户看得见的字全走 `tr('中文')`，英文用仓库的 i18n 工具加：把 `{ "<中文>": "<English>" }` 写到系统临时目录里的一个 JSON 文件，跑 `node scripts/i18n/set.mjs <那个文件>`（`docs/notes/i18n.md:18`）。加完跑 `node scripts/i18n/extract.mjs --check`。不出现：会话 / 引擎 / 窗格 / 停靠 / effort / ultracode / ACP（`wording.test.ts` 会拦）；叫「对话」。给 Claude 的提示是英文常量，不走 `tr`。
- 新 UI 状态存 meta.json（`settings.set` / store 的 `setSetting`），**不用 localStorage**。本阶段新键只有 `ui.nodegraphHint`（布尔，默认 `true`）。下拉框选了什么、卡片拖到哪都不保存（spec :409），只在组件状态里。
- zustand 选择器返回稳定引用：不要 `?? []`、`.filter()`、`({…})`。`NodeGraph` 不读 store；`NodegraphBlock` 只在点按钮时用 `useStore.getState()`。`store/selectors.test.ts` 会查。
- 键盘：卡片上的 Enter / 空格、画布上的 `+` / `-` / `0`，处理前先问 `web/src/ui/ime.ts:11` 的 `imeComposing(e)`。
- 颜色只用主题令牌（`web/src/tokens.css`：`--bg` `--bg-1/2` `--surface-1` `--surface-elev` `--ink-1..4` `--edge-subtle/default/strong` `--err` `--err-soft` `--ok` `--ok-soft` `--accent` `--accent-text` `--focus-ring` `--fill-subtle` `--agent-1..10`），或这些令牌的 `color-mix()`。不写任何十六进制颜色。字符画主题只改令牌，所以照样能读（`docs/notes/ascii-themes.md:21`）。文字颜色用 `--ink-*`；如果用 `--err` / 代理色当文字，照 `docs/notes/background.md:11` 的做法写 `color-mix(in oklab, X 70–80%, var(--ink-1))`。
- 减少动效：`<html data-reduce-motion="1">`（设置「减少动画」，`features/settings/ui-settings.ts:58`）或系统的 `prefers-reduced-motion`，这两种情况都不放入场、不放光点、不放发光呼吸。卡片超过 150 张同样不放（`NG_ANIMATE_MAX`）。组件用 `ui/node-graph/motion.ts` 的 `useReducedMotion()` 实时跟着变。
- 动效规矩（`docs/notes/ui-refresh.md:13`）：只动 `transform` / `opacity` / `stroke-dashoffset` / 颜色；只有眼前实时发生的才有入场动画。对话里 = `ArrivalCtx` 为真时挂上的代码块，翻历史不播；后台页和编排 = 用户打开那个视图时，算「眼前发生」。
- **绝不 `git add -A` / `git add .`**：`site/package.json`、`site/package-lock.json` 是用户没提交的改动。每次只 add 列出的路径。
- 测试命令前加：`env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_WEB_DIST -u ANTHROPIC_DEFAULT_OPUS_MODEL -u ANTHROPIC_DEFAULT_SONNET_MODEL -u ANTHROPIC_DEFAULT_HAIKU_MODEL -u CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION -u CLAUDE_WEB_THINKING_DISPLAY -u CLAUDE_WEB_CONTEXT_WINDOWS -u CLAUDE_WEB_MODEL_CAPS -u ELECTRON_RUN_AS_NODE -u CLAUDE_CODE_AUTO_COMPACT_WINDOW`，下文写作 `$CLEAN`。
- Electron 只用临时 `--user-data-dir` + 临时 `HOME` + 临时 `CLAUDE_WEB_DIR` 启动（ui-smoke 自己会这样做）。别碰用户的 `~/.claude-web`，也别用已装版正在用的数据目录。
- 停靠面板 / 右侧面板 / 分区页不卸载，只 `hidden`。节点图在隐藏的面板里不能报错：`ResizeObserver` 量到 0 时不适应窗口，等有尺寸再适应。
- 文件名：`ui/node-graph/` 里不放 `graph.ts`；编排里新文件叫 `orch-graph.ts`，不叫 `graph.ts`。原因是和 `Graph.tsx` 只差大小写，Windows 上 tsc 报 TS1149（`docs/notes/orchestra.md:16`）。
- CSS 选择器写 `.ng-layer > svg.ng-edges`，别写 `.ng-layer svg`：后者会把卡片里的图标 svg 也甩到左上角（`docs/notes/orchestra.md:14` 的同一个坑）。
- 控制台：ui-smoke 遇到任何 console error / warning 都算失败。所以格式错误、转换失败只在界面上说，**不** `console.warn`。
- 顺序：spec 规定「上一期没过不开下一期」。阶段 B、C 合并、验收之后才开始 D。现在 `server/src/web/*`、`server/src/protocol.ts`、`web/src/features/browser/*`、`server/src/ws/hub.ts`、`server/src/index.ts` 有人在改（`git status` 里是 M）。D 不碰前三处；Task 7 要改 `hub.ts` 和 `index.ts` 各一行，动手前先 `git status --short server/src/ws/hub.ts server/src/index.ts`，确认是干净的（B / C 已提交）。

现有锚点（写计划时核对过）：

- 后台关系图：`web/src/features/background/CommandGraph.tsx`（115 行）。:23 `CommandGraph({ session, taskId, compact, onPick })`；:24 按 `taskId` 筛任务；:26-29 建节点（命令 `shell|<id>`，代理 `<taskId>|<agentKey>`）；:31-36 上限（compact 16、整页 28，在跑的优先）；:53 `svg.bg-graph-svg`，`aria-label={tr('指挥台')}`；:59-63 中心「主对话 / {running} 个在跑 / 没有在跑的」；:65「还有 {more} 个」；:106-108 只有代理节点能点，`onPick(a.key, n.task.id)`，命令节点不能点（:97-104）。调用方有两处：`BackgroundPage.tsx:103`（`.bg-graph-wrap` 里，在 `.bg-side-col` 中，和 `Bill`、「动态」一列；`pick` 在 :91 = `openAgent`），以及 `features/panels/TasksPanel.tsx:45`（`.bg-tasks-graph`，`compact`；`pick` 在 :41）。
- 数据：`server/src/background/types.ts`。`BgAgent` 在 :13-42（`key color label phase phaseTitle agentType model state startedAt endedAt tokens lastSummary`）；`BgPhase` 在 :44；`BgTask` 在 :46-72（`kind: workflow|agent|shell|other`、`status`、`phases?`、`agents`、`tokens`）。`background/model.ts` 有 `agentColor agentStateText taskStateText taskTitle KIND_LABEL tokensText clock`（`CommandGraph.tsx:8` 和 `BackgroundPage.tsx:17` 在用）。
- 后台样式：`styles/background.css:96-122`（`.bg-graph` `.bg-graph-svg` `.bg-orbit` `.bg-edge` `.bg-hub*` `.bg-node*` `.bg-graph-more`）；:169、:175 两处减少动效列表里有 `.bg-flow` `.bg-node-glow`。`styles/background-page.css:13`（`.bg-graph-wrap` 卡片底）、:39（`.bg-graph-svg` 最宽 440px）。
- 后台调试入口：`features/background/state.ts:100-104` `window.__cwBackground = { inject, state, open }`。
- ui-smoke（3676 行）：`seedHome` 在 :83-147（`toolsSid` :108、`reviewSid` :132、`return` :147），环境变量 `SMOKE_SID` / `SMOKE_TOOLS_SID` 在 :235-236；`shot` :324、`click` :350、真鼠标 `mouseDown` 的写法 :400、`key` :410、`noBoundary` :420。后台段在 :2938-3032：:2944 `__cwBackground.inject(...)`（wf1：两个阶段、三个代理 w1 在跑 / w2 完成 / w3 排队；ag1 在跑的子代理；sh1 在跑的命令）；**:2952 `nodes: p.querySelectorAll('.bg-graph-svg .bg-node').length`、:2953 断言 `page.nodes >= 4`**；:2957-3002 是 A3 的滚轮段（`wheelAt` 用 `wc.sendInputEvent mouseWheel`，`window.__smokeWheel` 记 `defaultPrevented`）；**:3021 等 `.bg-tasks .bg-graph-svg`、:3022 断言任务面板**。chat-turns 段从 :3107 开始（`loadHistory` 打开种好的对话的写法）。
- 编排：`features/orchestra/Graph.tsx`（67 行）。:9 `KIND_ICON`；:11-15 `sub(n)`；:21 `Graph({ nodes, runs?, selected?, onSelect? })`；:22 `layoutGraph`；:24-25 在跑时每秒刷新；:27-37 `ResizeObserver` + `fitScale`；:38 空状态「还没有节点」；:44 线按来源节点的状态着色；:52 `.orch-card`；:67 `STATE_L`。`graph-layout.ts`：:5-8 类型，:10-14 `CARD_W 150 / CARD_H 56 / GAP / PAD`，:17-39 `layers`，:41-59 `layoutGraph`，:62-65 `fitScale`，:68-72 `nextNodeId`，:75-83 `promptVars`。`graph-layout.test.ts` 测这几样。调用方：`RunView.tsx:9`（import `Graph, KIND_ICON, STATE_L`）、:197；`WorkflowEditor.tsx:7-8`、:127。样式 `orchestra.css:27-52`（`.orch-graph` `.orch-canvas` `.orch-card`；:33 `orch-dash` 动画）。store：`orchestra/state.ts` 里 `useOrch`（:47 起），`ask(mode, runId)` 在 :68-75，`installOrchestra()` 在 :100（里面的 `ws.on` 在 :105 附近）。没有调试入口。`settings/wording.test.ts:399` 把 `features/orchestra/Graph.tsx` 的 `'worktree'` 列为代码值。
- 滚轮：`web/src/ui/wheel-zoom.ts:9` `wheelZoom(scale, e: { deltaY, deltaMode?, shiftKey }, o: { min, max, step }): number | null`。监听要非被动，React 的 `onWheel` 是被动的（`docs/notes/cafe.md:49-50`）。
- 对话代码块：`chat/Markdown.tsx:51-60` 的 `pre` 组件把 `language-x` 交给 `CodeBlock`（带 `data-streaming`）；`chat/CodeBlock.tsx:11` `const MermaidBlock = lazy(...)`；:105-119 `useCopy`（文件内私有）；:159 `isMermaid`；:166 `guarded`（空白块检查）；:202 Mermaid 不显示换行键；:206-210 流式结束后才挂 Mermaid。`chat/MermaidBlock.tsx`：:6-13 `getMermaid(theme)`，:16-37 默认导出 `MermaidBlock({ source })`，:34 出错时显示一个 `pre`。`chat/turn-context.ts` 的 `ArrivalCtx`（`{ current: boolean }`，只在实时到达的那一帧为真）。
- 往输入框里填字：`features/composer/quote.ts` 有 `QUOTE_EVENT` / `QuoteDetail { text, handled }` / `withQuote` / `quoteInComposer`；`Composer.tsx:484-500` 是接这个事件的 effect（只认焦点窗格最前面那个标签页里的输入框；在对话里点一下就会让那个窗格获得焦点）。测试文件已有：`features/composer/quote.test.ts`。
- 减少动效：`features/chat/Fold.tsx:8-14` `reducedMotion()`、`ui/input-intent.ts:35-39` `reducedMotion()`（`ui/` 里用后者，别从 `ui/` 往 `features/` 引）。
- 给 Claude 的附加说明：`server/src/runtime/session-runner.ts`。:117-119 `promptSuggestionsOn` + `setPromptSuggestions` 的模块级开关写法；:490 `bare = chatOnly || lean`；**:504 `const append = [verify, this.thinkingSection, delegate].filter(Boolean).join('\n\n');`**；:543 `systemPrompt: { type: 'preset', preset: 'claude_code', append }`。范例纯函数模块：`runtime/subagent-policy.ts` + `.test.ts`。设置接线：`server/src/index.ts:39`（import）、:340 `setPromptSuggestions(meta.settings()['ui.promptSuggestions'] !== false)`；`server/src/ws/hub.ts:7`（import）、:636 `if (req.key === 'ui.promptSuggestions') setPromptSuggestions(req.value !== false);`。
- 设置页：`features/settings/catalog.ts:22` `SettingId` 联合类型；:115 `sessions.mcp` 行（「新对话」块，「改了之后新开的对话生效」）；:143 `ui.reduceMotion`；`SettingsModal.tsx:66`、:70 是 `<Toggle … def />` 的写法；`catalog.test.ts:97` 的 `added` 列表（新设置要列在这里）。
- 下拉框：`ui/Select.tsx:9-25`（`SelectOption { value, label }`，属性 `value / onValueChange / options / label / className`）；DOM 是 `.select-trigger`，弹出的是 `.select-popover .select-option`（`role="menuitemradio"`，文字在 `.select-option-label`）。图标：`ui/icons.tsx:37` `IconName`、:61 `ICON_NAMES`。
- 测试环境：`web/vite.config.ts:46` `environment: 'node'`。
- e2e：`scripts/e2e.mjs:13` 是期号表；阶段 C 计划占了 33（`docs/superpowers/plans/2026-10-25-stage-c-card-projects-sidebar.md:479`），D 用 34（如果被占，就用 `ls server/ws-phase*.mjs` 后的下一个空号）。模板 `server/ws-phase32.mjs`：:14-48 假上游的辅助函数，:62-85 上游，:87-110 server + ws，:190-203 收尾。
- 样式层叠顺序：`web/src/main.tsx:5-20`。节点图的 CSS 由懒加载的 `NodeGraph.tsx` 自己 import，不进 `main.tsx`。

---

### Task 1：格式校验、marks 与状态标签（纯逻辑）

**Files:**
- Create: `web/src/ui/node-graph/schema.ts`
- Create: `web/src/ui/node-graph/schema.test.ts`
- Create: `web/src/ui/node-graph/marks.ts`
- Create: `web/src/ui/node-graph/marks.test.ts`
- Create: `web/src/ui/node-graph/sample.ts`（照 mp4 的示例图，测试和笔记共用）
- Modify: `web/src/i18n/en.ts`（经 `set.mjs`）

**Interfaces:**
- Consumes: `tr`（`@/i18n`）。
- Produces（`schema.ts`）:
  ```ts
  export type EdgeStyle = 'normal' | 'strong' | 'error' | 'dashed';
  export const EDGE_STYLES: readonly EdgeStyle[];
  export type NodeState = 'idle' | 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped';
  export const NODE_STATES: readonly NodeState[];
  export const NG_MAX_NODES = 500;
  export const NG_MAX_EDGES = 2000;
  // ---- 输入：Claude 写的 JSON（spec D1 的格式 + 选项的 marks + 边的 pulse）----
  export interface NgOptionIn { value: string; label?: string; marks?: Record<string, EdgeStyle> }
  export interface NgRowIn { id?: string; label: string; value: string; options?: (string | NgOptionIn)[] }
  export interface NgListIn { title: string; items: (string | { text: string; tags?: string[] })[] }
  export interface NgNodeIn { id: string; title: string; subtitle?: string; icon?: string; rows?: NgRowIn[]; list?: NgListIn; state?: NodeState; x?: number; y?: number }
  export interface NgEdgeIn { id?: string; from: string; to: string; fromRow?: string; label?: string; style?: EdgeStyle; pulse?: boolean }
  export type NgBadgeIn = string | { count?: EdgeStyle; text: string; okText: string };
  export interface NodeGraphIn { title?: string; subtitle?: string; badge?: NgBadgeIn; nodes: NgNodeIn[]; edges?: NgEdgeIn[] }
  // ---- 规整后：组件只吃这个；D2 / D3 直接构造它 ----
  export interface NgOption { value: string; label: string; marks: Record<string, EdgeStyle> }
  export interface NgRow { id: string; label: string; value: string; options: NgOption[] }
  export interface NgListItem { text: string; tags: string[] }
  export interface NgList { title: string; items: NgListItem[] }
  export interface NgNode { id: string; title: string; subtitle?: string; icon?: string; rows: NgRow[]; list?: NgList; state?: NodeState; x?: number; y?: number;
    /** 调用方专用（JSON 里不读）：卡片图标的颜色，一个 `var(--agent-n)` */ accent?: string;
    /** 调用方专用：悬停提示 */ tip?: string }
  export interface NgEdge { id: string; from: string; to: string; fromRow?: string /* 行 id */; label?: string; style: EdgeStyle; pulse?: boolean }
  export type NgBadge = { kind: 'text'; text: string } | { kind: 'count'; count: EdgeStyle; text: string; okText: string };
  export interface NodeGraphData { title?: string; subtitle?: string; badge?: NgBadge; nodes: NgNode[]; edges: NgEdge[] }
  export type ParseResult = { ok: true; graph: NodeGraphData } | { ok: false; error: string };
  export function parseNodeGraph(text: string): ParseResult;
  export function normalizeNodeGraph(raw: unknown): ParseResult;
  ```
  规则：
  - 线 id 默认是 `from>to`，重名时依次加 `#2`、`#3`；行 id 默认 `r<下标>`；`fromRow` 可以写行 id，也可以写行的 label，规整后一律是行 id。
  - 选项可以是字符串；`value` 不在 options 里时补到第一个（不带 marks）。这一步在校验 marks 之后做，所以报错路径里的下标是用户写的原下标。
  - 状态标签写成规则时，`count` 默认是 `'error'`。
  - 不认识的键忽略（以后加字段不会让旧图报错）。
  - 错误文字是 `<路径>: <原因>`，路径不翻译（`nodes[1].id`、`edges[0].style`）。
- Produces（`marks.ts`）:
  ```ts
  export type Picks = Readonly<Record<string, string>>;           // `${nodeId}/${rowId}` → 选中的 value
  export const pickKey: (nodeId: string, rowId: string) => string;
  export function initialPicks(g: NodeGraphData): Record<string, string>;   // 只收有 options 的行
  export function edgeStyles(g: NodeGraphData, picks: Picks): Record<string, EdgeStyle>; // 先取线的原样式，再按卡片、行的顺序套上每行选中项的 marks（后面的覆盖前面的）
  export function pulses(e: NgEdge, style: EdgeStyle): boolean;   // e.pulse ?? (style === 'strong' || style === 'error')
  export interface BadgeView { text: string; tone: 'error' | 'ok' | 'plain' }
  export function badgeView(b: NgBadge | undefined, styles: Readonly<Record<string, EdgeStyle>>): BadgeView | null; // 数样式等于 count 的线；n>0 → text 里的 {n} 换成 n、tone error；n=0 → okText、tone ok；字符串 → plain
  export function changeSentence(g: NodeGraphData, from: Picks, to: Picks): string; // 没改返回 ''
  ```
- Produces（`sample.ts`）：`export const ACCESS_SAMPLE: NodeGraphIn`。

- [ ] **Step 1：写示例图** `web/src/ui/node-graph/sample.ts`

```ts
import type { NodeGraphIn } from './schema';

/**
 * The mp4's picture (spec 2026-10-24 D: 「Access settings」): a public link reaches the customers bucket — one red,
 * glowing open path; read → Admin turns it into a grey dashed line and the badge into 「No open paths」. ui-smoke
 * draws the same graph (a JSON copy in scripts/ui-smoke.cjs — keep the two the same).
 */
export const ACCESS_SAMPLE = {
  title: 'Access settings',
  subtitle: 'Who can read the customers bucket',
  badge: { count: 'error', text: '{n} open path', okText: 'No open paths' },
  nodes: [
    { id: 'anyone', title: 'Anyone', subtitle: 'Public internet' },
    { id: 'admin', title: 'Admin', subtitle: '2 people' },
    { id: 'backup', title: 'Nightly backup', subtitle: 'paused' },
    {
      id: 'link', title: 'Share link', subtitle: 's3://acme-customers',
      rows: [
        { id: 'read', label: 'read', value: 'Anyone', options: [{ value: 'Anyone', marks: { 'e-open': 'error' } }, { value: 'Admin', marks: { 'e-open': 'dashed' } }] },
        { id: 'write', label: 'write', value: 'Admin', options: ['Admin', 'Team'] },
      ],
    },
    { id: 'bucket', title: 'customers', subtitle: 'S3 bucket', list: { title: '4 reads this week', items: [{ text: 'Lisbon', tags: ['PT', '2h'] }, { text: 'Austin', tags: ['US', '1d'] }, { text: 'Osaka', tags: ['JP', '3d'] }, { text: 'Berlin', tags: ['DE', '5d'] }] } },
  ],
  edges: [
    { id: 'e-open', from: 'anyone', to: 'link', label: 'public', style: 'error' },
    { id: 'e-admin', from: 'admin', to: 'link', label: 'member' },
    { id: 'e-read', from: 'link', to: 'bucket', fromRow: 'read', label: 'read' },
    { id: 'e-write', from: 'link', to: 'bucket', fromRow: 'write', label: 'write' },
    { id: 'e-backup', from: 'backup', to: 'bucket', label: 'paused', style: 'dashed' },
  ],
} satisfies NodeGraphIn;
```

- [ ] **Step 2：写失败的测试** `web/src/ui/node-graph/schema.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { NG_MAX_NODES, normalizeNodeGraph, parseNodeGraph } from './schema';
import { ACCESS_SAMPLE } from './sample';

const ok = (x: unknown) => { const r = normalizeNodeGraph(x); if (!r.ok) throw new Error(r.error); return r.graph; };
const bad = (x: unknown) => { const r = normalizeNodeGraph(x); if (r.ok) throw new Error('expected an error'); return r.error; };
const two = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];

describe('nodegraph format', () => {
  it('fills the defaults: edge ids and styles, row ids, string options', () => {
    const g = ok({
      nodes: [{ id: 'a', title: 'A', rows: [{ label: 'read', value: 'Anyone', options: ['Anyone', { value: 'Admin', marks: { e1: 'dashed' } }] }] }, { id: 'b', title: 'B' }],
      edges: [{ id: 'e1', from: 'a', to: 'b', fromRow: 'read', style: 'error' }, { from: 'b', to: 'a' }, { from: 'b', to: 'a' }],
    });
    expect(g.nodes[0].rows[0]).toEqual({ id: 'r0', label: 'read', value: 'Anyone', options: [{ value: 'Anyone', label: 'Anyone', marks: {} }, { value: 'Admin', label: 'Admin', marks: { e1: 'dashed' } }] });
    expect(g.nodes[1].rows).toEqual([]);
    expect(g.edges.map((e) => [e.id, e.style, e.fromRow])).toEqual([['e1', 'error', 'r0'], ['b>a', 'normal', undefined], ['b>a#2', 'normal', undefined]]);
  });
  it('a value missing from its options is offered first', () => {
    const g = ok({ nodes: [{ id: 'a', title: 'A', rows: [{ id: 'k', label: 'k', value: 'v', options: ['w'] }] }] });
    expect(g.nodes[0].rows[0].options.map((o) => o.value)).toEqual(['v', 'w']);
  });
  it('lists: plain strings and items with tags', () => {
    const g = ok({ nodes: [{ id: 'a', title: 'A', list: { title: '2 reads', items: ['x', { text: 'y', tags: ['US'] }] } }] });
    expect(g.nodes[0].list).toEqual({ title: '2 reads', items: [{ text: 'x', tags: [] }, { text: 'y', tags: ['US'] }] });
  });
  it('badge: a plain string, or a rule that counts error edges by default', () => {
    expect(ok({ nodes: two, badge: 'draft' }).badge).toEqual({ kind: 'text', text: 'draft' });
    expect(ok({ nodes: two, badge: { text: '{n} open', okText: 'none' } }).badge).toEqual({ kind: 'count', count: 'error', text: '{n} open', okText: 'none' });
  });
  it('the mp4 sample is valid', () => {
    const g = ok(ACCESS_SAMPLE);
    expect(g.nodes).toHaveLength(5);
    expect(g.edges.find((e) => e.id === 'e-read')?.fromRow).toBe('read');
  });
  it('text that is not JSON', () => {
    const r = parseNodeGraph('{"nodes": [');
    expect(r.ok).toBe(false);
    expect(parseNodeGraph(JSON.stringify({ nodes: two })).ok).toBe(true);
  });
  it('errors name the place', () => {
    expect(bad([])).toMatch(/^\$:/);
    expect(bad({})).toMatch(/^nodes:/);
    expect(bad({ nodes: [] })).toMatch(/^nodes:/);
    expect(bad({ nodes: [{ id: 'a' }] })).toMatch(/^nodes\[0\]\.title:/);
    expect(bad({ nodes: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] })).toMatch(/^nodes\[1\]\.id:/);
    expect(bad({ nodes: two, edges: [{ from: 'a', to: 'zz' }] })).toMatch(/^edges\[0\]\.to:.*zz/);
    expect(bad({ nodes: two, edges: [{ from: 'a', to: 'b', style: 'red' }] })).toMatch(/^edges\[0\]\.style:.*red/);
    expect(bad({ nodes: two, edges: [{ from: 'a', to: 'b', fromRow: 'nope' }] })).toMatch(/^edges\[0\]\.fromRow:/);
    expect(bad({ nodes: two, edges: [{ id: 'x', from: 'a', to: 'b' }, { id: 'x', from: 'b', to: 'a' }] })).toMatch(/^edges\[1\]\.id:/);
    expect(bad({ nodes: [{ id: 'a', title: 'A', rows: [{ label: 'x', value: 'v', options: [{ value: 'w', marks: { ghost: 'error' } }] }] }] })).toMatch(/^nodes\[0\]\.rows\[0\]\.options\[0\]\.marks:.*ghost/);
    expect(bad({ nodes: [{ id: 'a', title: 'A', rows: [{ id: 'k', label: 'k', value: '1' }, { id: 'k', label: 'k2', value: '2' }] }] })).toMatch(/^nodes\[0\]\.rows\[1\]\.id:/);
    expect(bad({ nodes: [{ id: 'a', title: 'A', state: 'sleepy' }] })).toMatch(/^nodes\[0\]\.state:/);
    expect(bad({ nodes: two, edges: [{ from: 'a', to: 'b', pulse: 'yes' }] })).toMatch(/^edges\[0\]\.pulse:/);
    expect(bad({ nodes: Array.from({ length: NG_MAX_NODES + 1 }, (_, i) => ({ id: `n${i}`, title: 'x' })) })).toMatch(/^nodes:/);
  });
  it('keys it does not know are ignored', () => {
    expect(ok({ nodes: [{ id: 'a', title: 'A', colour: 'red' }], theme: 'x' }).nodes[0].id).toBe('a');
  });
});
```

`web/src/ui/node-graph/marks.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { normalizeNodeGraph, type NodeGraphData } from './schema';
import { badgeView, changeSentence, edgeStyles, initialPicks, pickKey, pulses } from './marks';
import { ACCESS_SAMPLE } from './sample';

const g = (() => { const r = normalizeNodeGraph(ACCESS_SAMPLE); if (!r.ok) throw new Error(r.error); return r.graph; })() as NodeGraphData;

describe('marks and the badge', () => {
  it('starts from every dropdown row\'s value', () => {
    expect(initialPicks(g)).toEqual({ 'link/read': 'Anyone', 'link/write': 'Admin' });
    expect(pickKey('link', 'read')).toBe('link/read');
  });
  it('the mp4: one open path, then read → Admin closes it', () => {
    const init = initialPicks(g);
    const s0 = edgeStyles(g, init);
    expect(s0['e-open']).toBe('error');
    expect(s0['e-backup']).toBe('dashed');
    expect(badgeView(g.badge, s0)).toEqual({ text: '1 open path', tone: 'error' });
    const s1 = edgeStyles(g, { ...init, 'link/read': 'Admin' });
    expect(s1['e-open']).toBe('dashed');
    expect(badgeView(g.badge, s1)).toEqual({ text: 'No open paths', tone: 'ok' });
  });
  it('an option without marks leaves the edges as they are', () => {
    expect(edgeStyles(g, { 'link/write': 'Team' })).toEqual(edgeStyles(g, {}));
  });
  it('a plain badge, and none', () => {
    expect(badgeView({ kind: 'text', text: 'draft' }, {})).toEqual({ text: 'draft', tone: 'plain' });
    expect(badgeView(undefined, {})).toBeNull();
  });
  it('which edges carry a travelling dot', () => {
    const e = g.edges[0];
    expect(pulses(e, 'error')).toBe(true);
    expect(pulses(e, 'strong')).toBe(true);
    expect(pulses(e, 'normal')).toBe(false);
    expect(pulses({ ...e, pulse: false }, 'error')).toBe(false);
  });
  it('the sentence for 把改动发给 Claude', () => {
    const init = initialPicks(g);
    expect(changeSentence(g, init, init)).toBe('');
    expect(changeSentence(g, init, { ...init, 'link/read': 'Admin' })).toBe('我在图里把「Share link」的 read 从 Anyone 改成了 Admin。');
    expect(changeSentence(g, init, { 'link/read': 'Admin', 'link/write': 'Team' })).toBe('我在图里把「Share link」的 read 从 Anyone 改成了 Admin；「Share link」的 write 从 Admin 改成了 Team。');
  });
});
```

- [ ] **Step 3：确认失败**：`cd web && $CLEAN npx vitest run src/ui/node-graph`（期望：找不到 `./schema` / `./marks`）

- [ ] **Step 4：实现 `schema.ts`**

```ts
import { tr } from '@/i18n';
// spec 2026-10-24 D1 / D4: the node graph's input — what Claude writes in a ```nodegraph block (JSON) and what the
// background page / orchestra build directly (already normalized). Pure; the component only takes NodeGraphData.

/* types exactly as in this task's Interfaces */

class Bad extends Error {}
function fail(path: string, why: string): never { throw new Bad(`${path}: ${why}`); }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, p: string): string => (typeof v === 'string' && v.trim() ? v : fail(p, tr('要是非空字符串')));
const optStr = (v: unknown, p: string): string | undefined => (v === undefined || v === null ? undefined : typeof v === 'string' ? v : fail(p, tr('要是字符串')));
const optNum = (v: unknown, p: string): number | undefined => (v === undefined || v === null ? undefined : typeof v === 'number' && Number.isFinite(v) ? v : fail(p, tr('要是数字')));
const arr = (v: unknown, p: string): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : fail(p, tr('要是数组')));
const styleOf = (v: unknown, p: string): EdgeStyle => (v === undefined ? 'normal' : (EDGE_STYLES as readonly unknown[]).includes(v) ? (v as EdgeStyle) : fail(p, tr('不认识的线样式 {style}（只能是 normal / strong / error / dashed）', { style: String(v) })));

export function parseNodeGraph(text: string): ParseResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, error: tr('不是 JSON：{msg}', { msg: (e as Error).message }) }; }
  return normalizeNodeGraph(raw);
}

export function normalizeNodeGraph(raw: unknown): ParseResult {
  try { return { ok: true, graph: build(raw) }; } catch (e) { if (e instanceof Bad) return { ok: false, error: e.message }; throw e; }
}

function build(raw: unknown): NodeGraphData {
  if (!isObj(raw)) fail('$', tr('要是一个对象'));
  if (!Array.isArray(raw.nodes)) fail('nodes', tr('要有 nodes 数组'));
  const nodesIn = raw.nodes as unknown[];
  if (!nodesIn.length) fail('nodes', tr('至少要有一张卡片'));
  if (nodesIn.length > NG_MAX_NODES) fail('nodes', tr('卡片太多（最多 {max} 张）', { max: NG_MAX_NODES }));
  const edgesIn = arr(raw.edges, 'edges');
  if (edgesIn.length > NG_MAX_EDGES) fail('edges', tr('线太多（最多 {max} 条）', { max: NG_MAX_EDGES }));
  const nodes = nodesIn.map((n, i) => node(n, `nodes[${i}]`));
  const byId = new Map<string, NgNode>();
  nodes.forEach((n, i) => { if (byId.has(n.id)) fail(`nodes[${i}].id`, tr('卡片 id 重复：{id}', { id: n.id })); byId.set(n.id, n); });
  const edges: NgEdge[] = [];
  const ids = new Set<string>();
  edgesIn.forEach((e, i) => {
    const p = `edges[${i}]`;
    if (!isObj(e)) fail(p, tr('要是一个对象'));
    const from = str(e.from, `${p}.from`);
    const to = str(e.to, `${p}.to`);
    if (!byId.has(from)) fail(`${p}.from`, tr('没有 id 为 {id} 的卡片', { id: from }));
    if (!byId.has(to)) fail(`${p}.to`, tr('没有 id 为 {id} 的卡片', { id: to }));
    const fr = optStr(e.fromRow, `${p}.fromRow`);
    let fromRow: string | undefined;
    if (fr !== undefined) {
      const row = byId.get(from)!.rows.find((x) => x.id === fr || x.label === fr);
      if (!row) fail(`${p}.fromRow`, tr('{row} 不是卡片 {node} 里的一行', { row: fr, node: from }));
      fromRow = row.id;
    }
    let id = optStr(e.id, `${p}.id`);
    if (id !== undefined && ids.has(id)) fail(`${p}.id`, tr('线 id 重复：{id}', { id }));
    if (id === undefined) { id = `${from}>${to}`; for (let k = 2; ids.has(id); k++) id = `${from}>${to}#${k}`; }
    ids.add(id);
    const pulse = e.pulse === undefined ? undefined : typeof e.pulse === 'boolean' ? e.pulse : fail(`${p}.pulse`, tr('要是 true 或 false'));
    edges.push({ id, from, to, fromRow, label: optStr(e.label, `${p}.label`), style: styleOf(e.style, `${p}.style`), pulse });
  });
  nodes.forEach((n, i) => n.rows.forEach((r, j) => r.options.forEach((o, k) => {
    for (const eid of Object.keys(o.marks)) if (!ids.has(eid)) fail(`nodes[${i}].rows[${j}].options[${k}].marks`, tr('没有 id 为 {id} 的线', { id: eid }));
  })));
  // only now (the error paths above use the author's indexes): a value that is not among its options comes first
  for (const n of nodes) for (const r of n.rows) if (r.options.length && !r.options.some((o) => o.value === r.value)) r.options.unshift({ value: r.value, label: r.value, marks: {} });
  return { title: optStr(raw.title, 'title'), subtitle: optStr(raw.subtitle, 'subtitle'), badge: badge(raw.badge), nodes, edges };
}

function node(v: unknown, p: string): NgNode {
  if (!isObj(v)) fail(p, tr('要是一个对象'));
  const rows = arr(v.rows, `${p}.rows`).map((r, j) => row(r, `${p}.rows[${j}]`, j));
  const seen = new Set<string>();
  rows.forEach((r, j) => { if (seen.has(r.id)) fail(`${p}.rows[${j}].id`, tr('行 id 重复：{id}', { id: r.id })); seen.add(r.id); });
  const state = v.state === undefined ? undefined : (NODE_STATES as readonly unknown[]).includes(v.state) ? (v.state as NodeState) : fail(`${p}.state`, tr('不认识的状态 {state}', { state: String(v.state) }));
  return { id: str(v.id, `${p}.id`), title: str(v.title, `${p}.title`), subtitle: optStr(v.subtitle, `${p}.subtitle`), icon: optStr(v.icon, `${p}.icon`), rows, list: v.list === undefined ? undefined : list(v.list, `${p}.list`), state, x: optNum(v.x, `${p}.x`), y: optNum(v.y, `${p}.y`) };
}

function row(v: unknown, p: string, j: number): NgRow {
  if (!isObj(v)) fail(p, tr('要是一个对象'));
  return { id: optStr(v.id, `${p}.id`) ?? `r${j}`, label: str(v.label, `${p}.label`), value: str(v.value, `${p}.value`), options: arr(v.options, `${p}.options`).map((o, k) => option(o, `${p}.options[${k}]`)) };
}

function option(v: unknown, p: string): NgOption {
  if (typeof v === 'string') return { value: v, label: v, marks: {} };
  if (!isObj(v)) fail(p, tr('要是字符串或对象'));
  const value = str(v.value, `${p}.value`);
  const marks: Record<string, EdgeStyle> = {};
  if (v.marks !== undefined) {
    if (!isObj(v.marks)) fail(`${p}.marks`, tr('要是一个对象'));
    for (const [k, s] of Object.entries(v.marks)) marks[k] = styleOf(s, `${p}.marks`);
  }
  return { value, label: optStr(v.label, `${p}.label`) ?? value, marks };
}

function list(v: unknown, p: string): NgList {
  if (!isObj(v)) fail(p, tr('要是一个对象'));
  return {
    title: str(v.title, `${p}.title`),
    items: arr(v.items, `${p}.items`).map((x, k) => {
      if (typeof x === 'string') return { text: x, tags: [] };
      if (!isObj(x)) fail(`${p}.items[${k}]`, tr('要是字符串或对象'));
      return { text: str(x.text, `${p}.items[${k}].text`), tags: arr(x.tags, `${p}.items[${k}].tags`).map((t, m) => str(t, `${p}.items[${k}].tags[${m}]`)) };
    }),
  };
}

function badge(v: unknown): NgBadge | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return { kind: 'text', text: v };
  if (!isObj(v)) fail('badge', tr('要是字符串或对象'));
  return { kind: 'count', count: v.count === undefined ? 'error' : styleOf(v.count, 'badge.count'), text: str(v.text, 'badge.text'), okText: str(v.okText, 'badge.okText') };
}
```

- [ ] **Step 5：实现 `marks.ts`**

```ts
import { tr } from '@/i18n';
import type { EdgeStyle, NgBadge, NgEdge, NodeGraphData } from './schema';
// spec D4: a dropdown option's `marks` restyle edges while it is picked; the badge counts edges in one style.

export type Picks = Readonly<Record<string, string>>;
export const pickKey = (nodeId: string, rowId: string) => `${nodeId}/${rowId}`;

export function initialPicks(g: NodeGraphData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of g.nodes) for (const r of n.rows) if (r.options.length) out[pickKey(n.id, r.id)] = r.value;
  return out;
}

export function edgeStyles(g: NodeGraphData, picks: Picks): Record<string, EdgeStyle> {
  const out: Record<string, EdgeStyle> = {};
  for (const e of g.edges) out[e.id] = e.style;
  for (const n of g.nodes) for (const r of n.rows) {
    const v = picks[pickKey(n.id, r.id)] ?? r.value;
    const o = r.options.find((x) => x.value === v);
    if (o) for (const [id, s] of Object.entries(o.marks)) if (id in out) out[id] = s;
  }
  return out;
}

export const pulses = (e: NgEdge, style: EdgeStyle): boolean => e.pulse ?? (style === 'strong' || style === 'error');

export interface BadgeView { text: string; tone: 'error' | 'ok' | 'plain' }

export function badgeView(b: NgBadge | undefined, styles: Readonly<Record<string, EdgeStyle>>): BadgeView | null {
  if (!b) return null;
  if (b.kind === 'text') return { text: b.text, tone: 'plain' };
  const n = Object.values(styles).filter((s) => s === b.count).length;
  return n ? { text: b.text.replace(/\{n\}/g, String(n)), tone: 'error' } : { text: b.okText, tone: 'ok' };
}

export function changeSentence(g: NodeGraphData, from: Picks, to: Picks): string {
  const parts: string[] = [];
  for (const n of g.nodes) for (const r of n.rows) {
    const k = pickKey(n.id, r.id);
    const a = from[k] ?? r.value, b = to[k] ?? r.value;
    if (a === b) continue;
    const label = (v: string) => r.options.find((o) => o.value === v)?.label ?? v;
    parts.push(tr('「{node}」的 {label} 从 {from} 改成了 {to}', { node: n.title, label: r.label, from: label(a), to: label(b) }));
  }
  return parts.length ? tr('我在图里把{changes}。', { changes: parts.join(tr('；')) }) : '';
}
```

- [ ] **Step 6：英文**：写一个 JSON 文件，然后 `node scripts/i18n/set.mjs <file>`：

```json
{
  "要是非空字符串": "must be a non-empty string",
  "要是字符串": "must be a string",
  "要是数字": "must be a number",
  "要是数组": "must be an array",
  "要是一个对象": "must be an object",
  "要是字符串或对象": "must be a string or an object",
  "要是 true 或 false": "must be true or false",
  "要有 nodes 数组": "needs a nodes array",
  "至少要有一张卡片": "needs at least one card",
  "卡片太多（最多 {max} 张）": "too many cards (at most {max})",
  "线太多（最多 {max} 条）": "too many edges (at most {max})",
  "卡片 id 重复：{id}": "duplicate card id: {id}",
  "线 id 重复：{id}": "duplicate edge id: {id}",
  "行 id 重复：{id}": "duplicate row id: {id}",
  "没有 id 为 {id} 的卡片": "no card with the id {id}",
  "没有 id 为 {id} 的线": "no edge with the id {id}",
  "{row} 不是卡片 {node} 里的一行": "{row} is not a row of the card {node}",
  "不认识的线样式 {style}（只能是 normal / strong / error / dashed）": "unknown edge style {style} (normal / strong / error / dashed)",
  "不认识的状态 {state}": "unknown state {state}",
  "不是 JSON：{msg}": "not JSON: {msg}",
  "「{node}」的 {label} 从 {from} 改成了 {to}": "{label} on “{node}” from {from} to {to}",
  "我在图里把{changes}。": "In the graph I changed {changes}.",
  "；": "; "
}
```

- [ ] **Step 7：确认通过**：`cd web && $CLEAN npx vitest run src/ui/node-graph && cd .. && node scripts/i18n/extract.mjs --check`（期望：全绿；`--check` 没有缺译）

- [ ] **Step 8：提交**

```bash
git add web/src/ui/node-graph/schema.ts web/src/ui/node-graph/schema.test.ts web/src/ui/node-graph/marks.ts web/src/ui/node-graph/marks.test.ts web/src/ui/node-graph/sample.ts web/src/i18n/en.ts
git commit -m "feat(web): nodegraph format, marks and badge (stage D1, pure)"
```

---

### Task 2：布局与视口（纯逻辑；把拓扑分列从编排挪出来）

**Files:**
- Create: `web/src/ui/node-graph/layout.ts`
- Create: `web/src/ui/node-graph/layout.test.ts`
- Create: `web/src/ui/node-graph/viewport.ts`
- Create: `web/src/ui/node-graph/viewport.test.ts`
- Modify: `web/src/features/orchestra/graph-layout.ts:17-39`（删掉 `layers` 的实现，改成从共用位置 import 再 re-export。`layoutGraph` / `fitScale` / `CARD_*` 这一步先留着，因为 `Graph.tsx:5` 还在用，Task 5 再删）
- Modify: `web/src/features/orchestra/graph-layout.test.ts`（`layers` 的测试原样搬进 `layout.test.ts`，不删；这里只留 `layoutGraph` / `fitScale` / `nextNodeId` / `promptVars` 的测试）

**Interfaces:**
- Consumes: `NgNode`、`NgEdge`（Task 1）；`wheelZoom`（`ui/wheel-zoom.ts:9`）。
- Produces（`layout.ts`）:
  ```ts
  export interface LayerIn { id: string; dependsOn: string[] }
  export function layers<T extends LayerIn>(nodes: T[]): T[][];      // 从 graph-layout.ts:17-39 原样搬过来
  export const NG_CARD_W = 220, NG_HEAD_H = 52, NG_ROW_H = 30, NG_BODY_PAD = 8, NG_LIST_HEAD = 26, NG_LIST_ITEM = 22, NG_GAP_X = 80, NG_GAP_Y = 28, NG_PAD = 40;
  export interface Box { x: number; y: number; w: number; h: number }
  export function cardSize(n: NgNode, w?: number): { w: number; h: number };
  export function rowAnchor(i: number): number;   // NG_HEAD_H + NG_BODY_PAD/2 + i*NG_ROW_H + NG_ROW_H/2
  export interface LayoutOpts { cardW?: number; gapX?: number; gapY?: number; pad?: number; align?: 'center' | 'top' }
  export interface Placed { boxes: Record<string, Box>; width: number; height: number; cols: string[][] }
  export function layoutNodes(nodes: NgNode[], edges: NgEdge[], o?: LayoutOpts): Placed;
  export function moveBoxes(boxes: Record<string, Box>, offsets: Readonly<Record<string, { dx: number; dy: number }>>): Record<string, Box>;
  export interface EdgeGeom { id: string; d: string; mid: { x: number; y: number }; len: number }
  export function edgeGeom(id: string, a: Box, b: Box, row: number | null): EdgeGeom;
  export function labelWidth(text: string, fs?: number): number;     // 中日韩字符算 fs 宽，其余 0.6·fs，再加 12
  ```
- Produces（`viewport.ts`）:
  ```ts
  export interface View { scale: number; x: number; y: number }     // 屏幕坐标 = 内容坐标 · scale + (x, y)
  export interface Size { w: number; h: number }
  export const NG_ZOOM: { readonly min: 0.25; readonly max: 2.5; readonly step: 1.2 };
  export function fitView(content: Size, box: Size, o?: { max?: number; pad?: number }): View;  // 默认 max 1.25、pad 16，居中
  export function zoomAt(v: View, scale: number, p: { x: number; y: number }): View;           // p 下面那个内容点不动
  export function zoomBy(v: View, dir: 1 | -1, box: Size): View;                               // 按钮：以中心为准，乘或除 step
  export const pct: (scale: number) => string;                                                 // '116%'
  export const NG_ANIMATE_MAX = 150;
  export const motionOn: (count: number, reduced: boolean) => boolean;
  export const NG_CARD_STAGGER = 90, NG_CARD_IN = 320, NG_EDGE_STAGGER = 40, NG_EDGE_IN = 420;
  export function entranceTimes(cards: number, edges: number): { card(i: number): number; edge(i: number): number; total: number };
  ```

- [ ] **Step 1：写失败的测试** `web/src/ui/node-graph/layout.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { normalizeNodeGraph, type NgNode } from './schema';
import { ACCESS_SAMPLE } from './sample';
import { cardSize, edgeGeom, labelWidth, layers, layoutNodes, moveBoxes, rowAnchor, NG_BODY_PAD, NG_CARD_W, NG_GAP_X, NG_HEAD_H, NG_LIST_HEAD, NG_LIST_ITEM, NG_PAD, NG_ROW_H } from './layout';

const g = (() => { const r = normalizeNodeGraph(ACCESS_SAMPLE); if (!r.ok) throw new Error(r.error); return r.graph; })();
const card = (id: string, extra: Partial<NgNode> = {}): NgNode => ({ id, title: id, rows: [], ...extra });

describe('layers (moved from orchestra/graph-layout)', () => {
  it('puts a node one column after its deepest dependency', () => {
    const cols = layers([{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['a', 'b'] }, { id: 'd', dependsOn: [] }]);
    expect(cols.map((c) => c.map((n) => n.id))).toEqual([['a', 'd'], ['b'], ['c']]);
  });
  it('a cycle still lands somewhere', () => {
    const cols = layers([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }]);
    expect(cols.flat().map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
});

describe('layoutNodes', () => {
  it('columns from the edges, left to right', () => {
    const p = layoutNodes(g.nodes, g.edges);
    expect(p.cols).toEqual([['anyone', 'admin', 'backup'], ['link'], ['bucket']]);
    expect(p.boxes.link.x).toBe(NG_PAD + NG_CARD_W + NG_GAP_X);
    expect(p.boxes.bucket.x).toBe(NG_PAD + 2 * (NG_CARD_W + NG_GAP_X));
  });
  it('centres a short column on the tallest; align top starts every column at the top', () => {
    const p = layoutNodes(g.nodes, g.edges);
    const tallest = Math.max(...p.cols.map((c) => c.reduce((h, id) => h + p.boxes[id].h, 0) + (c.length - 1) * 28));
    expect(p.boxes.link.y).toBe(NG_PAD + (tallest - p.boxes.link.h) / 2);
    const t = layoutNodes(g.nodes, g.edges, { align: 'top' });
    expect(t.boxes.link.y).toBe(NG_PAD);
    expect(t.boxes.anyone.y).toBe(NG_PAD);
  });
  it('a card with x / y keeps them and the canvas grows to hold it', () => {
    const p = layoutNodes([card('a'), card('b', { x: 900, y: 500 })], []);
    expect(p.boxes.b).toMatchObject({ x: 900, y: 500 });
    expect(p.width).toBe(900 + NG_CARD_W + NG_PAD);
    expect(p.height).toBe(500 + NG_HEAD_H + NG_PAD);
  });
  it('self loops and edges to unknown cards do not move anything', () => {
    const p = layoutNodes([card('a')], [{ id: 'x', from: 'a', to: 'a', style: 'normal' }, { id: 'y', from: 'zz', to: 'a', style: 'normal' }]);
    expect(p.cols).toEqual([['a']]);
  });
  it('nothing to draw', () => expect(layoutNodes([], [])).toEqual({ boxes: {}, width: 0, height: 0, cols: [] }));
  it('dragging moves one box', () => {
    const b = { a: { x: 0, y: 0, w: 10, h: 10 }, b: { x: 50, y: 0, w: 10, h: 10 } };
    expect(moveBoxes(b, { a: { dx: 5, dy: -3 } })).toEqual({ a: { x: 5, y: -3, w: 10, h: 10 }, b: b.b });
  });
});

describe('card sizes and edges', () => {
  it('a card is its header, rows and list', () => {
    expect(cardSize(card('a')).h).toBe(NG_HEAD_H);
    const link = g.nodes.find((n) => n.id === 'link')!;
    expect(cardSize(link)).toEqual({ w: NG_CARD_W, h: NG_HEAD_H + 2 * NG_ROW_H + NG_BODY_PAD });
    const bucket = g.nodes.find((n) => n.id === 'bucket')!;
    expect(cardSize(bucket, 180)).toEqual({ w: 180, h: NG_HEAD_H + NG_LIST_HEAD + 4 * NG_LIST_ITEM + NG_BODY_PAD });
  });
  it('a straight edge between two headers', () => {
    const e = edgeGeom('e', { x: 0, y: 0, w: 100, h: 52 }, { x: 200, y: 0, w: 100, h: 52 }, null);
    expect(e.d).toBe('M100,26 C150,26 150,26 200,26');
    expect(e.mid).toEqual({ x: 150, y: 26 });
    expect(e.len).toBeCloseTo(100, 0);
  });
  it('an edge leaving from a row', () => {
    expect(rowAnchor(1)).toBe(NG_HEAD_H + NG_BODY_PAD / 2 + NG_ROW_H + NG_ROW_H / 2);
    const e = edgeGeom('e', { x: 0, y: 0, w: 100, h: 120 }, { x: 200, y: 0, w: 100, h: 52 }, 1);
    expect(e.d.startsWith(`M100,${rowAnchor(1)} `)).toBe(true);
  });
  it('a backwards edge bows out', () => {
    expect(edgeGeom('e', { x: 200, y: 0, w: 100, h: 52 }, { x: 0, y: 0, w: 100, h: 52 }, null).d).toBe('M300,26 C380,26 -80,26 0,26');
  });
  it('label widths', () => {
    expect(labelWidth('ab', 10)).toBe(24);
    expect(labelWidth('读', 10)).toBe(22);
  });
});
```

`web/src/ui/node-graph/viewport.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { wheelZoom } from '@/ui/wheel-zoom';
import { entranceTimes, fitView, motionOn, NG_ZOOM, pct, zoomAt, zoomBy } from './viewport';

describe('viewport', () => {
  it('fit: centred, never above max', () => {
    expect(fitView({ w: 400, h: 200 }, { w: 800, h: 400 })).toEqual({ scale: 1.25, x: 150, y: 75 });
  });
  it('fit: a huge graph stops at the minimum zoom', () => {
    expect(fitView({ w: 4000, h: 100 }, { w: 400, h: 300 })).toEqual({ scale: 0.25, x: -300, y: 137.5 });
  });
  it('fit: no size yet (a hidden panel) leaves 100%', () => {
    expect(fitView({ w: 400, h: 200 }, { w: 0, h: 0 })).toEqual({ scale: 1, x: 0, y: 0 });
  });
  it('zooming keeps the point under the pointer', () => {
    expect(zoomAt({ scale: 1, x: 10, y: 20 }, 2, { x: 110, y: 220 })).toEqual({ scale: 2, x: -90, y: -180 });
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 10, { x: 0, y: 0 }).scale).toBe(NG_ZOOM.max);
  });
  it('the − / + buttons zoom about the middle', () => {
    expect(zoomBy({ scale: 1, x: 0, y: 0 }, 1, { w: 200, h: 100 }).scale).toBeCloseTo(1.2);
    expect(zoomBy({ scale: 1, x: 0, y: 0 }, -1, { w: 200, h: 100 }).scale).toBeCloseTo(1 / 1.2);
  });
  it('the percentage', () => {
    expect(pct(1.16)).toBe('116%');
    expect(pct(0.999)).toBe('100%');
  });
  it('the wheel rule is the shared one (stage A3)', () => {
    expect(wheelZoom(1, { deltaY: -100, shiftKey: false }, NG_ZOOM)).toBeCloseTo(1.2);
    expect(wheelZoom(NG_ZOOM.max, { deltaY: -100, shiftKey: false }, NG_ZOOM)).toBeNull();
    expect(wheelZoom(1, { deltaY: -100, shiftKey: true }, NG_ZOOM)).toBeNull();
  });
  it('no animation when reduced or above 150 cards', () => {
    expect(motionOn(150, false)).toBe(true);
    expect(motionOn(151, false)).toBe(false);
    expect(motionOn(3, true)).toBe(false);
  });
  it('cards one after another, then the edges', () => {
    const t = entranceTimes(3, 2);
    expect([t.card(0), t.card(2), t.edge(0), t.edge(1), t.total]).toEqual([0, 180, 372, 412, 832]);
    expect(entranceTimes(2, 0).total).toBe(410);
  });
});
```

在 `wheel-zoom` 的模块里核对一下 `wheelZoom` 接受 `deltaY: -100` 时是不是放大一档（A3 的约定：向上滚 = 放大）。如果它用的是别的档位，改断言跟着 `wheel-zoom.test.ts`，**不改** `wheel-zoom.ts`。

- [ ] **Step 2：确认失败**：`cd web && $CLEAN npx vitest run src/ui/node-graph/layout.test.ts src/ui/node-graph/viewport.test.ts`

- [ ] **Step 3：实现 `layout.ts`**

```ts
import type { NgEdge, NgNode } from './schema';
// spec D1: columns from the edges (orchestra's topological layering, moved here), variable-height cards, bezier edges.

export interface LayerIn { id: string; dependsOn: string[] }
/* layers(): paste graph-layout.ts:17-39 unchanged (it is generic over T extends LayerIn) */

export const NG_CARD_W = 220, NG_HEAD_H = 52, NG_ROW_H = 30, NG_BODY_PAD = 8, NG_LIST_HEAD = 26, NG_LIST_ITEM = 22, NG_GAP_X = 80, NG_GAP_Y = 28, NG_PAD = 40;
export interface Box { x: number; y: number; w: number; h: number }

export function cardSize(n: NgNode, w = NG_CARD_W): { w: number; h: number } {
  let h = NG_HEAD_H;
  if (n.rows.length) h += n.rows.length * NG_ROW_H + NG_BODY_PAD;
  if (n.list) h += NG_LIST_HEAD + n.list.items.length * NG_LIST_ITEM + NG_BODY_PAD;
  return { w, h };
}
export const rowAnchor = (i: number) => NG_HEAD_H + NG_BODY_PAD / 2 + i * NG_ROW_H + NG_ROW_H / 2;

export interface LayoutOpts { cardW?: number; gapX?: number; gapY?: number; pad?: number; align?: 'center' | 'top' }
export interface Placed { boxes: Record<string, Box>; width: number; height: number; cols: string[][] }

export function layoutNodes(nodes: NgNode[], edges: NgEdge[], o: LayoutOpts = {}): Placed {
  if (!nodes.length) return { boxes: {}, width: 0, height: 0, cols: [] };
  const cardW = o.cardW ?? NG_CARD_W, gapX = o.gapX ?? NG_GAP_X, gapY = o.gapY ?? NG_GAP_Y, pad = o.pad ?? NG_PAD;
  const deps = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) if (e.from !== e.to && deps.has(e.from) && deps.has(e.to)) deps.get(e.to)!.push(e.from);
  const cols = layers(nodes.map((n) => ({ id: n.id, dependsOn: deps.get(n.id)! })));
  const size = new Map(nodes.map((n) => [n.id, cardSize(n, cardW)]));
  const colH = cols.map((c) => c.reduce((h, n) => h + size.get(n.id)!.h, 0) + Math.max(0, c.length - 1) * gapY);
  const tallest = Math.max(...colH);
  const boxes: Record<string, Box> = {};
  cols.forEach((c, ci) => {
    let y = pad + (o.align === 'top' ? 0 : (tallest - colH[ci]) / 2);
    for (const n of c) { const s = size.get(n.id)!; boxes[n.id] = { x: pad + ci * (cardW + gapX), y, ...s }; y += s.h + gapY; }
  });
  for (const n of nodes) if (typeof n.x === 'number' && typeof n.y === 'number') boxes[n.id] = { ...boxes[n.id], x: n.x, y: n.y };
  const all = Object.values(boxes);
  return { boxes, width: Math.max(...all.map((b) => b.x + b.w)) + pad, height: Math.max(...all.map((b) => b.y + b.h)) + pad, cols: cols.map((c) => c.map((n) => n.id)) };
}

export function moveBoxes(boxes: Record<string, Box>, offsets: Readonly<Record<string, { dx: number; dy: number }>>): Record<string, Box> {
  const out: Record<string, Box> = {};
  for (const [id, b] of Object.entries(boxes)) { const d = offsets[id]; out[id] = d ? { ...b, x: b.x + d.dx, y: b.y + d.dy } : b; }
  return out;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
export interface EdgeGeom { id: string; d: string; mid: { x: number; y: number }; len: number }

export function edgeGeom(id: string, a: Box, b: Box, row: number | null): EdgeGeom {
  const x1 = a.x + a.w, y1 = a.y + (row === null ? Math.min(a.h, NG_HEAD_H) / 2 : rowAnchor(row));
  const x2 = b.x, y2 = b.y + Math.min(b.h, NG_HEAD_H) / 2;
  const dx = x2 > x1 ? Math.max(30, (x2 - x1) / 2) : 80;
  const p = [x1, y1, x1 + dx, y1, x2 - dx, y2, x2, y2];
  const at = (t: number) => { const u = 1 - t; const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return { x: k[0] * p[0] + k[1] * p[2] + k[2] * p[4] + k[3] * p[6], y: k[0] * p[1] + k[1] * p[3] + k[2] * p[5] + k[3] * p[7] }; };
  let len = 0, prev = at(0);
  for (let i = 1; i <= 16; i++) { const q = at(i / 16); len += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
  const m = at(0.5);
  return { id, d: `M${r1(p[0])},${r1(p[1])} C${r1(p[2])},${r1(p[3])} ${r1(p[4])},${r1(p[5])} ${r1(p[6])},${r1(p[7])}`, mid: { x: r1(m.x), y: r1(m.y) }, len };
}

export function labelWidth(text: string, fs = 11): number {
  let w = 0;
  for (const ch of text) w += /[\u2E80-\uFFFF]/.test(ch) ? fs : fs * 0.6;
  return Math.round(w + 12);
}
```

- [ ] **Step 4：实现 `viewport.ts`**

```ts
// spec D1: zoom (wheel / − + / fit), the entrance timetable, and when not to animate (reduced motion, >150 cards).
export interface View { scale: number; x: number; y: number }
export interface Size { w: number; h: number }
export const NG_ZOOM = { min: 0.25, max: 2.5, step: 1.2 } as const;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function fitView(content: Size, box: Size, o: { max?: number; pad?: number } = {}): View {
  const max = o.max ?? 1.25, pad = o.pad ?? 16;
  if (content.w <= 0 || content.h <= 0 || box.w <= 0 || box.h <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = clamp(Math.min((box.w - 2 * pad) / content.w, (box.h - 2 * pad) / content.h), NG_ZOOM.min, max);
  return { scale, x: (box.w - content.w * scale) / 2, y: (box.h - content.h * scale) / 2 };
}
export function zoomAt(v: View, scale: number, p: { x: number; y: number }): View {
  const s = clamp(scale, NG_ZOOM.min, NG_ZOOM.max), k = s / v.scale;
  return { scale: s, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k };
}
export const zoomBy = (v: View, dir: 1 | -1, box: Size): View => zoomAt(v, dir > 0 ? v.scale * NG_ZOOM.step : v.scale / NG_ZOOM.step, { x: box.w / 2, y: box.h / 2 });
export const pct = (scale: number) => `${Math.round(scale * 100)}%`;

export const NG_ANIMATE_MAX = 150;
export const motionOn = (count: number, reduced: boolean) => !reduced && count <= NG_ANIMATE_MAX;
export const NG_CARD_STAGGER = 90, NG_CARD_IN = 320, NG_EDGE_STAGGER = 40, NG_EDGE_IN = 420;
export function entranceTimes(cards: number, edges: number) {
  const card = (i: number) => Math.min(i * NG_CARD_STAGGER, 1500);
  const edgesAt = cards ? card(cards - 1) + Math.round(NG_CARD_IN * 0.6) : 0;
  const edge = (i: number) => edgesAt + Math.min(i * NG_EDGE_STAGGER, 800);
  const total = edges ? edge(edges - 1) + NG_EDGE_IN : cards ? card(cards - 1) + NG_CARD_IN : 0;
  return { card, edge, total };
}
```

- [ ] **Step 5：编排这边改用共用的 `layers`**：`graph-layout.ts` 删掉 :17-39 的函数体，顶部加

```ts
import { layers } from '@/ui/node-graph/layout';
export { layers };
```

`layoutGraph` 继续调用 `layers(nodes)`（输入类型 `GraphNode` 满足 `LayerIn`）。`graph-layout.test.ts` 里测 `layers` 的那个 `describe` 已经搬进 `layout.test.ts`，在这里删掉；其余不动。

- [ ] **Step 6：确认通过**：`cd web && $CLEAN npx vitest run src/ui/node-graph src/features/orchestra && $CLEAN npx tsc -b --noEmit`（期望：全绿；如果 `tsc -b` 不认 `--noEmit`，就跑根目录的 `$CLEAN npm run typecheck`）

- [ ] **Step 7：提交**

```bash
git add web/src/ui/node-graph/layout.ts web/src/ui/node-graph/layout.test.ts web/src/ui/node-graph/viewport.ts web/src/ui/node-graph/viewport.test.ts web/src/features/orchestra/graph-layout.ts web/src/features/orchestra/graph-layout.test.ts
git commit -m "feat(web): node graph layout and viewport; topological layers move to ui/node-graph (stage D1, pure)"
```

---

### Task 3：共用组件 `NodeGraph`

**Files:**
- Create: `web/src/ui/node-graph/types.ts`（只放 props 类型，`index.tsx` 引它时不会把组件静态拉进来）
- Create: `web/src/ui/node-graph/motion.ts`（`useReducedMotion`）
- Create: `web/src/ui/node-graph/NodeGraph.tsx`
- Create: `web/src/ui/node-graph/node-graph.css`
- Create: `web/src/ui/node-graph/index.tsx`（`LazyNodeGraph`）
- Create: `web/src/ui/node-graph/NodeGraph.test.tsx`（`react-dom/server` 静态渲染）
- Modify: `web/src/i18n/en.ts`

**Interfaces:**
- Consumes: Task 1-2 的全部；`wheelZoom`；`Select`（`ui/Select.tsx`）；`Icon`、`ICON_NAMES`、`IconName`（`ui/icons.tsx:37,61`）；`imeComposing`（`ui/ime.ts:11`）；`reducedMotion`（`ui/input-intent.ts:35`）；`clsx`（`@/util`）。
- Produces（`types.ts`）:
  ```ts
  import type { NodeGraphData } from './schema';
  import type { Picks } from './marks';
  export interface NodeGraphProps {
    graph: NodeGraphData;
    ariaLabel: string;
    height?: number;                        // 画布高度，px，默认 360
    cardW?: number;                         // 默认 NG_CARD_W
    align?: 'center' | 'top';               // 默认 'center'
    compact?: boolean;                      // 右侧面板：更小的字和控件
    entrance?: boolean;                     // 挂载时放入场（仍受减少动效和 >150 的约束）
    selected?: string | null;
    onSelect?: (id: string) => void;        // 点卡片 / 在卡片上按 Enter
    canSelect?: (id: string) => boolean;    // 默认：有 onSelect 就都能选
    picks?: Picks;                          // 受控的下拉框
    onPick?: (key: string, value: string) => void;   // 不给 → 行只显示文字
    className?: string;
  }
  ```
- Produces: `motion.ts` 的 `export function useReducedMotion(): boolean`；`NodeGraph.tsx` 的 `export function NodeGraph(p: NodeGraphProps): JSX.Element`；`index.tsx` 的 `export function LazyNodeGraph(p: NodeGraphProps)`，以及 `export type { NodeGraphProps } from './types'`。
- DOM 约定（smoke 和 CSS 都靠它）：
  - 根节点：`div.ng[data-motion="on|off"][role="group"][aria-label]`，内联 CSS 变量 `--ng-head-h --ng-row-h --ng-body-pad --ng-list-head --ng-list-item`（取自 layout 常量，尺寸只有一个来源）。
  - `.ng-head > .ng-title + .ng-sub`；`.ng-badge[data-tone][role="status"][aria-live="polite"]`。
  - `.ng-viewport[tabindex="0"]`（拖动时加 `.panning`）> `.ng-layer`（`transform: translate() scale()`）> `svg.ng-edges`（子元素 `g.ng-edge[data-edge][data-style]`，里面有 `path.ng-glow`（只有 strong / error）、`path.ng-line`、`circle.ng-pulse > animateMotion`（只在动效开且 `pulses()` 为真时）、`g.ng-label > rect + text`）加上 `div.ng-card[data-node][data-state]`（选中时加 `.sel`；`> .ng-card-h > .ng-ic + .ng-tx > .ng-t + .ng-s`；`.ng-rows > .ng-row[data-row] > .k + (.v | .select-trigger)`；`.ng-list > .ng-list-h + .ng-li > span + .ng-tag*`）。
  - `.ng-zoom > button.ng-zoom-out + span.ng-zoom-pct + button.ng-zoom-in + button.ng-fit`。

- [ ] **Step 1：写失败的测试** `web/src/ui/node-graph/NodeGraph.test.tsx`

```tsx
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/ui/Select', () => ({ Select: () => null }));   // Select → Popover → ActionSheet pulls the store; not needed for markup
import { NodeGraph } from './NodeGraph';
import { normalizeNodeGraph } from './schema';
import { initialPicks } from './marks';
import { ACCESS_SAMPLE } from './sample';

const g = (() => { const r = normalizeNodeGraph(ACCESS_SAMPLE); if (!r.ok) throw new Error(r.error); return r.graph; })();
const html = (extra: Partial<Parameters<typeof NodeGraph>[0]> = {}) => renderToStaticMarkup(<NodeGraph graph={g} ariaLabel="t" {...extra} />);

describe('NodeGraph markup', () => {
  it('cards, edges with their styles, title and badge', () => {
    const h = html({ picks: initialPicks(g) });
    expect(h.match(/class="ng-card[ "]/g)).toHaveLength(5);
    expect(h).toContain('data-edge="e-open" data-style="error"');
    expect(h).toContain('data-edge="e-backup" data-style="dashed"');
    expect(h).toContain('Access settings');
    expect(h).toMatch(/class="ng-badge" data-tone="error"[^>]*>[^<]*1 open path/);
    expect(h).toContain('class="ng-zoom-pct"');
  });
  it('a pick re-marks the edge and recomputes the badge', () => {
    const h = html({ picks: { ...initialPicks(g), 'link/read': 'Admin' } });
    expect(h).toContain('data-edge="e-open" data-style="dashed"');
    expect(h).toContain('data-tone="ok"');
  });
  it('the travelling dot on error / strong edges, none above 150 cards', () => {
    expect(html()).toContain('<animateMotion');
    const big = { ...g, nodes: Array.from({ length: 151 }, (_, i) => ({ id: `n${i}`, title: `n${i}`, rows: [] })), edges: [{ id: 'x', from: 'n0', to: 'n1', style: 'strong' as const }] };
    const h = renderToStaticMarkup(<NodeGraph graph={big} ariaLabel="t" />);
    expect(h).not.toContain('<animateMotion');
    expect(h).toContain('data-motion="off"');
  });
  it('rows without onPick are plain text', () => {
    expect(html()).toMatch(/data-row="read"[^]*?class="v">Anyone</);
  });
});
```

注：`renderToStaticMarkup` 输出的属性顺序就是 JSX 里的书写顺序。`g.ng-edge` 上的属性按 `className, data-edge, data-style` 的顺序写，`.ng-badge` 按 `className, data-tone, role, aria-live` 的顺序写。

- [ ] **Step 2：确认失败**：`cd web && $CLEAN npx vitest run src/ui/node-graph/NodeGraph.test.tsx`

- [ ] **Step 3：`motion.ts`**

```ts
import { useEffect, useState } from 'react';
import { reducedMotion } from '@/ui/input-intent';
/** Live: the in-app 减少动画 (data-reduce-motion on <html>) and the system setting. */
export function useReducedMotion(): boolean {
  const [r, setR] = useState(reducedMotion);
  useEffect(() => {
    const on = () => setR(reducedMotion());
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduce-motion'] });
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener('change', on);
    return () => { mo.disconnect(); mq.removeEventListener('change', on); };
  }, []);
  return r;
}
```

- [ ] **Step 4：`NodeGraph.tsx`**（实现要点。`import './node-graph.css'` 写在文件顶部）
  - 派生数据全用 `useMemo`：
    - `placed = layoutNodes(graph.nodes, graph.edges, { cardW, align })`
    - `boxes = moveBoxes(placed.boxes, offsets)`
    - `styles = edgeStyles(graph, picks ?? EMPTY)`（`const EMPTY = {}` 放在模块顶层）
    - `badge = badgeView(graph.badge, styles)`
    - `rowIdx`：`Map<nodeId, Map<rowId, index>>`
    - `geoms = graph.edges.map(e => edgeGeom(e.id, boxes[e.from], boxes[e.to], e.fromRow ? rowIdx… : null))`
  - `reduced = useReducedMotion()`；`motion = motionOn(graph.nodes.length, reduced)`。
  - `nodeKey = graph.nodes.map(n => n.id).join('\n')`。拖动偏移在 `nodeKey` 变化时只保留仍然存在的卡片；适应窗口只在第一次量到尺寸、或 `nodeKey` 变了且用户还没缩放 / 平移过（`touched` ref）时发生。D2 / D3 每秒都会传一个新的 `graph` 对象，这条规则保证它们不会每秒重新适应、也不会重放入场。
  - 尺寸：根节点挂 `ResizeObserver` 记 `box`；`w` 或 `h` 为 0（面板隐藏）时什么都不做。
  - 入场：`const [playing, setPlaying] = useState(() => entrance && motion)`。为真时卡片加 `.ng-in`，带 `style={{ animationDelay: t.card(i) + 'ms' }}`；线也加 `.ng-in`，带 `--len` 和 `t.edge(i)` 延迟；标签和光点等线画完再淡入。`t.total + 50` ms 后 `setPlaying(false)`，去掉这些 class，之后拖动不会重放。
  - 滚轮：在 `.ng-viewport` 上用 `addEventListener('wheel', h, { passive: false })`，读 `viewRef.current`；`const next = wheelZoom(v.scale, e, NG_ZOOM); if (next === null) return; e.preventDefault(); touched = true; setView(zoomAt(v, next, { x: e.clientX - rect.left, y: e.clientY - rect.top }))`。Shift + 滚轮不拦，留给页面滚动（A3 规则）。
  - 指针：`.ng-viewport` 上的 `onPointerDown`。如果 `target.closest('.select-trigger, button, a, input, .select-popover')`，直接返回。否则看 `target.closest('.ng-card')`：有 → 拖卡片，没有 → 平移；然后 `setPointerCapture`。`pointermove` 用 rAF 节流：拖卡片时 `offsets[id] = base + d / view.scale`，平移时 `view.x / y = base + d`。移动超过 4px 算拖动（同时 `touched = true`）。`pointerup` 时如果没拖动且按在卡片上、`canSelect(id)` 为真 → `onSelect(id)`。用 pointerup 而不是 onClick，拖完不会误选。平移中给 viewport 加 `.panning`。
  - 双击空白（`onDoubleClick` 且 target 不在卡片里）：`setOffsets({})`、`touched = false`、重新适应。
  - 键盘：卡片 `tabIndex={0}`，能选的卡片 `role="button"`，其余 `role="group"`；都带 `aria-label={n.title}`、`title={n.tip}`。卡片上 Enter / 空格（`imeComposing(e)` 时跳过，target 必须就是卡片本身）→ `onSelect`。viewport 获得焦点时：`+` / `=` → `zoomBy(1)`，`-` → `zoomBy(-1)`，`0` → 适应。
  - 卡片：`style={{ left, top, width, height, '--c': n.accent }}`，`data-state={n.state}`，选中时加 `.sel`。图标：`ICON_NAMES.includes(n.icon)` → `<Icon name size={14} />`；`n.icon` 长度不超过 2（emoji）→ 原样显示；否则显示标题首字（大写）。有行时显示 `.ng-rows`：`onPick && r.options.length` → `<Select className="ng-sel" value={picks?.[key] ?? r.value} options={r.options.map(o => ({ value: o.value, label: o.label }))} onValueChange={v => onPick(key, String(v))} label={r.label} />`，否则 `<span className="v">{r.value}</span>`。有列表时显示 `.ng-list`。
  - 线：每条线外面一个 `<g className={clsx('ng-edge', playing && 'ng-in')} data-edge={e.id} data-style={st} style={{ '--len': len, animationDelay }}>`。strong / error 先画 `path.ng-glow`，再画 `path.ng-line`；`motion && pulses(e, st)` 时加 `<circle className="ng-pulse" r={3.5}><animateMotion dur={`${Math.max(1.2, len / 140).toFixed(2)}s`} repeatCount="indefinite" path={d} /></circle>`；有 `e.label` 时在 `mid` 画 `rect`（宽 `labelWidth(label)`，高 18，`rx` 9，居中）和 `text`（`text-anchor="middle"`，`dy="0.35em"`）。
  - 画布底纹跟着平移和缩放：根节点 `backgroundPosition: ${x}px ${y}px`，`backgroundSize: ${18 * scale}px ${18 * scale}px`。
  - 缩放控件：`− {pct(view.scale)} +` 外加一个适应按钮（`Icon` 用 `ICON_NAMES` 里的现成名字；aria 依次是 `tr('缩小')` / `tr('放大')` / `tr('适应窗口')`）。viewport 带 `aria-label={tr('节点图')}`、`title={tr('拖动画布平移，滚轮缩放，双击空白恢复布局')}`。

- [ ] **Step 5：`node-graph.css`**（只用令牌）

```css
/* spec 2026-10-24 D1 — the shared node graph. Sizes come from layout.ts through the --ng-* variables set inline. */
.ng { position: relative; overflow: hidden; border-radius: var(--r-lg); color: var(--ink-1); font-family: var(--font); user-select: none;
  background-color: color-mix(in oklab, var(--bg) 82%, var(--bg-2));
  background-image: radial-gradient(circle, var(--edge-subtle) 1px, transparent 1.4px);
  --ng-strong: var(--accent); --ng-error: var(--err); --ng-line: var(--edge-strong); }
.ng-head { position: absolute; left: 14px; top: 12px; z-index: 2; pointer-events: none; max-width: 60%; }
.ng-title { font-size: var(--fs-sm); font-weight: 600; }
.ng-sub { font-size: var(--fs-meta); color: var(--ink-3); margin-top: 2px; }
.ng-badge { position: absolute; right: 12px; top: 12px; z-index: 2; display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px;
  font-size: var(--fs-meta); font-weight: 600; background: var(--fill-subtle); color: var(--ink-2); transition: background var(--dur-base) var(--ease-out), color var(--dur-base) var(--ease-out); }
.ng-badge[data-tone='error'] { background: var(--err-soft); color: color-mix(in oklab, var(--err) 80%, var(--ink-1)); }
.ng-badge[data-tone='ok'] { background: var(--ok-soft); color: color-mix(in oklab, var(--ok) 80%, var(--ink-1)); }
.ng-viewport { position: absolute; inset: 0; cursor: grab; touch-action: none; outline: none; }
.ng-viewport:focus-visible { box-shadow: inset 0 0 0 2px var(--focus-ring); }
.ng-viewport.panning { cursor: grabbing; }
.ng-layer { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.ng-layer > svg.ng-edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.ng-line { fill: none; stroke: var(--ng-line); stroke-width: 1.6; transition: stroke var(--dur-slow) var(--ease-out); }
.ng-edge[data-style='dashed'] .ng-line { stroke-dasharray: 5 5; opacity: 0.75; }
.ng-edge[data-style='strong'] .ng-line { stroke: var(--ng-strong); stroke-width: 2; }
.ng-edge[data-style='error'] .ng-line { stroke: var(--ng-error); stroke-width: 2; }
.ng-glow { fill: none; stroke-width: 9; stroke-linecap: round; opacity: 0.2; }
.ng-edge[data-style='strong'] .ng-glow, .ng-edge[data-style='strong'] .ng-pulse { stroke: var(--ng-strong); fill: var(--ng-strong); }
.ng-edge[data-style='error'] .ng-glow, .ng-edge[data-style='error'] .ng-pulse { stroke: var(--ng-error); fill: var(--ng-error); }
.ng-glow { fill: none !important; }
.ng-label rect { fill: var(--surface-elev); stroke: var(--edge-subtle); }
.ng-label text { fill: var(--ink-3); font-size: 11px; }
.ng-edge[data-style='error'] .ng-label text { fill: color-mix(in oklab, var(--err) 75%, var(--ink-1)); }
.ng-card { position: absolute; box-sizing: border-box; border-radius: var(--r-lg); background: var(--surface-1); border: var(--hairline) solid var(--edge-default);
  box-shadow: var(--elev-1); overflow: hidden; cursor: grab; transition: border-color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out); }
.ng-card[role='button'] { cursor: pointer; }
.ng-card:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.ng-card.sel { box-shadow: var(--elev-1), 0 0 0 2px var(--accent); }
.ng-card[data-state='running'] { border-color: var(--ng-strong); box-shadow: var(--elev-1), 0 0 0 3px color-mix(in oklab, var(--ng-strong) 20%, transparent), 0 0 18px color-mix(in oklab, var(--ng-strong) 28%, transparent); }
.ng-card[data-state='failed'] { border-color: var(--ng-error); }
.ng-card[data-state='queued'], .ng-card[data-state='stopped'] { opacity: 0.72; }
.ng-card-h { height: var(--ng-head-h); display: flex; align-items: center; gap: 8px; padding: 0 10px; }
.ng-ic { flex: none; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; font-size: var(--fs-meta); font-weight: 700;
  color: var(--c, var(--ink-2)); background: color-mix(in oklab, var(--c, var(--ink-3)) 16%, transparent); }
.ng-tx { min-width: 0; }
.ng-t { font-size: var(--fs-sm); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ng-s { font-size: var(--fs-micro); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ng-rows { padding: calc(var(--ng-body-pad) / 2) 10px; border-top: var(--hairline) solid var(--edge-subtle); }
.ng-row { height: var(--ng-row-h); display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: var(--fs-meta); }
.ng-row .k { color: var(--ink-3); font-family: var(--mono); }
.ng-row .v { color: var(--ink-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ng-row .select-trigger { height: 22px; font-size: var(--fs-meta); }
.ng-list { padding: 0 10px calc(var(--ng-body-pad) / 2); border-top: var(--hairline) solid var(--edge-subtle); }
.ng-list-h { height: var(--ng-list-head); display: flex; align-items: center; font-size: var(--fs-micro); color: var(--ink-3); }
.ng-li { height: var(--ng-list-item); display: flex; align-items: center; gap: 6px; font-size: var(--fs-meta); }
.ng-li > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ng-tag { padding: 0 6px; border-radius: 999px; background: var(--fill-subtle); color: var(--ink-3); font-size: var(--fs-micro); }
.ng-zoom { position: absolute; right: 10px; bottom: 10px; z-index: 2; display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: 999px;
  background: var(--surface-elev); box-shadow: var(--elev-1); font-size: var(--fs-meta); }
.ng-zoom button { width: 24px; height: 24px; border: 0; border-radius: 999px; background: transparent; color: var(--ink-2); cursor: pointer; }
.ng-zoom button:hover { background: var(--fill-subtle); color: var(--ink-1); }
.ng-zoom-pct { min-width: 44px; text-align: center; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.ng.compact .ng-zoom-pct { min-width: 36px; }
.ng.compact .ng-head, .ng.compact .ng-badge { display: none; }
/* motion */
.ng[data-motion='on'] .ng-card.ng-in { animation: ng-card-in 320ms var(--ease-out) both; }
.ng[data-motion='on'] .ng-edge.ng-in .ng-line { stroke-dasharray: var(--len); stroke-dashoffset: var(--len); animation: ng-draw 420ms var(--ease-out) forwards; animation-delay: inherit; }
.ng[data-motion='on'] .ng-edge.ng-in[data-style='dashed'] .ng-line { stroke-dasharray: 5 5; stroke-dashoffset: 0; animation-name: ng-fade; }
.ng[data-motion='on'] .ng-edge.ng-in .ng-label, .ng[data-motion='on'] .ng-edge.ng-in .ng-glow { animation: ng-fade 420ms var(--ease-out) both; animation-delay: inherit; }
.ng[data-motion='on'] .ng-glow { animation: ng-breathe 2.4s ease-in-out infinite; }
@keyframes ng-card-in { from { opacity: 0; transform: translateY(6px) scale(0.98); } }
@keyframes ng-draw { to { stroke-dashoffset: 0; } }
@keyframes ng-fade { from { opacity: 0; } }
@keyframes ng-breathe { 50% { opacity: 0.32; } }
:root[data-reduce-motion='1'] .ng, :root[data-reduce-motion='1'] .ng * { animation: none !important; transition: none !important; }
@media (prefers-reduced-motion: reduce) { .ng, .ng * { animation: none !important; transition: none !important; } }
```

（`--fs-sm` / `--fs-meta` / `--fs-micro` / `--hairline` / `--r-lg` / `--elev-1` / `--dur-*` / `--ease-out` 都在 `tokens.css` 里。如果某个名字核对不到，换成 `tokens.css` 里最接近的，不要写死值。`--len` 由 JSX 以数字写入，`stroke-dasharray` 可以直接用无单位数字。）

- [ ] **Step 6：`index.tsx`**

```tsx
import { lazy, Suspense } from 'react';
import type { NodeGraphProps } from './types';
export type { NodeGraphProps } from './types';
// The component (+ its CSS) is its own chunk: background panel and orchestra live in boot, which has ~85 KB headroom.
const Impl = lazy(() => import('./NodeGraph').then((m) => ({ default: m.NodeGraph })));
export function LazyNodeGraph(p: NodeGraphProps) {
  return (
    <Suspense fallback={<div className="ng ng-loading" style={{ height: p.height ?? 360 }} aria-busy="true" />}>
      <Impl {...p} />
    </Suspense>
  );
}
```

- [ ] **Step 7：英文**（`set.mjs`）：`{"缩小": "Zoom out", "放大": "Zoom in", "适应窗口": "Fit to view", "节点图": "Node graph", "拖动画布平移，滚轮缩放，双击空白恢复布局": "Drag to pan, scroll to zoom, double-click empty space to reset"}`。哪一条 `get.mjs` 已经查到有英文，就跳过那条。

- [ ] **Step 8：确认通过**：`cd web && $CLEAN npx vitest run src/ui/node-graph && cd .. && $CLEAN npm run typecheck && node scripts/i18n/extract.mjs --check`

- [ ] **Step 9：提交**

```bash
git add web/src/ui/node-graph/types.ts web/src/ui/node-graph/motion.ts web/src/ui/node-graph/NodeGraph.tsx web/src/ui/node-graph/node-graph.css web/src/ui/node-graph/index.tsx web/src/ui/node-graph/NodeGraph.test.tsx web/src/i18n/en.ts
git commit -m "feat(web): shared NodeGraph component — drag, zoom, glowing edges, entrance (stage D1)"
```

---

### Task 4：后台页的关系图（D2）

**Files:**
- Create: `web/src/features/background/graph-data.ts`
- Create: `web/src/features/background/graph-data.test.ts`
- Modify: `web/src/features/background/CommandGraph.tsx:1-115`（整个重写；导出名和签名不变，所以 `BackgroundPage.tsx:103`、`TasksPanel.tsx:45` 的调用不用改）
- Modify: `web/src/features/background/BackgroundPage.tsx:99-106`（`.bg-graph-wrap` 从 `.bg-side-col` 里挪出来，放到 `AgentCards` 下面，占主栏整宽；`Bill` 和「动态」留在侧栏不动）
- Modify: `web/src/styles/background.css:96-122,169,175`；`web/src/styles/background-page.css:39`
- Modify: `web/src/i18n/en.ts`

**Interfaces:**
- Consumes: `BgSession`、`BgTask`、`BgAgent`（`@shared`）；`agentColor agentStateText clock KIND_LABEL taskStateText taskTitle tokensText`（`./model`）；`NgNode`、`NgEdge`、`NgRow`、`NodeGraphData`、`NodeState`、`EdgeStyle`；`LazyNodeGraph`。
- Produces:
  ```ts
  export const HUB = 'main';
  export interface BgGraph { graph: NodeGraphData; more: number; picks: Record<string, { agentKey: string; taskId: string }> }
  export function edgeStyleFor(s: NodeState): EdgeStyle;   // running→strong, failed→error, done→normal, 其余→dashed
  export function phaseState(agents: BgAgent[]): NodeState; // 有在跑的→running；有失败的→failed；全部完成→done；否则 queued
  export function backgroundGraph(session: BgSession, o: { taskId?: string; compact?: boolean; now: number }): BgGraph;
  ```
  - 卡片 id：中心 `main`；工作流 `wf|<taskId>`；阶段 `wf|<taskId>|p<index>`；代理 `<taskId>|<agentKey>`（和旧图一样）；命令 `shell|<taskId>`（和旧图一样）。
  - 连线：主对话 → 工作流 / 子代理 / 命令；工作流 → 阶段 → 代理；没有阶段的代理挂在工作流下面。线 id 是 `from>to`。失败的线 `pulse: false`（停了的红线不流动）。
  - 代理卡片的行（只读）：类型 / 模型 / token / 用时；`compact` 时不显示行，副标题改成状态文字。
  - 上限：compact 16、整页 40 个代理，在跑的优先，剩下的计入 `more`。
  - 只有代理卡片能点（`picks` 里有它）。

- [ ] **Step 1：写失败的测试** `graph-data.test.ts`（数据和 ui-smoke :2944 注入的那组一样）

```ts
import { describe, expect, it } from 'vitest';
import type { BgSession } from '@shared';
import { layoutNodes } from '@/ui/node-graph/layout';
import { backgroundGraph, edgeStyleFor, phaseState } from './graph-data';

const now = 1_000_000;
const agent = (key: string, state: 'queued' | 'running' | 'done' | 'failed' | 'stopped', phase?: number) =>
  ({ key, color: 1, label: key, phase, phaseTitle: phase ? `阶段${phase}` : undefined, agentType: 'general-purpose', model: 'opus', state, startedAt: now - 5000, tokens: 1200 });
const session = {
  sessionId: 's',
  tasks: [
    { id: 'wf1', kind: 'workflow', name: 'review', description: 'review', status: 'running', startedAt: now - 9000, tokens: 0, phases: [{ index: 1, title: '一' }, { index: 2, title: '二' }], agents: [agent('w1', 'running', 1), agent('w2', 'done', 1), agent('w3', 'queued', 2)] },
    { id: 'ag1', kind: 'agent', description: 'look around', status: 'running', startedAt: now - 3000, tokens: 0, agents: [agent('ag1', 'running')] },
    { id: 'sh1', kind: 'shell', description: 'npm run dev', status: 'running', startedAt: now - 1000, tokens: 0, agents: [] },
  ],
} as unknown as BgSession;
const styleOf = (r: ReturnType<typeof backgroundGraph>) => Object.fromEntries(r.graph.edges.map((e) => [e.id, e.style]));

describe('background graph', () => {
  it('main → workflow → phases → agents, plus the sub-agent and the command', () => {
    const r = backgroundGraph(session, { now });
    expect(r.graph.nodes.map((n) => n.id)).toEqual(['main', 'wf|wf1', 'wf|wf1|p1', 'wf1|w1', 'wf1|w2', 'wf|wf1|p2', 'wf1|w3', 'ag1|ag1', 'shell|sh1']);
    expect(styleOf(r)).toEqual({
      'main>wf|wf1': 'strong', 'wf|wf1>wf|wf1|p1': 'strong', 'wf|wf1|p1>wf1|w1': 'strong', 'wf|wf1|p1>wf1|w2': 'normal',
      'wf|wf1>wf|wf1|p2': 'dashed', 'wf|wf1|p2>wf1|w3': 'dashed', 'main>ag1|ag1': 'strong', 'main>shell|sh1': 'strong',
    });
    expect(r.graph.nodes[0].subtitle).toBe('3 个在跑');
    expect(Object.keys(r.picks).sort()).toEqual(['ag1|ag1', 'wf1|w1', 'wf1|w2', 'wf1|w3']);
    expect(r.picks['wf1|w1']).toEqual({ agentKey: 'w1', taskId: 'wf1' });
  });
  it('columns read left to right', () => {
    const r = backgroundGraph(session, { now });
    expect(layoutNodes(r.graph.nodes, r.graph.edges).cols).toEqual([['main'], ['wf|wf1', 'ag1|ag1', 'shell|sh1'], ['wf|wf1|p1', 'wf|wf1|p2'], ['wf1|w1', 'wf1|w2', 'wf1|w3']]);
  });
  it('agent cards carry their details as rows; compact drops them', () => {
    const full = backgroundGraph(session, { now }).graph.nodes.find((n) => n.id === 'wf1|w1')!;
    expect(full.rows.map((r) => r.id)).toEqual(['type', 'model', 'tokens', 'time']);
    expect(full.state).toBe('running');
    expect(backgroundGraph(session, { now, compact: true }).graph.nodes.find((n) => n.id === 'wf1|w1')!.rows).toEqual([]);
  });
  it('one task only (the drawer)', () => {
    expect(backgroundGraph(session, { now, taskId: 'ag1' }).graph.nodes.map((n) => n.id)).toEqual(['main', 'ag1|ag1']);
  });
  it('a failed agent: red, no travelling dot', () => {
    const s = { tasks: [{ ...session.tasks[1], agents: [agent('ag1', 'failed')] }] } as unknown as BgSession;
    const e = backgroundGraph(s, { now }).graph.edges[0];
    expect([e.style, e.pulse]).toEqual(['error', false]);
  });
  it('caps the agents, running first', () => {
    const many = { tasks: [{ id: 't', kind: 'agent', status: 'running', description: 'x', startedAt: now, tokens: 0, agents: Array.from({ length: 20 }, (_, i) => agent(`a${i}`, i === 19 ? 'running' : 'done')) }] } as unknown as BgSession;
    const r = backgroundGraph(many, { now, compact: true });
    expect(r.more).toBe(4);
    expect(r.graph.nodes.some((n) => n.id === 't|a19')).toBe(true);
  });
  it('style and phase rules', () => {
    expect(['running', 'failed', 'done', 'queued', 'stopped'].map((s) => edgeStyleFor(s as never))).toEqual(['strong', 'error', 'normal', 'dashed', 'dashed']);
    expect(phaseState([])).toBe('queued');
  });
});
```

- [ ] **Step 2：确认失败**：`cd web && $CLEAN npx vitest run src/features/background/graph-data.test.ts`

- [ ] **Step 3：实现 `graph-data.ts`**

```ts
import type { BgAgent, BgSession, BgTask } from '@shared';
import type { EdgeStyle, NgEdge, NgNode, NgRow, NodeGraphData, NodeState } from '@/ui/node-graph/schema';
import { agentColor, agentStateText, clock, KIND_LABEL, taskStateText, taskTitle, tokensText } from './model';
import { tr } from '@/i18n';
// spec 2026-10-24 D2: the background registry as a node graph (replaces the radial CommandGraph). Pure.

export const HUB = 'main';
export interface BgGraph { graph: NodeGraphData; more: number; picks: Record<string, { agentKey: string; taskId: string }> }
const AGENT: Record<BgAgent['state'], NodeState> = { queued: 'queued', running: 'running', done: 'done', failed: 'failed', stopped: 'stopped' };
const TASK: Record<BgTask['status'], NodeState> = { running: 'running', completed: 'done', failed: 'failed', stopped: 'stopped' };
export const edgeStyleFor = (s: NodeState): EdgeStyle => (s === 'running' ? 'strong' : s === 'failed' ? 'error' : s === 'done' ? 'normal' : 'dashed');
export function phaseState(agents: BgAgent[]): NodeState {
  if (agents.some((a) => a.state === 'running')) return 'running';
  if (agents.some((a) => a.state === 'failed')) return 'failed';
  return agents.length && agents.every((a) => a.state === 'done') ? 'done' : 'queued';
}

function agentRows(t: BgTask, a: BgAgent, now: number): NgRow[] {
  const end = a.endedAt ?? (a.state === 'running' ? now : undefined);
  const rows: Omit<NgRow, 'options'>[] = [{ id: 'type', label: tr('类型'), value: a.agentType ?? KIND_LABEL[t.kind] }];
  if (a.model) rows.push({ id: 'model', label: tr('模型'), value: a.model });
  if (a.tokens != null) rows.push({ id: 'tokens', label: 'token', value: tokensText(a.tokens) });
  if (a.startedAt && end) rows.push({ id: 'time', label: tr('用时'), value: clock(end - a.startedAt) });
  return rows.map((r) => ({ ...r, options: [] }));
}

export function backgroundGraph(session: BgSession, o: { taskId?: string; compact?: boolean; now: number }): BgGraph {
  const tasks = o.taskId ? session.tasks.filter((t) => t.id === o.taskId) : session.tasks;
  const all = tasks.flatMap((t) => t.agents.map((a) => ({ t, a })));
  const order = [...all.filter((x) => x.a.state === 'running'), ...all.filter((x) => x.a.state !== 'running')];
  const keep = new Set(order.slice(0, o.compact ? 16 : 40).map((x) => `${x.t.id}|${x.a.key}`));
  const running = all.filter((x) => x.a.state === 'running').length + tasks.filter((t) => t.kind === 'shell' && t.status === 'running').length;
  const nodes: NgNode[] = [{ id: HUB, title: tr('主对话'), subtitle: running ? tr('{running} 个在跑', { running }) : tr('没有在跑的'), icon: 'chat', rows: [] }];
  const edges: NgEdge[] = [];
  const picks: BgGraph['picks'] = {};
  const edge = (from: string, to: string, s: NodeState) => edges.push({ id: `${from}>${to}`, from, to, style: edgeStyleFor(s), pulse: s === 'failed' ? false : undefined });
  const agentNode = (t: BgTask, a: BgAgent) => {
    const id = `${t.id}|${a.key}`;
    nodes.push({ id, title: a.label, subtitle: o.compact ? agentStateText(a) : a.phaseTitle, icon: 'agent', accent: agentColor(a.color), state: AGENT[a.state], tip: a.lastSummary, rows: o.compact ? [] : agentRows(t, a, o.now) });
    picks[id] = { agentKey: a.key, taskId: t.id };
    return id;
  };
  for (const t of tasks) {
    if (t.kind === 'shell') {
      const id = `shell|${t.id}`;
      nodes.push({ id, title: t.description, subtitle: `${KIND_LABEL.shell} · ${taskStateText(t)}`, icon: 'terminal', state: TASK[t.status], rows: [] });
      edge(HUB, id, TASK[t.status]);
      continue;
    }
    if (t.kind !== 'workflow') { for (const a of t.agents) if (keep.has(`${t.id}|${a.key}`)) edge(HUB, agentNode(t, a), AGENT[a.state]); continue; }
    const wf = `wf|${t.id}`;
    nodes.push({ id: wf, title: taskTitle(t), subtitle: `${KIND_LABEL.workflow} · ${taskStateText(t)}`, icon: 'workflow', state: TASK[t.status], rows: [] });
    edge(HUB, wf, TASK[t.status]);
    const phases = t.phases?.length ? t.phases : [...new Map(t.agents.filter((a) => a.phase != null).map((a) => [a.phase!, { index: a.phase!, title: a.phaseTitle ?? String(a.phase) }])).values()];
    for (const p of phases) {
      const mine = t.agents.filter((a) => a.phase === p.index);
      const pid = `wf|${t.id}|p${p.index}`, ps = phaseState(mine);
      nodes.push({ id: pid, title: p.title, subtitle: tr('阶段 {index}', { index: p.index }), icon: 'tasks', state: ps, rows: [] });
      edge(wf, pid, ps);
      for (const a of mine) if (keep.has(`${t.id}|${a.key}`)) edge(pid, agentNode(t, a), AGENT[a.state]);
    }
    for (const a of t.agents) if (!phases.some((p) => p.index === a.phase) && keep.has(`${t.id}|${a.key}`)) edge(wf, agentNode(t, a), AGENT[a.state]);
  }
  return { graph: { nodes, edges }, more: all.length - keep.size, picks };
}
```

（`model.ts` 里各函数的实际参数以 `CommandGraph.tsx` 当前的调用为准：`agentColor(a.color)`、`taskStateText(t)`、`agentStateText(a)`、`clock(ms)`。如果 `BgPhase` 的字段名不是 `index` / `title`，按 `types.ts:44` 改。测试里 `'wf1|w2'` 排在 `'wf|wf1|p2'` 前面，就是因为卡片是按阶段依次推进去的。）

- [ ] **Step 4：重写 `CommandGraph.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { BgSession } from '@shared';
import { clsx } from '@/util';
import { LazyNodeGraph } from '@/ui/node-graph';
import { backgroundGraph } from './graph-data';
import { tr } from '@/i18n';
// spec 2026-10-24 D2: the 指挥台 as a node graph. Same props as the old radial SVG, so both callers stay untouched.

export function CommandGraph({ session, taskId, compact, onPick }: { session: BgSession; taskId?: string; compact?: boolean; onPick: (agentKey: string, taskId: string) => void }) {
  const live = !compact && session.tasks.some((t) => t.status === 'running');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!live) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [live]);
  const { graph, more, picks } = useMemo(() => backgroundGraph(session, { taskId, compact, now }), [session, taskId, compact, now]);
  return (
    <div className={clsx('bg-graph', compact && 'compact')}>
      <LazyNodeGraph graph={graph} ariaLabel={tr('指挥台')} height={compact ? 240 : 380} cardW={compact ? 150 : 200} compact={compact} entrance
        canSelect={(id) => !!picks[id]} onSelect={(id) => { const p = picks[id]; if (p) onPick(p.agentKey, p.taskId); }} />
      {more > 0 && <div className="bg-graph-more">{tr('还有 {more} 个', { more })}</div>}
    </div>
  );
}
```

- [ ] **Step 5：样式和摆放**
  - `background.css:96-122`：删掉 `.bg-graph-svg` `.bg-orbit` `.bg-edge*` `.bg-hub*` `.bg-node*` `.bg-flow`。删每个选择器前先 `Grep` 一下整个 `web/src`，还有别处用的就留着。`.bg-graph` 改成 `position: relative`。`.bg-graph-more` 改成 `text-align: end; font-size: var(--fs-micro); color: var(--ink-4); padding: 4px 6px 0`。:169 和 :175 两处减少动效列表里去掉已经删了的选择器（节点图有自己的减少动效规则）。
  - `background-page.css:39`：删掉 `.bg-graph-svg { max-width: 440px }`。`.bg-graph-wrap`（:13）保持卡片底，宽度跟主栏。
  - `BackgroundPage.tsx`：把 `<ErrorBoundary area={tr('后台 · 关系图')}><div className="bg-graph-wrap">…</div></ErrorBoundary>` 从 `.bg-side-col` 里剪出来，放到 `AgentCards` 那段之后、`.bg-stage` 之前。ErrorBoundary 的 area 不变。

- [ ] **Step 6：英文**：`{"类型": "Type", "用时": "Time", "阶段 {index}": "Phase {index}"}`（已有的跳过；`模型`、`主对话`、`{running} 个在跑`、`没有在跑的`、`还有 {more} 个`、`指挥台` 之前就有）。

- [ ] **Step 7：确认通过**：`cd web && $CLEAN npx vitest run src/features/background && cd .. && $CLEAN npm run typecheck && node scripts/i18n/extract.mjs --check`

- [ ] **Step 8：提交**

```bash
git add web/src/features/background/graph-data.ts web/src/features/background/graph-data.test.ts web/src/features/background/CommandGraph.tsx web/src/features/background/BackgroundPage.tsx web/src/styles/background.css web/src/styles/background-page.css web/src/i18n/en.ts
git commit -m "feat(web): background 指挥台 becomes a node graph — workflow → phases → agents (stage D2)"
```

---

### Task 5：编排执行图与编辑器预览（D3）

**Files:**
- Create: `web/src/features/orchestra/orch-graph.ts`（`KIND_ICON`、`STATE_L`、`sub` 从 `Graph.tsx:9-15,67` 挪过来，再加 `orchestraGraph`）
- Create: `web/src/features/orchestra/orch-graph.test.ts`
- Modify: `web/src/features/orchestra/Graph.tsx:1-67`（改用 `LazyNodeGraph`；`export { KIND_ICON, STATE_L } from './orch-graph'`，这样 `RunView.tsx:9` 和 `WorkflowEditor.tsx:7-8` 的 import 不用动）
- Modify: `web/src/features/orchestra/graph-layout.ts`（删 `layoutGraph`、`fitScale`、`CARD_W/CARD_H/GAP_X/GAP_Y/PAD` 和 `GraphNode` / `Placed` 类型，以及 Task 2 加的 `layers` re-export；只留 `nextNodeId`、`promptVars`）
- Modify: `web/src/features/orchestra/graph-layout.test.ts`（删 `layoutGraph` / `fitScale` 的测试，它们的等价测试已经在 `ui/node-graph/layout.test.ts` 和 `viewport.test.ts` 里）
- Modify: `web/src/features/orchestra/orchestra.css:27-52`（删 `.orch-canvas` `.orch-card*` `orch-dash`，先 Grep 确认没有别的用处；`.orch-graph` 留着，`padding: 0; overflow: hidden`）
- Modify: `web/src/features/orchestra/state.ts:100`（`installOrchestra()` 里加 `window.__cwOrch` 调试入口，写法照 `background/state.ts:100-104`）
- Modify: `web/src/features/settings/wording.test.ts:399`（路径 `features/orchestra/Graph.tsx` 改成 `features/orchestra/orch-graph.ts`，因为 `sub()` 搬过去了）
- Modify: `web/src/i18n/en.ts`

**Interfaces:**
- Consumes: `OrchNode`、`NodeRun`、`OrchRun`（`@shared`）；`fmtMs`（`@/util`）；`agentLabel`（`./labels`）；`IconName`；`layoutNodes`；`LazyNodeGraph`。
- Produces:
  ```ts
  export const KIND_ICON: Record<OrchNode['kind'], IconName>;
  export const STATE_L: Record<NodeRun['state'], string>;
  export function sub(n: OrchNode): string;
  export const ORCH_CARD_W = 170;
  export function orchestraGraph(nodes: OrchNode[], runs: Record<string, NodeRun> | undefined, now: number): NodeGraphData;
  // 卡片：id = 节点 id；state 从运行状态映射：pending→idle, running→running, waiting→waiting, done→done, failed→failed, skipped/cancelled→stopped
  // 线：dependsOn 里每一项连一条 `dep>id`；目标在跑 → strong，失败 → error（pulse false），其余 normal；重复的依赖和指向不存在节点的依赖都丢掉
  ```
  另外，`window.__cwOrch: { inject(run: OrchRun): void; open(runId: string): void }`。

- [ ] **Step 1：写失败的测试** `orch-graph.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { NodeRun, OrchNode } from '@shared';
import { layoutNodes } from '@/ui/node-graph/layout';
import { orchestraGraph } from './orch-graph';

const task = (id: string, dependsOn: string[] = []) => ({ id, kind: 'task', title: id.toUpperCase(), agent: 'claude', prompt: 'p', dependsOn, workspace: 'shared' }) as unknown as OrchNode;
const nodes = [task('a'), task('b', ['a', 'a', 'ghost']), task('c', ['b'])];
const run = (state: NodeRun['state'], extra: Partial<NodeRun> = {}) => ({ state, sessionIds: [], ...extra }) as NodeRun;

describe('orchestra graph', () => {
  it('the editor preview: one card per node, plain edges, same columns as before', () => {
    const g = orchestraGraph(nodes, undefined, 0);
    expect(g.nodes.map((n) => [n.id, n.title, n.state])).toEqual([['a', 'A', undefined], ['b', 'B', undefined], ['c', 'C', undefined]]);
    expect(g.edges.map((e) => [e.id, e.style])).toEqual([['a>b', 'normal'], ['b>c', 'normal']]);
    expect(layoutNodes(g.nodes, g.edges).cols).toEqual([['a'], ['b'], ['c']]);
  });
  it('a run: the running step glows and its incoming edge is strong', () => {
    const g = orchestraGraph(nodes, { a: run('done', { startedAt: 0, finishedAt: 4000 }), b: run('running', { startedAt: 5000 }), c: run('pending') }, 10_000);
    expect(g.nodes.map((n) => n.state)).toEqual(['done', 'running', 'idle']);
    expect(g.nodes[0].icon).toBe('check');
    expect(g.edges.map((e) => e.style)).toEqual(['strong', 'normal']);
    expect(g.nodes[1].subtitle).toMatch(/·/);
  });
  it('a failed step: red edge, no dot', () => {
    const g = orchestraGraph(nodes, { a: run('done'), b: run('failed'), c: run('cancelled') }, 0);
    expect([g.edges[0].style, g.edges[0].pulse]).toEqual(['error', false]);
    expect(g.nodes[2].state).toBe('stopped');
    expect(g.nodes[1].icon).toBe('close');
  });
});
```

- [ ] **Step 2：确认失败**：`cd web && $CLEAN npx vitest run src/features/orchestra/orch-graph.test.ts`

- [ ] **Step 3：实现 `orch-graph.ts`**：先把 `Graph.tsx:9`（`KIND_ICON`）、:11-15（`sub`）、:67（`STATE_L`）原样剪过来，再加：

```ts
export const ORCH_CARD_W = 170;
const RUN: Record<NodeRun['state'], NodeState> = { pending: 'idle', running: 'running', waiting: 'waiting', done: 'done', failed: 'failed', skipped: 'stopped', cancelled: 'stopped' };

export function orchestraGraph(nodes: OrchNode[], runs: Record<string, NodeRun> | undefined, now: number): NodeGraphData {
  const ids = new Set(nodes.map((n) => n.id));
  const out: NgNode[] = nodes.map((n) => {
    const r = runs?.[n.id];
    const secs = r?.startedAt ? (r.finishedAt ?? now) - r.startedAt : 0;
    const subtitle = r && r.state !== 'pending' ? `${STATE_L[r.state]}${secs && (r.state === 'running' || r.finishedAt) ? ` · ${fmtMs(secs)}` : ''}` : sub(n);
    return { id: n.id, title: n.title || n.id, subtitle, icon: r?.state === 'done' ? 'check' : r?.state === 'failed' ? 'close' : KIND_ICON[n.kind], state: r ? RUN[r.state] : undefined, rows: [] };
  });
  const edges: NgEdge[] = [];
  for (const n of nodes) for (const dep of new Set(n.dependsOn ?? [])) {
    if (!ids.has(dep)) continue;
    const st = runs?.[n.id]?.state;
    edges.push({ id: `${dep}>${n.id}`, from: dep, to: n.id, style: st === 'running' ? 'strong' : st === 'failed' ? 'error' : 'normal', pulse: st === 'failed' ? false : undefined });
  }
  return { nodes: out, edges };
}
```

`NodeRun['state']` 的实际取值以 `@shared` 为准。如果有 `RUN` 里没写到的状态，补上（映射到最接近的 `NodeState`），tsc 的 `Record` 会提示缺了哪个。

- [ ] **Step 4：重写 `Graph.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { NodeRun, OrchNode } from '@shared';
import { LazyNodeGraph } from '@/ui/node-graph';
import { layoutNodes } from '@/ui/node-graph/layout';
import { ORCH_CARD_W, orchestraGraph } from './orch-graph';
import { tr } from '@/i18n';
export { KIND_ICON, STATE_L } from './orch-graph';
// spec 2026-10-24 D3: run view and editor preview share the node graph; columns are the same topological layers.

export function Graph({ nodes, runs, selected, onSelect }: { nodes: OrchNode[]; runs?: Record<string, NodeRun>; selected?: string | null; onSelect?: (id: string) => void }) {
  const live = !!runs && Object.values(runs).some((r) => r.state === 'running');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!live) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [live]);
  const graph = useMemo(() => orchestraGraph(nodes, runs, now), [nodes, runs, now]);
  const height = useMemo(() => Math.min(420, Math.max(160, layoutNodes(graph.nodes, graph.edges, { cardW: ORCH_CARD_W, align: 'top' }).height + 40)), [graph]);
  if (!nodes.length) return <div className="orch-graph empty">{tr('还没有节点')}</div>;
  return (
    <div className="orch-graph">
      <LazyNodeGraph graph={graph} ariaLabel={tr('执行图')} height={height} cardW={ORCH_CARD_W} align="top" entrance selected={selected ?? null} onSelect={onSelect} />
    </div>
  );
}
```

- [ ] **Step 5：调试入口**：在 `orchestra/state.ts` 的 `installOrchestra()` 里、`ws.on(...)` 旁边加

```ts
// ui-smoke (spec D3): put a run into the store and open it — no engine needed. Same idea as window.__cwBackground.
(window as unknown as { __cwOrch?: unknown }).__cwOrch = {
  inject: (run: OrchRun) => useOrch.setState((s) => ({ full: { ...s.full, [run.id]: run } })),
  open: (runId: string) => useOrch.getState().ask('open', runId),
};
```

（如果 `full` 不叫这个名字，以 `RunView.tsx:166` 读的字段为准。`OrchRun` 从 `@shared` import。）

- [ ] **Step 6：清理 `graph-layout.ts`、它的测试和 `orchestra.css`**（见上面 Files），并改 `wording.test.ts:399` 的路径。

- [ ] **Step 7：英文**：`{"执行图": "Execution graph"}`。

- [ ] **Step 8：确认通过**：`cd web && $CLEAN npx vitest run src/features/orchestra src/features/settings src/ui/node-graph && cd .. && $CLEAN npm run typecheck && node scripts/i18n/extract.mjs --check`

- [ ] **Step 9：提交**

```bash
git add web/src/features/orchestra/orch-graph.ts web/src/features/orchestra/orch-graph.test.ts web/src/features/orchestra/Graph.tsx web/src/features/orchestra/graph-layout.ts web/src/features/orchestra/graph-layout.test.ts web/src/features/orchestra/orchestra.css web/src/features/orchestra/state.ts web/src/features/settings/wording.test.ts web/src/i18n/en.ts
git commit -m "feat(web): orchestra run view and editor preview use the shared node graph (stage D3)"
```

---

### Task 6：对话里的 ```nodegraph 与 Mermaid「节点图 / 原图」（D4 前端）

**Files:**
- Create: `web/src/ui/node-graph/mermaid-flow.ts`
- Create: `web/src/ui/node-graph/mermaid-flow.test.ts`
- Create: `web/src/features/chat/NodegraphBlock.tsx`（默认导出，懒加载）
- Modify: `web/src/features/chat/CodeBlock.tsx:11,105-119,159,166,191-210`（`export function useCopy`；新增 `isGraph`；`guarded`；图模式下不渲染 `.code-head`，改挂 `NodegraphBlock`）
- Modify: `web/src/features/chat/MermaidBlock.tsx:16-37`（能转的 flowchart 多一个切换）
- Modify: `web/src/features/composer/quote.ts`（`plain`、`withLine`、`insertInComposer`）
- Modify: `web/src/features/composer/quote.test.ts`
- Modify: `web/src/features/composer/Composer.tsx:484-500`（`d.plain ? withLine(...) : withQuote(...)`）
- Modify: `web/src/i18n/en.ts`

**Interfaces:**
- Consumes: `normalizeNodeGraph`、`NG_MAX_NODES`、`parseNodeGraph`、`initialPicks`、`changeSentence`、`NodeGraph`（直接 import，因为这个文件本身已经在懒加载的 chunk 里）、`layoutNodes`；`ArrivalCtx`（`chat/turn-context.ts`）；`ErrorBoundary`（`ui/ErrorBoundary`）；`useStore`（只用 `getState().toast`）。
- Produces:
  ```ts
  // mermaid-flow.ts
  export type FlowResult = { ok: true; graph: NodeGraphData } | { ok: false; reason: string };
  export function isFlowchart(src: string): boolean;          // 第一行有效内容以 flowchart / graph 开头
  export function flowchartToGraph(src: string): FlowResult;  // 只处理下面列出的语法，其余任何一行不认识 → ok:false（显示原图）
  // quote.ts
  export interface QuoteDetail { text: string; handled: boolean; plain?: boolean }
  export function withLine(cur: string, text: string): string;
  export function insertInComposer(text: string): boolean;    // 有输入框接住 → true
  // NodegraphBlock.tsx
  export default function NodegraphBlock(p: { source: string }): JSX.Element;
  ```
  - 支持的 flowchart：头 `flowchart|graph [LR|RL|TD|TB|BT]`；形状 `[ ]` `( )` `([ ])` `[[ ]]` `[( )]` `(( ))` `{ }` `{{ }}` `[/ /]` `[\ \]` `> ]`，以及带引号的文字；`:::cls` 后缀；连线 `-->` `---` `--x` `--o` `<-->`（normal）、`-.->` `-.-`（dashed）、`==>` `===`（strong）；标签 `-->|t|` 和 `-- t -->`、`-. t .->`、`== t ==>`；链 `A --> B --> C`；`&` 分组；`;` 分句；跳过的行 `%%` `subgraph` `end` `classDef` `class` `style` `linkStyle` `click` `direction` `accTitle` `accDescr`。布局总是从左到右（spec 只要求「能转的用节点图显示」）。

- [ ] **Step 1：写失败的测试** `mermaid-flow.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { flowchartToGraph, isFlowchart } from './mermaid-flow';

const ok = (s: string) => { const r = flowchartToGraph(s); if (!r.ok) throw new Error(r.reason); return r.graph; };
const edges = (s: string) => ok(s).edges.map((e) => `${e.from}>${e.to}:${e.style}${e.label ? `:${e.label}` : ''}`);

describe('mermaid flowchart → node graph', () => {
  it('knows a flowchart', () => {
    expect(isFlowchart('flowchart LR\nA-->B')).toBe(true);
    expect(isFlowchart('%% note\ngraph TD;A-->B')).toBe(true);
    expect(isFlowchart('sequenceDiagram\nA->>B: hi')).toBe(false);
  });
  it('shapes, edge kinds and |labels|', () => {
    const g = ok('flowchart LR\n  A[Client] -->|HTTPS| B(API)\n  B -.-> C{{Cache}}\n  B ==> D[(Orders DB)]\n  D --- E((Replica))');
    expect(g.nodes.map((n) => [n.id, n.title])).toEqual([['A', 'Client'], ['B', 'API'], ['C', 'Cache'], ['D', 'Orders DB'], ['E', 'Replica']]);
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.style}${e.label ? `:${e.label}` : ''}`)).toEqual(['A>B:normal:HTTPS', 'B>C:dashed', 'B>D:strong', 'D>E:normal']);
  });
  it('text in the middle of a link', () => {
    expect(edges('graph LR\nA -- yes --> B\nA -. maybe .-> C\nA == sure ==> D')).toEqual(['A>B:normal:yes', 'A>C:dashed:maybe', 'A>D:strong:sure']);
  });
  it('chains, & groups and ; statements', () => {
    expect(edges('graph TD;A-->B-->C;A & B --> D')).toEqual(['A>B:normal', 'B>C:normal', 'A>D:normal', 'B>D:normal']);
  });
  it('quoted text keeps its brackets; <br> becomes a space', () => {
    expect(ok('flowchart LR\nA["a [b] c"] --> B["x<br/>y"]').nodes.map((n) => n.title)).toEqual(['a [b] c', 'x y']);
  });
  it('subgraph / classDef / class / style / click / comments are skipped; nodes inside a subgraph stay', () => {
    const g = ok('flowchart LR\n%% top\nsubgraph S [Group]\n  A[One] --> B\nend\nclassDef hot fill:#f00\nclass A hot\nstyle B fill:#0f0\nclick A "https://x"\nA:::hot --> C');
    expect(g.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
    expect(g.edges).toHaveLength(2);
  });
  it('a node named later gets its text', () => {
    expect(ok('flowchart LR\nA --> B\nB[Named]').nodes[1].title).toBe('Named');
  });
  it('what it cannot draw goes back to the original', () => {
    for (const s of ['flowchart LR', 'flowchart LR\nA --', 'flowchart LR\nA@{ shape: rect } --> B', 'flowchart LR\nA-1 --> B', 'sequenceDiagram\nA->>B: hi', 'flowchart XY\nA-->B']) {
      expect(flowchartToGraph(s).ok, s).toBe(false);
    }
  });
});
```

在 `quote.test.ts` 末尾追加：

```ts
import { withLine } from './quote';
describe('withLine (把改动发给 Claude)', () => {
  it('the sentence goes after what is typed, as its own paragraph', () => {
    expect(withLine('', ' 我在图里把… ')).toBe('我在图里把…');
    expect(withLine('hello  \n', 'x')).toBe('hello\n\nx');
  });
});
```

（如果文件顶部已经有 `import { … } from './quote'`，就把 `withLine` 加进那一行，不要重复 import。）

- [ ] **Step 2：确认失败**：`cd web && $CLEAN npx vitest run src/ui/node-graph/mermaid-flow.test.ts src/features/composer/quote.test.ts`

- [ ] **Step 3：实现 `mermaid-flow.ts`**

```ts
import { tr } from '@/i18n';
import { NG_MAX_NODES, normalizeNodeGraph, type EdgeStyle, type NgEdgeIn, type NodeGraphData } from './schema';
// spec 2026-10-24 D4: a Mermaid flowchart drawn by the node graph. Only the common syntax; any line it does not know
// → ok:false and MermaidBlock keeps showing the original picture.

export type FlowResult = { ok: true; graph: NodeGraphData } | { ok: false; reason: string };
const HEADER = /^(?:flowchart|graph)\b(?:\s+(?:LR|RL|TD|TB|BT))?\s*$/i;
const SKIP = /^(?:classDef|class|style|linkStyle|click|direction|accTitle|accDescr|subgraph|end)\b/;
const SHAPES: [string, ...string[]][] = [['([', '])'], ['[[', ']]'], ['[(', ')]'], ['((', '))'], ['{{', '}}'], ['[/', '/]', '\\]'], ['[\\', '\\]', '/]'], ['>', ']'], ['[', ']'], ['(', ')'], ['{', '}']];
const ID = /^[\p{L}\p{N}_]+/u;
const ARROW = /^<?(?:-{2,}>|-{3,}|={2,}>|={3,}|-\.+->|-\.+-|--[xo]|==[xo])/;
const MIDDLE = /^(--|==|-\.)\s+(.+?)\s+(-{2,}>|-{3,}|={2,}>|={3,}|\.+->|\.+-)/;
const clean = (t: string) => t.replace(/<br\s*\/?>/gi, ' ').replace(/^"(.*)"$/, '$1').replace(/\s+/g, ' ').trim();
const styleOf = (arrow: string): EdgeStyle => (arrow.includes('.') ? 'dashed' : arrow.includes('=') ? 'strong' : 'normal');

function statements(src: string): string[] {
  const out: string[] = [];
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      if (ch === ';' && !q) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

export const isFlowchart = (src: string) => /^(?:flowchart|graph)\b/i.test(statements(src)[0] ?? '');

interface FNode { id: string; text?: string }
interface FLink { style: EdgeStyle; label?: string }

function nodeAt(s: string): { node: FNode; rest: string } | null {
  const m = ID.exec(s);
  if (!m) return null;
  const id = m[0];
  let rest = s.slice(id.length);
  for (const [open, ...closes] of SHAPES) {
    if (!rest.startsWith(open)) continue;
    let body = rest.slice(open.length), text: string;
    if (body.startsWith('"')) {
      const end = body.indexOf('"', 1);
      if (end < 0) return null;
      text = body.slice(1, end);
      body = body.slice(end + 1);
      const c = closes.find((x) => body.startsWith(x));
      if (!c) return null;
      rest = body.slice(c.length);
    } else {
      let at = -1, c = '';
      for (const x of closes) { const i = body.indexOf(x); if (i >= 0 && (at < 0 || i < at)) { at = i; c = x; } }
      if (at < 0) return null;
      text = body.slice(0, at);
      rest = body.slice(at + c.length);
    }
    return { node: { id, text: clean(text) }, rest: rest.replace(/^:::[\w-]+/, '') };
  }
  rest = rest.replace(/^:::[\w-]+/, '');
  if (rest && !/^(?:\s|&|[-=<.])/.test(rest)) return null;   // A@{…}, A!x …
  return { node: { id }, rest };
}

function linkAt(s: string): { link: FLink; rest: string } | null {
  const a = ARROW.exec(s);
  if (a) {
    let rest = s.slice(a[0].length), label: string | undefined;
    const p = /^\s*\|([^|]*)\|/.exec(rest);
    if (p) { label = clean(p[1]) || undefined; rest = rest.slice(p[0].length); }
    return { link: { style: styleOf(a[0]), label }, rest };
  }
  const m = MIDDLE.exec(s);
  return m ? { link: { style: styleOf(m[1] + m[3]), label: clean(m[2]) || undefined }, rest: s.slice(m[0].length) } : null;
}

function statement(s: string): { groups: FNode[][]; links: FLink[] } | null {
  let rest = s;
  const groups: FNode[][] = [], links: FLink[] = [];
  for (;;) {
    const g: FNode[] = [];
    for (;;) {
      const n = nodeAt(rest);
      if (!n) return null;
      g.push(n.node);
      rest = n.rest.trimStart();
      if (!rest.startsWith('&')) break;
      rest = rest.slice(1).trimStart();
    }
    groups.push(g);
    if (!rest) return { groups, links };
    const l = linkAt(rest);
    if (!l) return null;
    links.push(l.link);
    rest = l.rest.trimStart();
    if (!rest) return null;
  }
}

export function flowchartToGraph(src: string): FlowResult {
  const st = statements(src);
  const bad = (line: string): FlowResult => ({ ok: false, reason: tr('不认识这一行：{line}', { line }) });
  if (!st.length || !/^(?:flowchart|graph)\b/i.test(st[0])) return { ok: false, reason: tr('不是 flowchart / graph') };
  if (!HEADER.test(st[0])) return bad(st[0]);
  const titles = new Map<string, string>();
  const edges: NgEdgeIn[] = [];
  const see = (n: FNode) => {
    if (!titles.has(n.id)) titles.set(n.id, n.text ?? n.id);
    else if (n.text !== undefined && titles.get(n.id) === n.id) titles.set(n.id, n.text);
  };
  for (const s of st.slice(1)) {
    if (SKIP.test(s)) continue;
    const r = statement(s);
    if (!r) return bad(s);
    r.groups.flat().forEach(see);
    r.links.forEach((l, i) => { for (const a of r.groups[i]) for (const b of r.groups[i + 1]) edges.push({ id: `e${edges.length}`, from: a.id, to: b.id, label: l.label, style: l.style }); });
    if (titles.size > NG_MAX_NODES) return { ok: false, reason: tr('卡片太多（最多 {max} 张）', { max: NG_MAX_NODES }) };
  }
  if (!titles.size) return { ok: false, reason: tr('图里没有节点') };
  const res = normalizeNodeGraph({ nodes: [...titles].map(([id, title]) => ({ id, title })), edges });
  return res.ok ? { ok: true, graph: res.graph } : { ok: false, reason: res.error };
}
```

- [ ] **Step 4：`quote.ts` 和 `Composer.tsx`**
  - `quote.ts`：`QuoteDetail` 加 `plain?: boolean`，再加两个函数：

    ```ts
    /** 把改动发给 Claude (spec D4): a plain sentence after the draft, not a > quote. */
    export function withLine(cur: string, text: string): string { const head = cur.replace(/\s+$/, ''); return `${head}${head ? '\n\n' : ''}${text.trim()}`; }
    export function insertInComposer(text: string): boolean { const detail: QuoteDetail = { text, handled: false, plain: true }; window.dispatchEvent(new CustomEvent(QUOTE_EVENT, { detail })); return detail.handled; }
    ```

    事件派发方式（`window` 还是 `document`）照抄 `quoteInComposer` 现在的写法。
  - `Composer.tsx` 的 QUOTE_EVENT effect（:484-500）：把 `withQuote(textRef.current, d.text)` 换成 `(d.plain ? withLine : withQuote)(textRef.current, d.text)`，并 import `withLine`。

- [ ] **Step 5：`NodegraphBlock.tsx`**

```tsx
import { useContext, useMemo, useState } from 'react';
import { NodeGraph } from '@/ui/node-graph/NodeGraph';
import { parseNodeGraph } from '@/ui/node-graph/schema';
import { changeSentence, initialPicks } from '@/ui/node-graph/marks';
import { layoutNodes } from '@/ui/node-graph/layout';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { insertInComposer } from '@/features/composer/quote';
import { useStore } from '@/store';
import { tr } from '@/i18n';
import { ArrivalCtx } from './turn-context';
import { useCopy } from './CodeBlock';
// spec 2026-10-24 D4: a ```nodegraph block drawn as an interactive graph. Bad JSON → the code plus one line saying so.

export default function NodegraphBlock({ source }: { source: string }) {
  const parsed = useMemo(() => parseNodeGraph(source), [source]);
  const arrival = useContext(ArrivalCtx);
  const [entrance] = useState(() => arrival.current);
  const init = useMemo(() => (parsed.ok ? initialPicks(parsed.graph) : {}), [parsed]);
  const [picks, setPicks] = useState<Record<string, string>>(init);
  const [showSrc, setShowSrc] = useState(false);
  const { ok: copied, copy } = useCopy();
  const height = useMemo(() => (parsed.ok ? Math.min(520, Math.max(260, layoutNodes(parsed.graph.nodes, parsed.graph.edges).height + 90)) : 0), [parsed]);
  if (!parsed.ok) {
    return (
      <>
        <pre className="code-body">{source}</pre>
        <div className="ng-bad" role="note">{tr('这张图格式有误')}<span className="sub">{parsed.error}</span></div>
      </>
    );
  }
  const changed = changeSentence(parsed.graph, init, picks);
  const send = () => {
    if (insertInComposer(changed)) return;
    void navigator.clipboard?.writeText(changed).catch(() => {});
    useStore.getState().toast(tr('没有可以填的输入框，这句话已复制'));
  };
  return (
    <div className="ng-chat">
      <ErrorBoundary area={tr('节点图')}>
        <NodeGraph graph={parsed.graph} ariaLabel={parsed.graph.title ?? tr('节点图')} height={height} entrance={entrance} picks={picks} onPick={(k, v) => setPicks((p) => ({ ...p, [k]: v }))} />
      </ErrorBoundary>
      <div className="ng-foot">
        <button type="button" className="link ng-src" aria-expanded={showSrc} onClick={() => setShowSrc((v) => !v)}>{showSrc ? tr('收起源码') : tr('查看源码')}</button>
        <button type="button" className="link ng-copy" onClick={() => copy(source)}>{copied ? tr('已复制') : tr('复制')}</button>
        {changed && <button type="button" className="btn sm ng-send" onClick={send}>{tr('把改动发给 Claude')}</button>}
      </div>
      {showSrc && <pre className="code-body ng-source">{source}</pre>}
    </div>
  );
}
```

（`useCopy` 的返回形状以 `CodeBlock.tsx:105-119` 为准，按实际字段名解构。`toast` 的签名以 store 为准。`.ng-chat` / `.ng-foot` / `.ng-bad` 的样式写在 `node-graph.css` 末尾：`.ng-foot { display:flex; gap:12px; align-items:center; padding:6px 2px 0; font-size:var(--fs-meta); }`、`.ng-bad { padding:6px 10px; color:color-mix(in oklab, var(--err) 75%, var(--ink-1)); font-size:var(--fs-meta); } .ng-bad .sub { margin-inline-start:8px; color:var(--ink-3); font-family:var(--mono); }`。注意 `ng-bad` 显示时节点图的 CSS chunk 可能还没加载：`NodegraphBlock` 自己就在懒加载 chunk 里，并且 import 了 `NodeGraph`（`NodeGraph` 又 import 了 CSS），所以 chunk 一加载 CSS 就到了。）

- [ ] **Step 6：`CodeBlock.tsx`**
  - :105 `function useCopy` 前面加 `export`。
  - :11 旁边加 `const NodegraphBlock = lazy(() => import('./NodegraphBlock'));`。
  - :159 后面加 `const isGraph = lang === 'nodegraph';`。
  - :166 改成 `const guarded = !((isMermaid || isGraph) && !streaming);`。
  - 所有 hook 调用之后（:190 那个 effect 之后）、原来的 `return` 之前：

    ```tsx
    if (isGraph && !streaming) return (
      <div ref={rootRef} className={clsx('code', 'ng-block', className)}>
        <Suspense fallback={<pre className="code-body">{text}</pre>}><NodegraphBlock key={text} source={text} /></Suspense>
      </div>
    );
    ```

    `rootRef`、`text`、`className` 用 CodeBlock 里实际的变量名。流式输出时照常显示代码，等收完再画，和 Mermaid 一样。

- [ ] **Step 7：`MermaidBlock.tsx`**
  - `const flow = useMemo(() => (isFlowchart(source) ? flowchartToGraph(source) : null), [source]);`
  - `const [view, setView] = useState<'graph' | 'raw'>(() => (flow?.ok ? 'graph' : 'raw'));`
  - 原来的渲染 effect 在开头加 `if (view !== 'raw') return;`，依赖改成 `[source, theme, view]`。
  - 外层容器（`.mermaid-wrap`）里，`flow?.ok` 时在最前面放：

    ```tsx
    <div className="mmd-view" role="group" aria-label={tr('显示方式')}>
      <button type="button" className={clsx('btn sm', view === 'graph' && 'on')} aria-pressed={view === 'graph'} data-view="graph" onClick={() => setView('graph')}>{tr('节点图')}</button>
      <button type="button" className={clsx('btn sm', view === 'raw' && 'on')} aria-pressed={view === 'raw'} data-view="raw" onClick={() => setView('raw')}>{tr('原图')}</button>
    </div>
    ```

    然后 `view === 'graph' && flow?.ok ? <NodeGraph graph={flow.graph} ariaLabel={tr('流程图')} height={360} className="ng-mermaid" /> : <div ref={ref} className="mermaid-svg" />`。如果原来没有 `.mermaid-wrap` 包着，就加一个。`.mmd-view { display:flex; gap:4px; justify-content:flex-end; margin-bottom:6px; }` 写进 `node-graph.css`。

- [ ] **Step 8：英文**：

```json
{ "这张图格式有误": "This graph is not in the right format", "查看源码": "View source", "收起源码": "Hide source", "把改动发给 Claude": "Send the change to Claude",
  "没有可以填的输入框，这句话已复制": "No input box to fill — the sentence was copied", "原图": "Original", "流程图": "Flowchart", "显示方式": "View",
  "不认识这一行：{line}": "Cannot read this line: {line}", "不是 flowchart / graph": "Not a flowchart / graph", "图里没有节点": "The chart has no nodes" }
```

- [ ] **Step 9：确认通过**：`cd web && $CLEAN npx vitest run src/ui/node-graph src/features/composer src/features/chat && cd .. && $CLEAN npm run typecheck && node scripts/i18n/extract.mjs --check && $CLEAN npm run build -w web`（`build` 会跑 `assets.test` 的包大小检查前提：boot 包不能长。用 `ls -la web/dist/assets | sort -k5 -n | tail` 看 boot chunk 和改动前比，增长应当小于 5 KB）

- [ ] **Step 10：提交**

```bash
git add web/src/ui/node-graph/mermaid-flow.ts web/src/ui/node-graph/mermaid-flow.test.ts web/src/ui/node-graph/node-graph.css web/src/features/chat/NodegraphBlock.tsx web/src/features/chat/CodeBlock.tsx web/src/features/chat/MermaidBlock.tsx web/src/features/composer/quote.ts web/src/features/composer/quote.test.ts web/src/features/composer/Composer.tsx web/src/i18n/en.ts
git commit -m "feat(web): \`\`\`nodegraph blocks in answers, Mermaid flowchart 节点图/原图 toggle, send graph changes to the input (stage D4)"
```

---

### Task 7：给 Claude 的 nodegraph 提示与设置 `ui.nodegraphHint`（D4 服务端 + 设置页 + e2e）

**Files:**
- Create: `server/src/runtime/nodegraph-hint.ts`
- Create: `server/src/runtime/nodegraph-hint.test.ts`
- Modify: `server/src/runtime/session-runner.ts:117-119`（加开关）、`:504`（拼进 `append`）
- Modify: `server/src/index.ts:39,340`
- Modify: `server/src/ws/hub.ts:7,636`
- Modify: `web/src/features/settings/catalog.ts:22,115`
- Modify: `web/src/features/settings/SettingsModal.tsx:70`
- Modify: `web/src/features/settings/catalog.test.ts:97`
- Create: `server/ws-phase34.mjs`（34 被占就用下一个空号，文件名、`e2e.mjs` 里的期号、日志前缀三处一起改）
- Modify: `scripts/e2e.mjs:13`
- Modify: `web/src/i18n/en.ts`

**Interfaces:**
- Produces（`nodegraph-hint.ts`）：`export const NODEGRAPH_HINT_KEY = 'ui.nodegraphHint'`；`export function nodegraphHintPrompt(on: boolean): string`（关 → `''`；开 → 英文说明，少于 2400 字符）。
- Produces（`session-runner.ts`）：`export function setNodegraphHint(on: boolean): void`；新起的 Claude 进程读这个开关（和 `setPromptSuggestions` 一样，改了之后新开的对话生效）；`bare` 的对话（只聊天 / 精简）不加。
- Produces（设置）：`SettingId` 多一个 `'ui.nodegraphHint'`；放在「新对话」块里的开关，默认开。

- [ ] **Step 1：动手前确认 B / C 已提交**：`git status --short server/src/ws/hub.ts server/src/index.ts`（期望：没有输出。有输出就停下，等那边提交，**不要**顺手把别人的改动一起提交）

- [ ] **Step 2：写失败的测试** `server/src/runtime/nodegraph-hint.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { NODEGRAPH_HINT_KEY, nodegraphHintPrompt } from './nodegraph-hint.js';

describe('nodegraph hint (spec D4)', () => {
  it('off: nothing is added', () => expect(nodegraphHintPrompt(false)).toBe(''));
  it('on: the fence, the whole format, short, English', () => {
    const t = nodegraphHintPrompt(true);
    expect(t).toContain('```nodegraph');
    for (const w of ['nodes', 'edges', 'fromRow', 'options', 'marks', 'badge', 'okText', '{n}', 'normal', 'strong', 'error', 'dashed', 'flowchart']) expect(t).toContain(w);
    expect(t.length).toBeLessThan(2400);
    expect(/[\u4e00-\u9fff]/.test(t)).toBe(false);
  });
  it('the setting key', () => expect(NODEGRAPH_HINT_KEY).toBe('ui.nodegraphHint'));
});
```

在 `web/src/features/settings/catalog.test.ts:97` 的 `added` 数组里加 `'ui.nodegraphHint'`。

- [ ] **Step 3：确认失败**：`cd server && $CLEAN npx vitest run src/runtime/nodegraph-hint.test.ts`；`cd web && $CLEAN npx vitest run src/features/settings/catalog.test.ts`

- [ ] **Step 4：实现 `nodegraph-hint.ts`**

```ts
// spec 2026-10-24 D4: tell Claude that Claude Web draws ```nodegraph blocks. Behind the setting ui.nodegraphHint (default on).
export const NODEGRAPH_HINT_KEY = 'ui.nodegraphHint';

const HINT = [
  '# Interactive diagrams (Claude Web)',
  'The user reads your replies in Claude Web, which draws a fenced code block with the language `nodegraph` as an interactive node graph: cards in columns from left to right, curved edges, drag and zoom. Use one when cards and connections explain the answer better than prose — a flow or pipeline, dependencies, who can reach what (permissions, access paths), an architecture. Not for plain lists or tables. Mermaid `flowchart` blocks are drawn the same way.',
  'The block holds one JSON object (valid JSON, no comments):',
  '```nodegraph',
  '{"title": "…", "subtitle": "…", "badge": {"count": "error", "text": "{n} open paths", "okText": "No open paths"},',
  ' "nodes": [{"id": "link", "title": "Share link", "subtitle": "…", "rows": [{"id": "read", "label": "read", "value": "Anyone", "options": [{"value": "Anyone", "marks": {"e1": "error"}}, {"value": "Admin", "marks": {"e1": "dashed"}}]}], "list": {"title": "…", "items": ["…", {"text": "…", "tags": ["…"]}]}}],',
  ' "edges": [{"id": "e1", "from": "anyone", "to": "link", "fromRow": "read", "label": "public", "style": "error"}]}',
  '```',
  '- Only nodes[].id / title and edges[].from / to are required. Edge style: normal (grey), strong (highlighted, glowing), error (red, glowing — a problem such as an open access path), dashed (inactive or broken).',
  '- A row with options becomes a dropdown; picking an option applies its marks (edge id → style). Give marked edges an id. fromRow starts the edge at that row.',
  '- badge: {"count": <style>, "text": "… {n} …", "okText": "…"} counts edges in that style and updates when the user changes a dropdown; a plain string is shown as is.',
  '- Keep it under about 40 cards, with short unique ids.',
].join('\n');

export const nodegraphHintPrompt = (on: boolean): string => (on ? HINT : '');
```

- [ ] **Step 5：接线**
  - `session-runner.ts`：在 :117-119 `promptSuggestionsOn` 旁边加

    ```ts
    let nodegraphHintOn = true;
    /** spec D4: the ```nodegraph hint in the appended system prompt (setting ui.nodegraphHint); read when a process starts. */
    export function setNodegraphHint(on: boolean): void { nodegraphHintOn = on; }
    ```

    :504 改成 `const append = [verify, this.thinkingSection, delegate, bare ? '' : nodegraphHintPrompt(nodegraphHintOn)].filter(Boolean).join('\n\n');`，顶部 `import { nodegraphHintPrompt } from './nodegraph-hint.js';`。如果 :504 这一行在 B / C 里已经变了形状，就把这一项加进同一个数组。
  - `index.ts`：在 :39 的 import 里加 `setNodegraphHint`，再 `import { NODEGRAPH_HINT_KEY } from './runtime/nodegraph-hint.js'`；:340 后面加 `setNodegraphHint(meta.settings()[NODEGRAPH_HINT_KEY] !== false);`。
  - `hub.ts`：:7 加同样的 import；:636 后面加 `if (req.key === NODEGRAPH_HINT_KEY) setNodegraphHint(req.value !== false);`。
  - `catalog.ts:22`：联合类型加 `| 'ui.nodegraphHint'`；:115（`sessions.mcp`）后面加

    ```ts
    { id: 'ui.nodegraphHint', block: tr('新对话'), label: tr('让 Claude 画可交互的节点图'), hint: tr('告诉 Claude 这里能把 nodegraph 代码块显示成能拖、能改的节点图，适合画流程、依赖、权限和架构。改了之后新开的对话生效。'), keywords: tr('node graph diagram flowchart mermaid 节点图 流程图 架构图') },
    ```

    字段名以相邻条目为准；没有 `keywords` 字段就去掉。
  - `SettingsModal.tsx:70` 旁边：`'ui.nodegraphHint': (e) => <Toggle k={e.id} label={e.label} def />,`（照 :66 / :70 的写法，有 `hint` 参数就一并传）。

- [ ] **Step 6：e2e `server/ws-phase34.mjs`**：照 `ws-phase32.mjs` 复制 :1-110（头部、`check`、假上游、server 进程、ws、`req`），然后改三处：
  1. 上游请求处理里记下系统提示：`hits.push({ stream: !!j.stream, sys: textOf(j.system) })`。`textOf` 已经能处理 `[{type:'text', text}]` 数组。
  2. 正文用下面这段 `main()`。
  3. 收尾照 :190-203，日志前缀改成 `phase34`。

  ```js
  async function turn(params, text) {
    const o = await req({ kind: 'session.open', params: { cwd: proj, permissionMode: 'bypassPermissions', ...params } });
    const from = hits.length;
    await req({ kind: 'session.send', sessionId: o.sessionId, text });
    await waitFor(() => results_of(o.sessionId), 60_000);   // use phase32's "wait for the turn's result" helper by its real name
    await req({ kind: 'session.close', sessionId: o.sessionId }).catch(() => {});
    return hits.slice(from).filter((h) => h.stream).map((h) => h.sys).join('\n');
  }
  async function main() {
    const env = { ANTHROPIC_BASE_URL: up, ANTHROPIC_AUTH_TOKEN: 'e2e' };   // the same env phase32 passes to session.open
    const on = await turn({ env }, 'hello');
    check('default: the appended system prompt tells Claude about ```nodegraph', /```nodegraph/.test(on) && /okText/.test(on), on.slice(0, 200));
    await req({ kind: 'settings.set', key: 'ui.nodegraphHint', value: false });
    const off = await turn({ env }, 'hello again');
    check('ui.nodegraphHint off: a new conversation has no nodegraph hint', off.length > 0 && !/nodegraph/.test(off), off.slice(0, 200));
    await req({ kind: 'settings.set', key: 'ui.nodegraphHint', value: true });
  }
  ```

  `turn` 里的「等一轮结束」和 `session.open` 的参数形状，要照 phase32 实际用的写（phase32 :110-180 有现成的 `envTurn` 和结果等待），换成那边的真名字，不要留 `results_of` 这种假名。`scripts/e2e.mjs:13` 的期号表末尾加 `'34'`。

- [ ] **Step 7：英文**：`{"让 Claude 画可交互的节点图": "Let Claude draw interactive node graphs", "告诉 Claude 这里能把 nodegraph 代码块显示成能拖、能改的节点图，适合画流程、依赖、权限和架构。改了之后新开的对话生效。": "Tells Claude that nodegraph code blocks show here as node graphs you can drag and change — good for flows, dependencies, permissions and architecture. Applies to new conversations.", "node graph diagram flowchart mermaid 节点图 流程图 架构图": "node graph diagram flowchart mermaid architecture"}`。

- [ ] **Step 8：确认通过**：

```bash
cd server && $CLEAN npx vitest run src/runtime && cd ../web && $CLEAN npx vitest run src/features/settings && cd .. && $CLEAN npm run typecheck && node scripts/i18n/extract.mjs --check
$CLEAN npm run build:all && $CLEAN node server/ws-phase34.mjs
```

（期望：`phase34: 2/2 passed`）

- [ ] **Step 9：提交**

```bash
git add server/src/runtime/nodegraph-hint.ts server/src/runtime/nodegraph-hint.test.ts server/src/runtime/session-runner.ts server/src/index.ts server/src/ws/hub.ts web/src/features/settings/catalog.ts web/src/features/settings/SettingsModal.tsx web/src/features/settings/catalog.test.ts server/ws-phase34.mjs scripts/e2e.mjs web/src/i18n/en.ts
git commit -m "feat: tell Claude about \`\`\`nodegraph behind ui.nodegraphHint (default on) + e2e phase34 (stage D4)"
```

---

### Task 8：ui-smoke、全套检查、笔记、对照截图

**Files:**
- Modify: `scripts/ui-smoke.cjs`：
  - `seedHome` :83-147：加第 4 个种子对话 `graphSid`
  - :147：`return` 里带上 `graphSid`
  - :235-236：加环境变量 `SMOKE_GRAPH_SID`
  - :2952-2953、:3021-3022：迁移后台图的断言
  - 新增 `node-graph` 段：放在 chat-turns 段（:3107）之前，用 `phase = 'node-graph'`
- Create: `docs/notes/node-graph.md`
- Modify: `CLAUDE.md`（笔记索引加一行）、`docs/notes/background.md`、`docs/notes/orchestra.md`
- Create: `docs/images/node-graph-sample.png`（从 smoke 截图复制过来）

**Interfaces:**
- Consumes：
  - 前面各任务约定的 DOM（`.ng` `.ng-card[data-node]` `.ng-edge[data-edge][data-style]` `.ng-badge[data-tone]` `.ng-zoom-*` `.ng-viewport` `.ng-layer` `.ng-send` `.ng-bad` `.mmd-view [data-view]` `.select-trigger` `.select-popover .select-option`）
  - `window.__cwBackground`、`window.__cwOrch`、`window.__store`（`setSetting`、`saveDraft`）
  - smoke 自带的 `js / waitFor / click / key / shot / check / sleep / wc / noBoundary`

- [ ] **Step 1：种一个带图的对话**：在 `seedHome` 里 `reviewSid`（:132）那段后面，照它的写法写 transcript：

```js
const graphSid = '5a0e0e0e-0000-4000-8000-00000000c0f1';
// spec D4: the mp4's sample (keep the same as web/src/ui/node-graph/sample.ts), a mermaid flowchart, and a broken block
const NG_SAMPLE = {
  title: 'Access settings', subtitle: 'Who can read the customers bucket', badge: { count: 'error', text: '{n} open path', okText: 'No open paths' },
  nodes: [
    { id: 'anyone', title: 'Anyone', subtitle: 'Public internet' }, { id: 'admin', title: 'Admin', subtitle: '2 people' }, { id: 'backup', title: 'Nightly backup', subtitle: 'paused' },
    { id: 'link', title: 'Share link', subtitle: 's3://acme-customers', rows: [
      { id: 'read', label: 'read', value: 'Anyone', options: [{ value: 'Anyone', marks: { 'e-open': 'error' } }, { value: 'Admin', marks: { 'e-open': 'dashed' } }] },
      { id: 'write', label: 'write', value: 'Admin', options: ['Admin', 'Team'] }] },
    { id: 'bucket', title: 'customers', subtitle: 'S3 bucket', list: { title: '4 reads this week', items: [{ text: 'Lisbon', tags: ['PT', '2h'] }, { text: 'Austin', tags: ['US', '1d'] }, { text: 'Osaka', tags: ['JP', '3d'] }, { text: 'Berlin', tags: ['DE', '5d'] }] } },
  ],
  edges: [
    { id: 'e-open', from: 'anyone', to: 'link', label: 'public', style: 'error' }, { id: 'e-admin', from: 'admin', to: 'link', label: 'member' },
    { id: 'e-read', from: 'link', to: 'bucket', fromRow: 'read', label: 'read' }, { id: 'e-write', from: 'link', to: 'bucket', fromRow: 'write', label: 'write' },
    { id: 'e-backup', from: 'backup', to: 'bucket', label: 'paused', style: 'dashed' },
  ],
};
const graphText = [
  'Here is who can read the bucket:', '', '```nodegraph', JSON.stringify(NG_SAMPLE, null, 1), '```', '',
  'The request path:', '', '```mermaid', 'flowchart LR', '  A[Client] -->|HTTPS| B(API)', '  B -.-> C{{Cache}}', '  B ==> D[(Orders DB)]', '```', '',
  'And a broken one:', '', '```nodegraph', '{"nodes": [', '```',
].join('\n');
```

用和 `reviewSid` 一样的 user / assistant 行格式，把 `graphText` 作为 assistant 文本写进 `graphSid` 的 jsonl。`return` 改成带 `graphSid`；:235-236 旁边加 `SMOKE_GRAPH_SID: seeded.graphSid`（变量名以那两行实际的写法为准）。

- [ ] **Step 2：迁移后台图的断言**（:2952-2953、:3021-3022，不删，改成新组件）：

```js
await waitFor(`document.querySelectorAll('.bg-page .bg-graph .ng-card').length >= 9`, 8000);
// :2952 — inside the existing `page` probe object, replace the old `nodes:` line with:
//   nodes: p.querySelectorAll('.bg-graph .ng-card').length, edges: p.querySelectorAll('.bg-graph .ng-edge').length,
//   strong: p.querySelector('.bg-graph .ng-edge[data-edge="wf|wf1|p1>wf1|w1"]')?.dataset.style,
// :2953
check('background page: the 指挥台 is a node graph — main → workflow → 2 phases → 3 agents, the sub-agent and the command', page.nodes === 9 && page.edges === 8 && page.strong === 'strong', JSON.stringify(page));
```

在原后台段里接着加「点代理卡片打开抽屉」：`await click('.bg-page .bg-graph .ng-card[data-node="wf1|w1"]')`，然后等抽屉出现并检查标题含 `w1`。抽屉的选择器照这一段里已有的打开抽屉检查（`openAgent` 打开的那个）去写。检查完按 `Escape` 关掉。

:3021-3022 改成：

```js
await waitFor(`!!document.querySelector('.bg-tasks .bg-graph .ng-card')`, 8000);
const tasksGraph = await js(`document.querySelectorAll('.bg-tasks .bg-graph .ng-card').length`);
check('right panel → 任务: the compact node graph is there (same 9 cards)', tasksGraph === 9, String(tasksGraph));
```

- [ ] **Step 3：新段 `node-graph`：对话里的图**

```js
phase = 'node-graph';
{
  const gsid = JSON.stringify(E.SMOKE_GRAPH_SID);
  const G = '.pane.focused .ng-chat';
  await js(`window.__store.getState().loadHistory(${gsid})`);   // open the conversation the same way chat-turns (:3107) does — use its exact call
  await waitFor(`document.querySelectorAll('${G} .ng-card').length === 5`, 10000);
  await js(`document.querySelector('${G}').scrollIntoView({ block: 'center' })`);
  await sleep(500);
  const first = await js(`(() => { const r = document.querySelector('${G}'); const b = r.querySelector('.ng-badge');
    return { title: r.querySelector('.ng-title')?.textContent, badge: b?.textContent, tone: b?.dataset.tone, open: r.querySelector('.ng-edge[data-edge="e-open"]')?.dataset.style,
      dashed: r.querySelector('.ng-edge[data-edge="e-backup"]')?.dataset.style, labels: r.querySelectorAll('.ng-label').length, list: r.querySelectorAll('.ng-card[data-node="bucket"] .ng-li').length,
      motion: r.querySelector('.ng').dataset.motion, dots: r.querySelectorAll('.ng-edge[data-style="error"] animateMotion').length, pct: r.querySelector('.ng-zoom-pct')?.textContent }; })()`);
  check('```nodegraph: title, red badge 「1 open path」, error / dashed edges, 5 labels, the list under a card, − N% + control', first.title === 'Access settings' && /1 open path/.test(first.badge) && first.tone === 'error' && first.open === 'error' && first.dashed === 'dashed' && first.labels === 5 && first.list === 4 && /^\d+%$/.test(first.pct), JSON.stringify(first));
  check('the red path carries a travelling dot while motion is on', first.motion === 'on' && first.dots >= 1, JSON.stringify(first));
  await shot('node-graph-sample');
```

- [ ] **Step 4：减少动效**

```js
  await js(`window.__store.getState().setSetting('ui.reduceMotion', true)`);
  await waitFor(`document.querySelector('${G} .ng').dataset.motion === 'off'`, 3000);
  const rm = await js(`({ dots: document.querySelectorAll('${G} animateMotion').length, anim: getComputedStyle(document.querySelector('${G} .ng-glow')).animationName })`);
  check('减少动画: no travelling dot, no breathing glow', rm.dots === 0 && rm.anim === 'none', JSON.stringify(rm));
  await js(`window.__store.getState().setSetting('ui.reduceMotion', false)`);
  await waitFor(`document.querySelector('${G} .ng').dataset.motion === 'on'`, 3000);
```

- [ ] **Step 5：缩放控件和滚轮规则**

```js
  const pctOf = () => js(`parseInt(document.querySelector('${G} .ng-zoom-pct').textContent, 10)`);
  const p0 = await pctOf();
  await click(`${G} .ng-zoom-in`); const p1 = await pctOf();
  await click(`${G} .ng-zoom-out`); const p2 = await pctOf();
  check('zoom control: + is about ×1.2, − comes back', Math.abs(p1 - Math.round(p0 * 1.2)) <= 1 && Math.abs(p2 - p0) <= 1, `${p0} ${p1} ${p2}`);
  const vp = await js(`(() => { const r = document.querySelector('${G} .ng-viewport').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await js(`window.__ngWheel = []; addEventListener('wheel', (e) => window.__ngWheel.push(e.defaultPrevented), { passive: true });`);
  wc.sendInputEvent({ type: 'mouseWheel', x: vp.x, y: vp.y, deltaX: 0, deltaY: 120, canScroll: true }); await sleep(250);
  const p3 = await pctOf();
  wc.sendInputEvent({ type: 'mouseWheel', x: vp.x, y: vp.y, deltaX: 0, deltaY: 120, canScroll: true, modifiers: ['shift'] }); await sleep(250);
  const wheel = await js(`window.__ngWheel`);
  check('wheel over the graph zooms (taken); Shift+wheel is left to the page (A3 rule)', p3 !== p0 && wheel[0] === true && wheel[wheel.length - 1] === false, `${p0}→${p3} ${JSON.stringify(wheel)}`);
```

`deltaY` 的符号和 Electron 的 `mouseWheel` 字段，照 A3 段（:2957-3002）`wheelAt` 实际怎么发的来写；放大和缩小哪个方向不要紧，只要 `p3 !== p0`。

- [ ] **Step 6：拖卡片、拖画布、双击复原**

```js
  const drag = async (from, dx, dy) => {
    wc.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 6; i++) { wc.sendInputEvent({ type: 'mouseMove', x: from.x + (dx * i) / 6, y: from.y + (dy * i) / 6, button: 'left', modifiers: ['leftButtonDown'] }); await sleep(30); }
    wc.sendInputEvent({ type: 'mouseUp', x: from.x + dx, y: from.y + dy, button: 'left', clickCount: 1 }); await sleep(200);
  };
  const cardAt = () => js(`(() => { const r = document.querySelector('${G} .ng-card[data-node="anyone"] .ng-card-h').getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; })()`);
  const dOpen = () => js(`document.querySelector('${G} .ng-edge[data-edge="e-open"] .ng-line').getAttribute('d')`);
  const c0 = await cardAt(), d0 = await dOpen();
  await drag(c0, 80, 40);
  const c1 = await cardAt(), d1 = await dOpen();
  check('drag a card: it follows the mouse and its edge follows the card', c1.x - c0.x > 40 && c1.y - c0.y > 20 && d1 !== d0, `${JSON.stringify(c0)} → ${JSON.stringify(c1)}`);
  const t0 = await js(`document.querySelector('${G} .ng-layer').style.transform`);
  const blank = await js(`(() => { const r = document.querySelector('${G} .ng-viewport').getBoundingClientRect(); return { x: Math.round(r.left + 12), y: Math.round(r.bottom - 12) }; })()`);
  await drag(blank, 60, 0);
  const t1 = await js(`document.querySelector('${G} .ng-layer').style.transform`);
  check('drag empty canvas: it pans', t1 !== t0, `${t0} → ${t1}`);
  wc.sendInputEvent({ type: 'mouseDown', x: blank.x, y: blank.y, button: 'left', clickCount: 2 });
  wc.sendInputEvent({ type: 'mouseUp', x: blank.x, y: blank.y, button: 'left', clickCount: 2 }); await sleep(300);
  check('double-click empty space: the card goes back', (await dOpen()) === d0, await dOpen());
```

拖画布的起点必须落在空白处。如果 `elementFromPoint(blank)` 打到了卡片或缩放控件，改用画布左下角附近别的空白点，先 `log` 出命中的元素再决定。双击那一步要先发 `clickCount: 1` 的一对按下 / 抬起，再发 `clickCount: 2` 的一对，Chromium 才会认出 `dblclick`。

- [ ] **Step 7：下拉框改状态标签，发给 Claude**

```js
  await click(`${G} .ng-card[data-node="link"] .ng-row[data-row="read"] .select-trigger`);
  await waitFor(`!!document.querySelector('.select-popover .select-option')`, 3000);
  await js(`[...document.querySelectorAll('.select-popover .select-option')].find((o) => o.textContent.trim() === 'Admin').click()`);
  await waitFor(`document.querySelector('${G} .ng-badge').dataset.tone === 'ok'`, 3000);
  const after = await js(`({ badge: document.querySelector('${G} .ng-badge').textContent, open: document.querySelector('${G} .ng-edge[data-edge="e-open"]').dataset.style, send: !!document.querySelector('${G} .ng-send') })`);
  check('dropdown read → Admin: the red path turns dashed, the badge says 「No open paths」, 把改动发给 Claude appears', /No open paths/.test(after.badge) && after.open === 'dashed' && after.send, JSON.stringify(after));
  await shot('node-graph-sample-ok');
  await click(`${G} .ng-send`);
  const draft = await js(`document.querySelector('.pane.focused .composer textarea')?.value ?? ''`);
  check('把改动发给 Claude fills the input with one sentence (not sent)', /read/.test(draft) && /Anyone/.test(draft) && /Admin/.test(draft) && !/^>/.test(draft), draft);
  await js(`window.__store.getState().saveDraft(${gsid}, '')`);
```

如果 `.select-option` 不带原生 `.click()` 的处理（它监听的是 pointer 事件），就改用 `click()` 辅助函数，点那个选项的屏幕中心。

- [ ] **Step 8：坏 JSON 和 Mermaid 切换**

```js
  const badBlock = await js(`(() => { const b = document.querySelector('.pane.focused .ng-bad'); return { text: b?.textContent ?? '', code: b?.previousElementSibling?.textContent ?? '' }; })()`);
  check('broken ```nodegraph: the code stays, plus 「这张图格式有误」 and where', /这张图格式有误/.test(badBlock.text) && badBlock.code.includes('"nodes"'), JSON.stringify(badBlock));
  await waitFor(`!!document.querySelector('.pane.focused .mmd-view')`, 8000);
  const mm = await js(`({ cards: document.querySelectorAll('.pane.focused .ng-mermaid .ng-card').length, dashed: document.querySelector('.pane.focused .ng-mermaid .ng-edge[data-style="dashed"]') !== null, label: [...document.querySelectorAll('.pane.focused .ng-mermaid .ng-label text')].some((t) => t.textContent === 'HTTPS') })`);
  check('mermaid flowchart: drawn as a node graph by default (4 cards, dashed -.->, |HTTPS| label)', mm.cards === 4 && mm.dashed && mm.label, JSON.stringify(mm));
  await click('.pane.focused .mmd-view [data-view="raw"]');
  await waitFor(`!!document.querySelector('.pane.focused .mermaid-svg svg')`, 10000);
  check('节点图 / 原图: 原图 shows Mermaid\'s own picture', true, '');
  await noBoundary('node-graph');
}
```

`noBoundary` 的参数形状以 :420 为准。

- [ ] **Step 9：编排里的图**（同一段里接着写，在 `}` 之前）

```js
  const at = Date.now();
  const orun = (b) => ({ id: 'smoke-run', workflowId: 'smoke-wf', name: 'smoke 编排', cwd: E.SMOKE_REPO, input: '', startedAt: at - 60000, state: b === 'failed' ? 'failed' : 'running',
    workflow: [['plan', []], ['build', ['plan']], ['check', ['build']]].map(([id, dependsOn]) => ({ id, kind: 'task', title: id, agent: 'claude', prompt: 'p', dependsOn, workspace: 'shared' })),
    nodes: { plan: { state: 'done', sessionIds: [], startedAt: at - 50000, finishedAt: at - 30000 }, build: { state: b, sessionIds: [], startedAt: at - 20000, ...(b === 'failed' ? { finishedAt: at - 1000 } : {}) }, check: { state: 'pending', sessionIds: [] } } });
  await js(`window.__cwOrch.inject(${JSON.stringify(orun('running'))}); window.__cwOrch.open('smoke-run')`);
  const OG = '.dock-panel[data-panel="orchestra"]:not([hidden]) .orch-graph';
  await waitFor(`document.querySelectorAll('${OG} .ng-card').length === 3`, 8000);
  const og = await js(`({ run: document.querySelector('${OG} .ng-card[data-node="build"]')?.dataset.state, edge: document.querySelector('${OG} .ng-edge[data-edge="plan>build"]')?.dataset.style })`);
  check('orchestra run view: the running step glows, the edge into it is strong', og.run === 'running' && og.edge === 'strong', JSON.stringify(og));
  await js(`window.__cwOrch.inject(${JSON.stringify(orun('failed'))})`);
  await waitFor(`document.querySelector('${OG} .ng-edge[data-edge="plan>build"]')?.dataset.style === 'error'`, 3000);
  check('orchestra: a failed step turns its edge red', true, '');
```

最后照 smoke 里关停靠面板的现有写法关掉编排面板。`RunView` 里的「运行」字段名（`workflow` / `nodes` / `state`）以 `@shared` 的 `OrchRun` 为准；停靠面板的选择器以 `Dock.tsx` 渲染出的 `data-panel` 为准。

- [ ] **Step 10：全套检查**

```bash
$CLEAN npm run typecheck
$CLEAN npm test
$CLEAN npm run build:all
$CLEAN npm run e2e
$CLEAN node scripts/ui-smoke.cjs
node scripts/i18n/extract.mjs --check
```

期望：全部通过；ui-smoke 末尾汇总里 `node-graph` 段和迁移后的 `background` 断言都是 PASS，没有 console error / warning。任何一项失败先修，修完从第一条重跑。

- [ ] **Step 11：对照截图**：smoke 的输出目录里有 `ux-node-graph-sample.png`（初始帧：红色状态标签、红线）和 `ux-node-graph-sample-ok.png`（改成 Admin 之后），路径看 smoke 开头打印的 out 目录。

```bash
cp "<smoke out dir>/ux-node-graph-sample.png" docs/images/node-graph-sample.png
```

用 Read 打开这张图，对照 spec D 一节对 mp4 的描述逐条核对：暗色点阵底、左上标题和一行小字、右上红色「1 open path」、红色发光的路径、灰色普通线、虚线、线上标签、Share link 卡片的两行下拉框、customers 下面的 4 行小列表、右下「− N% +」。有不像的地方回到 Task 3 的 CSS 调整（只用令牌），然后重跑 Step 10 的 smoke。mp4 不在仓库里，交付时把这张图交给用户，请他和 mp4 对比。

- [ ] **Step 12：笔记**
  - 新建 `docs/notes/node-graph.md`，写这些段：
    - **在哪**：`ui/node-graph/` 各文件一行说明，以及三处用法的文件。
    - **格式**：贴 `sample.ts` 的结构、规则（默认 id、`fromRow` 可以写 label、value 不在 options 里就补到第一个、marks 只能指向有 id 的线、状态标签的 `{n}`、不认识的键忽略、上限 500 / 2000）。
    - **画法**：卡片是 HTML、线是 SVG，原因是下拉框、文字截断、Tab 焦点；尺寸常量在 `layout.ts`，通过 `--ng-*` 变量传给 CSS，只有一个来源。
    - **动效规则**：入场只在实时到达 / 打开视图时放；减少动效（设置或系统）和超过 150 张卡片都不动；光点只在 strong / error 上，`pulse:false` 可以关掉，D2 / D3 的失败线都关了。
    - **交互**：拖卡片、拖画布、滚轮用 A3 的 `wheelZoom`（Shift 不拦）、`+` `-` `0`、双击空白复原；拖动结果和选择都不保存（spec :409）。
    - **坑**：懒加载是因为 boot 包余量；`ui/` 里只能用 `ui/input-intent` 的 `reducedMotion`；`.ng-layer > svg`；graph 对象每秒重建时不能重新适应窗口，看的是 `nodeKey`；坏 JSON 不 `console.warn`（smoke 遇到 warning 就失败）。
    - **Mermaid 转换**：支持的语法清单；不认识的任何一行 → 显示原图；方向一律从左到右。
    - **提示**：`runtime/nodegraph-hint.ts`、设置 `ui.nodegraphHint`、新开的对话生效、只聊天 / 精简模式不加；e2e phase34。
    - **对照图**：`docs/images/node-graph-sample.png`。
  - `CLAUDE.md` 的笔记索引表照现有行的格式加一行：`| [node-graph](docs/notes/node-graph.md) | 节点图（spec 2026-10-24 D） | ui/node-graph 共用组件；nodegraph 格式、marks / 状态标签；后台指挥台、编排执行图、对话代码块与 Mermaid 切换；动效与 150 张上限；ui.nodegraphHint |`。
  - `docs/notes/background.md`：说到径向 `CommandGraph` 的地方改成「节点图（见 node-graph.md），数据在 `graph-data.ts`」，并写清卡片 id 的规则。
  - `docs/notes/orchestra.md`：`graph-layout.ts` 只剩 `nextNodeId` / `promptVars`，分列在 `ui/node-graph/layout.ts`；`KIND_ICON` / `STATE_L` / `sub` 在 `orch-graph.ts`；调试入口 `window.__cwOrch`。

- [ ] **Step 13：提交**

```bash
git add scripts/ui-smoke.cjs docs/notes/node-graph.md docs/notes/background.md docs/notes/orchestra.md CLAUDE.md docs/images/node-graph-sample.png
git commit -m "test(smoke): node graph in background / orchestra / chat, drag, zoom, wheel, reduced motion, nodegraph badge, bad JSON; notes (stage D)"
