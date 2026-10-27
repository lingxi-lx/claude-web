# 免费来源与托管程序（2026-10-26，spec「统一模型来源」切片 4）

设计：`docs/superpowers/specs/2026-10-26-unified-model-sources-design.md` §3.1 / §3.2 / §5.3 / §6。界面在
`web/src/features/gateway/`（另一个切片），本切片只出服务端：`channels.*` 和 `engines.*`。

## 结构

- `server/src/channels/catalog.ts` — 来源目录。三层：内置基线 `BASELINE`（离线可用）< 签名远程目录 < 用户改动
  （`meta.channelCatalog`：`hidden` / `patch`）。第四层是来源自己的实时 `/models`，在投影时用。
  - 基线的每个值都来自调研笔记（`research_notes/免费模型来源深度调研/B_official_free_tiers.md`、`A_keyless_pools.md`、
    `research_notes/可反代的模型上游调研/cherry-studio.md` 的 34 家 Anthropic 端点表）。**笔记里没有的值就不填**
    （比如 Cerebras 的注册页、各家 authStyle、大部分模型 id），别凭记忆补。
  - `notes` 是不带语言的代码（`real-name` / `one-concurrent` / `parallel-tools-off` / `list-any-key` / `logged` …），
    界面自己翻成字。`limits` 是厂商（或聚合清单）原话，英文。
  - 远程目录：设置 `channels.remoteCatalog = { enabled, url, publicKey }`，默认关。Ed25519 签名覆盖 `entries` 的
    JSON；字段白名单、只收 https / 本机地址、`modelFilter` 必须是合法正则；远程不能新加引擎 / 登录类条目，也不能改
    内置条目的 `driver`；验过的副本存 `<dataDir>/channels/catalog-remote.json`，更新失败用上次的。
    **还没有正式的公钥和发布地址**——这是个桩，等有人维护目录再填。
- `server/src/channels/drivers/` — ChannelDriver 注册表：`provider`（供应商档案，含免费 / 免 key）、
  `upstream:claude|gemini|workbuddy`（包现有账号池）、`engine:cliproxyapi|magpie`。凭据只走现有的存储：
  key 进 ProviderService（meta 加密），登录走 upstreams，托管程序的 key 走 SecretService。驱动自己不存任何凭据。
- `server/src/channels/service.ts` — `status()` 返回 `sources` + `available`（目录，带 `added` / `overridden`）；
  `add(catalogId, key?)` 一步建好；`remove(id)`；`setCatalog` / `updateCatalog`。
- `meta.channelLinks`：供应商 id → 它来自哪条目录（`keyless` / `engine` 标记）。供应商被删时链接留着也无害。
- `server/src/engines/` — EngineManager（`manager.ts`）、进程（`process.ts`）、清单（`manifests/index.ts`）、
  `handlers.ts`。`engines.*` 和 `channels.*` 都不带 sessionId，所以**不进联邦路由表**。

## 一步添加（channels.add）

1. 按目录条目建供应商：`type` = 条目 protocol，`baseUrl` 原样，key 存 ProviderService；条目有 `authStyle` 就一起写
   （隐私切片会给 Provider 加这个字段，现在 meta 原样存着）。
2. 拉 `/models`；失败就**删掉刚建的档案**再报错（不留半成品）。
3. 按 quick connect 的规则选默认模型（`channels/plan.ts`；Anthropic 格式顺带三家族映射）。
4. 免费专用来源（Kilo、OpenRouter :free、GLM-Flash）有 `modelFilter`：`ProviderService.modelFilter` 钩子让之后
   每次自动刷新也只留免费模型——Kilo 的列表有 400 个，大多是要登录的付费模型（`PAID_MODEL_AUTH_REQUIRED`）。

## 免 key（Kilo）

- 实测（2026-10-26）：`https://api.kilo.ai/api/gateway/v1/models` 和 `/v1/chat/completions` 不带鉴权、带随便一个
  Bearer 都是 200。所以免 key 来源存一个占位 key `anonymous`（`KEYLESS_KEY`）——CLI 和网关总会发 Bearer，
  而 refreshModels 没 key 会直接报「没有 API Key」。
- base 要带 `/v1`：`modelsUrl` / `openaiBase` 会补 `/v1`，不带的话变成 `/api/gateway/v1/...` 也恰好能用，但存带的更稳。
- 提示词可能被上游记录 / 训练（`mayTrain`、`logged`）。

## 托管程序（engines）

- 下载：GitHub releases API（`/releases/latest` 或某个 tag）。按文件名里的系统 / CPU 词挑 asset，排除校验文件和
  安装器。实测 2026-10-26：
  - CLIProxyAPI `router-for-me/CLIProxyAPI` v8.0.44：`CLIProxyAPI_<v>_<os>_<amd64|aarch64>.tar.gz|zip`，另有
    `_no-plugin` 版（不选）、`checksums.txt`。
  - Magpie `yetone/magpie-releases` v0.1.1657：`magpie-cli-<os>-<arch>[.exe]`（选这个，纯命令行）和桌面版
    `magpie-<os>-<arch>`、`.dmg` / `.zip`，`SHA256SUMS`。
  - 两边每个 asset 都有 GitHub 的 `digest: sha256:…`，先用它，其次 checksums 文件；都没有才「首次安装记下哈希」
    并在状态里警告（`verified: 'recorded'`）。
- 版本：没有写死的 pin（笔记里没有测过的 tag），装的是 latest，之后**不自动升级**；`engines.upgrade` 装新的、
  切过去、启动失败自动回到旧的；`engines.rollback` 手动回退。只留当前和上一个版本。
- 运行：`127.0.0.1` + 分配的端口（上次的端口空着就沿用，供应商地址不变）；`windowsHide: true`；POSIX 上独立进程组，
  停止时 Windows `taskkill /T /F`、POSIX 杀整个组。日志 `<dataDir>/engines/logs/<id>.log`，5 MB 轮转。
  意外退出 10 分钟内最多重启 3 次。服务退出时停掉，下次启动时把上次在跑的再拉起来（`autoStart`）。
- CLIProxyAPI：写 `<dataDir>/engines/cliproxyapi/data/config.yaml`（v8 布局：`server.host/port`、
  `management.secret-key` + `allow-remote: false`、`access.api-keys`、`oauth.auth-dir`），`--config` 启动。
  客户端 key / 管理 key 生成后用 SecretService 加密存 meta。**登录订阅账号（`--login` 等）还没接**：用户要自己对
  这份配置跑登录命令，或之后在详情页加。
- Magpie：`magpie serve` + `MAGPIE_ADDR=127.0.0.1:<port>`；本机任意 key 都收，用 `magpie-claudeweb`；
  健康 = `GET /api/hello` 回 `{name:"magpie"}`。它会自己后台更新（状态里有警告）。
- 已经在跑的：Magpie 查 `127.0.0.1:3425/api/hello`；CLIProxyAPI 查 `127.0.0.1:8317/v1/models` 有没有 JSON 回应
  （没 key 是 401）。查到就在 `engine.detected` 里给出，`channels.add` / `engines.connect` 走「连接」不装第二份；
  CLIProxyAPI 连接要用户给它 `access.api-keys` 里的一把 key。
- 起来之后注册成 Anthropic 格式的供应商（`http://127.0.0.1:<port>`，不带 `/v1`），`channelLinks` 标 `engine`，
  所以来源列表里只显示成托管程序那一条，模型也挂在它下面。

## 还没做 / 不知道的

- 远程目录：没有公钥和地址（桩）。
- 免费来源的「真实调用」健康检查和额度：只做了模型列表（ModelScope 的 `/models` 收任何 key，要真调一次才知道）；
  429 / 额度重置时间没接。
- CLIProxyAPI 的订阅登录流程、Magpie 的账号页没接；CLIProxyAPI 的检测只是「有 JSON 回应」。
- Cherry 列表里 opencode（base 带 `/v1`，不确定）、vertex / bedrock（SDK 拼地址）、new-api / aionly（没地址）没收。
