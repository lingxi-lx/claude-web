# 跨 agent 共享记忆（阶段 12，2026-09-04）

- **`node:sqlite` 里已经编译了 FTS5**，不用加依赖（实测过）。库在 `~/.claude-web/memory.db`，scope = global / project(cwd) / session，kind = decision / constraint / fact / deadend / preference / note。
- **FTS5 不分词中文**，整句会变成一个 token，`"最小化"*` 永远匹配不上句子中间。`hasCjk()` 把中文查询走 LIKE 回退（`service.test.ts` 有回归用例）。项目检索永远把 global 一起带上；project key 做过大小写与分隔符归一。
- **注入方式三条，一条都不改用户自己的配置文件**（`memory/launcher.ts` 一处收口）：Claude 走 Agent SDK 的 `mcpServers`；ACP agent 走 `session/new` 的 `mcpServers`（agent 拒绝就退回不带它重开一次并提示）；Codex 走 `-c mcp_servers.memory.*` 覆盖，**`-c` 是全局 flag 必须排在 `app-server` 子命令前面**，而且只对真的含 `app-server` 的 argv 动手（自定义命令 / 测试替身原样放行）。值按 TOML 解析，所以 Windows 路径要 JSON 引号，不能裸写。总开关是设置里的 `memory.mcp`（设置 → 共享记忆），下次开会话生效。
- 打包后 MCP 入口在 asar 里：`ELECTRON_RUN_AS_NODE=1` 起 Electron 二进制读 `app.asar/server/dist/memory/mcp.js` 是可以的（实测握手通过）。
- 自动萃取只收「死路 / 决定 / 约束」，每个会话最多 12 条；相同文本在同一 scope 里视为同一条（只加命中数）。
- `server/ws-phase12.mjs` 用**真的 JSON-RPC over stdio** 驱动 MCP server（agent 怎么调它就怎么调），断言 UI 写的 agent 能读到、agent 写的 UI 能读到。
