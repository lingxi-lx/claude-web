# 质感：发丝边 / 弹簧动效 / 滚动渐隐 / 字重与圆角（2026-10-16）

## 背景

用户让参考 [Caho1/open-claude-ui](https://github.com/Caho1/open-claude-ui)（MIT）把 claude-web 做得更好。看过之后的结论：

- 它是约 30 个独立的 React 示例组件 + 十来篇「逆向手册」，没有应用本体；组件依赖 Tailwind 和 framer-motion，不少是演示用的假状态机（例如 `McpToolDecisionCard` 用 `setTimeout` 模拟执行成功）。
- 文档自称从官方 Claude Desktop 包里逆向，但代码里没有可核实的提取物，是按观感重写的近似实现；第 9 篇（Desktop 2.0）的叙述无法核实，只当参考。
- 我们的令牌体系（`web/src/tokens.css`：语义层、六套主题、对比度测试）比它完整，配色不动。可借的是**质感**：发丝边、暗色内高光环、弹簧曲线、滚动边缘渐隐、暗色字重补偿、几个圆角数值。
- 只借思路、按我们的令牌自己实现，不引 Tailwind / framer-motion，不碰官方安装包里的任何专有代码或资源。

## 路线图（四期，各自 spec → plan → 实施）

1. **质感**（本篇）。
2. **交互细节**：流式钉底（150ms 冷却防抢）、分栏拖拽死区 / 双击吸附、图片灯箱以光标为中心缩放、429/503 退避重试。
3. **Desktop 2.0 功能**：侧栏按状态 / 日期 / 环境分组、对话弹出新窗口、发送失败本地留存 + 重试、长对话章节标记。
4. **Agents 协作界面**：参考 Cowork 看板，改进编排 / 后台的展示与交互。

## 约束

- **不改任何主题的颜色原语**（`--bg*`、`--fg*`、`--accent*`、状态色、`--agent-*`）。`ui/contrast.test.ts` 必须照旧通过。
- 改动集中在 `tokens.css` 的派生块和少量消费处；组件继续用已有的令牌名（`--elev-*`、`--edge-*`、`--r-*`、`--dur-*`、`--ease-*`）。
- 目标环境是桌面版（Electron 44 / Chromium 152，exe 和 dmg 用户最多）；手机浏览器不支持的特性一律 `@supports` 退化为「没有效果」，不能出错。
- 「减少动画」/ 系统减少动态效果下照旧什么都不动（现有规则不变）。
- 动效只动 `transform` / `opacity` / 颜色（`ui-refresh` 笔记的规矩）。
- 导出对话（`model/export.ts`）内联 tokens + styles + chat + composer + floating：新令牌要在这几份里自洽，不依赖别的文件。

## 1. 边线与阴影

### 1.1 发丝边 `--hairline`

```css
:root { --hairline: 1px; }
@media (resolution >= 2x) { :root { --hairline: 0.5px; } }
```

- `--elev-1/2/3`、`--elev-composer` 里的环从 `0 0 0 1px …` 改成 `0 0 0 var(--hairline) …`。
- 用 `--edge-*` 画的 1px 分隔线 / 输入框边框（`border: 1px solid var(--edge-…)`、`box-shadow: inset 0 0 0 1px var(--edge-…)`）改用 `var(--hairline)`。只改用到 `--edge-*` 的那些；虚线框、焦点环、选中描边不改。
- **补偿**：0.5px 的线在同样的透明度下看着太淡。2x 时把边线强度乘约 1.4：每套主题的 `--e1/--e2/--e3` 不动，派生块里加 `--e-k: 1`（2x 时 `1.4`），`--edge-*` 改成 `color-mix(in oklab, var(--fg) calc(var(--e1) * var(--e-k)), transparent)`。（实现时先确认 `color-mix` 的百分比里能用 `calc()`；不行就在 2x 的媒体查询里直接重写三条 `--edge-*`。）

### 1.2 环 `--ring`（暗色内高光）

- 新令牌 `--ring-1 / --ring-2`（附着 / 浮起两档），`--elev-*` 的第一段改成引用它们。
- 浅色主题（light、paper）：`--ring-n` = 外环 `0 0 0 var(--hairline) var(--edge-subtle | --edge-default)`（等于现状）。
- 暗色主题（默认块、dracula、nord、tokyo-night）：`--ring-n` = 内高光 `inset 0 0 0 var(--hairline) color-mix(in oklab, white 7% | 10%, transparent)` + 外环 `0 0 0 var(--hairline) rgba(0,0,0,0.45)`。
- 暗色的覆盖写在一个选择器里：`:root:not([data-theme='light']):not([data-theme='paper'])`，新加的浅色主题要加进排除列表（在 tokens.css 顶部注释写明）。
- **已知风险**：内高光会被贴边的子元素背景盖住（菜单项 hover 填充、代码块头、卡片里的整宽条）。逐个检查 `.menu`、`.cmdk`、`.modal`、`.pdock`、`.composer-box`、`.fcard`、`.tool`、右侧面板；被盖住的给容器加 `padding` 或让子元素圆角内缩，不行就那一处退回外环。

### 1.3 浮层的双层阴影

`--elev-2` 在现有两层漫射阴影前加一层短的接触阴影 `0 1px 2px rgba(var(--shade), calc(0.06 * var(--shade-a)))`，菜单 / 弹窗边缘更「贴」。`--elev-3` 同理（`0 1px 3px`，0.07）。这是起始值，截图对比后可微调，以 tokens.css 为准。

## 2. 动效手感：弹簧曲线

### 2.1 生成脚本

`scripts/gen-springs.mjs`：输入 `(stiffness, damping, mass)`，按阻尼谐振子解析解采样到落定（位移误差 < 0.001 且速度足够小），输出：

- `linear(...)` 字符串（采样点 ≤ 40 个，按曲率自适应取点，坐标保留 3 位小数）；
- 落定时间（毫秒，取整到 10）。

结果写进 `web/src/tokens.css` 派生块里一段用注释围起来的区域（`/* springs:begin */ … /* springs:end */`），脚本只替换这一段。`--check` 参数：生成结果和文件里不一致就非零退出（和 `scripts/i18n/extract.mjs --check` 一样的用法）。

三档：

| 令牌 | 用在 | 参数 (k, c, m) | 特征 |
| --- | --- | --- | --- |
| `--spring-bouncy` / `--spring-bouncy-dur` | 开关、分段控件滑块、发送键图标 | 600, 30, 1 | 超调约 9%，约 220ms 落定 |
| `--spring-snappy` / `--spring-snappy-dur` | 菜单 / 弹窗 / 卡片弹出、步骤 pop | 320, 28, 1 | 超调约 2% |
| `--spring-gentle` / `--spring-gentle-dur` | 右侧面板、抽屉、操作单 | 200, 30, 1 | 无超调 |

参数是起点；实施时以截图 / 录屏对比为准微调，最终值以脚本里的表为准。

### 2.2 替换

- `--ease-pop` 改成 `var(--spring-snappy)` 的别名（现有用处：`step-pop`、发送键图标、toast 进场），持续时间相应换成 `--spring-snappy-dur`。
- 开关 `.toggle::after`、`ui/Segmented.tsx` 的滑块、发送键：`transition-timing-function` 用 `--spring-bouncy`。
- 菜单 / 弹窗进场（`floating.css` 里的进场 keyframes）用 `--spring-snappy`；右侧面板滑入、手机抽屉 / 操作单落位用 `--spring-gentle`（手机抽屉跟手拖动时不用曲线，只有松手落位那段）。
- `--ease-sheet` 保留给退场。
- **按下反馈**：按钮类（`button`、`.icon-btn`、`.chip`、`.send` 等，按现有 `:active` 规则逐个对）统一 `:active { transform: scale(0.98) }`，过渡用 `--dur-instant`；已有自己按下效果的（发送键）不重复加。

### 2.3 不支持 `linear()` 时

`linear()` 不支持时整条 `transition` / `animation` 声明会被丢掉。令牌写成：先声明 cubic-bezier 退路，再在 `@supports (transition-timing-function: linear(0, 1))` 里覆盖成弹簧。

## 3. 滚动边缘渐隐 `.scroll-fade`

示意（尖括号处的停点见下面第二条）：

```css
@property --fade-t { syntax: '<length>'; inherits: false; initial-value: 0px; }
@property --fade-b { syntax: '<length>'; inherits: false; initial-value: 0px; }
@supports (animation-timeline: scroll()) {
  .scroll-fade {
    --fade: 24px;
    mask-image: linear-gradient(to bottom, <从 0 到 --fade-t 的约 7 个非线性 alpha 停点>, black …, <到底部 --fade-b 的对称停点>);
    animation: fade-t linear both, fade-b linear both;
    animation-timeline: scroll(self), scroll(self);
    animation-range: 0 var(--fade), calc(100% - var(--fade)) 100%;
  }
}
```

- 在顶部时上沿不渐隐、往下滚出 `--fade` 后上沿渐隐到满；离底部 `--fade` 以内下沿渐隐逐渐消失。内容不够滚时两边都不渐隐。
- 渐变用约 7 个停点的缓出 alpha（0 → 0.03 → 0.1 → 0.25 → 0.5 → 0.78 → 1 这类），不是一条硬线。
- `animation-range` 用长度还是百分比、两条动画分别作用于两个属性：实施时先写一个最小页面在 Electron 44 里验证，不行退到「顶 / 底各一个 scroll() 动画 + `animation-range: 0% 5%` / `95% 100%`」。
- **用在**：`.chat`、`.welcome`、`.sb-list`、`.sb-attn-list`、`.menu`（可滚的那些：`.sess-menu`、`.sb-menu`、`.tab-add-menu`）、`.cmdk .list`、`.dirmenu-list`、`.branch-menu .list`、`.ft-body`、`.git-body`、`.rv-git-body`、`.search-results`、`.memory-list`。横向的 `.dock-tablist` 已有自己的渐隐，不动。
- `.chat` 的下沿渐隐不能盖住紧贴输入框的最后一行太多：`.chat` 用更短的 `--fade: 16px`。
- **已知副作用**：遮罩也会让滚动条两端淡出，接受。
- 加类名优先直接在 CSS 里给这些选择器套用（`.chat, .sb-list, … { … }`），不改组件 JSX。

## 4. 文字与圆角

### 4.1 暗色字重补偿（只拉丁字母和数字）

暗色下浅字压在深底上看着发胖。做法：再声明一份 Inter：

```css
@font-face { font-family: 'Inter Dark'; src: <同一个 Inter Variable 文件>; font-weight: 350 380; }
@font-face { font-family: 'Inter Dark'; src: <同一个文件>; font-weight: 501 900; }
```

暗色主题把 `--font` 开头的 `'Inter Variable'` 换成 `'Inter Dark'`。CSS Fonts 4 的匹配规则：请求 400 时先在 400–500 里往上找，**所以第二份必须从 501 起**（写成 500 会被先选中），找不到再往下找到第一份并夹到 380；请求 600 往上找落到第二份。**中文字体的请求字重仍是 400**，微软雅黑不会落到 Light（这就是不直接把 `--fw-regular` 改成 380 的原因）。

- 源文件路径照 `web/src/fonts.css` 里 fontsource 的写法（实施时读它，unicode-range 也照抄）。
- `--mono` 不动。
- 验证：暗色下 `getComputedStyle` 不够，截图对比正文 / 粗体；Windows 上确认中文没变细。

### 4.2 行内图标光学居中

文字行内的 `<Icon>`（在段落、chip、菜单项文字里的）`vertical-align: -0.125em`。flex 容器里的图标不受 `vertical-align` 影响，不用逐个排除；只给 `.icon` 加这一条后截图检查有没有挪位的。

### 4.3 圆角

- `--r-bubble: 20px → 18px`（用户气泡；toast 也用它，36px 高时 18 仍是整圆）。更新 `floating.css` 那段说「radius is 20px」的注释。
- 新增 `--r-composer: 20px`，`composer.css` 的 `.composer-box` / `.cb` 外框和 `styles.css` 里旧的 `.composer-box` 规则用它（`corners.css` 的超椭圆跟着 `border-radius` 走，不用改）。
- 权限卡 `.pdock`、对话框 `.modal`、手机抽屉顶边仍用 `--r-2xl: 24px`。

## 5. 测试与验证

- `scripts/gen-springs.mjs` 的单元测试（放 `web/src/ui/springs.test.ts`，把求解函数抽到 `web/src/ui/springs.ts` 供脚本和测试共用）：曲线以 0 开始、以 1 结束；bouncy 的最大值在 1.07–1.11；gentle 不超过 1.0005；落定时间在预期区间；`--check` 对当前 tokens.css 通过。
- `ui/contrast.test.ts`、`store/selectors.test.ts`、`wording.test.ts` 等现有测试全过：`npm run typecheck`、`npm test`（`env -u` 掉本机继承的那几个环境变量）、`npm run build:all`。
- `node scripts/ui-smoke.cjs` 无 console 错误；原有的位置断言（审批卡、菜单数）不因动效时长变化而失败——弹簧落定时间比现在长的地方，相应等待要够。
- **截图对比**：Electron 里六套主题 × 1x / 2x（`deviceScaleFactor`）× 首页、对话（含代码块、工具卡、改动卡、审批卡）、打开的模型菜单、命令面板、右侧面板文件页、设置页，改前改后各一组，存在临时目录给用户看，不进仓库。
- 滚动渐隐：对话滚到顶 / 中间 / 底各截一张；内容不够滚的菜单确认没有渐隐。
- 导出对话：导出一份 HTML，在浏览器打开确认样式正常。

## 6. 文档

- `docs/notes/ui-refresh.md` 加一节「质感（2026-10-16）」：新令牌、弹簧脚本用法、`.scroll-fade` 套用规则、暗色字体别名、暗色主题选择器的排除列表。
- `CLAUDE.md` 索引里 ui-refresh 那一行的内容列补「发丝边、弹簧、滚动渐隐」。

## 不做

- 不改配色、不加主题、不引 Tailwind / framer-motion。
- 不改组件结构和交互行为（那是第 2 期）。
- 不做 Web Audio 提示音、语音、着色器光效。
