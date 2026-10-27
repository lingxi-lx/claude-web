# 插件 / 同步 / 远程共享（2026-10-26，spec 统一模型来源 §4.3、§8）

## 插件（`server/src/plugins/`）

两种，永不混用：

- **来源定义**（`declarative.ts`）：`<数据目录>/plugins/*.json`（跟 `CLAUDE_WEB_DIR`）。只是数据：endpoint、protocol（anthropic / openai / openai-responses / gemini）、auth（bearer / x-api-key / both / none）、models（上下文、最大输出、tools / images / reasoning / stream、free、mayTrain）。未知字段丢掉；endpoint 必须 https（http 只给本机 / 私网），URL 里不许带账号密码。文件可以是 `{ id, name, sources: [...] }`，也可以是单个来源对象（id 取文件名）。
- **可执行插件**（`runtime.ts`）：`plugins/<文件夹>/plugin.json` + 入口（CommonJS）。manifest 声明 `hooks`（`request-before` / `response-after` / `source-provider`）和 `permissions`（`network` 主机名、`fileRead` 路径、`secrets` 名字）、`timeoutMs`（默认 10 s，上限 60 s）、`maxOutputBytes`（默认 64 KB，上限 1 MB）。

可执行插件怎么隔离：

- 单独的 Node 子进程（Electron 下 `ELECTRON_RUN_AS_NODE=1`），`windowsHide: true`，**环境变量只给最小集**（不继承我们的 key / 代理）。
- 有 `--permission`（Node 22.13+）或 `--experimental-permission` 时开权限模型：只读自己的文件夹、bootstrap、声明的路径；子进程 / worker / addon 默认禁。没有时 `isolation: 'process'`，界面写「单独进程」。
- bootstrap（`BOOTSTRAP`，启动时写到 `plugins/.runtime/host.cjs`）在 require 层拒绝 net / http / https / tls / dns / child_process / worker_threads / vm 等；`globalThis.fetch` 换成 `host.fetch`，走父进程：只许 https、只许声明的主机、请求体过隐私钩子（`setPluginPrivacyHook`，隐私模块启动时注册；钩子抛错 = 不发）、超时、4 MB 上限、不跟随重定向、去掉 set-cookie。
- 每次调用有超时，超时**杀子进程**，下一次调用重新起；stdout / stderr 截到上限，界面显示最后一段。
- 密钥：只有声明过、且用户批准过的名字才给；目前支持 `provider:<供应商 id>` = 那个供应商的 key（SecretService 解密后只发给这个子进程）。
- 批准绑在 manifest 的哈希上（main + hooks + permissions），manifest 一变就要重新确认（`plugins.enable` 带 `approve: true`）。状态在 meta.json 设置 `plugins.state`（只有 enabled / approvedHash，没有秘密）。

接入点（**还没接线**，留给对应模块）：

- 渠道目录：`pluginSources()`（`declarative.ts`）返回 `SourceSummary[]`（id `plugin:<插件>/<来源>`，kind 暂用 `provider`），channels 的投影里 append 一下即可；原始定义用 `pluginSourceDefs()`。
- 网关：`PluginService.runHook('request-before' | 'response-after', payload)`，按名字顺序跑所有启用且批准的插件，出错 / 超时跳过、请求照常。gateway/service.ts 的 `attempt` 调它（merge-1 接上）：request-before 在隐私脱敏之后（插件只见占位符）、每个重试变体都过一遍；response-after 只给整段非流式回答，在隐私还原之前（passthrough 时请求改 `accept-encoding: identity`，仍是压缩的回答不过插件）。payload 是 `GatewayHookPayload`（source / model / path / body），插件返回 null 或同样的 body 时原字节不变；没有启用的插件声明这个 hook 时什么都不调（`hasHook`）。流式回答不过 response-after。
- 远程目录：`verifyRemoteCatalog(body, sig)` 用 Ed25519 验签后只解析成来源数据；`mergeRemoteCatalog` 不覆盖用户改过 / 关掉 / 删掉的。`CATALOG_PUBLIC_KEYS` 现在是空的——发版带上公钥前远程层不生效。

WS：`plugins.list / reload / enable / disable / remove`（remove 只删插件目录里的东西）。界面 `web/src/features/plugins/PluginList.tsx`，启用可执行插件前用 `dlg.confirm` 列出权限。

## 同步（`server/src/sync/`）

- `backup.ts`：文件格式 `claude-web-sync` v1。明文部分：供应商（去掉 apiKey 和本机学到的 / 缓存的字段：models、modelNames、modelEfforts、modelContext、modelsAt、modelsError、promptEffortModels、no*）、账号引用（id、kind、名字、并发、每日上限、邮箱 / 套餐，**没有凭据**）、网关组（成员和模型映射）、密钥组（共享权限，不含密钥本身——密钥每台机器自己发）、设置里的 `routing.*` / `models.*`。任何设置值里像绝对路径的（`C:\`、`\\`、`~/`、`/home/…`）都去掉。
- 加密部分（`crypto.ts`）：口令 → scrypt（N=2^15, r=8, p=1）→ AES-256-GCM，带 AAD；口令至少 8 个字。里面是供应商 key、账号凭据和代理、`privacy.*` 设置（spec：凭据与隐私配置用独立口令）。没口令就只导出明文部分。导入时 scrypt 参数有上限，伪造的文件吃不掉内存。
- `merge.ts`：逐项。设置 / 网关组 / 密钥组按 key 和字段合并，本机独有的保留；供应商 / 账号的**凭据两边不同 = 冲突，两份都留**，传入的另存为「名字（同步）」（新 id 加后缀），绝不覆盖。本机没有 key 而文件有 → 补上。
- WS：`sync.export { passphrase? }` → `{ filename, text }`（浏览器用 Blob 下载）；`sync.import { text, passphrase? }` → 预览（token，10 分钟，解密后的东西只在内存）；`sync.apply { token, skip }`；`sync.cancel`。界面 `web/src/features/sync/SyncPanel.tsx`。
- 坑：账号直接写 meta（`saveUpstreams`），UpstreamService / sidecar 不会马上知道新账号，可能要重启或刷新一次。

## 远程共享（`server/src/share/`）

- 不加第二个监听：共享密钥就是网关密钥，放在 `share` 密钥组里（第一次建时 `allowLan: true`，IP 白名单默认三段私网）。每把钥匙多一个 `GatewayKey.share`（`ShareRules`：routeGroupIds、models、concurrent、daily / weekly / monthly 的 requests / tokens）和 `period` 计数（ISO 周、月）。
- 检查在 `upstreams/keys.ts`：`verify()` 返回 `effectiveGroup(组, share)`——只收窄不放宽（来源取交集，模型两张表都要过，并发取小的；收窄成空就是 `~none~`，不会退回「全部」）；`canSpend()` 查日 / 周 / 月额度；`recordUsage()` 记周 / 月。这样网关 `serveRequest` 不用改。
- 局域网：用网关已有的 LAN 监听（默认关）。它只服务 `/v1…`、`/v1beta…`、`/healthz`，管理接口永远不在那上面；远程请求和本机走同一条 `run()`（协议转换、隐私、审计日志）。
- WS：`share.status / share.lan.set / share.keys.create / share.keys.update / share.keys.delete`，改完发 `gateway.changed`。界面 `web/src/features/share/ShareDrawer.tsx`（地址、白名单、密钥、权限、额度、今天 / 本周 / 本月用量）。
- 已知：周 / 月额度用完时 `retry-after` 仍是到午夜的秒数（serveRequest 里的 secondsToMidnight）。

## 三个界面

都是自包含组件，网关页挂载：`PluginList`、`SyncPanel`、`ShareDrawer`。样式沿用网关页的 `gateway-tab / gateway-card / gateway-row`。
