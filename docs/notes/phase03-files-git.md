# 文件 / Git / 编辑器（阶段 3，2026-09-03）

- 服务端三个新服务：`server/src/files/service.ts`（`fs.open/write/mkdir/create/rename/copy/trash/watch`，`write` 带 `expectMtime` 冲突检测；回收站在 Windows 走 PowerShell 的 `Microsoft.VisualBasic.FileIO`，macOS 走 Finder，Linux 走 `gio trash`）、`server/src/search/service.ts`（ripgrep `--json`；rg 优先用 ccb 自带的 `dist/vendor/ripgrep/<arch>-<platform>/rg`，没有再找 `@vscode/ripgrep` / PATH）、`server/src/git/service.ts`（porcelain v2 解析、`classifyGitError()` 把 stderr 归成 15 类并配修复提示，`GitCommandError` 在 hub 里编码成 `message\n\n[kind] hint`，客户端 `GitView` 解析回来给「一键修复」按钮）。
- `GET /api/file?path=&token=` 直出本地文件（图片 / PDF / 媒体预览用，支持 Range），CSP sandbox。
- 编辑器是 Monaco 0.56：`web/src/features/editor/monaco.ts` 懒加载，worker 用 exports 映射写法 `monaco-editor/editor/editor.worker.js?worker`（`esm/vs/...` 路径会被 exports 的 `./*` 规则映射错）。主题从 CSS 变量算出来，切主题时 MutationObserver 重定义。每个路径一个 model（多个 tile 共享），tile 关闭只 dispose editor。
- Doc tile：自动保存（`ui.autoSave`，默认开，停手 0.8s）、`fs.watch` 检测磁盘变更（干净时静默重载，脏时横幅二选一）、Ctrl+S、未保存关闭确认（store `dirtyDocs` + `closeTile`）。同一路径的 doc / diff tile 在同一窗格内去重（`tile.open` 里比较归一化路径）。
- 会话 tile 的工作台视图（`tile.wb`；标签行已从默认界面移走，入口是会话头 `···` 和命令面板；**改动 / Git / 文件 / 搜索 / 生成的文件 / Issue 与 PR 打开的是右侧面板**（手机上是底部抽屉），定时任务是自动化页，只有远端会话才原地换视图，见「界面改版 阶段 2 / 7」）：改动（会话触碰的文件）/ Git（`GitView`：分支切换新建、拉推 fetch、暂存 / 取消 / 丢弃、提交 amend、历史（点开提交 diff）、worktree 列表新建删除、stash）/ 文件（`FileTree`：git 徽章、右键菜单、内联新建重命名、F2、回收站）/ 搜索（`SearchView`：大小写 / 全词 / 正则 / include / exclude，替换可逐行排除）。
- 后台 fetch：`git.watch` 过的仓库每 5 分钟 `fetch --prune`，`.git/HEAD|index|refs` 变化广播 `git.changed`。
- `server/ws-phase3.mjs`：文件操作 / 冲突检测 / 搜索替换 / 回收站 / git 只读 的端到端检查（在 detached HEAD 下跑时 `branch` 可以是 null、分支列表里没有当前分支）。
