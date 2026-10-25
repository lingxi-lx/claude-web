# 节点图（spec 2026-10-24 D，2026-10-25）

spec：`docs/superpowers/specs/2026-10-24-desktop-parity-design.md` 的 D 节；计划 `docs/superpowers/plans/2026-10-25-stage-d-node-graph.md`。
样子照用户的一段 mp4（「Access settings」：一条红色发光的公开路径，下拉框把 read 改成 Admin，线变灰虚线、右上角变成「No open paths」）。
对照图：`docs/images/node-graph-sample.png`（ui-smoke 的 `ux-node-graph-sample.png` 复制来的；改成 Admin 之后那帧是 `ux-node-graph-sample-ok.png`）。

## 在哪

- `web/src/ui/node-graph/`
  - `schema.ts`：格式校验 + 补默认值（`parseNodeGraph` / `normalizeNodeGraph`），报错带路径（`edges[2].to: …`）。组件只收规范化后的 `NodeGraphData`。
  - `marks.ts`：下拉框的选择 → 线样式（`edgeStyles`）、状态标签（`badgeView`）、「把改动发给 Claude」那句话（`changeSentence`）、哪些线有光点（`pulses`）。
  - `layout.ts`：拓扑分列 `layers`（从 orchestra 挪来）、卡片尺寸、贝塞尔线、标签宽度、拖动偏移。
  - `viewport.ts`：适应窗口、以指针为中心缩放、百分比、入场时间表、`motionOn`（减少动效或超过 150 张不动）。
  - `mermaid-flow.ts`：Mermaid flowchart → 节点图。
  - `NodeGraph.tsx` + `node-graph.css`：组件；`index.tsx` 的 `LazyNodeGraph` 懒加载它；`motion.ts` 是实时的减少动效 hook；`sample.ts` 是 mp4 的那张图（ui-smoke 里有一份 JSON 拷贝，两边要一样）。
- 三处用法：后台指挥台 `features/background/CommandGraph.tsx`（数据 `graph-data.ts`，见「后台」笔记）；编排执行图 `features/orchestra/Graph.tsx`（数据 `orch-graph.ts`，见「多 agent 编排」笔记）；对话里的 ```` ```nodegraph ```` 代码块 `features/chat/NodegraphBlock.tsx`（`CodeBlock` 收完才画，流式时照常显示代码）和 `MermaidBlock` 的「节点图 / 原图」切换。

## 格式

结构见 `sample.ts`：`{ title?, subtitle?, badge?, nodes: [{ id, title, subtitle?, icon?, rows?: [{ id?, label, value, options? }], list?: { title, items }, state?, x?, y? }], edges?: [{ id?, from, to, fromRow?, label?, style?, pulse? }] }`。

- 只有 `nodes[].id / title`、`edges[].from / to` 必填。线样式 `normal | strong | error | dashed`，默认 normal。
- 线的默认 id 是 `from>to`，重复的加 `#2`、`#3`；行的默认 id 是 `r<序号>`；`fromRow` 可以写行 id 也可以写 label。
- `options` 可以是字符串或 `{ value, label?, marks? }`；`value` 不在 options 里就补到第一个。`marks` 是「线 id → 样式」，只能指向存在的线（所以要变样式的线得写 id）。
- `badge`：字符串原样显示；`{ count?: 样式（默认 error）, text: '… {n} …', okText }` 数那种样式的线，0 条时显示 okText，改下拉框会跟着变。
- 不认识的键忽略。上限 500 张卡片、2000 条线。

## 画法

卡片是 HTML（绝对定位），线是同一个变换层里的一张 SVG（`.ng-layer > svg.ng-edges`）。原因：下拉框（`ui/Select`）、文字省略号、Tab 焦点都用现成的 HTML；发光（一条粗的半透明路径）、光点（`<animateMotion>`）、标签（圆角 rect + text）全在 SVG 里。尺寸常量只在 `layout.ts`，通过 `--ng-head-h` 等变量传给 CSS，只有一个来源。颜色全用令牌（`--accent` 是 strong，`--err` 是 error）。

## 动效规则

- 入场（卡片一张接一张淡入、线从起点画出来）只在「刚到」时放：对话里是实时到达的块（`ArrivalCtx`），后台 / 编排是打开视图时。
- 减少动效（设置 `ui.reduceMotion` → `<html data-reduce-motion>`，或系统的 prefers-reduced-motion）和超过 150 张卡片：什么都不动（`data-motion="off"`，不渲染 `<animateMotion>`，CSS 把动画和过渡都关掉）。
- 光点只在 strong / error 线上，`pulse: false` 可以关掉；后台和编排里失败的线都关了（不再有东西在流动）。

## 交互

拖卡片、拖空白处平移、滚轮缩放（用 A3 的 `wheelZoom`：Shift 或到了上下限就不拦，页面照常滚）、`−  N%  +` 和「适应窗口」按钮、画布获得焦点时 `+` `-` `0`、双击空白恢复布局。卡片点击用 pointerup 判断（移动不到 4px 才算点），拖动的结尾不会误选。拖动结果和选择都不保存（spec 说的「不保存」）。

## 坑

- 懒加载：后台面板和编排都在 boot 包里，boot 离 1.9 MB 上限只剩约 85 KB，所以组件 + CSS 是单独的 chunk（`LazyNodeGraph`）。`NodegraphBlock` / `MermaidBlock` 自己已经是懒加载的，直接 import `NodeGraph`。
- `ui/` 里不能碰 store，减少动效只能读 `ui/input-intent` 的 `reducedMotion`（加 MutationObserver 跟着变）。
- 后台 / 编排每秒用新的 graph 对象重画（时间在走）：重新适应窗口只看卡片 id 拼成的 `nodeKey`，并且用户缩放 / 平移过就不再自动适应；拖过的偏移也按 id 保留。
- 隐藏的面板量出来是 0×0：等有尺寸才适应窗口。
- 坏 JSON 不 `console.warn`（ui-smoke 遇到 warning 就算失败），只在代码下面显示「这张图格式有误」和出错的位置。
- `orch-graph.ts` 用到的 `labels.ts` 读 store，单测里要 `vi.mock('./labels')`；`NodeGraph.test.tsx` 要 mock `@/ui/Select`（它经 Popover 拉进 store）。

## Mermaid 转换

支持：头 `flowchart|graph [LR|RL|TD|TB|BT]`；形状 `[ ]` `( )` `([ ])` `[[ ]]` `[( )]` `(( ))` `{ }` `{{ }}` `[/ /]` `[\ \]` `> ]`、带引号的文字（`<br>` 变空格）；`:::cls`；连线 `-->` `---` `--x` `--o` `<-->`（normal）、`-.->` `-.-`（dashed）、`==>` `===`（strong）；标签 `-->|t|`、`-- t -->`、`-. t .->`、`== t ==>`；链 `A --> B --> C`；`&`；`;` 分句。跳过 `%%` `subgraph` `end` `classDef` `class` `style` `linkStyle` `click` `direction` `accTitle` `accDescr`（subgraph 里的节点照样画）。任何一行不认识（比如 `A@{ shape: … }`）→ 只显示原图，没有切换按钮。方向一律从左到右。

## 给 Claude 的提示

`server/src/runtime/nodegraph-hint.ts` 的一段英文说明拼进 `session-runner.ts` 的 `systemPrompt.append`。设置「新对话 → 让 Claude 画可交互的节点图」（`ui.nodegraphHint`，默认开）；进程启动时读，改了之后新开的对话生效；只聊天 / 精简（`bare`）的对话不加。e2e：`server/ws-phase34.mjs`（假上游记下系统提示：默认有 ```` ```nodegraph ````，关掉后没有）。
