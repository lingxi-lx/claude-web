# 官网（三）：主题放映厅与录制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在官网首页的章节之后加一段「主题放映厅」：10 套内置字符画主题 + 「描述一个新的」共 11 段真实应用录像，访客切换（同一秒接着放、圆形揭开）、拖动、跳标记、对比、暂停、`?theme=` 深链接；再做一个从真实应用录出这 11 × 2 段录像的脚本，录像放在 GitHub pre-release `site-media`，构建时下载校验。

**Architecture:** 放映厅是 `site/src/showcase/` 下的一个 Astro 组件（构建时把配色、帧表、文案写进页面）+ 一个懒加载的纯 TS 播放器（`player.ts`，进视口前一屏才 `import()`）。主题数据直接读产品的 `web/src/themes/builtin/*/theme.json`，经 `@themes`（`server/src/themes/core`）的 `parsePack` / `paletteCss` / `animFor` 和 `@web-themes`（`web/src/themes`）的 `render.ts` / `ticker.ts`。录像不进仓库：`site/media.json`（文件名 → sha256 / 字节数）进仓库，`site/scripts/fetch-media.ts` 在 `astro build` 之后下载到 `site/dist/themes/`。录制脚本 `scripts/record-themes.cjs` 基于 `scripts/lib/demo.cjs`（临时 HOME + 假上游），离屏 Electron 逐帧录，ffmpeg 按时间戳重采样成恒定 30 fps。

**Tech Stack:** Astro 7.4.1、Vitest 4、TypeScript 7、Node 22.22（类型擦除直接跑 `.ts`）、Electron 44（根 `node_modules/electron`）、ffmpeg 8.1（本机有 `libaom-av1`、`libvpx-vp9`、`libx264`、`libwebp`，**没有** `libsvtav1`）、`gh` CLI。

设计文档：`docs/superpowers/specs/2026-10-21-website-design.md` §1、§2、§5.1、§5.2、§7、§9。第一份计划：`docs/superpowers/plans/2026-10-22-site-1-skeleton.md`；第二份（首屏网吧 + 视觉改版）：`docs/superpowers/plans/2026-10-22-site-2-hero.md`，先于本计划执行。
与设计文档的出入（已定）：`fetch-media` 是 `.ts`（Node 类型擦除）不是 `.mjs`；本机 ffmpeg 没有 `libsvtav1`，AV1 用 `libaom-av1`，都没有时用 VP9（`media.json` 的 `webmCodecs` 记下实际编码）；冒烟测试用 Electron 而不是 Playwright（仓库里现成的）。

## Global Constraints

- `site/` 是独立包：命令一律 `--prefix site`（`npm test --prefix site`、`npm run build --prefix site`），不用 `-w site`；根 `package.json` 的 `workspaces` 和根 `package-lock.json` 不改。`site/` 不加任何新依赖（`astro` 精确 `7.4.1`，不装 React / three / gsap / Playwright）。
- Node ≥ 22.22.0。仓库是 LF。文件只用 Write / Edit 写；不要用 bash heredoc、`node -e`、`sed -i` 生成或改文件（反引号、反斜杠会被吃掉）。
- 用户看得见的字都是 `site/src/copy.ts` 里的 `tr('中文')`，英文写进 `site/src/i18n/en.ts`（`EN_SITE`）。中文 key 在产品英文表里已有的，英文必须一样：`主题` → `Theme`，`浅色` → `Light`，`深色` → `Dark`（不要用 `应用` 当 key：产品里它是 `App`）。`.astro` 文件里不能有中文（`site/src/i18n/text.test.ts`）。
- 用词：叫「对话」不叫「会话」；不出现 会话 / 档案 / 引擎 / 窗格 / 停靠 / ACP / effort / ultracode（英文也不出现 session）。
- 不用 localStorage（录制脚本里写产品的 `cw.lastCwd` 是在临时 HOME 的产品里，不算官网）。
- 每个首页（`dist/index.html`、`dist/zh/index.html`）首次加载 ≤ 1.5 MB（`site/scripts/budget.ts`）；放映厅的海报和录像**不算**，所以它们只能由脚本在运行时创建（HTML 里不能出现指向 `/themes/` 的 `<img>` / `<video poster>` / `<source>`）。
- 工作区里有用户没提交的 `server/` / `web/` 改动：只 `git add` 任务里点名的路径，绝不 `git add -A` / `git add .`，不还原别人的改动。提交身份 `ypyik0669`（已配好）。分支 `feat/site-2`（和第二份计划共用；不存在就 `git switch -c feat/site-2`）。
- 开发 shell 继承了会干扰的环境变量：跑 Electron（录制、冒烟）一律 `env -u ELECTRON_RUN_AS_NODE -u CLAUDE_WEB_DIST`；录制用临时 HOME / `CLAUDE_WEB_DIR`（`scripts/lib/demo.cjs` 自己建），绝不碰用户的 `~/.claude-web`。
- 子进程 spawn 显式写 `windowsHide: true`。
- **绝不构建产品本身**：不跑 `npm run build`、`npm run build:all`、`npm run build -w web`、`npm run build -w server`，也不在 `web/` 里 `vite build` 到默认目录——用户正在跑的开发版 Claude Web 直接用 `web/dist`（和 `server/dist`），重建会换掉带哈希的 chunk，正在用的窗口当场坏掉（2026-10-22 发生过：网吧面板 `Failed to fetch dynamically imported module …/Cafe-….js`）。官网自己的 `npm run build --prefix site` 只写 `site/dist`，可以跑。
  录制脚本需要构建好的前端：它把前端构建到**临时目录**（`npx vite build web --outDir <临时目录> --emptyOutDir`），服务端从源码跑（`node --import tsx server/src/index.ts`），并用 `CLAUDE_WEB_DIST=<临时目录>` 指过去（`server/src/index.ts` 第 174 行：`opts.distDir ?? process.env.CLAUDE_WEB_DIST ?? web/dist`）；`scripts/lib/demo.cjs` 的 `startServer` 原来会删掉 `CLAUDE_WEB_DIST` 并跑 `server/dist/index.js`，Task 6 给它加 `opts.dist` / `opts.fromSource`。
- 主题 id 和顺序（产品 `web/src/themes/builtin/index.ts` 的 `ORDER`）：`phosphor abyss koi moon dither orb garden paper letters ink`；亮色的是 `paper letters ink`。第 11 段 id 是 `describe`，配色用 fixture 主题 `metro`。
- 录像文件名：`<id>.<lang>.webm`、`<id>.<lang>.mp4`、`<id>.<lang>-sm.webm`、`<id>.<lang>-sm.mp4`、`<id>.<lang>.webp`（海报），`lang` ∈ `en zh`；共 11 × 2 × 5 = 110 个。

## 对第二份计划的假设

写这份计划时第二份计划的文件还不存在，本计划只依赖下面这些（第二份改了名字的，执行时按真实文件对上）：

- `site/src/layouts/Base.astro` 仍是所有页面的外壳；`site/src/views/Home.astro` 里仍有 `<section class="stats" …>`（数字那一段）。放映厅插在它**前面**，也就是章节（和第二份包住首屏 + 章节的钉住场景）结束之后。
- `site/src/components/Header.astro` 的导航里仍有「功能」链接（`href(base, locale, 'home', '#features')`）；「主题」加在它后面。
- `site/src/copy.ts` 仍是 `copy(locale)` 返回一个对象、里面有 `nav: { … features: tr('功能'), … }`；`site/src/i18n/en.ts` 仍是 `EN_SITE`。
- 第二份的 `site.css`、像素字体、WebGL 后处理都不碰；放映厅的样式全在新的 `site/src/styles/showcase.css`，只用 `tokens.css` 里的 `--fs-sm --fs-meta --fs-xl --mono --font`。
- 第二份如果已经给 `astro.config.mjs` / `vitest.config.ts` / `tsconfig.json` 加了别名（比如 `@cafe` `@characters`），本计划只**追加** `@themes` 和 `@web-themes`，不删别的。

## 文件一览

新建：

| 文件 | 职责 |
| --- | --- |
| `scripts/lib/fixtures/theme-metro/{theme.json,backdrop.js,theme.css}` | 「描述一个新的」那段里生成出来的主题（假上游把它当工具参数发出去） |
| `site/src/showcase/ids.ts` | 主题 id 表（不带 JSON，客户端也能引） |
| `site/src/showcase/themes.ts` | 构建时：读 11 个 theme.json，`parsePack` |
| `site/src/showcase/palette.ts` | 构建时：把配色限定在按钮 / 这一段上的 CSS |
| `site/src/showcase/glyph.ts` | 构建时：按钮上的小过程动画帧（HTML） |
| `site/src/showcase/clips.ts` | 片段表、时间标记、录像文件名、`expectedMediaFiles()` |
| `site/src/showcase/params.ts` | `?theme=` 解析与写回 |
| `site/src/showcase/input.ts` | 键盘、拖动、揭开半径的纯函数 |
| `site/src/showcase/data.ts` | 页面 → 播放器的数据类型 |
| `site/src/showcase/player.ts` | 浏览器端播放器 |
| `site/src/showcase/Showcase.astro` | 这一段的结构 |
| `site/src/styles/showcase.css` | 这一段的样式 |
| `site/media.json` | 录像清单 |
| `site/scripts/fetch-media.ts` | 构建时下载 / 校验录像 |
| `scripts/lib/media-encode.cjs` | ffmpeg：挑编码器、出 5 种文件、报大小 |
| `scripts/make-standin-clips.cjs` | 真录像出来之前的替身录像 |
| `scripts/upload-site-media.cjs` | 写 `media.json`、上传到 `site-media` |
| `scripts/site-showcase-smoke.cjs` | Electron 打开构建好的站点逐个切换 |
| `scripts/record-themes.cjs` | 录制脚本 |
| `scripts/lib/demo.test.cjs` | 假上游剧本的测试（`node --test`） |

测试：`site/src/showcase/{themes,clips,params,input,media}.test.ts`、`site/scripts/fetch-media.test.ts`、`scripts/lib/demo.test.cjs`、`scripts/site-showcase-smoke.cjs`。

修改：`site/astro.config.mjs`、`site/vitest.config.ts`、`site/tsconfig.json`、`site/package.json`、`site/.gitignore`、`site/src/copy.ts`、`site/src/i18n/en.ts`、`site/src/views/Home.astro`、`site/src/components/Header.astro`、`.github/workflows/site.yml`、`.github/workflows/ci.yml`、`scripts/lib/demo.cjs`、`docs/notes/site.md`。

## 任务

1. 主题数据、配色、metro fixture
2. 片段表、深链接、输入的纯函数
3. 录像清单、替身录像、构建时下载
4. 放映厅界面
5. 构建后的真浏览器冒烟
6. 假上游的录制剧本
7. 录制脚本
8. 录全部、上传（控制者确认）、验收、笔记

---

### Task 1: 主题数据、配色、metro fixture

**Files:**
- Create: `scripts/lib/fixtures/theme-metro/theme.json`、`backdrop.js`、`theme.css`
- Create: `site/src/showcase/ids.ts`、`site/src/showcase/themes.ts`、`site/src/showcase/palette.ts`、`site/src/showcase/glyph.ts`
- Modify: `site/astro.config.mjs`、`site/vitest.config.ts`、`site/tsconfig.json`
- Test: `site/src/showcase/themes.test.ts`

**Interfaces:**
- Produces:
  - `ids.ts`：`THEME_IDS: readonly ['phosphor','abyss','koi','moon','dither','orb','garden','paper','letters','ink']`、`type ThemeId`、`DESCRIBE_ID = 'describe'`、`DESCRIBE_THEME = 'metro'`
  - `themes.ts`：`PACKS: Record<string, ThemePack>`（键：10 个主题 id + `'metro'`）
  - `palette.ts`：`SECTION_VARS`、`scopedPaletteCss(p: ThemePack, selector: string): string`、`sectionVarsCss(p: ThemePack, selector: string): string`、`showcaseCss(entries: { key: string; pack: ThemePack }[]): string`——按钮规则 `.sc-pick[data-sc-palette='<key>']`（产品的变量名 `--bg --fg --accent …`），整段规则 `.showcase[data-sc-current='<key>']`（`--sc-bg --sc-fg …`）
  - `glyph.ts`：`glyphClip(pack: ThemePack, process?: Process): { frames: string[]; fps: number }`（默认 `'think'`，`stage` 尺寸的 loop 帧，已转成 HTML）
  - 别名：`@themes` → `server/src/themes/core/index.ts`，`@web-themes` → `web/src/themes`

- [ ] **Step 1: 切到分支**

Run: `git switch feat/site-2 || git switch -c feat/site-2`
Expected: `Switched to branch 'feat/site-2'`（或新建）。

- [ ] **Step 2: 做 metro fixture（照磷光复制，再改 id / 名字 / 配色）**

Run: `mkdir -p scripts/lib/fixtures/theme-metro && cp web/src/themes/builtin/phosphor/theme.json web/src/themes/builtin/phosphor/backdrop.js web/src/themes/builtin/phosphor/theme.css scripts/lib/fixtures/theme-metro/`

然后用 Edit 改 `scripts/lib/fixtures/theme-metro/theme.json`（文件是 1 空格缩进）：

1. `"id": "phosphor",` → `"id": "metro",`
2. `"zh": "磷光",` → `"zh": "地铁站",`；`"en": "Phosphor"` → `"en": "Metro"`
3. 把 `"colors": {` 到 `"shade-a": "3"` 之间这些行的值换成下面（键不变，顺序不变；`agent-1`…`agent-10`、`shade`、`shade-a` 保持原值）：

```
  "bg": "#07100c",
  "bg-1": "#040906",
  "bg-2": "#0c1812",
  "bg-3": "#12221a",
  "bg-elev": "#0f1d16",
  "line": "#183026",
  "line-1": "#22402f",
  "fg": "#e4f5ea",
  "fg-1": "#b6dcc4",
  "fg-2": "#8fbfa1",
  "fg-3": "#5f8f72",
  "accent": "#2ee88a",
  "accent-text": "#4ff09c",
  "accent-fg": "#03140b",
  "primary": "#2ee88a",
  "primary-fg": "#03140b",
  "user-bg": "#10221a",
  "green": "#5cf29f",
  "red": "#ff7468",
  "yellow": "#ffd25c",
  "blue": "#6cc8ff",
```

（这套配色已用 `server/src/themes/core/contrast.ts` 的 `contrastProblems` 验过：无问题。）

`scripts/lib/fixtures/theme-metro/theme.css`：Edit，`replace_all`，`phosphor` → `metro`（15 处）。
`scripts/lib/fixtures/theme-metro/backdrop.js`：只改第 1 行注释的开头 `// 磷光 · Phosphor: a CRT's character rain.` → `// 地铁站 · Metro (the showcase's "describe a new theme" fixture, made from Phosphor): signal-green character rain.`

- [ ] **Step 3: 用产品的草稿检查验 fixture**

Run: `npx tsx scripts/theme-check.ts scripts/lib/fixtures/theme-metro`
Expected: 没有格式 / 对比度 / CSS 错误，背景在两种场景下都跑完（输出里没有 `error`）。有问题按提示改 fixture，不改检查脚本。

- [ ] **Step 4: 加别名**

`site/astro.config.mjs`，`alias` 那一行改成（保留别的计划加的别名）：

```js
    resolve: {
      alias: {
        '@i18n': path.resolve(here, '../server/src/i18n/core.ts'),
        '@themes': path.resolve(here, '../server/src/themes/core/index.ts'),
        '@web-themes': path.resolve(here, '../web/src/themes'),
      },
    },
```

`site/vitest.config.ts`：

```ts
  resolve: {
    alias: {
      '@i18n': path.resolve(import.meta.dirname, '../server/src/i18n/core.ts'),
      '@themes': path.resolve(import.meta.dirname, '../server/src/themes/core/index.ts'),
      '@web-themes': path.resolve(import.meta.dirname, '../web/src/themes'),
    },
  },
```

`site/tsconfig.json` 的 `paths`：

```json
    "paths": {
      "@i18n": ["../server/src/i18n/core.ts"],
      "@themes": ["../server/src/themes/core/index.ts"],
      "@web-themes/*": ["../web/src/themes/*"]
    }
```

- [ ] **Step 5: 写失败的测试** `site/src/showcase/themes.test.ts`

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, contrastProblems, paletteCss } from '@themes';
import { DESCRIBE_THEME, THEME_IDS } from './ids';
import { PACKS } from './themes';
import { scopedPaletteCss, sectionVarsCss, showcaseCss, SECTION_VARS } from './palette';
import { glyphClip } from './glyph';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const ALL = [...THEME_IDS, DESCRIBE_THEME];

describe('the showcase themes', () => {
  it('are the product\'s built-in themes, in its order', () => {
    const src = fs.readFileSync(path.join(ROOT, 'web/src/themes/builtin/index.ts'), 'utf8');
    const m = /export const ORDER = (\[[^\]]*\]);/.exec(src);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1].replace(/'/g, '"'))).toEqual([...THEME_IDS]);
  });

  it('all parse, with both names and a palette', () => {
    for (const id of ALL) {
      const p = PACKS[id];
      expect(p.id).toBe(id);
      expect(p.name.zh.length).toBeGreaterThan(0);
      expect(p.name.en.length).toBeGreaterThan(0);
      expect(paletteCss(p)).toContain('--bg:');
    }
    expect(['paper', 'letters', 'ink'].map((id) => PACKS[id].mode)).toEqual(['light', 'light', 'light']);
  });

  it('read well in the section and on their buttons', () => {
    for (const id of ALL) {
      const c = PACKS[id].colors;
      expect(contrastProblems(c), id).toEqual([]);
      const pairs: [string, string, number][] = [
        ['fg', 'bg-1', 7], ['fg-1', 'bg-1', 4.5], ['fg-2', 'bg-1', 4.5], // the section: title, text, markers
        ['fg-1', 'bg-2', 4.5], // the title bar
        ['fg', 'bg-2', 7], ['fg-2', 'bg-2', 4.5], // a theme button: name, light / dark tag
        ['accent-fg', 'accent', 4.5], // the compare toggle when on, the play button
      ];
      for (const [ink, ground, min] of pairs) expect(contrast(c[ink], c[ground]), `${id} ${ink} on ${ground}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('scopes a palette to the given selector', () => {
    const css = scopedPaletteCss(PACKS.ink, ".sc-pick[data-sc-palette='ink']");
    expect(css.startsWith(".sc-pick[data-sc-palette='ink'] {")).toBe(true);
    expect(css).toContain(`--accent: ${PACKS.ink.colors.accent};`);
    expect(css).not.toContain('html:root');
    const sec = sectionVarsCss(PACKS.ink, ".showcase[data-sc-current='ink']");
    for (const k of SECTION_VARS) expect(sec).toContain(`--sc-${k}: ${PACKS.ink.colors[k]};`);
    expect(sec).toContain('color-scheme: light;');
  });

  it('writes one button rule and one section rule per clip', () => {
    const css = showcaseCss([...THEME_IDS.map((id) => ({ key: id, pack: PACKS[id] })), { key: 'describe', pack: PACKS.metro }]);
    expect(css.match(/\.sc-pick\[data-sc-palette='/g)).toHaveLength(11);
    expect(css.match(/\.showcase\[data-sc-current='/g)).toHaveLength(11);
    expect(css).toContain(".showcase[data-sc-current='describe']");
  });

  it('gives every theme a small live process animation', () => {
    for (const id of ALL) {
      const g = glyphClip(PACKS[id]);
      expect(g.frames.length).toBeGreaterThan(0);
      expect(g.fps).toBeGreaterThanOrEqual(1);
      expect(g.fps).toBeLessThanOrEqual(30);
      expect(g.frames.join('')).not.toMatch(/<script|<\/script/i);
    }
  });
});
```

- [ ] **Step 6: 跑，确认失败**

Run: `npm test --prefix site -- src/showcase/themes.test.ts`
Expected: FAIL，`Failed to resolve import "./ids"`。

- [ ] **Step 7: 实现**

`site/src/showcase/ids.ts`：

```ts
// The showcase's clips by id (spec §5.1): the product's ten built-in character themes in its order
// (web/src/themes/builtin/index.ts ORDER), then "describe a new one", coloured by the theme it makes (the metro
// fixture, scripts/lib/fixtures/theme-metro). No JSON here: the browser side imports this.
export const THEME_IDS = ['phosphor', 'abyss', 'koi', 'moon', 'dither', 'orb', 'garden', 'paper', 'letters', 'ink'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DESCRIBE_ID = 'describe';
export const DESCRIBE_THEME = 'metro';
```

`site/src/showcase/themes.ts`：

```ts
// Build time only: every showcase theme's theme.json, parsed the way the product parses it. Not imported by the
// browser side (the packs are large; Showcase.astro writes what the page needs).
import { parsePack, type ThemePack } from '@themes';
import phosphor from '@web-themes/builtin/phosphor/theme.json';
import abyss from '@web-themes/builtin/abyss/theme.json';
import koi from '@web-themes/builtin/koi/theme.json';
import moon from '@web-themes/builtin/moon/theme.json';
import dither from '@web-themes/builtin/dither/theme.json';
import orb from '@web-themes/builtin/orb/theme.json';
import garden from '@web-themes/builtin/garden/theme.json';
import paper from '@web-themes/builtin/paper/theme.json';
import letters from '@web-themes/builtin/letters/theme.json';
import ink from '@web-themes/builtin/ink/theme.json';
import metro from '../../../scripts/lib/fixtures/theme-metro/theme.json';
import { DESCRIBE_THEME, THEME_IDS } from './ids';

const RAW: Record<string, unknown> = { phosphor, abyss, koi, moon, dither, orb, garden, paper, letters, ink, metro };

function load(id: string): ThemePack {
  const { pack, errors } = parsePack(RAW[id]);
  if (!pack) throw new Error(`showcase theme ${id}: ${errors.join('; ')}`);
  return pack;
}

export const PACKS: Record<string, ThemePack> = Object.fromEntries([...THEME_IDS, DESCRIBE_THEME].map((id) => [id, load(id)]));
```

`site/src/showcase/palette.ts`：

```ts
// The showcase takes its colours from the theme on show (spec §5.1). A theme button wears its own theme's palette
// under the product's names (--bg, --accent…: the process frames colour characters with var(--accent) and so on);
// the section wears the current one under --sc-* names, registered with @property in showcase.css so a switch
// transitions. Both come from the product's paletteCss, so a palette means the same here as in the app.
import { paletteCss, type ThemePack } from '@themes';

export const SECTION_VARS = ['bg', 'bg-1', 'bg-2', 'bg-3', 'line', 'line-1', 'fg', 'fg-1', 'fg-2', 'accent', 'accent-text', 'accent-fg'] as const;

/** paletteCss's rule with its `html:root[data-ascii=…]` selector swapped for `selector`. */
export function scopedPaletteCss(p: ThemePack, selector: string): string {
  const css = paletteCss(p);
  const head = `html:root[data-ascii='${p.id}']`;
  if (!css.startsWith(head)) throw new Error('paletteCss no longer starts with its html:root selector');
  return selector + css.slice(head.length);
}

export function sectionVarsCss(p: ThemePack, selector: string): string {
  const decl = SECTION_VARS.map((k) => `  --sc-${k}: ${p.colors[k]};`).join('\n');
  return `${selector} {\n${decl}\n  color-scheme: ${p.mode};\n}\n`;
}

export function showcaseCss(entries: { key: string; pack: ThemePack }[]): string {
  return entries
    .map(({ key, pack }) => scopedPaletteCss(pack, `.sc-pick[data-sc-palette='${key}']`) + sectionVarsCss(pack, `.showcase[data-sc-current='${key}']`))
    .join('');
}
```

`site/src/showcase/glyph.ts`：

```ts
// A theme button's small live process animation (spec §5.1): the theme's own frames for a process, as the product's
// ProcessGlyph draws them (animFor + frameHtml), computed at build time; player.ts plays them with the product's ticker.
import { animFor, type Process, type ThemePack } from '@themes';
import { frameHtml } from '@web-themes/render';

export function glyphClip(pack: ThemePack, process: Process = 'think'): { frames: string[]; fps: number } {
  const a = animFor(pack, process);
  return { frames: a.loop.map((f) => frameHtml(f, a.color)), fps: a.fps };
}
```

- [ ] **Step 8: 跑测试和类型检查**

Run: `npm test --prefix site -- src/showcase/themes.test.ts && npx tsc --noEmit -p site`
Expected: 6 passed；tsc 无输出。

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/fixtures/theme-metro site/src/showcase/ids.ts site/src/showcase/themes.ts site/src/showcase/palette.ts site/src/showcase/glyph.ts site/src/showcase/themes.test.ts site/astro.config.mjs site/vitest.config.ts site/tsconfig.json
git commit -m "feat(site): 放映厅的主题数据、配色和 metro 主题 fixture"
```

---

### Task 2: 片段表、深链接、输入的纯函数

**Files:**
- Create: `site/src/showcase/clips.ts`、`site/src/showcase/params.ts`、`site/src/showcase/input.ts`
- Test: `site/src/showcase/clips.test.ts`、`site/src/showcase/params.test.ts`、`site/src/showcase/input.test.ts`

**Interfaces:**
- Consumes: `ids.ts`（Task 1）。
- Produces:
  - `clips.ts`：`type Lang = 'en' | 'zh'`、`LANGS`、`type MarkerKey = 'home' | 'turn' | 'waiting' | 'describe' | 'trial' | 'apply'`、`interface Clip { id: string; palette: string; duration: number; markers: { at: number; key: MarkerKey }[]; describe: boolean }`、`CLIPS: Clip[]`（11 个，`describe` 最后）、`videoFile(id, lang, ext: 'webm' | 'mp4', small: boolean): string`、`posterFile(id, lang): string`、`expectedMediaFiles(): string[]`（排好序，110 个）
  - `params.ts`：`DEFAULT_CLIP = 'phosphor'`、`clipFromSearch(search: string): string`、`searchWithClip(search: string, id: string): string`
  - `input.ts`：`DRAG_SLOP = 4`、`type KeyMove`、`showcaseKey(key, index, count): KeyMove`、`timeOnTimeline(x, left, width, duration)`、`timeAfterDrag(start, dx, width, duration)`、`revealRadius(x, y, w, h)`

- [ ] **Step 1: 写失败的测试**

`site/src/showcase/clips.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { CLIPS, expectedMediaFiles, posterFile, videoFile } from './clips';
import { THEME_IDS } from './ids';

describe('the clip table', () => {
  it('has the ten themes in order, then describe', () => {
    expect(CLIPS.map((c) => c.id)).toEqual([...THEME_IDS, 'describe']);
    expect(CLIPS.filter((c) => !c.describe).every((c) => c.duration === 12 && c.palette === c.id)).toBe(true);
    const d = CLIPS[10];
    expect(d).toMatchObject({ id: 'describe', palette: 'metro', duration: 15, describe: true });
  });

  it('puts the markers inside each clip', () => {
    expect(CLIPS[0].markers).toEqual([{ at: 0, key: 'home' }, { at: 5, key: 'turn' }, { at: 10, key: 'waiting' }]);
    expect(CLIPS[10].markers.map((m) => m.key)).toEqual(['describe', 'trial', 'apply']);
    for (const c of CLIPS) for (const m of c.markers) expect(m.at).toBeLessThan(c.duration);
  });

  it('names the files', () => {
    expect(videoFile('ink', 'zh', 'webm', false)).toBe('ink.zh.webm');
    expect(videoFile('ink', 'zh', 'mp4', true)).toBe('ink.zh-sm.mp4');
    expect(posterFile('describe', 'en')).toBe('describe.en.webp');
  });

  it('expects 110 files, each once', () => {
    const f = expectedMediaFiles();
    expect(f).toHaveLength(110);
    expect(new Set(f).size).toBe(110);
    expect(f).toEqual([...f].sort());
    expect(f).toContain('phosphor.en.webm');
    expect(f).toContain('describe.zh-sm.mp4');
    expect(f).toContain('ink.zh.webp');
  });
});
```

`site/src/showcase/params.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { clipFromSearch, searchWithClip } from './params';

describe('?theme=', () => {
  it('picks a known clip', () => {
    expect(clipFromSearch('?theme=ink')).toBe('ink');
    expect(clipFromSearch('?lang=en&theme=koi')).toBe('koi');
    expect(clipFromSearch('?theme=describe')).toBe('describe');
  });
  it('falls back to phosphor', () => {
    expect(clipFromSearch('')).toBe('phosphor');
    expect(clipFromSearch('?theme=nope')).toBe('phosphor');
    expect(clipFromSearch('?theme=')).toBe('phosphor');
    expect(clipFromSearch('?theme=metro')).toBe('phosphor');
  });
  it('writes the clip back, keeping the other parameters', () => {
    expect(searchWithClip('', 'orb')).toBe('?theme=orb');
    expect(searchWithClip('?lang=en', 'koi')).toBe('?lang=en&theme=koi');
    expect(searchWithClip('?theme=ink', 'orb')).toBe('?theme=orb');
  });
});
```

`site/src/showcase/input.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { revealRadius, showcaseKey, timeAfterDrag, timeOnTimeline } from './input';

describe('keys', () => {
  it('← → wrap over all clips', () => {
    expect(showcaseKey('ArrowRight', 0, 11)).toEqual({ kind: 'go', index: 1 });
    expect(showcaseKey('ArrowRight', 10, 11)).toEqual({ kind: 'go', index: 0 });
    expect(showcaseKey('ArrowLeft', 0, 11)).toEqual({ kind: 'go', index: 10 });
  });
  it('1–9 and 0 pick the first ten', () => {
    expect(showcaseKey('1', 5, 11)).toEqual({ kind: 'go', index: 0 });
    expect(showcaseKey('9', 5, 11)).toEqual({ kind: 'go', index: 8 });
    expect(showcaseKey('0', 5, 11)).toEqual({ kind: 'go', index: 9 });
    expect(showcaseKey('0', 0, 5)).toBeNull();
  });
  it('space pauses; other keys are not ours', () => {
    expect(showcaseKey(' ', 0, 11)).toEqual({ kind: 'toggle' });
    expect(showcaseKey('d', 0, 11)).toBeNull();
    expect(showcaseKey('Enter', 0, 11)).toBeNull();
  });
});

describe('scrubbing', () => {
  it('maps the timeline to time, clamped short of the end', () => {
    expect(timeOnTimeline(150, 100, 200, 12)).toBeCloseTo(3);
    expect(timeOnTimeline(50, 100, 200, 12)).toBe(0);
    expect(timeOnTimeline(999, 100, 200, 12)).toBeCloseTo(11.96);
    expect(timeOnTimeline(150, 100, 0, 12)).toBe(0);
  });
  it('a drag across the whole picture is the whole clip', () => {
    expect(timeAfterDrag(6, 100, 400, 12)).toBeCloseTo(9);
    expect(timeAfterDrag(6, -1000, 400, 12)).toBe(0);
    expect(timeAfterDrag(6, 50, 0, 12)).toBe(6);
  });
});

describe('the reveal', () => {
  it('reaches the farthest corner, from inside or outside', () => {
    expect(revealRadius(0, 0, 100, 50)).toBeCloseTo(111.803, 2);
    expect(revealRadius(50, 25, 100, 50)).toBeCloseTo(55.902, 2);
    expect(revealRadius(50, 80, 100, 50)).toBeCloseTo(94.34, 1);
  });
});
```

- [ ] **Step 2: 跑，确认失败**

Run: `npm test --prefix site -- src/showcase/clips.test.ts src/showcase/params.test.ts src/showcase/input.test.ts`
Expected: FAIL，找不到 `./clips` / `./params` / `./input`。

- [ ] **Step 3: 实现**

`site/src/showcase/clips.ts`：

```ts
// The showcase's clips (spec §5.1–5.2): one 12 s recording per built-in theme, all made from the same script so
// second n is the same action in each, and one 15 s "describe a new theme". The file names here are the ones
// scripts/record-themes.cjs writes, scripts/upload-site-media.cjs lists in site/media.json and fetch-media.ts copies.
import { DESCRIBE_ID, DESCRIBE_THEME, THEME_IDS } from './ids';

export type Lang = 'en' | 'zh';
export const LANGS: readonly Lang[] = ['en', 'zh'];
export type MarkerKey = 'home' | 'turn' | 'waiting' | 'describe' | 'trial' | 'apply';
export interface Clip { id: string; palette: string; duration: number; markers: { at: number; key: MarkerKey }[]; describe: boolean }

const THEME_MARKERS: Clip['markers'] = [{ at: 0, key: 'home' }, { at: 5, key: 'turn' }, { at: 10, key: 'waiting' }];
const DESCRIBE_MARKERS: Clip['markers'] = [{ at: 0, key: 'describe' }, { at: 4, key: 'trial' }, { at: 11, key: 'apply' }];

export const CLIPS: Clip[] = [
  ...THEME_IDS.map((id) => ({ id, palette: id, duration: 12, markers: THEME_MARKERS, describe: false })),
  { id: DESCRIBE_ID, palette: DESCRIBE_THEME, duration: 15, markers: DESCRIBE_MARKERS, describe: true },
];

export const videoFile = (id: string, lang: Lang, ext: 'webm' | 'mp4', small: boolean): string => `${id}.${lang}${small ? '-sm' : ''}.${ext}`;
export const posterFile = (id: string, lang: Lang): string => `${id}.${lang}.webp`;

/** Every file site/media.json must list: per clip and language, two sizes of two encodings and a poster. */
export function expectedMediaFiles(): string[] {
  const out: string[] = [];
  for (const c of CLIPS) for (const l of LANGS) {
    for (const ext of ['webm', 'mp4'] as const) for (const small of [false, true]) out.push(videoFile(c.id, l, ext, small));
    out.push(posterFile(c.id, l));
  }
  return out.sort();
}
```

`site/src/showcase/params.ts`：

```ts
// The clip on show is in the URL (spec §5.1 分享): ?theme=<id>#themes. Anything unknown is phosphor.
import { CLIPS } from './clips';

export const DEFAULT_CLIP = 'phosphor';

export function clipFromSearch(search: string): string {
  const v = new URLSearchParams(search).get('theme');
  return v && CLIPS.some((c) => c.id === v) ? v : DEFAULT_CLIP;
}

export function searchWithClip(search: string, id: string): string {
  const p = new URLSearchParams(search);
  p.set('theme', id);
  return `?${p.toString()}`;
}
```

`site/src/showcase/input.ts`：

```ts
// The showcase's input, as pure functions (player.ts wires them to the DOM).

/** pixels a press may wander before it is a drag rather than a click (pause) */
export const DRAG_SLOP = 4;

export type KeyMove = { kind: 'go'; index: number } | { kind: 'toggle' } | null;

/** With the section focused: ← → step through the clips (wrapping), 1–9 and 0 pick the first ten, space pauses. */
export function showcaseKey(key: string, index: number, count: number): KeyMove {
  if (key === 'ArrowRight') return { kind: 'go', index: (index + 1) % count };
  if (key === 'ArrowLeft') return { kind: 'go', index: (index - 1 + count) % count };
  if (key === ' ') return { kind: 'toggle' };
  if (/^[0-9]$/.test(key)) {
    const i = key === '0' ? 9 : Number(key) - 1;
    return i < count ? { kind: 'go', index: i } : null;
  }
  return null;
}

/** never the very end: a looping video seeked to its duration jumps back to 0 */
const clamp = (t: number, d: number) => Math.min(Math.max(t, 0), Math.max(0, d - 0.04));

export function timeOnTimeline(x: number, left: number, width: number, duration: number): number {
  return width > 0 ? clamp(((x - left) / width) * duration, duration) : 0;
}

/** dragging across the whole picture moves through the whole clip */
export function timeAfterDrag(start: number, dx: number, width: number, duration: number): number {
  return width > 0 ? clamp(start + (dx / width) * duration, duration) : start;
}

/** the circle from (x, y) — inside the w × h picture or outside it (a theme button below) — that covers it all */
export function revealRadius(x: number, y: number, w: number, h: number): number {
  return Math.hypot(Math.max(Math.abs(x), Math.abs(w - x)), Math.max(Math.abs(y), Math.abs(h - y)));
}
```

- [ ] **Step 4: 跑测试**

Run: `npm test --prefix site -- src/showcase && npx tsc --noEmit -p site`
Expected: 全部通过（themes / clips / params / input）；tsc 无输出。

- [ ] **Step 5: Commit**

```bash
git add site/src/showcase/clips.ts site/src/showcase/params.ts site/src/showcase/input.ts site/src/showcase/clips.test.ts site/src/showcase/params.test.ts site/src/showcase/input.test.ts
git commit -m "feat(site): 放映厅的片段表、?theme= 深链接、键盘和拖动的纯函数"
```

---

### Task 3: 录像清单、替身录像、构建时下载

**Files:**
- Create: `scripts/lib/media-encode.cjs`、`scripts/make-standin-clips.cjs`、`scripts/upload-site-media.cjs`、`site/scripts/fetch-media.ts`、`site/media.json`（脚本生成）
- Modify: `site/package.json`、`site/.gitignore`、`.github/workflows/site.yml`、`.github/workflows/ci.yml`
- Test: `site/scripts/fetch-media.test.ts`、`site/src/showcase/media.test.ts`

**Interfaces:**
- Consumes: `expectedMediaFiles()`（Task 2）。
- Produces:
  - `media-encode.cjs`：`ff(args: string[])`、`webmEncoder(): 'libsvtav1' | 'libaom-av1' | 'libvpx-vp9'`、`encodeClip(master: string, outDir: string, id: string, lang: string, opts?: { fast?: boolean }): string[]`（写 5 个文件，返回路径）、`report(files: string[]): void`、`webmCodecs(file: string): string`（`'av01.0.08M.08'` 或 `'vp9'`）
  - `site/media.json`：`{ repo: 'ypyik0669/claude-web', tag: 'site-media', webmCodecs: string, files: Record<string, { sha256: string; bytes: number }> }`
  - `fetch-media.ts`：`interface MediaManifest`、`type Source = (file: string) => Promise<Buffer | null>`、`sha256(b)`、`dirSource(dir)`、`releaseSource(m, base?)`、`fetchMedia(m, out, source, cache?, warn?) → Promise<{ copied: string[]; missing: string[] }>`；环境变量 `SITE_MEDIA=off`（跳过）、`SITE_MEDIA_DIR=<相对 site/ 的目录>`（从本地目录拷，不联网）
  - 本地替身录像在 `site/.media-local/`（gitignore），下载缓存在 `site/.media-cache/`（gitignore）

- [ ] **Step 1: 写 `scripts/lib/media-encode.cjs`**

```js
// ffmpeg for the site's theme recordings (scripts/record-themes.cjs, scripts/make-standin-clips.cjs): from one master
// video, per clip and language, the five files the showcase plays (spec §5.2) —
//   <id>.<lang>.webm / .mp4 (1280×800) and <id>.<lang>-sm.webm / -sm.mp4 (720×450), <id>.<lang>.webp (the poster, 7 s in).
// webm is AV1 when this ffmpeg has an AV1 encoder (libsvtav1, else libaom-av1), else VP9; mp4 is H.264 for Safari.
// Keyframes every 15 frames so scrubbing and switching (a seek to the same second) are quick.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'] });

let picked = null;
function webmEncoder() {
  if (picked) return picked;
  const list = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { windowsHide: true, encoding: 'utf8' });
  for (const need of ['libx264', 'libwebp']) if (!new RegExp(`\\b${need}\\b`).test(list)) throw new Error(`this ffmpeg has no ${need}`);
  // libaom-av1 is skipped on purpose: ~1.5–2 h for the 22 clips on this machine; VP9 plays everywhere the site targets.
  picked = /\blibsvtav1\b/.test(list) ? 'libsvtav1' : 'libvpx-vp9';
  return picked;
}

const WEBM = {
  libsvtav1: ['-c:v', 'libsvtav1', '-preset', '6', '-crf', '38', '-g', '15'],
  'libaom-av1': ['-c:v', 'libaom-av1', '-cpu-used', '5', '-row-mt', '1', '-crf', '36', '-b:v', '0', '-g', '15', '-keyint_min', '15'],
  'libvpx-vp9': ['-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-crf', '38', '-b:v', '0', '-g', '15'],
};
const WEBM_FAST = ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '40', '-b:v', '0', '-g', '15'];
const MP4 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-g', '15', '-movflags', '+faststart'];
const MP4_FAST = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-g', '15', '-movflags', '+faststart'];
const SIZES = [['', '1280:800'], ['-sm', '720:450']];

/** opts.fast: VP9 realtime / x264 ultrafast (stand-ins); the real recordings use the defaults */
function encodeClip(master, outDir, id, lang, opts = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const webmArgs = opts.fast ? WEBM_FAST : WEBM[webmEncoder()];
  const mp4Args = opts.fast ? MP4_FAST : MP4;
  const files = [];
  for (const [suffix, size] of SIZES) {
    const vf = `scale=${size}:flags=lanczos,format=yuv420p`;
    const webm = path.join(outDir, `${id}.${lang}${suffix}.webm`);
    ff(['-i', master, '-an', '-vf', vf, ...webmArgs, webm]);
    const mp4 = path.join(outDir, `${id}.${lang}${suffix}.mp4`);
    ff(['-i', master, '-an', '-vf', vf, ...mp4Args, mp4]);
    files.push(webm, mp4);
  }
  const poster = path.join(outDir, `${id}.${lang}.webp`);
  ff(['-ss', '7', '-i', master, '-frames:v', '1', '-vf', 'scale=1280:800:flags=lanczos', '-c:v', 'libwebp', '-quality', '72', poster]);
  files.push(poster);
  return files;
}

const LARGE_LIMIT = 1.5 * 1024 * 1024;
const POSTER_LIMIT = 80 * 1024;
function report(files) {
  for (const f of files) {
    const n = fs.statSync(f).size;
    const name = path.basename(f);
    const big = /\.(webm|mp4)$/.test(name) && !name.includes('-sm.') && n > LARGE_LIMIT;
    const fat = name.endsWith('.webp') && n > POSTER_LIMIT;
    console.log(`${name.padEnd(28)} ${(n / 1024).toFixed(0).padStart(6)} KB${big ? '  WARNING: over 1.5 MB' : ''}${fat ? '  WARNING: poster over 80 KB' : ''}`);
  }
}

/** the codecs string for <video>'s canPlayType: AV1 main 8-bit level 4.0 (1280×800 at 30 fps), or VP9 */
function webmCodecs(file) {
  const c = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], { windowsHide: true, encoding: 'utf8' }).trim();
  if (c === 'av1') return 'av01.0.08M.08';
  if (c === 'vp9') return 'vp9';
  throw new Error(`${file}: unexpected webm codec ${c}`);
}

module.exports = { ff, webmEncoder, encodeClip, report, webmCodecs };
```

- [ ] **Step 2: 写 `scripts/make-standin-clips.cjs`**

```js
// Stand-in recordings for building and testing the site's theme showcase before the real ones exist
// (scripts/record-themes.cjs): per clip and language a test pattern on the theme's background, labelled with the clip,
// the language and the running time, encoded like the real ones (fast settings) under the real file names.
//   node scripts/make-standin-clips.cjs [--out site/.media-local]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const media = require('./lib/media-encode.cjs');

const ROOT = path.resolve(__dirname, '..');
const THEMES = ['phosphor', 'abyss', 'koi', 'moon', 'dither', 'orb', 'garden', 'paper', 'letters', 'ink'];
const CLIPS = [...THEMES.map((id) => ({ id, theme: id, seconds: 12 })), { id: 'describe', theme: 'metro', seconds: 15 }];
const i = process.argv.indexOf('--out');
const out = path.resolve(i > 0 ? process.argv[i + 1] : path.join(ROOT, 'site', '.media-local'));

const colorsOf = (theme) => JSON.parse(fs.readFileSync(theme === 'metro'
  ? path.join(ROOT, 'scripts', 'lib', 'fixtures', 'theme-metro', 'theme.json')
  : path.join(ROOT, 'web', 'src', 'themes', 'builtin', theme, 'theme.json'), 'utf8')).colors;
const hex = (h) => `0x${h.slice(1, 7)}`;
// drawtext without fontconfig on Windows: name the font file (":" escaped for the filter graph)
const font = process.platform === 'win32' ? "fontfile='C\\:/Windows/Fonts/arial.ttf':" : '';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-standin-'));
try {
  for (const clip of CLIPS) for (const lang of ['en', 'zh']) {
    const c = colorsOf(clip.theme);
    const master = path.join(tmp, `${clip.id}.${lang}.mp4`);
    const graph = `[0][1]overlay=x=(W-w)/2:y=(H-h)/2+120,drawbox=x=0:y=0:w=iw:h=72:color=${hex(c['bg-2'])}:t=fill,`
      + `drawtext=${font}text='${clip.id} ${lang}':fontsize=96:fontcolor=${hex(c.accent)}:x=(w-tw)/2:y=220,`
      + `drawtext=${font}text='%{pts\\:hms}':fontsize=72:fontcolor=${hex(c.fg)}:x=(w-tw)/2:y=360`;
    media.ff(['-f', 'lavfi', '-i', `color=c=${hex(c.bg)}:s=2560x1600:r=30:d=${clip.seconds}`, '-f', 'lavfi', '-i', `testsrc2=s=960x600:r=30:d=${clip.seconds}`,
      '-filter_complex', graph, '-t', String(clip.seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', master]);
    media.report(media.encodeClip(master, out, clip.id, lang, { fast: true }));
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`stand-ins in ${out}`);
```

- [ ] **Step 3: 写 `scripts/upload-site-media.cjs`**

```js
// The site's theme recordings → site/media.json (file → sha256, bytes; the site's build checks every download
// against it, site/scripts/fetch-media.ts) and the `site-media` pre-release of the repo they are downloaded from.
// The recordings are never committed (spec §5.2). site/src/showcase/media.test.ts checks the list is complete.
//   node scripts/upload-site-media.cjs --dir <recordings> [--manifest-only]
// --manifest-only: only write site/media.json (stand-ins, a dry run). Without it this changes the public release:
// run it only when the person in charge has said so.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const media = require('./lib/media-encode.cjs');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'ypyik0669/claude-web';
const TAG = 'site-media';
const NAME = /^[a-z0-9-]+\.(en|zh)((-sm)?\.(webm|mp4)|\.webp)$/;

const i = process.argv.indexOf('--dir');
if (i < 0 || !process.argv[i + 1]) { console.error('usage: node scripts/upload-site-media.cjs --dir <recordings> [--manifest-only]'); process.exit(2); }
const dir = path.resolve(process.argv[i + 1]);
const files = fs.readdirSync(dir).filter((f) => NAME.test(f)).sort();
const firstWebm = files.find((f) => f.endsWith('.webm'));
if (!firstWebm) { console.error(`no recordings in ${dir}`); process.exit(2); }

const manifest = { repo: REPO, tag: TAG, webmCodecs: media.webmCodecs(path.join(dir, firstWebm)), files: {} };
let total = 0;
for (const f of files) {
  const b = fs.readFileSync(path.join(dir, f));
  manifest.files[f] = { sha256: crypto.createHash('sha256').update(b).digest('hex'), bytes: b.length };
  total += b.length;
}
fs.writeFileSync(path.join(ROOT, 'site', 'media.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`site/media.json: ${files.length} files, ${(total / 1048576).toFixed(1)} MB, webm ${manifest.webmCodecs}`);
if (process.argv.includes('--manifest-only')) process.exit(0);

const gh = (args) => execFileSync('gh', args, { windowsHide: true, stdio: 'inherit' });
try {
  execFileSync('gh', ['release', 'view', TAG, '--repo', REPO], { windowsHide: true, stdio: 'ignore' });
} catch {
  gh(['release', 'create', TAG, '--repo', REPO, '--prerelease', '--target', 'main', '--title', 'Site media',
    '--notes', 'Recordings for the website’s theme showcase (scripts/record-themes.cjs). Not a release of the app.']);
}
for (let k = 0; k < files.length; k += 10) gh(['release', 'upload', TAG, '--repo', REPO, '--clobber', ...files.slice(k, k + 10).map((f) => path.join(dir, f))]);
console.log(`uploaded ${files.length} files to ${REPO}@${TAG}`);
```

（`site/src/data/releases.ts` 已经把 pre-release 和非 `vX.Y.Z` 的 tag 排除在版本之外；桌面版 `autoUpdater.allowPrerelease = false`，不会把它当更新。）

- [ ] **Step 4: 生成替身录像和清单**

Run（大约 3–6 分钟，可放后台）：`node scripts/make-standin-clips.cjs && node scripts/upload-site-media.cjs --dir site/.media-local --manifest-only`
Expected: 每个文件一行大小，最后 `site/media.json: 110 files, … MB, webm vp9`。可能有 `Fontconfig error` 字样，不影响。

`site/.gitignore` 末尾加两行：

```
.media-local/
.media-cache/
```

- [ ] **Step 5: 写失败的测试**

`site/src/showcase/media.test.ts`：

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectedMediaFiles } from './clips';

const m = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../media.json'), 'utf8'));

describe('site/media.json', () => {
  it('lists exactly the files the showcase plays', () => {
    expect(Object.keys(m.files).sort()).toEqual(expectedMediaFiles());
  });
  it('has a sha256 and a size for each', () => {
    for (const [name, e] of Object.entries(m.files) as [string, { sha256: string; bytes: number }][]) {
      expect(e.sha256, name).toMatch(/^[0-9a-f]{64}$/);
      expect(e.bytes, name).toBeGreaterThan(0);
    }
  });
  it('names the release and the webm codec', () => {
    expect(m.repo).toBe('ypyik0669/claude-web');
    expect(m.tag).toBe('site-media');
    expect(m.webmCodecs).toMatch(/^(av01\.|vp9$)/);
  });
});
```

`site/scripts/fetch-media.test.ts`：

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dirSource, fetchMedia, releaseSource, sha256, type MediaManifest } from './fetch-media';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cw-media-'));
function fixture() {
  const src = tmp();
  const a = Buffer.from('poster bytes');
  const b = Buffer.from('video bytes');
  fs.writeFileSync(path.join(src, 'phosphor.en.webp'), a);
  fs.writeFileSync(path.join(src, 'phosphor.en.webm'), b);
  const m: MediaManifest = { repo: 'x/y', tag: 'site-media', webmCodecs: 'vp9', files: {
    'phosphor.en.webp': { sha256: sha256(a), bytes: a.length },
    'phosphor.en.webm': { sha256: sha256(b), bytes: b.length },
  } };
  return { src, m };
}
const quiet = () => {};

describe('fetchMedia', () => {
  it('copies the files that match', async () => {
    const { src, m } = fixture();
    const out = tmp();
    expect(await fetchMedia(m, out, dirSource(src), undefined, quiet)).toEqual({ copied: ['phosphor.en.webm', 'phosphor.en.webp'], missing: [] });
    expect(fs.readFileSync(path.join(out, 'phosphor.en.webm'), 'utf8')).toBe('video bytes');
  });

  it('fails the build on a sha256 mismatch', async () => {
    const { src, m } = fixture();
    fs.writeFileSync(path.join(src, 'phosphor.en.webm'), 'tampered');
    await expect(fetchMedia(m, tmp(), dirSource(src), undefined, quiet)).rejects.toThrow(/sha256 mismatch.*phosphor\.en\.webm/);
  });

  it('warns and goes on when the files cannot be reached', async () => {
    const { m } = fixture();
    const warned: string[] = [];
    const r = await fetchMedia(m, tmp(), async () => null, undefined, (s) => warned.push(s));
    expect(r).toEqual({ copied: [], missing: ['phosphor.en.webm', 'phosphor.en.webp'] });
    expect(warned[0]).toMatch(/2 of 2 files unreachable/);
  });

  it('uses the cache when its copy matches', async () => {
    const { src, m } = fixture();
    const cache = tmp();
    await fetchMedia(m, tmp(), dirSource(src), cache, quiet);
    expect(await fetchMedia(m, tmp(), async () => null, cache, quiet)).toEqual({ copied: ['phosphor.en.webm', 'phosphor.en.webp'], missing: [] });
  });

  it('the release source answers null when nothing is there', async () => {
    const { m } = fixture();
    expect(await releaseSource(m, 'http://127.0.0.1:9')('phosphor.en.webp')).toBeNull();
  });
});
```

- [ ] **Step 6: 跑，确认失败**

Run: `npm test --prefix site -- scripts/fetch-media.test.ts src/showcase/media.test.ts`
Expected: `media.test.ts` 通过（清单已生成），`fetch-media.test.ts` FAIL：找不到 `./fetch-media`。

- [ ] **Step 7: 实现 `site/scripts/fetch-media.ts`**

```ts
// The theme showcase's recordings → site/dist/themes/ (spec §5.2), after `astro build`, before the budget check.
// They live on the repo's `site-media` pre-release, not in git; site/media.json lists each with its sha256.
// A file that downloads but does not match fails the build; a file that cannot be reached is a warning — the
// showcase shows its poster, or a placeholder, instead — so the site still builds without the network.
//   node site/scripts/fetch-media.ts
//   SITE_MEDIA=off       skip (CI checks on pull requests)
//   SITE_MEDIA_DIR=<dir> copy from a local folder, relative to site/ (stand-ins: .media-local)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface MediaEntry { sha256: string; bytes: number }
export interface MediaManifest { repo: string; tag: string; webmCodecs: string; files: Record<string, MediaEntry> }
/** a file's bytes, or null when it cannot be had */
export type Source = (file: string) => Promise<Buffer | null>;

export const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

export function dirSource(dir: string): Source {
  return async (file) => {
    const f = path.join(dir, file);
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  };
}

export function releaseSource(m: MediaManifest, base = 'https://github.com'): Source {
  return async (file) => {
    try {
      const r = await fetch(`${base}/${m.repo}/releases/download/${m.tag}/${encodeURIComponent(file)}`, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    } catch {
      return null;
    }
  };
}

export async function fetchMedia(m: MediaManifest, out: string, source: Source, cache?: string, warn: (s: string) => void = console.warn): Promise<{ copied: string[]; missing: string[] }> {
  fs.mkdirSync(out, { recursive: true });
  // posters first: they are what shows while the rest arrive
  const names = Object.keys(m.files).sort((a, b) => Number(b.endsWith('.webp')) - Number(a.endsWith('.webp')) || a.localeCompare(b));
  const copied: string[] = [];
  const missing: string[] = [];
  const bad: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < names.length) {
      const name = names[next++];
      const want = m.files[name];
      const cached = cache ? path.join(cache, name) : null;
      let buf: Buffer | null = null;
      if (cached && fs.existsSync(cached)) {
        const b = fs.readFileSync(cached);
        if (sha256(b) === want.sha256) buf = b;
      }
      if (!buf) {
        buf = await source(name);
        if (!buf) { missing.push(name); continue; }
        if (sha256(buf) !== want.sha256 || buf.length !== want.bytes) { bad.push(name); continue; }
        if (cache && cached) { fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(cached, buf); }
      }
      fs.writeFileSync(path.join(out, name), buf);
      copied.push(name);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (bad.length) throw new Error(`site media: sha256 mismatch for ${bad.sort().join(', ')} (site/media.json and the site-media release disagree)`);
  if (missing.length) warn(`site media: ${missing.length} of ${names.length} files unreachable; the showcase shows a poster or a placeholder for them: ${missing.sort().slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`);
  return { copied: copied.sort(), missing: missing.sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (process.env.SITE_MEDIA === 'off') {
    console.log('site media: SITE_MEDIA=off, skipped');
  } else {
    const m = JSON.parse(fs.readFileSync(path.join(site, 'media.json'), 'utf8')) as MediaManifest;
    const local = process.env.SITE_MEDIA_DIR;
    const source = local ? dirSource(path.resolve(site, local)) : releaseSource(m);
    fetchMedia(m, path.join(site, 'dist', 'themes'), source, path.join(site, '.media-cache')).then(
      (r) => console.log(`site media: ${r.copied.length} files in dist/themes/ (${r.missing.length} missing)`),
      (e: Error) => { console.error(e.message); process.exit(1); },
    );
  }
}
```

- [ ] **Step 8: 接进构建**

`site/package.json` 的 `scripts`：

```json
    "build": "astro build && node scripts/fetch-media.ts && node scripts/budget.ts",
    "media": "node scripts/fetch-media.ts",
```

`.github/workflows/site.yml`：在 `- run: npm test --prefix site` 之前加一步缓存（录像没变就不重新下载），并在 `on.push.paths` 里加主题来源：

```yaml
      - uses: actions/cache@v4
        with:
          path: site/.media-cache
          key: site-media-${{ hashFiles('site/media.json') }}
```

```yaml
      - 'web/src/themes/**'
      - 'server/src/themes/core/**'
      - 'scripts/lib/fixtures/theme-metro/**'
```

`.github/workflows/ci.yml` 第 32 行 `- run: npm run build:site` 改成：

```yaml
      - run: npm run build:site
        env:
          SITE_MEDIA: off # the recordings are the deploy's business; a PR check does not download them
```

- [ ] **Step 9: 跑测试、试构建**

Run: `npm test --prefix site && npx tsc --noEmit -p site`
Expected: 全部通过。

Run: `cd site && SITE_MEDIA_DIR=.media-local npm run build; cd ..`
Expected: 日志里 `site media: 110 files in dist/themes/ (0 missing)`，之后预算检查两行都 ≤ 1.5 MB。

Run: `cd site && SITE_MEDIA=off npm run build; cd ..`
Expected: `site media: SITE_MEDIA=off, skipped`，构建成功。

- [ ] **Step 10: Commit**

```bash
git add scripts/lib/media-encode.cjs scripts/make-standin-clips.cjs scripts/upload-site-media.cjs site/scripts/fetch-media.ts site/scripts/fetch-media.test.ts site/src/showcase/media.test.ts site/media.json site/package.json site/.gitignore .github/workflows/site.yml .github/workflows/ci.yml
git commit -m "feat(site): 主题录像清单、替身录像、构建时按 sha256 下载录像"
```

（这时提交的 `media.json` 是替身的哈希；Task 8 上传真录像后会整份换掉。在那之前线上构建下载不到，放映厅显示占位，构建照常成功。）

---

### Task 4: 放映厅界面

**Files:**
- Create: `site/src/showcase/data.ts`、`site/src/showcase/player.ts`、`site/src/showcase/Showcase.astro`、`site/src/styles/showcase.css`
- Modify: `site/src/copy.ts`、`site/src/i18n/en.ts`、`site/src/views/Home.astro`、`site/src/components/Header.astro`

**Interfaces:**
- Consumes: `PACKS`（Task 1）、`showcaseCss`、`glyphClip`、`CLIPS` / `videoFile` / `posterFile`、`clipFromSearch` / `searchWithClip`、`showcaseKey` / `timeOnTimeline` / `timeAfterDrag` / `revealRadius` / `DRAG_SLOP`（Task 2）、`site/media.json` 的 `webmCodecs`（Task 3）、产品的 `play(r: { el; frames; fps; once; onEnd? }) => () => void`（`web/src/themes/ticker.ts`）。
- Produces（Task 5 的冒烟测试依赖这些 DOM 约定）：
  - `section#themes.showcase[data-sc-current="<clip id>"]`，挂上播放器后 `data-mounted="1"`，暂停时有 class `sc-paused`
  - `.sc-pick[data-id]`（11 个，`aria-pressed`），`.sc-compare`（`aria-pressed`），`.sc-stage` 里的 `video.sc-video[data-id]`（对比时左边那个多一个 class `sc-back`），`.sc-timeline`、`.sc-marker`、`.sc-play`
  - 每次切换在 section 上派发 `CustomEvent('showcase:switched', { detail: { from, to, prevTime, newTime } })`：`newTime` 是新录像对齐之后、开始播之前的时间，`prevTime` 是旧录像那一刻的时间
  - `copy(locale).nav.themes`、`copy(locale).showcase.*`

- [ ] **Step 1: 文案**

`site/src/copy.ts`：`nav` 里 `features: tr('功能'),` 后面加一行：

```ts
      themes: tr('主题'),
```

在 `chapterMore: tr('详细说明'),` 后面加：

```ts
    showcase: {
      title: tr('十套皮，换着穿'),
      sub: tr('同一个应用、同一回合，在每套字符画主题下各录一段。拖动画面看任意一秒，打开「对比」左右对照。'),
      home: tr('首页'),
      turn: tr('跑一回合'),
      waiting: tr('等你批准'),
      describe: tr('描述'),
      trial: tr('试跑'),
      apply: tr('换上新主题'),
      describeNew: tr('描述一个新的'),
      describeNote: tr('这是 Claude Web 自己生成的；你也可以描述一个'),
      compare: tr('对比'),
      play: tr('播放'),
      light: tr('浅色'),
      dark: tr('深色'),
      pick: tr('选一套主题'),
      timeline: tr('时间轴'),
      stage: tr('主题录像'),
      unavailable: tr('录像暂时看不了'),
    },
```

`site/src/i18n/en.ts` 的 `EN_SITE` 里加（`主题` / `浅色` / `深色` 和产品同 key，英文必须一致）：

```ts
  "主题": "Theme",
  "十套皮，换着穿": "Ten skins. Same app.",
  "同一个应用、同一回合，在每套字符画主题下各录一段。拖动画面看任意一秒，打开「对比」左右对照。": "The same app and the same turn, recorded in every character theme. Drag the picture to any second; turn on Compare to see two side by side.",
  "首页": "Home",
  "跑一回合": "A turn runs",
  "等你批准": "Waiting for you",
  "描述": "Describe",
  "试跑": "Trial run",
  "换上新主题": "New theme on",
  "描述一个新的": "Describe a new one",
  "这是 Claude Web 自己生成的；你也可以描述一个": "Claude Web made this one itself. You can describe your own.",
  "对比": "Compare",
  "播放": "Play",
  "浅色": "Light",
  "深色": "Dark",
  "选一套主题": "Pick a theme",
  "时间轴": "Timeline",
  "主题录像": "Theme recording",
  "录像暂时看不了": "This recording isn’t available right now",
```

Run: `node scripts/i18n/extract.mjs --check && npm test --prefix site -- src/i18n`
Expected: 无缺漏；`text.test.ts` 通过。若 `--check` 报的是顺序问题，跑 `node scripts/i18n/extract.mjs` 让它重写 `en.ts`，`git diff site/src/i18n/en.ts` 确认只是挪了位置。若报某个 key 与产品英文不一致，改成产品的英文。

- [ ] **Step 2: `site/src/showcase/data.ts`**

```ts
// What Showcase.astro writes into the page (#sc-data) for player.ts.
export interface ClipData {
  id: string;
  /** on its button */
  name: string;
  /** in the window's title bar: "Claude Web — <title>" */
  title: string;
  duration: number;
  describe: boolean;
  markers: { at: number; label: string }[];
  /** the button's live process animation: frames as HTML (the product's frameHtml) */
  glyph: { frames: string[]; fps: number };
}
export interface ShowcaseData {
  locale: 'en' | 'zh';
  /** where the recordings are: <base>themes/ */
  base: string;
  /** site/media.json webmCodecs, for canPlayType */
  webmCodecs: string;
  clips: ClipData[];
}
```

- [ ] **Step 3: `site/src/showcase/Showcase.astro`**

```astro
---
// 主题放映厅 (spec §5.1). Everything here is static; player.ts is imported when the section comes within a screen of
// the viewport. No poster or video is in the HTML: they are not part of the home page's first load (spec §7).
import '../styles/showcase.css';
import { copy } from '../copy';
import type { Locale } from '../i18n';
import media from '../../media.json';
import { CLIPS } from './clips';
import { PACKS } from './themes';
import { showcaseCss } from './palette';
import { glyphClip } from './glyph';
import type { ClipData, ShowcaseData } from './data';

interface Props { locale: Locale }
const { locale } = Astro.props;
const c = copy(locale).showcase;
const base = import.meta.env.BASE_URL;
const label = { home: c.home, turn: c.turn, waiting: c.waiting, describe: c.describe, trial: c.trial, apply: c.apply };
const clips: (ClipData & { tag: string })[] = CLIPS.map((cl) => {
  const p = PACKS[cl.palette];
  return {
    id: cl.id,
    name: cl.describe ? `${c.describeNew} →` : p.name[locale],
    title: p.name[locale],
    tag: cl.describe ? '' : p.mode === 'light' ? c.light : c.dark,
    duration: cl.duration,
    describe: cl.describe,
    markers: cl.markers.map((m) => ({ at: m.at, label: label[m.key] })),
    glyph: glyphClip(p, 'think'),
  };
});
const data: ShowcaseData = { locale, base: `${base}themes/`, webmCodecs: media.webmCodecs, clips: clips.map(({ tag: _tag, ...rest }) => rest) };
const json = JSON.stringify(data).replace(/</g, '\\u003c');
const css = showcaseCss(CLIPS.map((cl) => ({ key: cl.id, pack: PACKS[cl.palette] })));
const first = clips[0];
---
<section id="themes" class="showcase" data-sc-current={first.id} tabindex="-1" aria-labelledby="themes-t">
  <style is:inline set:html={css}></style>
  <script is:inline type="application/json" id="sc-data" set:html={json}></script>
  <div class="sc-head">
    <h2 id="themes-t">{c.title}</h2>
    <p>{c.sub}</p>
  </div>
  <div class="sc-window">
    <div class="sc-titlebar">
      <span class="sc-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="sc-title">{`Claude Web — ${first.title}`}</span>
      <button type="button" class="sc-compare" aria-pressed="false" hidden>{c.compare}</button>
    </div>
    <div class="sc-stage" role="group" aria-label={c.stage} data-unavailable={c.unavailable}>
      <span class="sc-split" aria-hidden="true"></span>
      <button type="button" class="sc-play">{c.play}</button>
    </div>
  </div>
  <div class="sc-timeline" role="group" aria-label={c.timeline}>
    <span class="sc-progress" aria-hidden="true"></span>
    <div class="sc-markers"></div>
  </div>
  <p class="sc-note" hidden>{c.describeNote}</p>
  <div class="sc-picks" role="group" aria-label={c.pick}>
    {clips.map((cl, i) => (
      <button type="button" class:list={['sc-pick', cl.describe && 'sc-pick-new']} data-id={cl.id} data-sc-palette={cl.id}
        aria-pressed={i === 0 ? 'true' : 'false'} aria-keyshortcuts={i < 10 ? String((i + 1) % 10) : undefined}>
        <span class="sc-glyph" aria-hidden="true" set:html={cl.glyph.frames[0]}></span>
        <span class="sc-name">{cl.name}</span>
        {cl.tag && <span class="sc-mode">{cl.tag}</span>}
      </button>
    ))}
  </div>
</section>
<script>
  const root = document.getElementById('themes');
  if (root) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void import('./player').then((m) => m.mountShowcase(root));
    }, { rootMargin: '100% 0px' });
    io.observe(root);
  }
</script>
```

- [ ] **Step 4: `site/src/styles/showcase.css`**

```css
/* 主题放映厅 (spec §5.1). The section wears the current theme's palette as --sc-* (Showcase.astro writes one rule per
   clip, from the product's paletteCss); registered here so a switch transitions over 400 ms. Each theme button wears
   its own theme under the product's names (--bg, --accent…), which its process frames are coloured with. */
@property --sc-bg { syntax: '<color>'; inherits: true; initial-value: #1b1a18; }
@property --sc-bg-1 { syntax: '<color>'; inherits: true; initial-value: #12110f; }
@property --sc-bg-2 { syntax: '<color>'; inherits: true; initial-value: #24221f; }
@property --sc-bg-3 { syntax: '<color>'; inherits: true; initial-value: #2e2b27; }
@property --sc-line { syntax: '<color>'; inherits: true; initial-value: #2e2b27; }
@property --sc-line-1 { syntax: '<color>'; inherits: true; initial-value: #3a3631; }
@property --sc-fg { syntax: '<color>'; inherits: true; initial-value: #f2efe9; }
@property --sc-fg-1 { syntax: '<color>'; inherits: true; initial-value: #d6d1c8; }
@property --sc-fg-2 { syntax: '<color>'; inherits: true; initial-value: #aaa399; }
@property --sc-accent { syntax: '<color>'; inherits: true; initial-value: #d97757; }
@property --sc-accent-text { syntax: '<color>'; inherits: true; initial-value: #e8916f; }
@property --sc-accent-fg { syntax: '<color>'; inherits: true; initial-value: #1b1a18; }

.showcase {
  --sc-split: 50%;
  position: relative;
  padding: clamp(72px, 12vh, 140px) clamp(16px, 5vw, 64px);
  background: var(--sc-bg-1);
  color: var(--sc-fg);
  outline: none;
  transition: --sc-bg 400ms ease, --sc-bg-1 400ms ease, --sc-bg-2 400ms ease, --sc-bg-3 400ms ease, --sc-line 400ms ease, --sc-line-1 400ms ease,
    --sc-fg 400ms ease, --sc-fg-1 400ms ease, --sc-fg-2 400ms ease, --sc-accent 400ms ease, --sc-accent-text 400ms ease, --sc-accent-fg 400ms ease;
}
.showcase:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
.sc-head { max-width: 720px; margin: 0 auto 32px; text-align: center; }
.sc-head h2 { margin: 0 0 12px; font-size: var(--fs-xl); line-height: 1.15; }
.sc-head p { margin: 0; color: var(--sc-fg-1); }

.sc-window { max-width: 1040px; margin: 0 auto; border: 1px solid var(--sc-line-1); border-radius: 12px; overflow: hidden; background: var(--sc-bg); box-shadow: 0 30px 80px -30px rgb(0 0 0 / 0.6); }
.sc-titlebar { display: flex; align-items: center; gap: 12px; height: 36px; padding: 0 12px; background: var(--sc-bg-2); border-bottom: 1px solid var(--sc-line); font-size: var(--fs-sm); color: var(--sc-fg-1); }
.sc-dots { display: inline-flex; gap: 6px; }
.sc-dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--sc-line-1); }
.sc-title { flex: 1; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sc-compare { font: inherit; font-size: var(--fs-meta); padding: 3px 10px; border-radius: 999px; border: 1px solid var(--sc-line-1); background: transparent; color: var(--sc-fg-1); cursor: pointer; }
.sc-compare[aria-pressed='true'] { background: var(--sc-accent); color: var(--sc-accent-fg); border-color: transparent; }

.sc-stage { position: relative; aspect-ratio: 16 / 10; background: var(--sc-bg); cursor: grab; touch-action: pan-y; user-select: none; overflow: hidden; }
.sc-stage:active { cursor: grabbing; }
.sc-poster, .sc-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.sc-stage.comparing { cursor: ew-resize; }
.sc-stage.comparing .sc-video:not(.sc-back) { clip-path: inset(0 0 0 var(--sc-split)); }
.sc-split { display: none; position: absolute; z-index: 2; top: 0; bottom: 0; left: var(--sc-split); width: 2px; margin-left: -1px; background: var(--sc-accent); pointer-events: none; }
.sc-stage.comparing .sc-split { display: block; }
.sc-play { display: none; position: absolute; z-index: 3; left: 50%; top: 50%; translate: -50% -50%; padding: 12px 22px; border: 0; border-radius: 999px; background: var(--sc-accent); color: var(--sc-accent-fg); font: inherit; font-weight: 600; cursor: pointer; }
.sc-paused .sc-play { display: inline-flex; }
.sc-stage[data-missing]::after { content: attr(data-unavailable); position: absolute; inset: 0; display: grid; place-items: center; color: var(--sc-fg-2); font-size: var(--fs-sm); }

.sc-timeline { position: relative; max-width: 1040px; height: 44px; margin: 0 auto; cursor: pointer; touch-action: none; }
.sc-timeline::before { content: ''; position: absolute; left: 0; right: 0; top: 13px; height: 2px; background: var(--sc-line-1); }
.sc-progress { position: absolute; left: 0; right: 0; top: 13px; height: 2px; background: var(--sc-accent); transform-origin: left; transform: scaleX(var(--sc-p, 0)); }
.sc-markers { position: absolute; inset: 0; }
.sc-marker { position: absolute; top: 20px; padding: 2px 0; border: 0; background: none; color: var(--sc-fg-2); font: inherit; font-size: var(--fs-meta); white-space: nowrap; cursor: pointer; }
.sc-marker::before { content: ''; position: absolute; left: 0; top: -9px; width: 2px; height: 9px; background: var(--sc-accent-text); }
.sc-marker:hover { color: var(--sc-fg); }
.sc-note { max-width: 1040px; margin: 4px auto 0; text-align: center; font-size: var(--fs-sm); color: var(--sc-fg-2); }

.sc-picks { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; max-width: 1040px; margin: 32px auto 0; }
.sc-pick { display: grid; grid-template-columns: auto auto; align-items: center; column-gap: 10px; row-gap: 2px; padding: 8px 12px; border: 1px solid var(--line-1); border-radius: 10px; background: var(--bg-2); color: var(--fg); font: inherit; font-size: var(--fs-sm); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease; }
.sc-pick:hover { transform: translateY(-2px); }
.sc-pick[aria-pressed='true'] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.sc-glyph { grid-row: span 2; min-width: 14ch; font-family: var(--mono); font-size: 9px; line-height: 1.15; white-space: pre; color: var(--fg-2); }
.sc-name { font-weight: 600; }
.sc-mode { font-size: var(--fs-meta); color: var(--fg-2); }

@media (max-width: 720px) {
  .sc-picks { flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 8px; }
  .sc-pick { flex: none; scroll-snap-align: start; }
  .sc-stage { cursor: default; }
  .sc-compare { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .showcase, .sc-pick { transition: none; }
}
```

- [ ] **Step 5: `site/src/showcase/player.ts`**

```ts
// The theme showcase in the browser (spec §5.1), imported when the section comes within a screen of the viewport.
// Everything it needs is in #sc-data (Showcase.astro); the recordings are in <base>themes/ (site/scripts/fetch-media.ts).
// The interactions, and only these: switch (a button, ← →, 1–9 / 0) at the same second with a circle reveal; drag the
// picture or the timeline to scrub; markers jump; compare (previous theme left, current right, in step); click or
// space pauses; ?theme=<id>#themes. A recording that fails leaves its poster; a poster that fails, a placeholder.
import { play as playGlyph } from '@web-themes/ticker';
import { posterFile, videoFile } from './clips';
import type { ShowcaseData } from './data';
import { DRAG_SLOP, revealRadius, showcaseKey, timeAfterDrag, timeOnTimeline } from './input';
import { clipFromSearch, searchWithClip } from './params';

const REVEAL_MS = 400;
/** compare: how far the two halves may drift before the left one is put back in step */
const DRIFT = 0.08;

export interface SwitchedDetail { from: string; to: string; prevTime: number; newTime: number }

const once = (el: EventTarget, type: string, fn: () => void) => el.addEventListener(type, fn, { once: true });

export function mountShowcase(root: HTMLElement): void {
  const dataEl = root.querySelector<HTMLScriptElement>('#sc-data');
  const stage = root.querySelector<HTMLElement>('.sc-stage');
  const split = root.querySelector<HTMLElement>('.sc-split');
  const title = root.querySelector<HTMLElement>('.sc-title');
  const timeline = root.querySelector<HTMLElement>('.sc-timeline');
  const markers = root.querySelector<HTMLElement>('.sc-markers');
  const note = root.querySelector<HTMLElement>('.sc-note');
  const compareBtn = root.querySelector<HTMLButtonElement>('.sc-compare');
  const playBtn = root.querySelector<HTMLButtonElement>('.sc-play');
  if (root.dataset.mounted || !dataEl || !stage || !split || !title || !timeline || !markers || !note || !compareBtn || !playBtn) return;
  root.dataset.mounted = '1';
  const D = JSON.parse(dataEl.textContent ?? '{}') as ShowcaseData;
  const clips = D.clips;
  const picks = [...root.querySelectorAll<HTMLButtonElement>('.sc-pick')];
  const themeCount = clips.filter((c) => !c.describe).length;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const ext = document.createElement('video').canPlayType(`video/webm; codecs="${D.webmCodecs}"`) === 'probably' ? 'webm' : 'mp4';
  const srcOf = (id: string) => D.base + videoFile(id, D.locale, ext, small);
  const posterOf = (id: string) => D.base + posterFile(id, D.locale);

  let index = Math.max(0, clips.findIndex((c) => c.id === clipFromSearch(location.search)));
  /** compare's left half: the theme shown before this one (never "describe") */
  let prevIndex = index === 0 || index >= themeCount ? themeCount - 1 : index - 1;
  let playing = !reduced;
  let compare = false;
  let visible = false;
  let front: HTMLVideoElement | null = null;
  let back: HTMLVideoElement | null = null;
  let gen = 0;
  let raf = 0;
  const cur = () => clips[index];

  const poster = document.createElement('img');
  poster.className = 'sc-poster';
  poster.alt = '';
  poster.decoding = 'async';
  poster.addEventListener('load', () => stage.removeAttribute('data-missing'));
  poster.addEventListener('error', () => stage.setAttribute('data-missing', ''));
  stage.prepend(poster);

  const videos = new Map<string, HTMLVideoElement>();
  const failed = new Set<string>();
  const park = (v: HTMLVideoElement | null) => { if (!v) return; v.pause(); v.remove(); v.style.clipPath = ''; v.classList.remove('sc-back'); };
  const put = (v: HTMLVideoElement, before: Element) => { if (v.parentElement === stage && v.nextSibling === before) return; stage.insertBefore(v, before); };
  const run = (v: HTMLVideoElement | null) => { if (v && playing && visible) void v.play().catch(() => {}); };

  function videoFor(id: string): HTMLVideoElement | null {
    if (failed.has(id)) return null;
    const known = videos.get(id);
    if (known) return known;
    const v = document.createElement('video');
    v.className = 'sc-video';
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('aria-hidden', 'true');
    v.dataset.id = id;
    v.addEventListener('error', () => {
      failed.add(id);
      videos.delete(id);
      if (front === v) front = null;
      if (back === v) back = null;
      park(v); // its poster stays
    });
    v.src = srcOf(id);
    videos.set(id, v);
    return v;
  }

  function applyClip(): void {
    const c = cur();
    root.dataset.scCurrent = c.id;
    title.textContent = `Claude Web — ${c.title}`;
    picks.forEach((p, i) => p.setAttribute('aria-pressed', String(i === index)));
    note.hidden = !c.describe;
    compareBtn.hidden = small || c.describe;
    timeline.style.setProperty('--sc-p', '0');
    markers.replaceChildren(...c.markers.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sc-marker';
      b.textContent = m.label;
      b.style.left = `${(m.at / c.duration) * 100}%`;
      b.addEventListener('click', () => seek(m.at + 0.01));
      return b;
    }));
    poster.src = posterOf(c.id);
  }

  function start(): void {
    const v = videoFor(cur().id);
    if (!v) return;
    front = v;
    const show = () => { if (front !== v) return; put(v, split); run(v); syncCompare(); };
    if (v.readyState >= 2) show(); else once(v, 'loadeddata', show);
  }

  function switchTo(i: number, from: { x: number; y: number }): void {
    if (i === index || i < 0 || i >= clips.length) return;
    const a = cur();
    const b = clips[i];
    const old = front;
    // both halves halt while the new one seeks, so it starts on exactly the second the old one is on
    if (old) old.pause();
    const t = old && !a.describe && !b.describe ? old.currentTime : 0;
    if (!a.describe) prevIndex = index;
    index = i;
    const my = ++gen;
    applyClip();
    history.replaceState(history.state, '', `${searchWithClip(location.search, b.id)}#themes`);
    const v = old || playing ? videoFor(b.id) : null; // reduced motion and never played: posters only
    if (!v) { park(old); front = null; syncCompare(); return; }
    const seeked = () => {
      if (my !== gen) return;
      put(v, split);
      const detail: SwitchedDetail = { from: a.id, to: b.id, prevTime: old ? old.currentTime : 0, newTime: v.currentTime };
      root.dispatchEvent(new CustomEvent<SwitchedDetail>('showcase:switched', { detail }));
      run(v);
      run(old);
      const done = () => {
        if (my !== gen) { if (v !== front) park(v); return; }
        v.style.clipPath = '';
        if (old && old !== v) park(old);
        front = v;
        syncCompare();
      };
      if (old && !reduced && !compare) {
        const r = stage.getBoundingClientRect();
        const x = from.x - r.left;
        const y = from.y - r.top;
        const R = revealRadius(x, y, r.width, r.height);
        v.animate([{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${R}px at ${x}px ${y}px)` }], { duration: REVEAL_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' }).finished.then(done, done);
      } else done();
    };
    const seekTo = () => {
      if (my !== gen) return;
      if (Math.abs(v.currentTime - t) < 0.001) seeked();
      else { once(v, 'seeked', seeked); v.currentTime = t; }
    };
    if (v.readyState >= 1) seekTo(); else once(v, 'loadedmetadata', seekTo);
  }

  function syncCompare(): void {
    const on = compare && !cur().describe && !small && !!front;
    stage.classList.toggle('comparing', on);
    const want = on ? videoFor(clips[prevIndex].id) : null;
    if (back && back !== want) park(back);
    back = want;
    if (!back || !front) return;
    const b = back;
    const f = front;
    b.classList.add('sc-back');
    put(b, f);
    const align = () => { if (back === b && front === f) { b.currentTime = f.currentTime; if (!f.paused) run(b); } };
    if (b.readyState >= 1) align(); else once(b, 'loadedmetadata', align);
  }

  function setCompare(on: boolean): void {
    compare = on;
    compareBtn.setAttribute('aria-pressed', String(on));
    syncCompare();
  }

  function seek(t: number): void {
    for (const v of [front, back]) if (v) v.currentTime = t;
  }

  function setPlaying(on: boolean): void {
    playing = on;
    root.classList.toggle('sc-paused', !on);
    if (on && !front) { start(); return; }
    for (const v of [front, back]) if (v) { if (on) run(v); else v.pause(); }
  }

  // ---- scrubbing: drag the picture (relative) or the timeline (absolute); a press without a drag on the picture pauses
  let drag: { id: number; x: number; t0: number; moved: boolean; onTimeline: boolean; was: boolean } | null = null;
  function scrub(e: PointerEvent): void {
    if (!drag) return;
    const d = cur().duration;
    if (drag.onTimeline) { const r = timeline.getBoundingClientRect(); seek(timeOnTimeline(e.clientX, r.left, r.width, d)); }
    else seek(timeAfterDrag(drag.t0, e.clientX - drag.x, stage.getBoundingClientRect().width, d));
  }
  function down(e: PointerEvent, onTimeline: boolean): void {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    if (!onTimeline && small) return; // phones: the picture scrolls the page; scrub on the timeline
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, t0: front?.currentTime ?? 0, moved: onTimeline, onTimeline, was: playing };
    if (onTimeline) { for (const v of [front, back]) v?.pause(); scrub(e); }
  }
  function move(e: PointerEvent): void {
    if (compare && e.currentTarget === stage) {
      const r = stage.getBoundingClientRect();
      stage.style.setProperty('--sc-split', `${Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))}%`);
    }
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x) < DRAG_SLOP) return;
      drag.moved = true;
      for (const v of [front, back]) v?.pause();
    }
    scrub(e);
  }
  function up(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, was } = drag;
    drag = null;
    if (!moved) { setPlaying(!playing); return; }
    if (was) setPlaying(true);
  }
  stage.addEventListener('pointerdown', (e) => down(e, false));
  timeline.addEventListener('pointerdown', (e) => down(e, true));
  for (const el of [stage, timeline]) {
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => { drag = null; });
  }

  const centre = () => { const r = stage.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  picks.forEach((p, i) => {
    p.addEventListener('click', (e) => switchTo(i, e.detail > 0 ? { x: e.clientX, y: e.clientY } : centre()));
    // hovering a theme loads its recording, so the switch is instant
    p.addEventListener('pointerenter', () => { if (!small && (playing || front)) videoFor(clips[i].id); });
  });
  compareBtn.addEventListener('click', () => setCompare(!compare));
  playBtn.addEventListener('click', () => setPlaying(true));
  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const t = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === ' ' && t.closest('button')) return; // a focused button's own space
    const m = showcaseKey(e.key, index, clips.length);
    if (!m) return;
    e.preventDefault();
    if (m.kind === 'toggle') { setPlaying(!playing); return; }
    switchTo(m.index, centre());
    picks[m.index]?.focus({ preventScroll: true });
  });

  // ---- the buttons' process animations and the progress line run only while the section is on screen
  let stops: (() => void)[] = [];
  function glyphs(on: boolean): void {
    for (const s of stops) s();
    stops = [];
    if (!on || reduced) return;
    picks.forEach((p, i) => {
      const el = p.querySelector<HTMLElement>('.sc-glyph');
      const g = clips[i].glyph;
      if (el && g.frames.length) stops.push(playGlyph({ el, frames: g.frames, fps: g.fps, once: false }));
    });
  }
  function tick(): void {
    raf = 0;
    if (!visible) return;
    const v = front;
    if (v) {
      timeline.style.setProperty('--sc-p', String(Math.min(1, v.currentTime / cur().duration)));
      if (back && !v.paused && !back.seeking && Math.abs(back.currentTime - v.currentTime) > DRIFT) back.currentTime = v.currentTime;
    }
    raf = requestAnimationFrame(tick);
  }
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    glyphs(visible);
    if (visible) { run(front); run(back); if (!raf) raf = requestAnimationFrame(tick); }
    else { front?.pause(); back?.pause(); }
  }, { threshold: 0.05 }).observe(root);

  // posters: the current one, then the other ten; then the current recording (unless motion is reduced)
  applyClip();
  for (const c of clips) if (c.id !== cur().id) { const im = new Image(); im.decoding = 'async'; im.src = posterOf(c.id); }
  setPlaying(playing);
}
```

- [ ] **Step 6: 挂进首页和导航**

`site/src/views/Home.astro`：frontmatter 加 `import Showcase from '../showcase/Showcase.astro';`；在 `<section class="stats"` 那一行**前面**加一行：

```astro
  <Showcase locale={locale} />
```

`site/src/components/Header.astro`：在「功能」那个 `<a class="nav-wide" href={href(base, locale, 'home', '#features')}>…</a>` 后面加：

```astro
    <a class="nav-wide" href={href(base, locale, 'home', '#themes')}>{c.nav.themes}</a>
```

- [ ] **Step 7: 测试、类型、构建**

Run: `npm test --prefix site && npx tsc --noEmit -p site && node scripts/i18n/extract.mjs --check`
Expected: 全过。

Run: `cd site && SITE_MEDIA_DIR=.media-local npm run build; cd ..`
Expected: 构建成功；`site media: 110 files …`；两个首页的预算行都 ≤ 1.5 MB。再确认 HTML 里没有直接引录像：

Run: `grep -c 'themes/[a-z]*\.\(en\|zh\)' site/dist/index.html`
Expected: `0`。

- [ ] **Step 8: 用眼睛看一遍**

Run（后台）：`npm run preview --prefix site`（http://localhost:4321/）。
Run：`env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe "$(pwd -W)/scripts/shot.cjs" "localhost:4321/?lang=en&theme=ink#themes" "$TEMP/sc-ink.png" "" 6000 1360 900`
用 Read 打开 `$TEMP/sc-ink.png`：窗口标题 `Claude Web — SumiInk`，整段是浅色，窗口里是 ink 的替身画面（米色底、`ink en` 字样、时间在走），下面一条时间轴 + 三个标记，11 个按钮里「SumiInk」高亮。看完停掉 preview。

- [ ] **Step 9: Commit**

```bash
git add site/src/showcase/data.ts site/src/showcase/player.ts site/src/showcase/Showcase.astro site/src/styles/showcase.css site/src/copy.ts site/src/i18n/en.ts site/src/views/Home.astro site/src/components/Header.astro
git commit -m "feat(site): 主题放映厅——同一秒切换、拖动、标记、对比、暂停、?theme= 深链接"
```

---

### Task 5: 构建后的真浏览器冒烟

**Files:**
- Create: `scripts/site-showcase-smoke.cjs`

**Interfaces:**
- Consumes: Task 4 的 DOM 约定和 `showcase:switched` 事件；`site/dist/`（带录像，`SITE_MEDIA_DIR=.media-local` 构建的替身或 Task 8 的真录像）。
- Produces: `env -u ELECTRON_RUN_AS_NODE node scripts/site-showcase-smoke.cjs` → 成功打印 `showcase smoke: ok`、退出码 0。

- [ ] **Step 1: 写脚本**

```js
// The theme showcase in a real browser (spec §9): serves the built site (site/dist, with its recordings in themes/),
// opens the home page in Electron and switches through every clip, asserting each new recording starts within 0.1 s
// of the second the previous one was on, that keys and compare work, that ?theme= picks (or falls back), and that the
// console stays free of errors.
//   cd site && SITE_MEDIA_DIR=.media-local npm run build && cd ..     (stand-ins; or a normal build with real media)
//   env -u ELECTRON_RUN_AS_NODE node scripts/site-showcase-smoke.cjs
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.webm': 'video/webm', '.mp4': 'video/mp4', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

// a static server with byte ranges (a <video> seeks with them)
function serve(dist) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(dist, p);
      if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404).end(); return; }
      const size = fs.statSync(f).size;
      const type = MIME[path.extname(f)] ?? 'application/octet-stream';
      const m = /bytes=(\d*)-(\d*)/.exec(q.headers.range ?? '');
      if (m) {
        const a = m[1] ? Number(m[1]) : size - Number(m[2]);
        const b = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        r.writeHead(206, { 'content-type': type, 'content-range': `bytes ${a}-${b}/${size}`, 'accept-ranges': 'bytes', 'content-length': b - a + 1 });
        fs.createReadStream(f, { start: a, end: b }).pipe(r);
        return;
      }
      r.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
      fs.createReadStream(f).pipe(r);
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

async function driver() {
  const { app, BrowserWindow } = require('electron');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  await app.whenReady();
  const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const wc = win.webContents;
  const errors = [];
  wc.on('console-message', (a, b, c) => {
    const level = typeof a === 'object' && a && 'level' in a ? a.level : b;
    const message = typeof a === 'object' && a && 'message' in a ? a.message : c;
    if (level === 'error' || Number(level) >= 3) errors.push(String(message).slice(0, 400));
  });
  const js = (code) => wc.executeJavaScript(code, true);
  const waitFor = async (code, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await js(code)) return true; } catch { /* navigating */ } await sleep(100); } return false; };
  const current = () => js("document.querySelector('#themes').dataset.scCurrent");
  const press = (keyCode) => { wc.sendInputEvent({ type: 'keyDown', keyCode }); if (/^[0-9]$/.test(keyCode)) wc.sendInputEvent({ type: 'char', keyCode }); wc.sendInputEvent({ type: 'keyUp', keyCode }); };
  const open = async (q) => {
    await win.loadURL(process.env.SMOKE_URL + q);
    if (!(await waitFor("document.querySelector('#themes')?.dataset.mounted === '1'"))) throw new Error(`the showcase did not mount on ${q}`);
  };
  const listen = () => js("window.__sw = []; document.querySelector('#themes').addEventListener('showcase:switched', (e) => window.__sw.push(e.detail)); true");
  const checkSwitch = async (n, to) => {
    if (!(await waitFor(`window.__sw.length > ${n}`, 10000))) throw new Error(`no switch to ${to}`);
    const d = await js(`window.__sw[${n}]`);
    const want = d.to === 'describe' || d.from === 'describe' ? 0 : d.prevTime;
    console.log(`${d.from} -> ${d.to}: ${d.prevTime.toFixed(3)} -> ${d.newTime.toFixed(3)}`);
    if (d.to !== to) throw new Error(`switched to ${d.to}, wanted ${to}`);
    if (Math.abs(d.newTime - want) > 0.1) throw new Error(`${to} started ${Math.abs(d.newTime - want).toFixed(3)} s away from ${want.toFixed(3)}`);
  };

  try {
    await open('/?lang=en&theme=phosphor#themes');
    if (!(await waitFor("(() => { const v = document.querySelector('#themes .sc-stage video'); return !!v && v.currentTime > 1.5; })()", 20000))) throw new Error('the first recording does not play');
    await listen();
    const ids = await js("[...document.querySelectorAll('#themes .sc-pick')].map((b) => b.dataset.id)");
    if (ids.length !== 11) throw new Error(`${ids.length} theme buttons`);
    for (let i = 1; i < ids.length; i++) {
      const n = await js('window.__sw.length');
      await js(`document.querySelector('#themes .sc-pick[data-id="${ids[i]}"]').click()`);
      await checkSwitch(n, ids[i]);
      if ((await current()) !== ids[i]) throw new Error(`data-sc-current is not ${ids[i]}`);
      await sleep(900);
    }
    // keys, with the section focused: describe → (wrap) phosphor → abyss, then 3 = koi
    await js("document.querySelector('#themes').focus(); true");
    for (const [key, want] of [['Right', 'phosphor'], ['Right', 'abyss'], ['3', 'koi']]) {
      const n = await js('window.__sw.length');
      press(key);
      await checkSwitch(n, want);
      await sleep(900);
    }
    // compare: abyss (the one before) on the left, koi on the right, in step
    await js("document.querySelector('#themes .sc-compare').click(); true");
    await sleep(2000);
    const pair = await js("[...document.querySelectorAll('#themes .sc-stage video')].map((v) => ({ id: v.dataset.id, t: v.currentTime, back: v.classList.contains('sc-back') }))");
    const left = pair.find((p) => p.back);
    if (pair.length !== 2 || !left || left.id !== 'abyss') throw new Error(`compare shows ${JSON.stringify(pair)}`);
    if (Math.abs(pair[0].t - pair[1].t) > 0.1) throw new Error(`compare halves ${Math.abs(pair[0].t - pair[1].t).toFixed(3)} s apart`);
    // deep links
    await open('/?lang=en&theme=nope#themes');
    if ((await current()) !== 'phosphor') throw new Error('?theme=nope did not fall back to phosphor');
    await open('/zh/?theme=ink#themes');
    if ((await current()) !== 'ink') throw new Error('?theme=ink was not picked on /zh/');
    await sleep(1500);
    if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`);
    console.log('showcase smoke: ok');
    app.exit(0);
  } catch (e) {
    console.error(`FAIL ${e.message}`);
    app.exit(1);
  }
}

async function runner() {
  const dist = path.join(ROOT, 'site', 'dist');
  for (const f of ['index.html', 'zh/index.html', 'themes/phosphor.en.webp', 'themes/phosphor.en.webm', 'themes/ink.zh.mp4']) {
    if (!fs.existsSync(path.join(dist, f))) { console.error(`missing site/dist/${f}: build the site with its media first (cd site && SITE_MEDIA_DIR=.media-local npm run build)`); process.exit(2); }
  }
  const server = await serve(dist);
  const env = { ...process.env, SMOKE_URL: `http://127.0.0.1:${server.address().port}` };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const code = await new Promise((res) => {
    const p = spawn(electron, [__filename], { env, stdio: 'inherit', windowsHide: true });
    const t = setTimeout(() => { p.kill(); res(-1); }, 180_000);
    p.on('exit', (c) => { clearTimeout(t); res(c); });
  });
  server.close();
  process.exit(code === 0 ? 0 : 1);
}

if (process.versions.electron) driver();
else runner().catch((e) => { console.error(e); process.exit(2); });
```

- [ ] **Step 2: 跑（构建是 Task 4 Step 7 的替身构建）**

Run: `env -u ELECTRON_RUN_AS_NODE -u CLAUDE_WEB_DIST node scripts/site-showcase-smoke.cjs`
Expected: 13 行 `a -> b: x -> y`（主题之间两个数相差 ≤ 0.1；进 / 出 describe 的那两行新时间是 0），最后 `showcase smoke: ok`，退出码 0。

失败时先修 `player.ts`（不是放宽断言）。常见：时间差 > 0.1 → 检查 `switchTo` 是否在 seek 前暂停了旧录像；`console errors` 里有 404 → 构建时没带 `SITE_MEDIA_DIR`。

- [ ] **Step 3: 反向验证一次断言是真的**

临时把 `player.ts` 里 `const t = old && !a.describe && !b.describe ? old.currentTime : 0;` 改成 `const t = 0;`，重新构建（`cd site && SITE_MEDIA_DIR=.media-local npm run build; cd ..`）再跑冒烟。
Expected: `FAIL abyss started … s away`。改回来、再构建、再跑，回到 `ok`。

- [ ] **Step 4: Commit**

```bash
git add scripts/site-showcase-smoke.cjs
git commit -m "test(site): 放映厅的真浏览器冒烟——逐个切换同一秒、键盘、对比、深链接、控制台无错"
```

---

### Task 6: 假上游的录制剧本

**Files:**
- Modify: `scripts/lib/demo.cjs`
- Test: `scripts/lib/demo.test.cjs`

**Interfaces:**
- Consumes: `scripts/lib/fixtures/theme-metro/`（Task 1）。
- Produces（`scripts/lib/demo.cjs`，旧调用方 `readme-shots.cjs` / `i18n-smoke.cjs` 行为不变）：
  - `TEXT[lang]` 新增：`recIntro`、`recIntroSay`、`rec`、`recSay: [string, string, string]`、`recTestDesc`、`recDone`、`themeAsk`、`themeSay: [string, string, string]`、`themeDone`
  - `seedDemo(home, lang, opts = {})`：`opts.clean` 为真时 `src/cart.ts`、`tests/cart.test.ts` 保持提交时的旧内容（录像里的 Edit 要找得到 `old_string`）
  - `startUpstream(lang, opts = {})`：`opts.shop`（演示仓库路径，工具参数里的文件路径用它）、`opts.pace`（延时倍数，默认 1；测试用 0）。请求里带 `tools` 时按剧本回放：
    - 最后一句用户话含 `recIntro` → 一段文字（`recIntroSay`），结束
    - 含 `rec` 且工具里有 `Read` → 第 0 步：文字 + `Read src/cart.ts`；第 1 步：文字 + `Edit`（旧 → 新取整）；第 2 步：文字 + `Bash npm test`（`acceptEdits` 下这一步弹权限卡）；之后：`recDone`
    - 含 `themeAsk` → `theme_draft`（fixture 的 json / backdrop / css）→ `theme_save {id:'metro'}` → `theme_apply {id:'metro'}`（弹权限卡）→ `themeDone`。工具里有 `mcp__web__theme_draft` 就直接叫它；没有而有 `ExecuteExtraTool`（ccb 把 MCP 工具藏在它后面）就包成 `ExecuteExtraTool { tool_name, params }`
    - 「第几步」= 那句用户话之后有几条带 `tool_result` 的用户消息；文字和工具参数分块流出，块间隔 × `pace`
  - `startServer(home, opts)` 新增：`opts.dist`（设 `CLAUDE_WEB_DIST`，在删环境变量之后）、`opts.fromSource`（`node --import tsx server/src/index.ts` 代替 `server/dist/index.js`）

- [ ] **Step 1: 写失败的测试** `scripts/lib/demo.test.cjs`

```js
// The fake upstream's recording scripts (scripts/record-themes.cjs): run with `node --test scripts/lib/demo.test.cjs`.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const demo = require('./demo.cjs');

const post = (url, body) => new Promise((res, rej) => {
  const q = http.request(`${url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (r) => { let s = ''; r.on('data', (c) => { s += c; }); r.on('end', () => res(s)); });
  q.on('error', rej);
  q.end(JSON.stringify(body));
});
const events = (sse) => sse.split('\n\n').filter((b) => b.includes('data: ')).map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: ')).slice(6)));
const toolOf = (sse) => {
  const ev = events(sse);
  const start = ev.find((e) => e.type === 'content_block_start' && e.content_block.type === 'tool_use');
  if (!start) return null;
  const json = ev.filter((e) => e.type === 'content_block_delta' && e.index === start.index).map((e) => e.delta.partial_json).join('');
  return { name: start.content_block.name, input: JSON.parse(json) };
};
const textOf = (sse) => events(sse).filter((e) => e.type === 'content_block_delta' && e.delta.type === 'text_delta').map((e) => e.delta.text).join('');
const stopOf = (sse) => events(sse).find((e) => e.type === 'message_delta').delta.stop_reason;
const used = (id, name) => ({ role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }] });
const result = (id) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }, { type: 'text', text: '<system-reminder>x</system-reminder>' }] });
const shop = path.join('C:', 'work', 'acme-shop');

test('the recorded turn: Read → Edit → npm test, then done', async () => {
  const up = await demo.startUpstream('en', { shop, pace: 0 });
  try {
    const T = demo.TEXT.en;
    const tools = [{ name: 'Read' }, { name: 'Edit' }, { name: 'Bash' }];
    const ask = { role: 'user', content: [{ type: 'text', text: '<system-reminder>x</system-reminder>' }, { type: 'text', text: T.rec }] };
    let messages = [ask];
    const r1 = toolOf(await post(up.url, { model: 'm', stream: true, tools, messages }));
    assert.equal(r1.name, 'Read');
    assert.equal(r1.input.file_path, path.join(shop, 'src', 'cart.ts'));
    messages = [...messages, used('a', 'Read'), result('a')];
    const r2 = toolOf(await post(up.url, { model: 'm', stream: true, tools, messages }));
    assert.equal(r2.name, 'Edit');
    assert.equal(r2.input.old_string, '  return total - total * (percent / 100);');
    messages = [...messages, used('b', 'Edit'), result('b')];
    const s3 = await post(up.url, { model: 'm', stream: true, tools, messages });
    assert.deepEqual(toolOf(s3), { name: 'Bash', input: { command: 'npm test', description: T.recTestDesc } });
    assert.equal(stopOf(s3), 'tool_use');
    messages = [...messages, used('c', 'Bash'), result('c')];
    const s4 = await post(up.url, { model: 'm', stream: true, tools, messages });
    assert.equal(toolOf(s4), null);
    assert.equal(stopOf(s4), 'end_turn');
    // a side request (a title: no tools) with the same words is not the turn
    assert.equal(toolOf(await post(up.url, { model: 'm', stream: true, messages: [ask] })), null);
  } finally { up.server.close(); }
});

test('the intro answers in words', async () => {
  const up = await demo.startUpstream('zh', { shop, pace: 0 });
  try {
    const s = await post(up.url, { model: 'm', stream: true, tools: [{ name: 'Read' }], messages: [{ role: 'user', content: demo.TEXT.zh.recIntro }] });
    assert.equal(textOf(s), demo.TEXT.zh.recIntroSay);
    assert.equal(stopOf(s), 'end_turn');
  } finally { up.server.close(); }
});

test('the described theme: draft (the metro fixture) → save → apply, direct or behind ExecuteExtraTool', async () => {
  const up = await demo.startUpstream('en', { shop, pace: 0 });
  try {
    const ask = { role: 'user', content: demo.TEXT.en.themeAsk };
    const direct = [{ name: 'mcp__web__theme_draft' }, { name: 'mcp__web__theme_save' }, { name: 'mcp__web__theme_apply' }];
    const d1 = toolOf(await post(up.url, { model: 'm', stream: true, tools: direct, messages: [ask] }));
    assert.equal(d1.name, 'mcp__web__theme_draft');
    assert.equal(d1.input.json.id, 'metro');
    assert.equal(typeof d1.input.backdrop, 'string');
    assert.equal(typeof d1.input.css, 'string');
    const d2 = toolOf(await post(up.url, { model: 'm', stream: true, tools: direct, messages: [ask, used('a', 'x'), result('a')] }));
    assert.deepEqual(d2, { name: 'mcp__web__theme_save', input: { id: 'metro' } });
    const d3 = toolOf(await post(up.url, { model: 'm', stream: true, tools: direct, messages: [ask, used('a', 'x'), result('a'), used('b', 'x'), result('b')] }));
    assert.deepEqual(d3, { name: 'mcp__web__theme_apply', input: { id: 'metro' } });
    const w1 = toolOf(await post(up.url, { model: 'm', stream: true, tools: [{ name: 'Read' }, { name: 'ExecuteExtraTool' }], messages: [ask] }));
    assert.equal(w1.name, 'ExecuteExtraTool');
    assert.equal(w1.input.tool_name, 'mcp__web__theme_draft');
    assert.equal(w1.input.params.json.id, 'metro');
  } finally { up.server.close(); }
});

test('the old demo is unchanged: the .gitignore conversation still asks to Write', async () => {
  const up = await demo.startUpstream('en');
  try {
    const s = await post(up.url, { model: 'm', stream: true, messages: [{ role: 'user', content: demo.TEXT.en.gitignore }] });
    assert.equal(toolOf(s).name, 'Write');
  } finally { up.server.close(); }
});
```

- [ ] **Step 2: 跑，确认失败**

Run: `node --test scripts/lib/demo.test.cjs`
Expected: 前三个 FAIL（`T.rec` 是 `undefined`，读不到工具），第四个 PASS。

- [ ] **Step 3: 文案**（Edit `scripts/lib/demo.cjs`）

英文：把 `    sys: 'Claude Web',\n  },\n  zh: {` 换成：

```js
    sys: 'Claude Web',
    recIntro: 'Take a look at the cart module first',
    recIntroSay: 'The cart module is `src/cart.ts`: `subtotal`, `applyCoupon` and `total`, with one test in `tests/cart.test.ts`.',
    rec: 'Round the coupon discount to whole cents, then run the tests',
    recSay: ['Let me read how the discount is applied.', 'The discount is a float. I’ll round it to whole cents.', 'Now the tests.'],
    recTestDesc: 'Run the tests',
    recDone: 'All tests pass.',
    themeAsk: 'A metro station late at night, green signal lights blinking',
    themeSay: ['A late-night metro: a dark platform and green signal lights. I’ll draft it and look at the trial run.', 'The trial run looks right. Saving it.', 'Switching to it now.'],
    themeDone: 'Done: the Metro theme is on.',
  },
  zh: {
```

中文：把 `    sys: 'Claude Web',\n  },\n};` 换成：

```js
    sys: 'Claude Web',
    recIntro: '先看一下购物车模块',
    recIntroSay: '购物车模块在 `src/cart.ts`：`subtotal`、`applyCoupon` 和 `total`，测试在 `tests/cart.test.ts`，目前只有一个。',
    rec: '把优惠券的折扣取整到分，然后跑一下测试',
    recSay: ['我先看一下折扣是怎么减的。', '折扣是浮点数，我把它取整到分。', '跑一下测试。'],
    recTestDesc: '跑测试',
    recDone: '测试全部通过。',
    themeAsk: '深夜的地铁站，绿色的指示灯在闪',
    themeSay: ['深夜的地铁站：暗下来的站台、绿色的信号灯。我先起个草稿，看看试跑。', '试跑看着没问题，存下来。', '现在换上。'],
    themeDone: '好了，换上了「地铁站」。',
  },
};
```

（`scripts/lib/` 不在 i18n 扫描范围里：这是录进画面的「用户」和「模型」说的话，不是界面文字。）

- [ ] **Step 4: `seedDemo` 的 `clean`**

`function seedDemo(home, lang) {` → `function seedDemo(home, lang, opts = {}) {`；把

```js
  fs.writeFileSync(path.join(shop, 'src/cart.ts'), CART_NEW); // what the conversation below did: real uncommitted changes
  fs.writeFileSync(path.join(shop, 'tests/cart.test.ts'), TEST_NEW);
```

换成

```js
  if (!opts.clean) { // what the conversation below did: real uncommitted changes (a recording starts clean: its Edit needs the old text)
    fs.writeFileSync(path.join(shop, 'src/cart.ts'), CART_NEW);
    fs.writeFileSync(path.join(shop, 'tests/cart.test.ts'), TEST_NEW);
  }
```

- [ ] **Step 5: 剧本**

在 `// ---- the fake Anthropic upstream ----…` 那一行之后、`function startUpstream(lang) {` 之前插入：

```js
// The recordings' scripts (scripts/record-themes.cjs): the same turn, paced the same way, every time. A step is one
// model response; which step comes next = how many tool results follow the user's words. Text and tool arguments
// stream in chunks so the app shows each step running (with the theme's process animation) for a moment.
const sse = (type, o) => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
const pieces = (s, n) => { const cps = Array.from(s); const k = Math.max(1, Math.ceil(cps.length / n)); const out = []; for (let i = 0; i < cps.length; i += k) out.push(cps.slice(i, i + k).join('')); return out; };
const streamText = (i, text, n, gap) => [[0, sse('content_block_start', { index: i, content_block: { type: 'text', text: '' } })], ...pieces(text, n).map((c) => [gap, sse('content_block_delta', { index: i, delta: { type: 'text_delta', text: c } })]), [0, sse('content_block_stop', { index: i })]];
const streamTool = (i, id, name, input, n, gap) => [[0, sse('content_block_start', { index: i, content_block: { type: 'tool_use', id, name, input: {} } })], ...pieces(JSON.stringify(input), n).map((c) => [gap, sse('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: c } })]), [0, sse('content_block_stop', { index: i })]];
const finish = (reason) => [[0, sse('message_delta', { delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 40 } })], [0, sse('message_stop', {})]];

function metroFixture() {
  const d = path.join(__dirname, 'fixtures', 'theme-metro');
  const read = (f) => fs.readFileSync(path.join(d, f), 'utf8');
  return { json: JSON.parse(read('theme.json')), backdrop: read('backdrop.js'), css: read('theme.css') };
}

/** [script, its name] for this request, or null: only main-loop requests (they carry tools) follow a script */
function scriptFor(T, ask, tools, shop) {
  if (!tools.length) return null;
  if (ask.includes(T.recIntro)) return [() => [...streamText(0, T.recIntroSay, 8, 40), ...finish('end_turn')]];
  if (ask.includes(T.rec) && tools.includes('Read')) {
    const cart = path.join(shop, 'src', 'cart.ts');
    return [
      () => [...streamText(0, T.recSay[0], 10, 50), ...streamTool(1, 'toolu_rec_read', 'Read', { file_path: cart }, 12, 50), ...finish('tool_use')],
      () => [[500, ''], ...streamText(0, T.recSay[1], 10, 50), ...streamTool(1, 'toolu_rec_edit', 'Edit', { file_path: cart, old_string: '  return total - total * (percent / 100);', new_string: '  const discount = Math.round(total * percent) / 100;\n  return Math.round((total - discount) * 100) / 100;' }, 16, 45), ...finish('tool_use')],
      () => [[500, ''], ...streamText(0, T.recSay[2], 8, 50), ...streamTool(1, 'toolu_rec_test', 'Bash', { command: 'npm test', description: T.recTestDesc }, 6, 60), ...finish('tool_use')],
      () => [...streamText(0, T.recDone, 6, 40), ...finish('end_turn')],
    ];
  }
  if (ask.includes(T.themeAsk)) {
    // ccb hides MCP tools behind ExecuteExtraTool { tool_name, params }; the official client lists them by name
    const call = (i, id, name, input, n, gap) => (tools.includes(name) || !tools.includes('ExecuteExtraTool')
      ? streamTool(i, id, name, input, n, gap)
      : streamTool(i, id, 'ExecuteExtraTool', { tool_name: name, params: input }, n, gap));
    return [
      () => [...streamText(0, T.themeSay[0], 10, 50), ...call(1, 'toolu_th_draft', 'mcp__web__theme_draft', metroFixture(), 40, 30), ...finish('tool_use')],
      () => [[300, ''], ...streamText(0, T.themeSay[1], 8, 40), ...call(1, 'toolu_th_save', 'mcp__web__theme_save', { id: 'metro' }, 2, 40), ...finish('tool_use')],
      () => [[300, ''], ...streamText(0, T.themeSay[2], 8, 40), ...call(1, 'toolu_th_apply', 'mcp__web__theme_apply', { id: 'metro' }, 2, 40), ...finish('tool_use')],
      () => [...streamText(0, T.themeDone, 6, 40), ...finish('end_turn')],
    ];
  }
  return null;
}
```

`function startUpstream(lang) {` → `function startUpstream(lang, opts = {}) {`，并在它下一行（`const T = TEXT[lang];` 之后）加：

```js
  const pace = opts.pace ?? 1;
  const isResult = (m) => m?.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b?.type === 'tool_result');
  /** the user's last words (system reminders, which start with "<", are not words) and where they are */
  const lastAsk = (msgs) => {
    for (let k = msgs.length - 1; k >= 0; k--) {
      const m = msgs[k];
      if (m?.role !== 'user') continue;
      if (typeof m.content === 'string') return { text: m.content, at: k };
      const words = (Array.isArray(m.content) ? m.content : []).filter((b) => b?.type === 'text' && !String(b.text).startsWith('<'));
      if (words.length) return { text: words.map((b) => b.text).join('\n'), at: k };
    }
    return { text: '', at: -1 };
  };
  const paced = async (s, parts) => { for (const [ms, chunk] of parts) { if (ms && pace) await new Promise((r) => setTimeout(r, ms * pace)); if (chunk) s.write(chunk); } s.end(); };
```

然后在 `      if (hasResult) {` 这一行**之前**插入：

```js
      const ask = lastAsk(msgs);
      const script = scriptFor(T, ask.text, Array.isArray(j.tools) ? j.tools.map((t) => t?.name) : [], opts.shop ?? '');
      if (script) {
        const step = msgs.slice(ask.at + 1).filter(isResult).length;
        void paced(s, [[0, head(j)], ...script[Math.min(step, script.length - 1)]()]);
        return;
      }
```

- [ ] **Step 6: `startServer` 的 `dist` / `fromSource`**

在 `startServer` 里，删环境变量的那行 `for (const k of Object.keys(env)) if (/^(ANTHROPIC_|…` **之后**加：

```js
  // a web build somewhere else than web/dist (the recorder builds its own: a running dev app serves web/dist)
  if (opts.dist) env.CLAUDE_WEB_DIST = opts.dist;
```

把 `const server = spawn(process.execPath, [path.join(ROOT, 'server', 'dist', 'index.js')], …` 的参数数组换成：

```js
opts.fromSource ? ['--import', 'tsx', path.join(ROOT, 'server', 'src', 'index.ts')] : [path.join(ROOT, 'server', 'dist', 'index.js')]
```

（其余参数不变。）

- [ ] **Step 7: 跑测试**

Run: `node --test scripts/lib/demo.test.cjs`
Expected: `# pass 4`、`# fail 0`。

Run: `node --check scripts/lib/demo.cjs && node --check scripts/readme-shots.cjs`
Expected: 无输出（语法正确）。

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/demo.cjs scripts/lib/demo.test.cjs
git commit -m "feat(scripts): 演示假上游加录像剧本——读 / 改 / 跑测试一回合、描述一个新主题，按步回放、节奏固定"
```

---

### Task 7: 录制脚本

**Files:**
- Create: `scripts/record-themes.cjs`

**Interfaces:**
- Consumes: `demo.seedDemo(home, lang, { clean: true })`、`demo.startUpstream(lang, { shop })`、`demo.startServer(home, { lang, shop, theme, settings, dist, fromSource })`、`demo.client`、`demo.TEXT[lang].{recIntro, rec, themeAsk}`（Task 6）；`media.encodeClip` / `media.report`（Task 3）。产品里的：`window.__store.getState()`（`setSetting`、`dispatchLayout`、`metaLoaded`、`agents`）、新对话按钮 `.nav[data-id="sb-new"], .sb-top .nav`、侧栏行 `[data-sid="<id>"]`、输入框 `.composer textarea`、权限卡 `.pdock, .pdock-out` 和它的 `[data-act="allow"]`、主题设置 `ui.theme = 'ascii:<id>'`、`ui.defaultMode`。
- Produces: `env -u ELECTRON_RUN_AS_NODE -u CLAUDE_WEB_DIST node scripts/record-themes.cjs [--lang en|zh] [--only phosphor,ink,describe] [--out <dir>] [--keep-frames] [--describe-runtime claude|ccb]` → `<out>/`（默认 `site/.media-local/`）下每段 5 个文件，文件名同 Task 2。

剧本（秒，从录制开始算；10 段主题完全一样）：

| 秒 | 主题段 | 「描述一个新的」段（15 s，起始主题 phosphor） |
| --- | --- | --- |
| 0–2.7 | 新对话的欢迎页，背景在动；鼠标从左上划到右下（带弧度） | 0–0.5 鼠标移到输入框，0.6 点击 |
| 2.75–3.35 | 鼠标移到侧栏里那条对话，3.35 点开 | 0.8–2.6 打出 `themeAsk`，2.8 回车 |
| 4.5–4.9 | 鼠标移到输入框，4.9 点击 | 假上游：起草（试跑卡片 + 截图）→ 保存 → `theme_apply` 的权限卡 |
| 5.0–5.7 | 打出 `rec`，5.8 回车 | 卡出现后鼠标移到「允许一次」，最早 11.0 点下 |
| 5.8–~9.6 | 读 → 改 → `npm test` 的权限卡（`acceptEdits`：读、改不问） | 整个界面换成 metro |
| 10–12 | 停在权限卡上 | 15 结束 |

- [ ] **Step 1: 写脚本**

```js
// The site's theme showcase recordings (docs/superpowers/specs/2026-10-21-website-design.md §5.2): the real app, one
// clip per built-in character theme with the same scripted actions (12 s), and one "describe a new theme" (15 s),
// in English and Chinese. Nothing real is spent: a throwaway HOME, the demo repo and a fake upstream that replays the
// same turn every time (scripts/lib/demo.cjs). Electron renders offscreen at 1280×800 ×2; every painted frame is kept
// with its time, and ffmpeg resamples them to a constant 30 fps, so frame n is the same moment in every clip.
//   env -u ELECTRON_RUN_AS_NODE -u CLAUDE_WEB_DIST node scripts/record-themes.cjs [--lang en|zh] [--only phosphor,describe] [--out <dir>] [--keep-frames] [--describe-runtime claude|ccb]
// Manual (not in CI). It never touches web/dist: the web app is built into a temp folder and the server runs from source.
// Then: node scripts/upload-site-media.cjs --dir <out> (only when the person in charge says so).
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const demo = require('./lib/demo.cjs');

const THEMES = ['phosphor', 'abyss', 'koi', 'moon', 'dither', 'orb', 'garden', 'paper', 'letters', 'ink'];
const CLIPS = [...THEMES.map((id) => ({ id, theme: id, seconds: 12 })), { id: 'describe', theme: 'phosphor', seconds: 15 }];
const W = 1280;
const H = 800;
const FPS = 30;
const arg = (name, def) => { const i = process.argv.indexOf(name); if (i < 0) return def; const v = process.argv[i + 1]; return v === undefined || v.startsWith('--') ? true : v; };

// --------------------------------------------------------------------------------------------------------- driver
async function driver() {
  const { app, BrowserWindow } = require('electron');
  app.commandLine.appendSwitch('force-device-scale-factor', '2');
  const E = process.env;
  const clip = JSON.parse(E.REC_CLIP);
  const frames = E.REC_FRAMES;
  const sleep = demo.sleep;
  fs.mkdirSync(frames, { recursive: true });
  await app.whenReady();
  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  const wc = win.webContents;
  wc.setFrameRate(FPS);
  const js = (code) => wc.executeJavaScript(code, true);
  const waitFor = async (code, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await js(code)) return true; } catch { /* not ready */ } await sleep(150); } return false; };
  const centreOf = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);

  // ---- set up (not recorded): the app on the demo project, this theme, a new conversation's welcome page
  await win.loadURL(E.REC_URL);
  await js(`localStorage.setItem('cw.lastCwd', ${JSON.stringify(E.REC_SHOP)})`);
  await win.loadURL(E.REC_URL);
  await waitFor('!!document.querySelector(".composer")', 30_000);
  await waitFor('window.__store && window.__store.getState().metaLoaded', 20_000);
  await waitFor('window.__store.getState().agents.length > 0', 40_000);
  await js(`window.__store.getState().setSetting('ui.theme', ${JSON.stringify(`ascii:${clip.theme}`)})`);
  await js("window.__store.getState().dispatchLayout({ t: 'dock.set', patch: { open: false } })");
  await js('(() => { const b = document.querySelector(\'.nav[data-id="sb-new"], .sb-top .nav\'); if (b) b.click(); return !!b; })()');
  await sleep(4000); // the backdrop worker up and drawing

  // ---- recording
  let t0 = 0;
  let n = 0;
  const shots = [];
  let size = null;
  wc.on('paint', (_e, _dirty, image) => {
    if (!t0) return;
    const at = performance.now() - t0;
    const name = `f${String(n++).padStart(5, '0')}.jpg`;
    size = size ?? image.getSize();
    fs.writeFileSync(path.join(frames, name), image.toJPEG(92));
    shots.push({ name, at });
  });
  let mouse = { x: 180, y: 260 };
  const move = (x, y) => { mouse = { x: Math.round(x), y: Math.round(y) }; wc.sendInputEvent({ type: 'mouseMove', x: mouse.x, y: mouse.y }); };
  const clickAt = (p) => { move(p.x, p.y); wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 }); };
  const at = async (ms) => { const d = t0 + ms - performance.now(); if (d > 0) await sleep(d); };
  const glide = async (to, ms0, ms1, bow = 0) => {
    const from = { ...mouse };
    for (let t = ms0; t <= ms1; t += 1000 / FPS) {
      await at(t);
      const k = (t - ms0) / Math.max(1, ms1 - ms0);
      const e = k * k * (3 - 2 * k);
      move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e + Math.sin(k * Math.PI) * bow);
    }
  };
  const typeText = async (text, ms0, ms1) => { const cps = Array.from(text); for (let i = 0; i < cps.length; i++) { await at(ms0 + ((ms1 - ms0) * i) / cps.length); wc.insertText(cps[i]); } };
  const enter = () => { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); wc.sendInputEvent({ type: 'char', keyCode: '\r' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); };
  const log = [];

  move(mouse.x, mouse.y);
  t0 = performance.now();
  wc.invalidate(); // a first frame at 0 even when nothing moves
  if (clip.id !== 'describe') {
    await glide({ x: 1120, y: 560 }, 0, 2700, -120);
    const row = await centreOf(`[data-sid="${E.REC_SID}"]`);
    if (!row) throw new Error(`the conversation ${E.REC_SID} is not in the sidebar`);
    await glide(row, 2750, 3300);
    await at(3350); clickAt(row);
    await at(4500);
    const box = await centreOf('.composer textarea');
    if (!box) throw new Error('no composer after opening the conversation');
    await glide(box, 4500, 4850);
    await at(4900); clickAt(box);
    await typeText(E.REC_ASK, 5000, 5700);
    await at(5800); enter();
    await at(10_000);
    const card = await js('!!document.querySelector(".pdock, .pdock-out")');
    log.push(card ? 'permission card up at 10 s' : 'WARNING: no permission card at 10 s');
    await at(clip.seconds * 1000 + 100);
  } else {
    const box = await centreOf('.composer textarea');
    if (!box) throw new Error('no composer on the welcome page');
    await glide(box, 0, 500);
    await at(600); clickAt(box);
    await typeText(E.REC_THEME_ASK, 800, 2600);
    await at(2800); enter();
    const allowSel = '.pdock [data-act="allow"], .pdock-out [data-act="allow"]';
    let allow = null;
    while (!allow && performance.now() - t0 < 14_000) { allow = await centreOf(allowSel); if (!allow) await sleep(100); }
    if (!allow) throw new Error('the theme_apply permission card never showed');
    const ready = performance.now() - t0;
    log.push(`apply card at ${(ready / 1000).toFixed(1)} s${ready > 11_000 ? ' (WARNING: later than 11 s, the 「换上新主题」 marker is early)' : ''}`);
    const go = Math.max(ready, 10_400);
    await glide(allow, go, go + 500);
    await at(Math.max(go + 600, 11_000)); clickAt(allow);
    await at(clip.seconds * 1000 + 100);
    const applied = await js("document.documentElement.dataset.ascii === 'metro'");
    log.push(applied ? 'metro applied' : 'WARNING: metro is not applied at the end');
  }
  t0 = 0;
  fs.writeFileSync(path.join(frames, 'shots.json'), JSON.stringify({ shots, size, log }));
  app.exit(0);
}

// ------------------------------------------------------------------------------------------------------------ runner
/** the concat demuxer's list: every frame lasts until the next one, the last until the end of the clip */
function writeConcat(dir, shots, seconds) {
  const end = seconds * 1000;
  const kept = shots.filter((s) => s.at < end);
  if (!kept.length) throw new Error('no frames were painted');
  const lines = ['ffconcat version 1.0'];
  kept.forEach((s, i) => {
    const from = i === 0 ? 0 : s.at; // the first frame covers from 0
    const to = i + 1 < kept.length ? kept[i + 1].at : end;
    lines.push(`file '${s.name}'`, `duration ${Math.max(0.001, (to - from) / 1000).toFixed(4)}`);
  });
  lines.push(`file '${kept[kept.length - 1].name}'`); // the demuxer reads the last duration only with the file listed again
  const list = path.join(dir, 'frames.ffconcat');
  fs.writeFileSync(list, `${lines.join('\n')}\n`);
  return { list, count: kept.length };
}

function electronRun(env) {
  const electron = require(path.join(demo.ROOT, 'node_modules', 'electron'));
  const e = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ...env };
  delete e.ELECTRON_RUN_AS_NODE;
  return new Promise((res) => {
    const p = spawn(electron, [__filename], { env: e, stdio: 'inherit', windowsHide: true });
    const t = setTimeout(() => { p.kill(); res(-1); }, 300_000);
    p.on('exit', (c) => { clearTimeout(t); res(c); });
  });
}

async function recordOne(clip, lang, out, dist, opts) {
  const media = require('./lib/media-encode.cjs');
  const T = demo.TEXT[lang];
  const home = demo.tmpHome(`cw-rec-${clip.id}-${lang}-`);
  const seed = demo.seedDemo(home, lang, { clean: true });
  const up = await demo.startUpstream(lang, { shop: seed.shop });
  const srv = await demo.startServer(home, { lang, shop: seed.shop, theme: `ascii:${clip.theme}`, dist, fromSource: true, settings: { 'ui.defaultMode': 'acceptEdits', 'ui.promptSuggestions': false } });
  const c = demo.client(srv.port, srv.token);
  const frames = path.join(out, '.frames', `${clip.id}.${lang}`);
  try {
    await c.ready;
    await c.req({ kind: 'settings.set', key: 'network.proxy', value: 'off' });
    const runtime = clip.id === 'describe' ? opts.describeRuntime : 'ccb';
    const prov = await c.req({ kind: 'providers.upsert', provider: { name: lang === 'zh' ? '中转' : 'Relay', type: 'anthropic', baseUrl: up.url, apiKey: 'sk-demo-not-real', defaultModel: 'claude-sonnet-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5'], runtime } });
    await c.req({ kind: 'settings.set', key: 'defaultProviderId', value: prov.id });
    await c.req({ kind: 'workspaces.add', path: seed.shop });
    let sid = '';
    if (clip.id !== 'describe') {
      // the conversation the clip opens at 3 s: live, edits allowed, one short exchange already in it
      const o = await c.req({ kind: 'session.open', params: { cwd: seed.shop, providerId: prov.id, model: 'claude-sonnet-5-5', permissionMode: 'acceptEdits' } });
      await c.req({ kind: 'session.send', params: { sessionId: o.sessionId, text: T.recIntro, uuid: crypto.randomUUID() } });
      sid = o.sessionId;
      await demo.sleep(6000);
    }
    fs.rmSync(frames, { recursive: true, force: true });
    const code = await electronRun({ REC_URL: srv.url, REC_SHOP: seed.shop, REC_SID: sid, REC_CLIP: JSON.stringify(clip), REC_FRAMES: frames, REC_ASK: T.rec, REC_THEME_ASK: T.themeAsk });
    if (code !== 0) throw new Error(`${clip.id}.${lang}: electron exited ${code}\n${srv.log().slice(-2000)}`);
    const { shots, size, log } = JSON.parse(fs.readFileSync(path.join(frames, 'shots.json'), 'utf8'));
    for (const l of log) console.log(`${clip.id}.${lang}: ${l}`);
    const { list, count } = writeConcat(frames, shots, clip.seconds);
    const fps = count / clip.seconds;
    console.log(`${clip.id}.${lang}: ${count} frames painted (${fps.toFixed(1)} fps) at ${size.width}×${size.height}${fps < 24 ? '  WARNING: under 24 fps, motion will stutter' : ''}${size.width < W * 2 ? '  WARNING: not ×2' : ''}`);
    const master = path.join(frames, 'master.mp4');
    media.ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${FPS},format=yuv420p`, '-t', String(clip.seconds), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', master]);
    media.report(media.encodeClip(master, out, clip.id, lang));
  } finally {
    c.ws.close();
    srv.server.kill();
    up.server.close();
    seed.cleanup();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* a handle may still be held */ }
    if (!opts.keepFrames) fs.rmSync(frames, { recursive: true, force: true });
  }
}

async function runner() {
  const langs = arg('--lang', null) ? [String(arg('--lang'))] : ['en', 'zh'];
  if (langs.some((l) => !['en', 'zh'].includes(l))) throw new Error('--lang en|zh');
  const only = arg('--only', null) ? String(arg('--only')).split(',') : null;
  const clips = CLIPS.filter((c) => !only || only.includes(c.id));
  if (!clips.length) throw new Error(`--only names none of: ${CLIPS.map((c) => c.id).join(' ')}`);
  const out = path.resolve(String(arg('--out', path.join(demo.ROOT, 'site', '.media-local'))));
  const opts = { keepFrames: !!arg('--keep-frames', false), describeRuntime: String(arg('--describe-runtime', 'claude')) };
  require('./lib/media-encode.cjs').webmEncoder(); // fail early on an ffmpeg without the encoders
  fs.mkdirSync(out, { recursive: true });
  // the web app, built where nothing else looks (a running dev app serves web/dist: never rebuild that)
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-rec-web-'));
  console.log(`building the web app into ${dist} …`);
  execFileSync(process.execPath, [path.join(demo.ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', path.join(demo.ROOT, 'web'), '--outDir', dist, '--emptyOutDir'], { cwd: demo.ROOT, stdio: 'inherit', windowsHide: true });
  try {
    for (const lang of langs) for (const clip of clips) {
      console.log(`--- ${clip.id}.${lang}`);
      await recordOne(clip, lang, out, dist, opts);
    }
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
  console.log(`done: ${out}`);
}

if (process.versions.electron) driver().catch((e) => { console.error(e); process.exit(2); });
else runner().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 先确认 vite 在根目录、tsx 能起服务端（只读检查）**

Run: `ls node_modules/vite/bin/vite.js node_modules/tsx/package.json && node --check scripts/record-themes.cjs`
Expected: 两个文件都在；语法检查无输出。若 `node_modules/vite` 不在根目录，改用 `web/node_modules/vite/bin/vite.js`（`ls web/node_modules/vite/bin/vite.js` 确认），只改 `runner()` 里那一处路径。

- [ ] **Step 3: 试录一段主题**

Run（约 5 分钟，后台跑）：`env -u ELECTRON_RUN_AS_NODE -u CLAUDE_WEB_DIST node scripts/record-themes.cjs --lang en --only phosphor --out "$TEMP/rec-try" --keep-frames`
Expected：
- `phosphor.en: permission card up at 10 s`
- `phosphor.en: 3xx frames painted (≥ 24 fps) at 2560×1600`（没有 `WARNING`）
- 5 行文件大小；`phosphor.en.webm` 不带 `over 1.5 MB`

抽 4 帧看：`for s in 1 4 8 11; do ffmpeg -hide_banner -loglevel error -y -ss $s -i "$TEMP/rec-try/phosphor.en.mp4" -frames:v 1 "$TEMP/rec-try/at$s.png"; done`，用 Read 逐张看：1 s 欢迎页 + 磷光背景 + 鼠标；4 s 对话打开、有先前那段交流；8 s 回合在跑（读 / 改的步骤行、过程动画、回复文字）；11 s 权限卡「npm test」。

不对时按现象改（只改录制脚本或 `demo.cjs` 的剧本节奏，不改产品）：
- 侧栏里找不到那条对话 → 看 `.frames/phosphor.en/` 里 3 s 前后的帧，确认行的选择器；产品侧栏行是 `web/src/features/sidebar/rows.tsx` 的 `data-sid`。
- Edit 也弹了卡 → 对话没在 `acceptEdits`：确认 `session.open` 带了 `permissionMode: 'acceptEdits'`。
- 10 s 还没卡 → 调 `demo.cjs` 剧本里 `[500, '']` 和块间隔，让卡在 9–10 s 之间出现。

- [ ] **Step 4: 试录「描述一个新的」**

Run：`env -u ELECTRON_RUN_AS_NODE -u CLAUDE_WEB_DIST node scripts/record-themes.cjs --lang zh --only describe --out "$TEMP/rec-try" --keep-frames`
Expected：`apply card at 9–11 s`、`metro applied`。抽 3、8、13 s 三帧看：输入框里的中文描述；对话里主题草稿卡片带试跑截图；13 s 整个界面是 metro 的绿。

若报 `the theme_apply permission card never showed`：看帧里草稿卡片是否出现。
- 卡片没出现、对话里是 `ExecuteExtraTool` 的普通工具行 → 用了 ccb（MCP 工具被包起来，界面不认主题草稿卡片）：确认 `--describe-runtime claude`（默认）且本机有官方 `claude` 二进制（设置 → 关于里能看到两个运行内核）；没有就把这一点报给控制者，不要改产品。
- 卡片出现但 apply 没有卡 → 用户设置里 apply 被预先允许了？临时 HOME 不该有；检查 `startServer` 的 meta 设置。

- [ ] **Step 5: Commit**

```bash
git add scripts/record-themes.cjs
git commit -m "feat(scripts): 主题放映厅的录制脚本——真应用、同一套动作、逐帧按时间戳重采样成 30 fps"
```

---

### Task 8: 录全部、上传（控制者确认）、验收、笔记

**Files:**
- Modify: `site/media.json`（脚本重写）、`docs/notes/site.md`

**Interfaces:**
- Consumes: Task 3–7 的全部脚本。
- Produces: `site-media` pre-release 上的 110 个文件；与之一致的 `site/media.json`；笔记。

- [ ] **Step 1: 录全部**

Run（每种语言约 40–60 分钟，后台跑，超时给足）：
`env -u ELECTRON_RUN_AS_NODE -u CLAUDE_WEB_DIST node scripts/record-themes.cjs --lang en`
然后 `--lang zh`。输出都到 `site/.media-local/`（覆盖替身）。
Expected：22 段都有 `permission card up at 10 s` 或 `apply card at …` + `metro applied`；没有 `under 24 fps` / `not ×2`；`over 1.5 MB` 的警告逐条记下（超了就把 `scripts/lib/media-encode.cjs` 里 AV1 的 `-crf` 加 2 重编那几段：`--only <id> --lang <lang>`）。

- [ ] **Step 2: 抽查**

对 `phosphor.en`、`ink.zh`、`describe.en` 各抽 1 / 4 / 8 / 11 s 四帧（命令同 Task 7 Step 3，输入换成 `site/.media-local/<id>.<lang>.mp4`），用 Read 看：同一秒的画面在不同主题里是同一个动作（例：8 s 都是「改文件」那一步）。再看 3 张海报 `site/.media-local/<id>.<lang>.webp`（Read 读不了 webp 就先 `ffmpeg -i x.webp x.png`）。

- [ ] **Step 3: 写清单（不上传）**

Run: `node scripts/upload-site-media.cjs --dir site/.media-local --manifest-only && npm test --prefix site -- src/showcase/media.test.ts`
Expected：`site/media.json: 110 files, … MB, webm av01.0.08M.08`；测试通过。

- [ ] **Step 4: 【控制者步骤】上传**

这一步改公开的 GitHub release，**由控制者向用户确认后**执行，执行任务的子代理不跑：

Run: `node scripts/upload-site-media.cjs --dir site/.media-local`
Expected：第一次会 `gh release create site-media --prerelease …`，然后分 11 批上传，最后 `uploaded 110 files to ypyik0669/claude-web@site-media`。
Run: `gh release view site-media --repo ypyik0669/claude-web --json isPrerelease,assets -q '.isPrerelease, (.assets | length)'`
Expected：`true`、`110`。

- [ ] **Step 5: 从 release 构建，验证真的能下**

Run: `rm -rf site/.media-cache && npm run build --prefix site`
Expected：`site media: 110 files in dist/themes/ (0 missing)`，预算两行 ≤ 1.5 MB。

Run: `env -u ELECTRON_RUN_AS_NODE -u CLAUDE_WEB_DIST node scripts/site-showcase-smoke.cjs`
Expected：`showcase smoke: ok`。

再用 Task 4 Step 8 的办法截 `?lang=en&theme=koi#themes` 和 `/zh/?theme=describe#themes` 两张，Read 看：真录像、标题栏、配色对得上。

- [ ] **Step 6: 笔记**

在 `docs/notes/site.md` 末尾加一节：

```markdown
## 主题放映厅（2026-10-22）

- 代码在 `site/src/showcase/`：`Showcase.astro`（构建时把配色、按钮的过程动画帧、文案写进页面）、`player.ts`（进视口前一屏才 `import()`）。主题数据直接读产品的 `web/src/themes/builtin/*/theme.json`，经别名 `@themes`（`server/src/themes/core`）/ `@web-themes`（`web/src/themes`），只用 `parsePack` / `paletteCss` / `animFor` / `frameHtml` / ticker 的 `play`。
- 配色：按钮用自己主题的变量（产品名 `--bg --accent …`），整段用当前主题的 `--sc-*`（`showcase.css` 里 `@property` 注册，切换 400 ms 过渡）。对比度：`showcase/themes.test.ts` 用产品的 `contrastProblems` 和这一段实际用到的几对颜色。
- 同一秒切换：切换前先暂停旧录像，新录像 seek 到那一秒、`seeked` 后两个一起播；每次派发 `showcase:switched`（冒烟测试读它）。
- 录像不进仓库：`site/media.json`（110 个文件的 sha256 / 字节数）+ pre-release `site-media`。构建时 `site/scripts/fetch-media.ts` 下载进 `dist/themes/`（缓存 `site/.media-cache/`）：哈希不对构建失败，下不到只警告（显示海报 / 占位）。`SITE_MEDIA=off` 跳过（PR 的 CI），`SITE_MEDIA_DIR=.media-local` 用本地的。HTML 里不能直接引 `/themes/…`（会算进首页 1.5 MB 预算）。
- 重录：`env -u ELECTRON_RUN_AS_NODE -u CLAUDE_WEB_DIST node scripts/record-themes.cjs [--lang] [--only]` → `node scripts/upload-site-media.cjs --dir site/.media-local`（改公开 release，先问用户）→ 提交 `site/media.json`。界面或主题改了就该重录。录制脚本**不碰 `web/dist`**：前端构建到临时目录、服务端从源码跑（开发中的 Claude Web 用着 `web/dist`，重建会把它弄坏）。
- 录制剧本在 `scripts/lib/demo.cjs` 的 `scriptFor`：带 `tools` 的请求才按剧本走（标题之类的旁路请求不算），第几步 = 那句话之后的 `tool_result` 数。「描述一个新的」那段默认用官方运行内核：ccb 把 MCP 工具包在 `ExecuteExtraTool` 里，界面不显示主题草稿卡片。
- 替身录像：`node scripts/make-standin-clips.cjs`（主题底色 + 测试图 + 文字），给还没真录像时构建和冒烟用。冒烟：`env -u ELECTRON_RUN_AS_NODE node scripts/site-showcase-smoke.cjs`（要先带录像构建）。
- ffmpeg：本机 8.1 没有 `libsvtav1`，webm 用 `libaom-av1`（`media.json` 的 `webmCodecs` 记实际编码，播放器拿它问 `canPlayType`，不行就放 mp4）。
```

- [ ] **Step 7: 全量检查并提交**

Run: `npm test --prefix site && npx tsc --noEmit -p site && node scripts/i18n/extract.mjs --check && node --test scripts/lib/demo.test.cjs`
Expected：全过。

```bash
git add site/media.json docs/notes/site.md
git commit -m "feat(site): 主题放映厅换上真录像（site-media），笔记"
```

---

## 自查记录

- 设计覆盖：§5.1 布局 / 同一条时间线 / 五种交互 / 描述一个新的 / 加载顺序 / 手机与减少动画与加载失败 → Task 4（+ 2 的纯函数）；§5.2 录制、剧本、恒定 30 fps、五种输出、大小报警、不进 CI、release + `media.json` + 构建时校验 → Task 3、6、7、8；§7 预算排除 → Task 3 Step 9 / Task 4 Step 7 的检查；§9 片段表 ↔ 清单、parsePack + 配色、对比度、`?theme=`、fetch 的失败与不可达、真浏览器逐个切换 ≤ 0.1 s 和控制台无错、对比同步 → Task 1、2、3、5。导航「主题」→ Task 4 Step 6。
- 名字一致：`expectedMediaFiles` / `videoFile` / `posterFile`（Task 2 定义，3、4 使用）；`showcase:switched` 的 `{ from, to, prevTime, newTime }`（Task 4 定义，5 使用）；`startUpstream(lang, { shop, pace })`、`seedDemo(…, { clean })`、`startServer(…, { dist, fromSource })`（Task 6 定义，7 使用）；`encodeClip` / `report` / `webmCodecs` / `ff`（Task 3 定义，7、`upload` 使用）。
- 已核对的事实：主题 id 与 `ORDER`、各 theme.json 的中英名和 mode、`parsePack` / `paletteCss`（选择器 `html:root[data-ascii='<id>']`）/ `animFor` / `frameHtml` / ticker `play` 的签名、`contrastProblems`（10 套和 metro 都为空）、产品设置键 `ui.theme = 'ascii:<id>'` 和 `ui.defaultMode`、权限卡 `[data-act="allow"]`、侧栏 `data-sid`、`THEME_FREE_TOOLS` 不含 `theme_apply`（所以它弹卡）、ccb 的 `ExecuteExtraTool` 包装、服务端 `CLAUDE_WEB_DIST`、`releases.ts` 已排除 pre-release、桌面版 `allowPrerelease = false`、ffmpeg 的编码器和 drawtext 写法（本机试过）。

