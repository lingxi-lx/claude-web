# 统一会话库（2026-09-27）

- **一个入口**：`server/src/library/service.ts` 的 `LibraryService` 把 Claude + 各 agent 自己的会话记录合成一个列表 / 读取 / 搜索面；`sessions.list`、`sessions.search`、`transcript.load`、`session.open` 都走它。来源实现 `SessionSource`（`library/types.ts`），每个来源一个文件：

  | 来源 | 列表 / 读取 | rename | archive | delete | fork | 续聊 |
  | --- | --- | --- | --- | --- | --- | --- |
  | Claude（`claude-source.ts`） | SDK `listSessions` / transcript | ✓（SDK） | ✓（只记在 meta.json，Claude Code 没有归档标记） | ✓ | ✓（SDK `forkSession`） | ✓ |
  | Codex（`codex-source.ts`） | `codex app-server` 的 `thread/list`、`thread/turns/list` | `thread/name/set` | `thread/archive`/`unarchive` | `thread/delete` | `thread/fork` | `thread/resume` |
  | OpenCode（`opencode-source.ts`） | `opencode serve` 的 `GET /project` + `GET /session` + `/session/:id/message` | — | — | CLI `opencode session delete` | — | ACP `session/load` |
  | ACP agent（`acp-source.ts`） | 只有声明 `sessionCapabilities.list` 的才能列（`session/list`），无 read | — | — | — | — | 看 `loadSession` |

  能力只来自**官方接口**；没有就是只读，不改 agent 的数据文件。库专用后台进程（app-server / `opencode serve`）每来源一个、`LazyRpc` 闲置 5 分钟退出，不和会话进程共用。
- **id 规则**：Claude 保持原 UUID；其它 `<agent>-<原生 id>`（`codex-…`、`opencode-…`、`gemini-|qwen-|kimi-…`），自定义 ACP agent `acp:<name>` → `acp_<name 里的 - 转成 ~>-<原生 id>`。不含冒号。前缀表和 `parseLibraryId` 在 `protocol.ts`（web 共用）。续聊时 `prepareResume()` 给它建一个 `imported:true` 的头指向原生 id，驱动走原生 resume，新轮次写回 agent 自己的记录。
- **加入是可选的**：除 Claude 外默认不加入；检测只看 `AgentRegistry` 版本探测 + 数据目录（`~/.codex/sessions`、`~/.local/share/opencode`、`%LOCALAPPDATA%\opencode`），**不启动任何进程**。`library.discovered {kinds}` 在连接时和 `agents.list {refresh:true}` 后推送，侧栏底部出一行轻提示「把 X 里的对话也列在这里？ · 列出来 ×」（× = 以后再说；入门清单完成或关掉之后、或清单出现满 3 天后才出，见「界面改版 阶段 4」）。状态存 meta `settings['library.joined' | 'library.dismissed']`。移出 = 关掉该来源进程 + 从列表和索引里去掉（agent 数据不动）。
- **删除先备份**：完整历史导出到 `<dataDir>/library-trash/<id>.json`（`dataDir()` 跟随 `CLAUDE_WEB_DIR`），写成功才调来源的 delete，导出失败就不删；启动时清理 30 天前的备份。界面二次确认，批量默认归档。
- **索引**：`<dataDir>/library.db`（FTS5），每会话正文摘录上限 20 000 字，中文走 LIKE（同 memory 的 `hasCjk`）；首轮索引完成前搜索退回旧的 transcript 扫描。`agent:codex`、`in:<目录片段>` 是查询前缀。
  - **索引不能跟着正在写的对话反复重读**（2026-09-29 实测：空闲的 3090 server 常驻 ~16% CPU、库专用的 `codex app-server` ~30%）：Claude 的监听器每次 transcript 追加都触发一次索引，而每次都整份重读（进行中的对话 60–70 MB），索引里的 `list()` 还会让过了 TTL 的来源在后台重列（Codex 一次 ~760 个线程）。现在：① 索引用 `list({revalidate:false})`，年龄不触发重列，只有监听器（soft → `stale`）/ 我们自己的改动（`dirty`）才会；有监听器的来源（Codex）TTL 10 分钟（`WATCHED_LIST_TTL_MS`），其它 60 秒；② 还在写（3 分钟内变过）的 Claude 对话，索引正文已存满 20 000 字（按 UTF-16 算，和截断同一个单位——SQLite 的 `LENGTH` 按码点，一个 emoji 就永远「不满」）时只 `touch()` 摘要（标题），**不动 `lastModified`**，安静 3 分钟后重读一次：索引读的是 `getSessionMessages` 沿 `parentUuid` 走出的链，压缩（`compact_boundary` 的 `parentUuid:null`，> 5 MB 时 SDK 只读最后一个边界之后）和 CLI 里的回退都会换掉开头，文件只追加不代表正文开头不变；③ 其它还在写的对话 3 分钟内最多重读一次（`INDEX_LIVE_MS`），跳过的会排一次补跑，补跑用 `scheduleIndex(ms, {unlessSooner:true})`，不会把已经排好的更早一次（监听器的 5 s）往后推。实测一个 62 MB、每 7 秒追加一次的对话：server CPU 7.9 s/分钟 → 0.2 s/分钟。
- **踩过的坑**：
  - **来源遇到暂时性失败必须 throw**（不能返回空），否则 service 会以为「没有会话」、把索引和缓存清掉；只有「没装」/「版本不支持」才返回空。service 保留上次缓存并在 `SourceStatus.error` 里带出错误。
  - **Codex `Thread.source` 不只是字符串**：`"cli"|"vscode"|"exec"|"appServer"|{custom}|{subAgent:…}`，`subAgent` 里又是 `"review"|"compact"|{thread_spawn:{parent_thread_id,…}}|…`。响应是 `{data, nextCursor, backwardsCursor}`（不是 `threads` / `turns`），以 `codex app-server generate-ts` 为准。
  - **Codex `thread/list` 默认只返回当前 provider 的线程**：真机上 690 个里只列出 399 个；要传 `modelProviders: []`。而且带 `[]` 时子代理线程的 `parentThreadId` 是 null，父线程只在 `source.subAgent.thread_spawn.parent_thread_id` 里（`parentOf()` 兜底，否则 277 个子线程平铺在顶层）。
  - **OpenCode 的 `/doc` 只写了 2 个路径**（`/auth`、`/log`），能力没法从 OpenAPI 探测，改为解析 `opencode session --help`（Windows 冷启动约 10 秒，超时 60 秒、失败下次重试）。**`GET /session` 只返回 serve 自己 cwd 所在项目的会话**（从 claude-web 仓库起是 0 条），要先 `GET /project` 再逐个带 `x-opencode-directory`（URI 编码）头去取。
  - **Windows 上 Python 文本模式写文件会把 LF 变成 CRLF**：仓库有 `.gitattributes`（`eol=lf`），改文件用 Edit/Write 或二进制写；提交前 `git diff -w --ignore-cr-at-eol --stat` 应该和 `git diff --stat` 一样。
  - **大目录树别用 chokidar 监听**（2026-09-29 实测，桌面版从开始菜单点开后一分多钟没有窗口的根因）：chokidar 在 Windows 上对**每个文件**单独 `fs.watch`，库对 `~/.claude/projects` 深度 4 的监听是 4468 个文件 + 168 个目录（Codex 再加 720 个），server 开始监听后事件循环整整堵了 ~18 s（CPU profile 里 `createFsWatchInstance` → 原生 `start`），打包版里连着 Codex 列表一起是 ~65 s，而桌面窗口要等页面画出来才显示。现在 `SessionService` 和库的监听都走 `runtime/watch-tree.ts` 的 `watchTree(dir, onChange)`：一个 `fs.watch(dir, {recursive:true})` 句柄（Windows ReadDirectoryChangesW / macOS FSEvents / Linux 按目录 inotify，Node ≥ 20），回调拿到相对路径；目录还不存在就每 30 s 找一次、出现后再挂；句柄出错（整棵树被删，Windows 上是 EPERM）回到寻找。`SessionService` 只认 `transcriptEvent(rel)`：项目目录、项目下的 `<id>.jsonl` / `<id>` 目录（子代理日志、tool-results、memory 不算）。同样条件下 profile 里 55 s 内零卡顿。chokidar 只留给小目标（git 的 HEAD / index / refs、编辑器里打开的单个文件）。
- `server/ws-phase13.mjs`：mock Codex（`agents/__mocks__/codex-server.mjs`，`CW_MOCK_RPC_LOG` 记录收到的请求）+ `MOCK_ACP_LIST=1` 的 mock ACP，端到端验证加入前不列、加入后列出并折叠子线程、分页读、搜索、改名、删除备份、`codex-` 会话续聊走 `thread/resume`、`library.sources` 状态。
- 真机验证（2026-09-27，只读 + 一个自建的测试线程）：Codex 717 条（`~/.codex/sessions` 721 个 jsonl + archived 42，部分没有线程记录）、OpenCode 11 条、Claude 119 条；首轮全量索引约 150 秒（约 850 个会话），之后中文搜索 ~150 ms。测真机时用临时 `CLAUDE_WEB_DIR` 起一个独立 server，别碰用户自己的 `~/.claude-web`。

## Codex 的「分页存储」线程（2026-10-16 用户报告）

另一台电脑上打开 Codex 对话报「加载历史失败：paginated_threads is not supported yet」。新版 Codex（桌面版自己会更新）把线程存成 `history_mode = 'paginated'`（`~/.codex/state_5.sqlite` 的 `threads` 表；本机 766 条都是），旧一些的 `codex` 命令行认得这种格式但读不了，**分页读和整条读都拒**，所以不能走 `NO_PAGING` 那条 `thread/read` 退路（以前退过去，用户看到的就是 Codex 的原话）。

- `codex-source.ts`：`PAGINATED` 命中时 `read()` / `exportAll()` 换「Codex 桌面版自带的 codex」再读一次（`desktopCodexBin()`：Windows `%LOCALAPPDATA%\OpenAI\Codex\bin\<build>\codex.exe` 取最新的，macOS `Codex.app/Contents/Resources/codex`；`newerRpc()` 按 command+args+env 判断是不是同一个，懒启动、和主进程一起关）。没有桌面版就报一句能照做的话（更新 Codex 命令行，或在 设置 → Agents 把命令换成桌面版那个）。
- 本机复现不了原话：0.159.2 / 0.162.1（npm 包解到临时目录，`CODEX_HOME` 指到 `~/.codex` 的**拷贝**）和桌面版 0.162-alpha 读本机的分页线程都正常（turns/list full / summary / notLoaded、`thread/read includeTurns`、`thread/items/list` 全通）；原话在二进制里只出现在 `thread_processor.rs` 的 fork / resume 一带。所以「旧命令行 + 新桌面版写的线程」是推断，测试用 mock 的 `MOCK_CODEX_NO_PAGINATED=1`（分页读和整条读都拒）覆盖。
- 拷贝的 `CODEX_HOME` 上 `thread/resume` / `thread/fork` 测不了：线程记着当时的 model provider（`cwgw`，我们的网关）、rollout 路径指向真的 `~/.codex`（「must be in Codex home directory」）。
- **SDK 的 `listSessions` 会整个漏掉第一句很长的对话**（2026-10-17 实测：头 64 KB 里没有可读的第一句、尾部又没有标题类的行）：`sessions/unlisted.ts`
  扫目录补上，进程结束时补一行 `last-prompt` 让别的应用（Mirasim）也列得出。详见「照官方桌面版录屏改的界面」第二轮。

## 本机发现与 Cursor 只读历史（2026-10-21，用户要求「直接扫本机」）

- **Cursor**：`~/.cursor/projects/<project>/agent-transcripts/<uuid>/<uuid>.jsonl`（本机确认的字段：`{role, message:{content:[{type:'text'|'tool_use'}]}}`）。`library/cursor-source.ts` 只读，`caps` 全 false（`resume / rename / archive / delete / fork`）；`AgentKind` 加 `cursor`，库 id `cursor-<uuid>`。`LibraryService.prepareResume` 现在对 `caps.resume === false` 的来源直接报「只读」，不再把它交给根本没有驱动的 agent。
- **本机发现**：`library/local-scan.ts` 只看常见目录（home、`APPDATA`、`LOCALAPPDATA`、`HERMES_HOME`），列 Cursor / WorkBuddy / DeepSeek Harness / Zcode / Hermes / OpenClaw / Kiro / Windsurf；`readable` 只在确有来源时为 true。本机 WorkBuddy 只有 `~/.workbuddy/sessions/*.json` 运行记录，没有可读的对话文件 → 界面显示「找到数据」。扫描不读凭据、不全盘递归；结果缓存 60 秒（按 homeDir 区分，测试可注入）。
- **协议**：新增 `library.localScan`；`SourceStatus.caps` 让设置页把只读来源标成「只读」。测试 `library/cursor-source.test.ts`（脱敏 fixture：半行 JSON、tool_use、本机发现只读标记）。

### DeepSeek Harness（2026-10-21，用户问「对话库没有它是不是我电脑没有」）

- **不是没装**：`~/.dsh`（`$DSH_HOME` 可改）是它的用户目录；会话在 `sessions/<项目目录>/<会话目录>/`，标题/cwd 索引在 `storages/session_projcache/sessions/*.json`。之前的 `local-scan` 只找 `.deepseek*` 和 AppData，漏了 `~/.dsh`。
- **格式**：日志是**多帧 zstd**（每次追加一帧），Node 的 `zstdDecompressSync` 只解第一帧；要按 magic `28 B5 2F FD` 切帧再逐帧解。旧会话文件名 `session.jsonl.zstd`、新会话（v4）是 `session.v4.jsonl.zstd`，两者都要认。解出来是 JSONL 事件流：`session`（header，`cwd` / `createdAt` 在**顶层**，不在 `data` 里）、`session/title`、`user/message`、`assistant/message`、`tool/call`、`tool/result`（另有 text / reasoning / tool-call 的增量 chunk，读历史用不到）。
- **会话 id 就是目录名**：旧会话目录是 `session-<uuid>`，新会话是裸 `<uuid>`。不要去掉/补前缀——`session/list` 和 `session/resume` 都用它，改了就回 `session is not resumable`。
- **注入消息与思考块（2026-10-21，用户问「能读、能续吗」时对着真会话发现的）**：harness 把自己的注入也写成 `user/message`——`source.kind: 'runtime-context'`（cwd / 沙箱 / 审批快照）和 `'skill-catalog'`（整份技能清单，几千字）。照原样读出来像是用户每问一句前粘了一大段；`dshMessages` 现在只把 `source.kind === 'user'`（以及没有 source 的旧格式）当用户消息。assistant 的思考块是 `{type:'reasoning', text}`，而渲染只折叠 SDK 的 `thinking` 块，所以要映射成 `{type:'thinking', thinking}`，否则历史里的思考整段消失。
- **实现**：`library/dsh-source.ts` 读文件（列会话 / 读正文），`AgentKind` 加 `dsh`，库 id `dsh-<目录名>`；`local-scan.ts` 把它标为可读取（不再重复列 `.deepseek*`）。真机验证：本机 4 个会话（Desktop\dsh 3 个、Documents 1 个，后者只有标题头），最大一个 49 条消息（21 user / 28 assistant）。测试 `library/dsh-source.test.ts` 用两帧 zstd 的脱敏 fixture 覆盖多帧解码、消息映射与分页。
- **续聊（2026-10-21 用户要求「像 Codex 那样」）**：dsh 的 ACP 服务端（`dsh --profile acp`）在 `initialize` 里声明 `sessionCapabilities: { list, resume, close }`，**没有标准 `loadSession`**。所以 `agents/acp-driver.ts` 续聊时先发 `session/resume`（`{ sessionId, cwd, mcpServers }`，要求 cwd 与创建时一致），再退回 `session/load`；`library/acp-source.ts` 的 `caps.resume` 也认 `sessionCapabilities.resume`。`DshSource` 继续负责列会话和读正文（ACP 没有 transcript replay），续聊由 ACP 驱动完成，新轮次由 dsh 写回同一份日志，下次读文件就能看到。`AGENT_DEFS` 里 dsh 默认命令是 `dsh --profile acp`（需 `npm i -g @deepseek-ai/dsh`；本机实测 npx 缓存那份依赖不全，`execa` / `zod` 解析失败，所以不用 npx）。
- **resume 不能带我们的 MCP 列表**（2026-10-21 真机）：带上 `claude-web-memory` 的 stdio MCP 时 dsh 回 `Internal error`，去掉就成功。AcpDriver 现在先按完整 MCP 列表 resume，失败再不带 MCP 重试一次，并推一条「本次续聊没有挂载共享记忆 / 联网」的提示。
- **真机实测**（`dsh` 0.2.1-rc.2）：`initialize` 12.8 s（`deepseek-harness-acp` 0.0.1）、`session/list` 4 个、`session/resume` 15.3 s、`session/close` 正常；用用户的 `session-86ce…` 跑完整 AcpDriver，`head.nativeSessionId` 保持原 id，未回退新会话。测试时创建的 3 个空会话目录已删除。限制：dsh 不支持 fork / 删除 / `session/load`，一次只允许一个进行中的 prompt。
