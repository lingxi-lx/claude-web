# 配置中心 / 自动化 / 打磨（阶段 4，2026-09-03）

- **设置**（Ctrl+,）是全窗页（改版阶段 6 重组成 5 组 + 高级，见「界面改版 阶段 6」）：`openSettings({section, query, reveal})` 可以直接跳到某一页 / 某一条并高亮，旧分区 id 照样能用。简单开关用 `ui.*` 键存 meta.json；复杂页面复用 `ConfigPanel` 里 export 出来的组件。停靠面板里的「配置中心」保留（侧栏账户行的齿轮右键，或账户弹层里的「配置中心」）。
- **外观**：`ui.theme`（含 `system` 跟随系统）、`ui.fontSize`、`ui.density`、`ui.cjkFont`、`ui.reduceMotion` 由 `features/settings/ui-settings.ts` 的 `applyUiSettings()` 写到 `<html>` 的 data 属性 / CSS 变量；`setTheme` 同时写 `ui.theme`，localStorage 只当缓存。设置 → 外观的主题是一排色块（`settings/ThemePicker.tsx` 的 `ThemeSwatches`：跟随系统（半亮半暗）· 浅色 · 深色 · 纸张 · Dracula · Nord · Tokyo Night），不是下拉；色块的颜色在 `settings/theme-preview.ts`（色块画的是别的主题，读不到当前的 CSS 变量），`theme-preview.test.ts` 用对比度测试的 `themeBlock()` 读 `styles.css` 逐个比对，并断言每个主题块都有色块和名字——**加主题时也要往这张表里加一行**。
- **原生对话框全部换成 `web/src/ui/dialog.tsx`**（`dlg.confirm / prompt / alert` 返回 Promise，`DialogHost` 挂在 App）。新代码别再用 `window.confirm/prompt`（Electron 下会抢焦点、样式也不对）。
- **密钥**：`server/src/secrets/service.ts`，Windows 走 DPAPI（PowerShell `ProtectedData`，CurrentUser），macOS 走 `security` 钥匙串，其它平台只做 base64 标记。meta.json 里的 `apiKey` 形如 `enc:dpapi:…`；`ProviderService.warm()` 启动时把全部密钥解密进内存，`forSession()` 仍是同步的。换机器 / 换用户后解不开会报错要求重输。
- **Skills**：`server/src/skills/service.ts` 支持 `owner/repo`、`owner/repo/子目录`、GitHub tree 链接、本地路径；仓库根没有 SKILL.md 时递归两层装所有带 SKILL.md 的文件夹。`remove` 只允许 skills 目录下的路径。备份用系统自带 `tar`。
- **MCP**：`McpCatalog.tsx` 内置约 27 个常用服务器配置（stdio / http / sse，标注需要的 env 与 OAuth），官方注册表搜索走 `registry.modelcontextprotocol.io/v0/servers`（`mcp.registry`），健康检查解析 `claude mcp list` 输出（`mcp.health`）。OAuth 授权仍需在会话里 `/mcp`（TUI 交互）。
- **定时任务**：`server/src/schedules/cron.ts` 自写 5 字段 cron（列表 / 范围 / 步长 / 名称 / @daily 等），`nextCron()` 本地时间；`Schedule.cron` 优先于 `everyMinutes`；每次运行记到 `meta.scheduleRuns`（上限 300，含 30 分钟内的结果摘要）；`freshSession` 每次新开会话；6 个模板在 `SCHEDULE_TEMPLATES`。改 cron / 间隔 / 启用状态时 hub 重新算 `nextRunAt`。
- **账本**：`server/src/usage/ledger.ts` 订阅 pool 的每条消息，每个 `result` 记一行到 `~/.claude-web/ledger.jsonl`（延迟 `duration_api_ms`、缓存读写、费用、失败原因），`api_retry` 也记；用量面板「账本」tab 有柱状图 / 表 / CSV 导出。
- **Mission Control**：停靠面板 `mission`（Ctrl+Shift+M）按「需要你 / 运行中 / 出错 / 空闲」分列所有活动会话，卡片上直接允许 / 拒绝权限、中断、跳转。
- **桌面壳**：`electron-updater`（GitHub Releases，`electron-builder.yml` 的 `publish`，开发模式直接报「不检查更新」）；退出守卫统计运行中会话 + 待处理权限 + 未保存文件，`ui.confirmExit` / `ui.closeToTray` 可关；`flags.json` 里的 `softwareRender` 在 `ready` 前 `disableHardwareAcceleration()`，GPU 进程连挂两次自动写标记重启；`ui.softwareRender` 设置通过 `desktop.setFlags` 同步。
- 诊断包：`diag.bundle` → `~/.claude-web/diagnostics/<ts>/`（info.json、server.log / main.log 尾部、脱敏 meta.json 与 settings.json）+ tar。
- `server/ws-phase4.mjs`：skills / tools / secrets 迁移 / cron / 账本 / 诊断 / 注册表 的端到端检查。首次运行引导只在没有任何工作区时出现（两步：登录 · 项目文件夹，见「界面改版 阶段 7」）。
