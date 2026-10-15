# 自定义样式 custom.css 与 DOM 钩子（2026-10-15，GitHub issue #2）

issue #2（plge0n）：想不 fork 就能微调界面——加载一个用户 CSS 文件、改完热加载；关键状态多暴露在 DOM 上，比如任务面板「计划」只写「3/7 完成」，想要一条和目标卡片一样的进度条。

## 做法

- 文件：`~/.claude-web/custom.css`（`CLAUDE_WEB_DIR` 下）。服务端 `appearance/custom-css.ts`：`read()`（超过 512 KB 不加载，带 `error`）、`create()`（不存在就写模板：用途 + 钩子清单 + 一个注释掉的例子；模板里的花括号不能进 `tr()`，占位符检查会当成 `{name}`）、`watch()` 监视数据目录（文件可能被删了再建），120 ms 防抖后 `customCss.changed` 广播。请求 `ui.customCss` / `ui.customCss.create`。联邦的对端事件默认丢弃，不会串。
- 前端 `app/custom-css.tsx`：`<style id="cw-custom-css">` 放在 **`<body>` 末尾**——代码分割的 chunk 以后还会往 `<head>` 里加样式表，放 head 里会被它们盖掉；body 里的永远在文档顺序最后。连上时和收到事件时 `loadCustomCss()`。开关是设置 `ui.customCss`（缺省开），设置 → 外观 → 自定义样式（`settings/CustomCssSection.tsx`）：状态、新建 / 编辑（关掉设置页，在编辑器标签里打开，自动保存 → 热加载）、打开所在文件夹。手机 / 浏览器 / 桌面版都生效。
- **钩子是约定**（模板、README、这里三处一致，改名字前先想清楚）：`html[data-theme]`、`html[lang]`、`.chat[data-state]`（runner 的状态，没在跑 = history / closed / error）、`.todos[data-done][data-total]` + `style="--progress: N%"`（`AgentTool.tsx planProgress()`，对话里和任务面板里的计划都有）、`.todos > li[data-status]`、`.tasks-plan .plan-head`（同样的 data 和 `--progress`）、`.tasks-plan .plan-prog > i`、`.goal-h .prog > div`、CSS 变量。
- 内置的计划进度条：任务面板「计划」标题行 `计划 3/7 ━━━`（`TasksPanel.tsx`），样式跟目标卡片的 `.goal-h .prog` 一样。

## 验证

- `server/ws-phase29.mjs`：没有文件、模板内容、写文件后事件 + 新内容、超大不加载。
- 一次性 Electron 检查（没进仓库）：加载时生效且在 body 末尾、写文件后几秒内变、开关拿掉 / 放回、计划的 data / `--progress` / 进度条宽度、用户文件里的 `height` 生效、`li[data-status]`、设置页状态是「已加载」。
