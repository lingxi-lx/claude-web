# 对话与输入：旁聊 / 下一句提示 / 查看模式 / @文件 / 快捷键（2026-10-16）

五期「赶上官方桌面版」路线的第 2 期。spec：`docs/superpowers/specs/2026-10-16-chat-input-design.md`。
功能来源只用官方公开文档（code.claude.com/docs 的 `.md` 才抓得到正文）和用户截图，不逆向官方安装包。

## 盘点时发现已经有的

钉底（`ChatView` 的 `stick`）、图片灯箱（`ImageViewer.tsx`）、429 / 过载重试的显示（reducer 的 `api_retry`）、
快捷键速查（F1 / ?）。别再当成缺的功能重做。

## 旁聊（/btw、Ctrl+;）

- 引擎能力：SDK 的 `Query.askSideQuestion(question, { history })`——**类型声明里没有，实现里有**，发
  `side_question` 控制请求。CLI 要的 history 是 `{ question, response }[]`（引擎报错原文：「history an array of
  {question, response} strings」）。回 `{ response, synthetic }`，`null` 表示没答。
- 真引擎实测（官方二进制，haiku，2026-10-16）：先说「我喜欢 teal」，旁聊问「我喜欢什么颜色」答「Teal.」；
  带 history 再问「我刚才问了什么」答对；**jsonl 里没有旁聊的任何字**。ccb fork 没测。
- 服务端 `session.side` → `SessionRunner.askSide`；没有 runner 回 `{ error: 'not-open' }`，前端
  （`features/chat/side-chat.ts`）照发送的路子 `openSession(resumeParams)` 再问一次；Codex / ACP 等回
  `{ error: 'unsupported' }`。进了联邦路由表。
- 前端状态是独立的小 zustand（`useSideChat`），只在内存里，关了就没；「放进对话」把最后一问一答引用成草稿。
- `/btw` 是我们自己加进斜杠补全的本地命令，发送时在 `doSend` 里截住（引擎列表里若也有 btw 就去重）。

## 下一句提示

- `Options.promptSuggestions: true` **单独不够**：官方二进制两轮对话后一条都没来；加上 CLI 自己的开关
  `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=1` 才来（「create the project structure」）。runner 两个都设
  （设置 `ui.promptSuggestions`，默认开，`setPromptSuggestions` 由 hub / index 推下去，新开的 query 生效）。
- 引擎还有自己的闸：GrowthBook 开关、非交互、计划模式、额度快满、没东西可提示时都不发——不来不是 bug。
- reducer：`prompt_suggestion` 不进消息树，存 `conv.suggestion`；新用户消息（含别的窗口的回显）、本窗口发送、
  `conversation_reset` 清掉。输入框为空且不在跑、没有停靠卡、没附件时当灰色占位，Tab 采用、Esc 这一条不再显示；
  手机是框上方一个「用这句」。

## 查看模式（Ctrl+O）

- `ui.viewMode`：normal / verbose / summary，全局一个。纯函数在 `features/chat/view-mode.ts`（别在里面 import
  store：node 测试里 store 会碰 `location`）。
- ChatView：详细 = 折叠的回合默认展开、步骤默认展开、思考展开；精简 = 思考隐藏、回合下只留最后一条回答。
  `TurnList` 的 key 带上档位：换档整份重画，手动开合的状态归零。普通档和以前完全一样。
- 对话头 `···` 里一项循环切换（只加一项：ui-smoke 数菜单项）。

## @ 文件补全

- `fs.findFiles { root, query }` → `server/src/files/find.ts`：git 仓库用 `git ls-files --cached --others
  --exclude-standard -z`，不是仓库就广度优先遍历（跳过 node_modules / .git / dist 等，最多 2 万），每个 root 缓存
  10 秒。排序：名字开头 > 名字包含 > 路径包含 > 名字按序含这些字母 > 路径按序含。
- 输入框：`at-mention.ts` 找光标前的 `@词`（行首或空白后，邮箱不算），弹层复用 `.palette`；Tab / Enter 填
  `@路径 `，有空格的路径加引号。联邦（别的机器上的）对话不弹。

## 快捷键

| 键 | 做什么 | 备注 |
| --- | --- | --- |
| Ctrl+O | 查看模式 | 官方同键 |
| Ctrl+; | 旁聊 | 官方同键；按物理键（`Semicolon`）也认，别的键盘布局 |
| Alt+M | 模型菜单 | 官方是 Ctrl+Shift+I，但那是 Electron 菜单和浏览器的开发者工具 |
| Ctrl+Shift+E | 思考强度菜单 | 官方同键 |
| Shift+Tab | 下一个权限模式 | 只在输入框为空时；跳过危险模式（`nextPermissionMode` 在 `ui/terms.ts`） |

官方的 Ctrl+Shift+M / Ctrl+Shift+D 在我们这里是「总览」「向下分屏」，没改。桌面版里 Ctrl 组合键默认归菜单
加速键，新的 Ctrl 键要加进 `App.tsx` 那份白名单；新命令要在 `cover-commands.ts` 决定被设置页盖住时怎么办
（`cover-commands.test.ts` 会拦）。菜单两键是在聚焦分屏里点对应的 chip。

## 桌面版没有麦克风

Electron 44 有 `webkitSpeechRecognition`，但连不上识别服务：麦克风权限给了，`start()` 后 `onerror` 是
`network`（2026-10-16 实测）。桌面版不显示麦克风按钮，浏览器里照旧。

## 选中文字就出的菜单（2026-10-20，用户：「不想右键」）

照 VS Code 里 Claude 面板的样子：在对话里选中文字，松开鼠标（或 Shift+方向键选完）就在选区末端旁出一个小菜单——
复制（Ctrl+C）· 复制代码块（选区在代码块里）· 复制整条消息 / 复制为 Markdown（用户消息只有一行）· 引用到输入框（Ctrl+Shift+L）·
钉住这条回复（回复才有）· 从这里分叉（「新开一个对话，这个保留」；用户消息是从它之前分叉）。

- 组件 `web/src/features/chat/SelectionMenu.tsx`，ChatView 里每个对话挂一个；哪些行、放哪儿是纯函数 `selection-menu.ts`（有测试）。
  外层只听选区（`.chat` 上的 pointerdown + document 的 mouseup / keyup / keydown / selectionchange），菜单本身每次出现才挂
  （`key` 递增），所以 `useMenuMotion` 每次都能判断是鼠标还是键盘打开的；开着时走 `useDropdown`（别处按下 / Esc 关、同时只有一个菜单）。
- **只认这个对话转录里的选区**：`commonAncestor` 在 `.chat-inner` 里；输入框 / 编辑中的消息 / Monaco / xterm / 旁聊不算；
  按下必须是从这个 `.chat` 开始的（否则选区留着时点侧栏任何按钮都会再弹一次）。触摸 / 笔不弹（系统有自己的）。
- 不抢焦点（还要能接着 Shift+方向键扩选区）；开着时按 Tab 进菜单，之后 ↑ ↓ Home End / 数字和 composer 的菜单一样（`menuKey`）。
  菜单上的 mousedown `preventDefault`，选区不丢。滚动、窗口缩放、选区收起都关。Ctrl+Shift+L 桌面版菜单没占，不用进白名单。
- 复用：引用走 `quote.ts` 的 `quoteInComposer`（进当前聚焦分屏的输入框，和右键那条一样）；钉住 / 分叉 / 回复的 Markdown 是
  `MessageActions.tsx` 导出的 `togglePin` / `forkFrom` / `replyMarkdown`；代码块的全文由 `CodeBlock.tsx` 的 `codeOf(el)`
  （WeakMap：`.code` 根元素 → 代码）给；「复制整条消息」的纯文字取 `.msg.assistant > .msg-text` 的 innerText。
- 用户说的「钉住为章节」：我们没有章节，用的是现成的「钉住」（信息栏「钉住的回复」），字照实写。桌面版右键菜单不变。
- ui-smoke 段 `selection-menu`：用 Range 选中种子回复的 `ok`，派 pointerdown + mouseup，点 引用到输入框，查输入框是 `> ok`。

## 坑

- 用 `node -e` 往测试里写带 `'` 的字符串，转义经常坏成 `'CLI's'`，vitest 报「no tests」+ PARSE_ERROR——改用 Edit。
- i18n：`extract.mjs <dir>` 出的 `todo-NN.json` 是数组，`done-NN.json` 要按同样顺序写**字符串数组**，不是对象。
