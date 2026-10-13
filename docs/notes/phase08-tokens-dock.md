# 设计令牌 / 图标 / 停靠面板（阶段 8，2026-09-04）

- **令牌是分层的**：主题只定义十来个原色，语义层全部用 `color-mix(in oklab, var(--fg) N%, transparent)` 从里面派生 —— 表面 `--surface-0..3/-elev`、描边 `--edge-subtle/default/strong`、叠加 `--layer-hover/selected/active`、文字 `--ink-1..5`、圆角 `--r-sm..2xl/pill`、阴影 `--elev-1..3`、时长 `--dur-1..4`、缓动 `--ease-out/in-out`、字号 `--fs-micro..xl`、状态 `--ok/warn/err/info/ctl-on`。**加一个主题只要写那十几个原色**，别再往规则里写死颜色或圆角。旧名 `--bg/--fg/--line` 还在但只作兼容，新代码别用。
- 焦点环统一：全局 `:focus{outline:none}` + `:focus-visible{outline:2px solid var(--focus-ring)}`，删掉了散落的 15 处 `outline:none`。`.icon-btn` 有固定 28×28 盒子（`.xs` 22px），命中区不再等于字形宽度。
- `.sub` 是**独立的类**，不再只在 `.row` 里生效；`.row .sub` 只额外加单行省略。设置页那种成段的说明文字靠它。
- **图标全部手写**：`web/src/ui/icons.tsx` 一个 `PATHS` 表，24×24 网格、stroke 1.75、`currentColor`，`<Icon name size />`。没有图标库依赖。原来约 175 处内联 Unicode/emoji 已经换掉；`server` 的 `AGENT_DEFS.icon` 存的是图标名不是字形。
- **面板表只有一份**：`web/src/model/layout.ts` 的 `PANELS`（id/title/icon/tier/rail/keepAlive）导出 `PANEL_IDS/PANEL_TITLES/PANEL_ICONS`，Dock / DockRail / 命令面板 / TabStrip 全从这里取。加面板 = 往 `PANELS` 加一行（必须有 `tier`，`panel-entries.test.ts` 会断言它 ≤ 2 次点击可达）+ `PanelContent` 加一个 case。
- **停靠面板只有一条渲染分支**：最小化靠 CSS（`.dock.min` 收成图标轨）+ `[hidden]`，**绝不卸载面板**，否则终端 pty、xterm 缓冲、表单状态全丢。注意 `.dock-panel{display:flex}` 会盖掉 UA 的 `[hidden]`，所以显式写了 `.dock-panel[hidden]{display:none}`。**整个停靠面板隐藏（Ctrl+J / 会话头的右侧面板按钮 / 终端按钮再点一次）也是 `hidden`**（`.dock[hidden]{display:none}`），不 `return null`——以前隐藏会卸掉终端；只有点标签的 × / 中键（`dock.close`）才卸载那一个面板；默认界面的四个固定标签没有 ×，第一次打开时才挂载（见「界面改版 阶段 2」）。
- `deriveActive()` 会**越过**前面的浏览器 / 文档 / 终端标签往后找会话：停靠面板（文件 / Git / 记忆 / 任务）读的是 `activeId`，不这样做的话把浏览器标签切到前面，右边整排面板就空了。
