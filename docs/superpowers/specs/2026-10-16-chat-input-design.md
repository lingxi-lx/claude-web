# 对话与输入：旁聊 / 下一句提示 / 查看模式 / @文件 / 快捷键（2026-10-16，第 2 期）

## 背景

五期路线的第 2 期（路线见 `2026-10-16-texture-design.md`）。对照官方 Claude 桌面版 Code 页的公开文档和用户截图，盘点后这一期**真正缺的**是下面五样。原来列在这期的「流式钉底」「图片灯箱」「429 退避」「语音」核对代码后发现已经有了：

- 钉底：`features/chat/ChatView.tsx` 的 `stick`（离底 80px 内跟随）+ 「回到底部」按钮。
- 灯箱：`features/chat/ImageViewer.tsx`（适应 / 1:1、滚轮缩放、拖动、方向键、缩略图条）。
- 429 / 过载：CLI 自己退避重试，`model/conversation.ts` 的 `api_retry` 已在对话里显示「API 重试 n/m（原因）· x 秒后」。
- 语音：`Composer.tsx` 用 Web Speech API（`toggleVoice`）。**但 Electron 里 `webkitSpeechRecognition` 存在却连不上谷歌的识别服务**，按了会立刻 `network` 报错——本期顺手修（§6）。

## 1. 旁聊（/btw，Ctrl+;）

问一个和当前对话有关的小问题，回答**不进对话记录、不占主对话的上下文**。

- **能力来源**：SDK 的 `Query` 对象上有 `askSideQuestion(question, { history })`（类型声明里没有，实现里有：发 `side_question` 控制请求，回 `{ response, synthetic, refusalFallback? }`，`response` 为 `null` 表示没答）。它借用当前对话的上下文，但不写进 jsonl。
- **服务端**：新请求 `{ kind: 'session.side'; sessionId; question; history?: { q: string; a: string }[] }` → 回 `{ text: string | null; synthetic?: boolean }`。
  - `SessionRunner.askSide(question, history)`：有活的 `q` 就调 `(q as any).askSideQuestion`；`history` 转成 SDK 要的形状（实施时从 `sdk.mjs` 里 `side_question` 的 `history` 用法确认字段名，确认不了就只传本轮问题）。
  - 对话没有活的 runner（闲置回收了 / 刚打开的历史对话）：先按「打开对话」的路子把它拉起来（resume，不发消息）再问。
  - 不是 Claude 引擎（Codex / ACP 等 AgentDriver）或引擎回「不支持的控制请求」：回错误 `side-unsupported`，界面说「这个对话的 agent 不支持旁聊」。
  - 进联邦路由表 `federation/rewrite.ts`（带 sessionId 的新请求都要进）。
- **界面**：一张浮在输入框上方的卡片（`features/chat/SideChat.tsx`），和停靠的权限卡同一位置规则，但更窄、可滚动：
  - 打开：输入框里打 `/btw 问题` 回车，或 `Ctrl+;`（打开空卡片，焦点在卡片自己的输入行）。`/btw` 要出现在斜杠命令补全里（本地命令，不发给引擎）。
  - 卡片里：问答一问一答往下排；自己的输入行回车再问（带上前面的问答当 `history`）；在等回答时显示「在想…」和停止（停止只是前端丢弃结果）。
  - 关：Esc 或 ×。问答只存在这张卡片的内存里，关掉就没了（和官方一致：不保存）。
  - 「放进对话」按钮：把最后一问一答作为一条普通消息的草稿塞进主输入框（不自动发），满足「这个回答我想让主对话也知道」。
  - 主对话在跑时也能问（官方就是边跑边问）。
- 用户可见字走 `tr()`；新命令进快捷键表和速查。

## 2. 下一句提示

每轮结束后，引擎猜你下一句可能说什么，灰字出现在空的输入框里，Tab 接受。

- **能力来源**：SDK `Options.promptSuggestions: true` → 每轮 `result` 之后最多一条 `{ type: 'prompt_suggestion', suggestion }`（第一轮、出错、计划模式、额度快满时不发）。
- **服务端**：`session-runner.ts` 建 query 时 `promptSuggestions: settings['ui.promptSuggestions'] !== false`。消息照常推给前端。
- **reducer**：`prompt_suggestion` **不进消息树**，存成会话状态 `c.suggestion = { text, afterUuid }`；下一条用户消息 / 新一轮开始 / 对话被重置时清掉。（reducer 是唯一真源，改它先跑 `npm test -w web`。）
- **输入框**：框为空、对话不在跑、没有停靠的卡片、没有附件时，`suggestion` 当占位灰字显示（替换平时的占位文字，前面一个小的 ↹ 提示）。Tab 把它填进框里（光标到末尾，不发送）；打字、Esc 让它这一轮不再显示。手机上：灰字下方一个「用这句」小按钮（手机没有 Tab）。
- **设置**：设置 → 对话显示 加开关「下一句提示」（`ui.promptSuggestions`，默认开）；改了对**新开的** query 生效（在 hint 里写明）。

## 3. 查看模式（Ctrl+O）

整个对话的详略一键切换，三档：

| 档 | 回合 | 思考 | 工具步骤 |
| --- | --- | --- | --- |
| 普通（默认，现状） | 完成的回合折叠成摘要行 | 跟随「显示思考过程」设置 | 折叠，点开看 |
| 详细 | 全部展开 | 展开 | 全部展开（输出也展开） |
| 精简 | 只显示你的消息和每轮最后的回答 | 隐藏 | 隐藏（回合摘要行保留，点开仍能看） |

- 设置项 `ui.viewMode: 'normal' | 'verbose' | 'summary'`（meta.json，不用 localStorage）；**全局一个**，不分对话（官方也是）。
- `Ctrl+O` 循环三档，切换时一个 toast「查看：详细」；对话头的 `···` 菜单里也有这三档（单选）。
- 实现：`ChatView` 读 `viewMode` 作为默认展开状态的输入（回合折叠、`Thinking` 的 `pref`、工具卡的初始开合）；用户手动点开 / 折叠的单个回合仍以手动为准，直到切换档位（切换时清掉手动状态）。精简档隐藏的东西不卸载数据，只是不渲染。
- 普通档的行为必须和现在**完全一样**（现有测试和 ui-smoke 不该变）。

## 4. @ 文件补全

- 输入框里打 `@` 后跟字（在行首或空白之后），弹出项目里的文件候选（同斜杠补全的弹层和键盘规则：↑↓ 选，Tab / Enter 填，Esc 关）。填进去的是 `@相对路径 `（带一个空格）。Claude Code 自己会处理 prompt 里的 `@路径`。
- **服务端**：新请求 `{ kind: 'fs.findFiles'; root: string; query: string; limit?: number }` → `{ files: string[] }`（相对路径，`/` 分隔）。
  - 是 git 仓库：`git ls-files --cached --others --exclude-standard`（尊重 .gitignore），结果按 root 缓存，root 下有文件增删（已有的 chokidar / `watchTree` 能告诉就用，不能就 10 秒过期）后失效。
  - 不是 git 仓库：广度优先遍历，跳过 `node_modules`、`.git`、`dist` 等常见目录，最多 20 000 个。
  - 匹配：文件名包含优先于路径包含，再按路径短的在前；子序列模糊匹配（`cmpsr` 能找到 `Composer.tsx`）。
  - 安全：`root` 必须是已知的项目目录或某个对话的 cwd（和 `fs.list` 一样的校验）；spawn 带 `windowsHide: true`。
- 远端（联邦）对话：`fs.findFiles` 不走联邦，弹层不出现（这一期不做）。

## 5. 快捷键

加到 `features/workbench/shortcuts.ts` 的表里（速查自动有），**不抢已有的键**：

| 功能 | 键 | 说明 |
| --- | --- | --- |
| 旁聊 | `Ctrl+;` | 官方同键 |
| 查看模式 | `Ctrl+O` | 官方同键；桌面版菜单里没有占用 |
| 模型菜单 | `Ctrl+Shift+I`（只在 Electron 的打包版里且该键不是开发者工具时；否则 `Alt+M`） | 官方同键；先查 `desktop/src` 有没有给开发者工具绑它 |
| 思考强度菜单 | `Ctrl+Shift+E` | 官方同键 |
| 权限模式循环 | `Shift+Tab`（只在输入框里、框为空时） | 和 CLI 一样；框里有字时 Shift+Tab 照常是焦点后退 |

官方的 `Ctrl+Shift+M`（权限）和 `Ctrl+Shift+D`（diff）在我们这里已是「总览」和「向下分屏」，不改。实施时用 `matchBrowserKey` 的测试覆盖新键，并核对 `desktop/src/main.ts` 的菜单加速键表（注释说两边镜像）。

## 6. 桌面版的语音

Electron 里 Web Speech 连不上识别服务。处理：

- 先实测：桌面版里按麦克风，看 `onerror` 的 `error`。如果确实是 `network` / `not-allowed` 且无法修，**桌面版不显示麦克风按钮**（`speechOk` 加上「不是 Electron」），浏览器里照旧。
- 不引入本地语音识别模型（太大），留到以后。

## 测试

- reducer：`prompt_suggestion` 不进树、存 / 清的时机（`conversation.test.ts`）。
- `fs.findFiles`：git 仓库 / 非 git、忽略规则、模糊匹配排序、root 校验（server 单测，临时目录）。
- `session.side`：runner 有 / 无活 query、非 Claude 引擎报不支持（server 单测用假的 Query 对象）；联邦路由表测试（已有的那份会因为新 kind 没登记而失败——先让它失败再登记）。
- 快捷键：`matchBrowserKey` 新键；输入框 Shift+Tab 只在框空时生效。
- 查看模式：三档下回合 / 思考 / 工具卡的开合（组件测试或 ui-smoke 段）；普通档 ui-smoke 原有断言不变。
- ui-smoke 加段：`/btw` 打开旁聊卡（用假引擎时回答走 stub）、Ctrl+O 循环并检查精简档里没有工具行、`@` 弹层出现并填入。
- 真机：真引擎（ccb fork 和官方二进制各一次，临时 HOME）问一次旁聊，确认回答出来且 jsonl 里没有这条；跑两轮确认出现下一句提示。
- 文案：`node scripts/i18n/extract.mjs --check`、`wording.test.ts`。

## 不做

- 旁聊的历史保存、旁聊里调工具（官方旁聊也不调工具）。
- 联邦对话的 @ 补全。
- 本地语音识别。
