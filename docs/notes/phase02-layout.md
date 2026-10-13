# 工作台布局（阶段 2，2026-09-03）

- **三层模型**：分组（Group）→ 窗格（Pane，二叉分割树，最多 6 个）→ 标签（Tile：chat / doc / diff / term / panel）。纯函数在 `web/src/model/layout.ts`（`layoutReducer` + `layoutRects` + `presetTree` + `migrateLegacy`），`layout.test.ts` 覆盖不变量；组件在 `web/src/features/workbench/`。
- **`activeId` 是派生值**（焦点窗格的活动 chat tile），由 `dispatchLayout` 写回；`panels` 也是 `dock.tabs` 的投影。老代码继续读 `activeId` 没问题，但对话内组件要用 `useScopedSession()` / `useScopedSessionId()` / `usePaneCtx()` 取**自己所在窗格**的会话，别再 `useStore.getState().activeId`。
- **窗格永不卸载**：`PaneLayer` 把所有窗格绝对定位，分屏 / 拖动 / 缩放只改矩形（zoom 时其它窗格 `visibility:hidden`），所以 xterm 缓冲、滚动位置、草稿都保得住。`PaneLayer` 用 `useLayoutEffect` 先量尺寸再挂 tile，否则 0×0 时 Composer 自适应高度会读到假的 scrollHeight 并一直卡在 280px。
- 布局存 localStorage `cw.layout.v2:<winId>`（`?win=` 参数，桌面多窗口各一份），首次启动从 `cw.panels/cw.rp/cw.collapsed` 迁移（一个都没有 = 全新布局，停靠面板默认关）；UI 开关走 meta.json `settings.set`。分组栏 / 标签条 / 面板图标栏「用到才出现」，见下面「界面改版 阶段 0–1」。
- 快捷键唯一来源 `workbench/shortcuts.ts`（桌面菜单加速器 `desktop/src/main.ts` 抄它的 desktop 列，菜单文字也用它的 label / `ui/terms.ts` 的用户词——对话 / 分屏 / 标签页 / 右侧面板 / 步骤视图，desktop 包引用不到 web 的 terms.ts，所以是照抄，改词两边一起改，浏览器用 `matchBrowserKey`），命令统一走 `workbench/commands.ts` 的 `runCommand(id)`。桌面里 Ctrl 系组合由菜单触发，浏览器绑 Alt 系避开 Chrome 占用。
- 拖放是原生 HTML5：侧栏会话行 `application/x-cw-session`、标签 `application/x-cw-tile`、停靠标签 `application/x-cw-panel`；`dnd.ts` 的 `zoneAt()` 用边缘 25% 判定分屏方向。
- 多窗口：Electron `wins: Map<winId, BrowserWindow>`，`window-state.json` v2 存每个窗口的 bounds；**分组迁移不走 IPC**，同源 `BroadcastChannel('cw.workbench')`（`workbench/windows.ts`）offer/ack，源窗口收到 ack 才删；通知点击广播 `desktop:focusSession`，持有该会话的窗口响应，都没有时 main 窗口 claim。
- `scripts/shot.cjs` 的 argv 里任何带冒号的 token（比如 `'cw.layout.v2:main'`）都会让 Electron 当成 URL 直接退出 127，JS 里别写冒号字面量。
