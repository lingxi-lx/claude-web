---
name: ascii-theme
description: 用一句描述做一套 Claude Web 的字符画（ASCII）主题：配色、会动的字符画背景、16 个过程的字符动画、界面装饰。用户说「做一个主题」「换个风格」「/ascii-theme …」时用。
---

# 做一套字符画主题

用户描述一种气质（「深海里的水母」「赛博朋克夜市」「宣纸上的水墨」），你做出一整套主题，用 `theme_draft` 提交，看试跑结果改到满意，再 `theme_save`、`theme_apply`。

先调一次 `theme_guide`：它给你可用的颜色名、16 个过程、以及一套内置主题的完整源码当范例。照着范例的结构写，别从零猜格式。

## 一套主题 = 三个文件

### 1. theme.json

```json
{
  "id": "night-market",                       // 小写字母、数字、连字符，≤ 32
  "name": { "zh": "夜市", "en": "Night Market" },
  "mode": "dark",                              // dark 或 light：决定整个界面按深色还是浅色的规矩走
  "colors": { … 见下 … },
  "chatDim": { "opacity": 0.14, "speed": 0.33 },  // 对话页背后的淡背景：透明度（0–0.5）和速度（相对欢迎页）
  "processes": { … 16 个过程的帧表 … }
}
```

**colors**（全部写 `#rrggbb`）：

| 名字 | 是什么 |
|---|---|
| `bg` | 主面板（对话、卡片）的底 |
| `bg-1` | 外壳和侧栏的底（暗色主题比 bg 更暗一点） |
| `bg-2` `bg-3` | 嵌进去的块（代码、悬停、标签），一级比一级深 / 浅 |
| `bg-elev` | 浮起来的东西（菜单、输入框） |
| `line` `line-1` | 分隔线，弱 / 强 |
| `fg` | 正文 |
| `fg-1` `fg-2` | 次要文字，依次变淡 |
| `fg-3` | 最淡的辅助文字（占位符、时间） |
| `accent` | 主题的标志色（光点、选中、动画） |
| `accent-text` | 用作文字的标志色（链接、焦点环） |
| `accent-fg` | 标志色色块上的文字 |
| `primary` `primary-fg` | 主按钮（发送键）的底和字 |
| `user-bg` | 用户消息气泡的底 |
| `green` `red` `yellow` `blue` | 成功 / 失败 / 需要你 / 信息 |
| `agent-1` … `agent-10` | 十个子代理的颜色，互不相同 |

可选：`shade`（投影颜色，`"0, 0, 0"` 这样的 RGB 三元组）、`shade-a`（投影强度，暗色 2–3，亮色 1）、`e1` `e2` `e3`（描边强度，如 `"7%"`）。

**对比度必须达标**（`theme_draft` 会算，不达标会报出来）：在 `bg`、`bg-1`、`bg-2`、`bg-elev` 每一个上——
`fg` ≥ 7:1；`fg-1` `fg-2` `green` `red` `yellow` `blue` `accent-text` ≥ 4.5:1；`fg-3` ≥ 3:1。
还有：`fg` 在 `user-bg` 上 ≥ 7；`accent-fg` 在 `accent` 上 ≥ 4.5；`primary-fg` 在 `primary` 上 ≥ 4.5；
`fg-1` 比 `fg-2` 醒目、`fg-2` 比 `fg-3` 醒目；十个 `agent-n` 在 `bg` 和 `bg-1` 上都 ≥ 3:1。
做法：先定底色和 `fg`，再把其余文字色往 `fg` 方向推，直到够数。风格靠背景、装饰和 `accent`，不靠把字调暗。

### 2. processes：16 个过程的字符动画

| 过程 | 什么时候 | 例子（要贴着主题的气质画） |
|---|---|---|
| `start` | 刚发出去，等第一个字 | 墨水瓶冒泡、拨号 |
| `think` | 思考 | 月相变化、触须发光、灯泡忽明忽暗 |
| `read` | 读文件 | 书翻页、字浮起来 |
| `search` | 在代码里搜 | 放大镜扫过一行、声呐圈 |
| `edit` | 改文件 | 笔写字、毛笔落印 |
| `cmd` | 跑命令 | 光标打字、打字机 |
| `test` | 跑测试 | 一排格子依次打勾、花苞依次开 |
| `git` | git | 封信盖章、提交节点连成线 |
| `install` | 装依赖 | 箱子落下摞好、种子落地 |
| `web` | 联网 | 纸飞机、电报、声波 |
| `agent` | 子代理 / 并行 | 一个分成几个 |
| `plan` | 列计划 | 清单一行行写出来 |
| `tool` | 其它工具 | 齿轮 |
| `wait` | 等用户确认 | 敲门、沙漏、印章悬着 |
| `compact` | 压缩上下文 | 一摞纸压成一张 |
| `connect` | 断线重连 | 两端拉起一根线 |

每个过程一张帧表：

```json
"edit": {
  "fps": 6,
  "loop": [["✎      ", "───────"], ["d✎     ", "───────"], ["de✎    ", "───────"]],
  "done": [["dear ✓ ", "───────"]],
  "fail": [["de ✗   ", "───────"]],
  "color": { "✎": "accent", "✓": "green", "✗": "red" },
  "inline": { "fps": 4, "loop": ["✎", "✐"], "done": ["✓"], "fail": ["✗"] }
}
```

- `loop` 循环播放；过程结束时播一遍 `done`（失败播 `fail`），停在最后一帧，再换回步骤自己的图标。`done` / `fail` 可以省。好的结尾是「动画变成结果」：笔写完变成 ✓，不是突然消失。
- 一帧 = 1 到 2 行字符串。**同一个过程里每一帧每一行一样宽**（用空格补齐），最宽 14 格；中文、全角字符占 2 格。
- `inline`：步骤行开头的小号版本，1 行，每帧最多 3 格（最好 1 格）。
- `color`：某个字符 → 颜色名。颜色名只能用：`accent` `accent-text` `green` `red` `yellow` `blue` `fg` `fg-1` `fg-2` `fg-3` `agent-1`…`agent-10`。没写的字符用 `accent-text`。
- `fps` 1–30。字符动画 4–8 帧每秒最好看。
- 16 个都要画。少了或格式错的会退回默认动画，`theme_draft` 会告诉你哪个错了。

### 3. backdrop.js：会动的背景

在一个独立线程里跑，画在一块画布上（OffscreenCanvas，Canvas 2D 或 WebGL 都行）。只能这样写：

```js
export default {
  init({ canvas, width, height, dpr, colors, scene, reduce }) {},  // 拿到画布；colors 是上面那些颜色（不带 --）
  frame({ t, dt, mouse, process, scene, speed, quiet }) {},        // 每帧调用，必须有
  event({ type, x, y, text }) {},   // type: 'click'（点了背景）/ 'type'（用户在输入框里新打的字）
  resize({ width, height, dpr }) {},
  theme({ colors }) {},             // 配色变了
  data(d) {},                       // 预留
};
```

- `t` 秒、`dt` 这一帧过了几秒（已经乘过 `speed`）；`mouse` 是 `{ x, y, down }` 或 `null`（画布坐标，CSS 像素）。
- `process`：当前对话在做什么（上面 16 个之一，或 `idle`）。让背景对它有反应：思考时变快 / 变亮，等用户时变慢。
- `scene`：`welcome`（新对话页，完整播放，30 帧）或 `chat`（对话后面，很淡很慢，15 帧）。chat 里把主角挪到角落、少画东西。
- `quiet`：页面上文字和按钮所在的矩形（`{x,y,w,h}` 数组）。在这些矩形里要画得很淡（比如透明度 × 0.2），不然字看不清。
- `reduce`：用户要求减少动态效果。为真时只会调用一次 `frame` 画一帧静止画面。
- 画布尺寸自己设：`canvas.width = width * dpr` 等，`ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`。
- `getContext('2d', { alpha: false })`，自己先铺底色。拖尾用「每帧盖一层半透明底色」，别用 `destination-out`。
- 字体只能用系统等宽字体：`ui-monospace, Consolas, monospace`。
- 不能 `import`，不能联网（fetch、WebSocket、import() 都被禁止，用了会报错），不能碰页面。
- **性能**：每帧要在几毫秒内画完。每帧超过 50 毫秒持续 2 秒、抛异常、或卡死，会被自动关掉换回默认背景。字符多时先把字符画到一张小图上再贴（`drawImage`），比每个字 `fillText` 快得多。
- 好背景的套路：一个**主角**（一条鱼、一个太阳、一颗星球）+ 一层**质地**（字符雨、网点、波纹）+ **互动**（鼠标拨动、点击荡开、打的字飘进来）+ **对过程有反应**。

### 4. theme.css（可选）

任意样式，全部写在 `html[data-ascii="<id>"]` 下面。常用的钩子：

| 选择器 / 变量 | 是什么 |
|---|---|
| `--r-xs` `--r-sm` `--r-row` `--r-md` `--r-lg` `--r-xl` `--r-bubble` `--r-composer` `--r-2xl` | 圆角（终端风全改成 0–3px） |
| `--display` | 大标题字体（欢迎语）；`--mono` 是等宽字体 |
| `.welcome .greet` / `.greet .spark` | 欢迎语 / 它前面的小图标 |
| `.welcome-tile` | 新对话页整页（可以加 `::after` 叠扫描线、纸纹） |
| `.composer-box` | 输入框（边框、投影、`::after` 加角标） |
| `.run-card` | 输入框上方的状态条 |
| `.tool-head` | 对话里每个步骤那一行 |
| `.chat-main` | 对话区域 |

不能引用任何外部资源：不能 `@import`，`url()` 只能是 `data:`，字符串里不能有网址。违反的话整份 CSS 不生效，`theme_draft` 会报出来。不要动布局（宽高、display、position），只改颜色、边框、圆角、字体、阴影和装饰。

## 流程

1. `theme_guide` 看格式和范例。
2. 想清楚：底色和主色、背景的主角、装饰的字符（`┌─┐`、`⌜ ⌝`、`░▒▓`……）、16 个过程各自的小故事。
3. `theme_draft` 提交（json、backdrop、css 三样）。它会返回：格式 / 对比度 / CSS 的问题清单，以及（界面开着时）一张试跑截图——背景跑了 3 秒的样子加 16 个过程的动画格——和每帧耗时。
4. 看截图改：看不清的字、太满的背景、太慢的帧、宽度不齐的动画。一般两三轮。
5. 用户满意了：`theme_save` 转正，`theme_apply` 换上。改已有主题：`theme_get` 读出来再 `theme_draft`。

用户界面里叫「主题」「字符画主题」；跟用户说话别提文件名和工具名，说「我做好了第一版，你看看」。
