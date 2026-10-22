# 官网（一）：骨架、页面、下载与发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `site/` 做出一个能上线的 Astro 静态官网：中英两套的首页（首屏先用现成的网吧动图占位）、下载页、更新内容页，自动识别系统的下载按钮，键盘快捷键，GitHub Pages 自动发布。

**Architecture:** `site/` 是新的 npm workspace，Astro 7 静态输出，部署在主域名 `psycioxyxs.my` 的根上（`base: '/'`）。所有可见文字都在 `site/src/copy.ts` 里用 `tr('中文')` 写，英文在 `site/src/i18n/en.ts`，借用产品共享的 `@i18n` 核心（`server/src/i18n/core.ts`）和现有的 i18n 覆盖测试。`.astro` 文件只管结构，不写字。版本和下载链接由构建时的脚本从 GitHub API 抓成 JSON。前端只有一个很小的脚本：识别系统、快捷键、复制按钮。

**Tech Stack:** Astro 7.4.1、@astrojs/markdown-remark 7.3.4、Vitest 4、TypeScript 7、Node 22.22+（类型擦除直接跑 `.ts` 脚本）、GitHub Actions + Pages。

这是三份计划中的第一份。设计文档：`docs/superpowers/specs/2026-10-21-website-design.md`。第二份（首屏网吧场景：分层视差、演示日脚本、章节演戏、微交互、分级降级、海报）和第三份（主题放映厅和录制脚本）等这一份合进去后再写，写的时候以这一份的真实文件为准。

这一份**不包括**（留给后两份）：设计 §4 的网吧场景和章节演戏、§5 的微交互和声音、§7 的像素标题字、海报和三档降级、
§5.1–5.2 的主题放映厅和录制、导航里的「主题」、§9 的 Lighthouse 和集显帧率验收。这一份完成时，首屏是现成的网吧动图，其它都是可用的成品。

## Global Constraints

- Node ≥ 22.22.0。`astro` 精确锁 `7.4.1`（7.4.2 要求 Node ≥ 22.23.4，本机是 22.22.1）。
- `site/` 的依赖只有：`astro` 7.4.1、`@astrojs/markdown-remark` 7.3.4、`vitest` ^4.1.11、`typescript` ^7.0.2。不装 three / gsap / lenis / React。
- 站点地址 `https://psycioxyxs.my/`：GitHub Pages 的自定义域名（DNS 在 Cloudflare），`base: '/'`，`trailingSlash: 'always'`。英文在 `/`，中文在 `/zh/`。
  用 Actions 发布时 Pages 不读 CNAME 文件，域名在仓库的 Pages 设置里绑定（Task 7 Step 11）。
- 用户看得见的字都是 `site/src/*.ts` 里的 `tr('中文')`，英文写在 `site/src/i18n/en.ts`（`EN_SITE`）。`.astro` 文件里不能出现中文。如果某个中文 key 在产品的英文表里已经有了，英文必须一样：`下载` → `Download`，`更新内容` → `What’s new`（弯引号），`复制` → `Copy`，`已复制` → `Copied`。
- 用词：叫「对话」，不叫「会话」；不出现 档案 / 引擎 / 窗格 / 停靠 / ACP / effort / ultracode。
- 不用 localStorage。语言就是 URL：从中文页切到英文页的链接带 `?lang=en`，带了这个参数就不再自动跳转。
- 每个首页（`dist/index.html`、`dist/zh/index.html`）首次加载 ≤ 1.5 MB（1 572 864 字节）。
- 仓库是 LF。文件用 Write / Edit 写，不要在 bash 里用 heredoc 或 `node -e` 生成。提交身份 `ypyik0669`（已经配好）。
- 本机跑测试时，开发 shell 里继承来的环境变量会干扰产品测试；只跑本计划点名的测试文件。

## 文件一览

新建：

| 文件 | 职责 |
| --- | --- |
| `site/package.json`、`site/astro.config.mjs`、`site/tsconfig.json`、`site/vitest.config.ts`、`site/.gitignore`、`site/src/env.d.ts` | workspace 和构建配置 |
| `site/src/i18n/index.ts` | `makeTr(locale)`、`otherLocale`，注册 `EN_SITE` |
| `site/src/i18n/en.ts` | 官网的英文表 |
| `site/src/i18n/languages.ts` | 用每种语言自己的写法写出的语言名（加进覆盖测试的白名单） |
| `site/src/i18n/paths.ts` | `href()`、`langRedirect()` |
| `site/src/copy.ts` | 官网所有文案 |
| `site/src/readme.ts` | 从 README 标题算出 GitHub 锚点链接 |
| `site/src/changelog.ts` | 把 CHANGELOG 整理成页面用的 Markdown |
| `site/src/data/releases.ts`、`site/src/data/site-data.json`、`site/src/data/links.ts`、`site/src/data/agents.ts` | 版本 / 下载数据，固定链接，agent 列表 |
| `site/src/client/os.ts`、`site/src/client/keys.ts`、`site/src/client/main.ts` | 浏览器端：识别系统、快捷键、复制 |
| `site/src/styles/tokens.css`、`site/src/styles/site.css` | 令牌（从产品复制）和站点样式 |
| `site/src/layouts/Base.astro`、`site/src/components/{Header,Footer,DownloadButtons}.astro` | 页面骨架 |
| `site/src/views/{Home,DownloadView,ChangelogView}.astro` | 三个页面的内容（两种语言共用） |
| `site/src/pages/{index,download/index,changelog/index}.astro`、`site/src/pages/zh/…` | 路由：只传 `locale` |
| `site/scripts/releases.ts`、`site/scripts/budget.ts` | 构建时抓数据、检查体积预算 |
| `site/public/icon.svg`、`site/public/og/{en,zh}.png` | 图标、分享图 |
| `.github/workflows/site.yml` | 构建并发布到 Pages |
| `docs/notes/site.md` | 官网笔记 |

测试：`site/src/i18n/paths.test.ts`、`site/src/i18n/text.test.ts`、`site/src/readme.test.ts`、`site/src/changelog.test.ts`、`site/src/data/releases.test.ts`、`site/src/client/os.test.ts`、`site/src/client/keys.test.ts`、`site/scripts/budget.test.ts`。

修改：根 `package.json`、`scripts/i18n/scan.mjs`（`AREAS`）、`web/src/i18n/coverage.test.ts`（`ALLOWED`）、`scripts/icons.cjs`、`CLAUDE.md`（笔记索引加一行）、设计文档 §2（注明替换旧页）。

删除：9 月的旧宣传页 `site/index.html`、`site/page.html`、`site/build.mjs`、`site/assets/`、`site/dist/`、旧的 `site/.gitignore`（用户已同意替换；git 历史里还在）。

---

### Task 1: 新的 site workspace（替换旧页），能构建出空页面

**Files:**
- Delete: `site/index.html`、`site/page.html`、`site/build.mjs`、`site/assets/`、`site/dist/`、`site/.gitignore`
- Create: `site/package.json`、`site/astro.config.mjs`、`site/tsconfig.json`、`site/vitest.config.ts`、`site/.gitignore`、`site/src/env.d.ts`、`site/src/pages/index.astro`、`site/public/icon.svg`
- Modify: 根 `package.json`、`scripts/icons.cjs:5,25-26`、`docs/superpowers/specs/2026-10-21-website-design.md` §2

**Interfaces:**
- Produces: workspace 名 `claude-web-site`；脚本 `npm run build -w site`、`npm test -w site`、`npm run data -w site`；别名 `@i18n` → `server/src/i18n/core.ts`（Astro 和 Vitest 两边都配）。

- [ ] **Step 1: 删掉旧页**

```bash
git rm -r -q site/index.html site/page.html site/build.mjs site/assets site/.gitignore
rm -rf site/dist
ls site
```

预期：`ls site` 没有输出（或者报目录不存在）。

- [ ] **Step 2: 写 `site/package.json`**

```json
{
  "name": "claude-web-site",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "test": "vitest run",
    "data": "node scripts/releases.ts"
  },
  "devDependencies": {
    "@astrojs/markdown-remark": "7.3.4",
    "astro": "7.4.1",
    "typescript": "^7.0.2",
    "vitest": "^4.1.11"
  }
}
```

（Task 7 会把 `build` 改成 `astro build && node scripts/budget.ts`。）

- [ ] **Step 3: 写 `site/astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Served by GitHub Pages on the custom domain https://psycioxyxs.my/ (bound in the repo's Pages settings)
export default defineConfig({
  site: 'https://psycioxyxs.my',
  base: '/',
  trailingSlash: 'always',
  output: 'static',
  build: { format: 'directory' },
  vite: {
    resolve: { alias: { '@i18n': path.resolve(here, '../server/src/i18n/core.ts') } },
  },
});
```

- [ ] **Step 4: 写 `site/tsconfig.json`、`site/vitest.config.ts`、`site/.gitignore`、`site/src/env.d.ts`**

`site/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "types": ["node"],
    "paths": { "@i18n": ["../server/src/i18n/core.ts"] }
  },
  "include": ["src", "scripts"]
}
```

`site/vitest.config.ts`：

```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@i18n': path.resolve(__dirname, '../server/src/i18n/core.ts') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 30_000,
  },
});
```

`site/.gitignore`：

```
dist/
.astro/
```

`site/src/env.d.ts`：

```ts
/// <reference types="astro/client" />
```

- [ ] **Step 5: 临时首页和图标**

`site/src/pages/index.astro`（Task 5 会替换）：

```astro
---
---
<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Claude Web</title></head><body><h1>Claude Web</h1></body></html>
```

```bash
mkdir -p site/public && cp web/public/icon.svg site/public/icon.svg
```

- [ ] **Step 6: `scripts/icons.cjs` 改写到新位置**

把第 5 行注释里的 `site/assets/icon.svg` 改成 `site/public/icon.svg`；第 25–26 行改成：

```js
  fs.copyFileSync(svgFile, path.join(root, 'site/public/icon.svg'));
  console.log('wrote site/public/icon.svg');
```

- [ ] **Step 7: 根 `package.json` 接上 site**

`workspaces` 改成 `["server", "web", "desktop", "site"]`；`scripts` 里：

```json
    "test": "npm test -w server && npm test -w web && npm test -w desktop && npm test -w site",
    "build:site": "npm run build -w site",
    "typecheck": "tsc --noEmit -p server && tsc --noEmit -p web && tsc --noEmit -p desktop && tsc --noEmit -p site",
```

（`build:site` 加在 `build:all` 后面，其它脚本不动。）

- [ ] **Step 8: 装依赖**

```bash
npm install --ignore-scripts
```

预期：`package-lock.json` 多出 `site` 和 astro 相关的条目，没有报错。`--ignore-scripts` 是为了不重新跑 Electron、node-pty 的安装脚本。

- [ ] **Step 9: 构建、类型检查**

```bash
npm run build -w site && ls site/dist && tsc --noEmit -p site
```

预期：Astro 输出 `1 page(s) built`；`site/dist` 里有 `index.html` 和 `icon.svg`；tsc 没有输出。

- [ ] **Step 10: 设计文档注明替换旧页**

在 `docs/superpowers/specs/2026-10-21-website-design.md` §2 的代码块下面第一条之前加一条：

```markdown
- `site/` 原来是 9 月的单页旧宣传页（`index.html` / `page.html` / `build.mjs` / `assets/`），新站整个替换它（2026-10-22 用户确认）；
  `scripts/icons.cjs` 改为把图标写到 `site/public/icon.svg`。
```

- [ ] **Step 11: 提交**

```bash
git add -A site package.json package-lock.json scripts/icons.cjs docs/superpowers/specs/2026-10-21-website-design.md
git status --short
git commit -m "feat(官网): site/ 换成 Astro workspace（替换 9 月的旧宣传页），能构建出空页面"
```

`git status --short` 里应只有上面这些路径；如果出现别的文件，不要一起提交。

---

### Task 2: 两种语言：`tr()`、英文表、路径与语言跳转、用词闸

**Files:**
- Create: `site/src/i18n/index.ts`、`site/src/i18n/en.ts`、`site/src/i18n/languages.ts`、`site/src/i18n/paths.ts`、`site/src/copy.ts`、`site/src/data/agents.ts`、`site/src/data/links.ts`
- Modify: `scripts/i18n/scan.mjs:8-13`（`AREAS`）、`web/src/i18n/coverage.test.ts`（`ALLOWED`）
- Test: `site/src/i18n/paths.test.ts`、`site/src/i18n/text.test.ts`

**Interfaces:**
- Consumes: `@i18n` 的 `tIn(locale, zh, params)`、`registerEnglish(entries)`、`localeOf(tag)`、`type Locale = 'zh' | 'en'`。
- Produces:
  - `makeTr(locale: Locale): (zh: string, params?: Record<string, string | number>) => string`
  - `otherLocale(l: Locale): Locale`、`LOCALES: readonly Locale[]`、`export type { Locale }`
  - `LANGUAGE_NAME: Record<Locale, string>`
  - `type Page = 'home' | 'download' | 'changelog'`；`href(base: string, locale: Locale, page: Page, hash?: string): string`；`langRedirect(pathname: string, search: string, navLang: string, base: string): string | null`
  - `copy(locale)`，返回对象的字段见下面代码；`interface Chapter { id; title; body; readme }`；`type Copy`
  - `AGENTS: readonly string[]`（8 个）；`REPO_URL`、`RELEASES_URL`、`SOURCE_COMMANDS`

- [ ] **Step 1: 写路径测试 `site/src/i18n/paths.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { localeOf } from '@i18n';
import { href, langRedirect } from './paths';

const BASE = '/claude-web/';

describe('href', () => {
  it('puts Chinese under zh/ and keeps the trailing slash', () => {
    expect(href(BASE, 'en', 'home')).toBe('/claude-web/');
    expect(href(BASE, 'zh', 'home')).toBe('/claude-web/zh/');
    expect(href(BASE, 'en', 'download')).toBe('/claude-web/download/');
    expect(href(BASE, 'zh', 'changelog')).toBe('/claude-web/zh/changelog/');
    expect(href(BASE, 'en', 'download', '#source')).toBe('/claude-web/download/#source');
  });
  it('takes a base without its slash too', () => {
    expect(href('/claude-web', 'zh', 'download')).toBe('/claude-web/zh/download/');
  });
  it('works at the domain root (the real site: base "/")', () => {
    expect(href('/', 'en', 'home')).toBe('/');
    expect(href('/', 'zh', 'download', '#source')).toBe('/zh/download/#source');
    expect(langRedirect('/', '', 'zh-CN', '/')).toBe('/zh/');
    expect(langRedirect('/zh/', '', 'zh-CN', '/')).toBeNull();
    expect(langRedirect('/download/', '', 'zh-CN', '/')).toBeNull();
  });
});

describe('langRedirect', () => {
  it('sends a Chinese browser from the English home page to /zh/', () => {
    expect(langRedirect('/claude-web/', '', 'zh-CN', BASE)).toBe('/claude-web/zh/');
    expect(langRedirect('/claude-web', '', 'zh', BASE)).toBe('/claude-web/zh/');
    expect(langRedirect('/claude-web/', '', 'zh-Hant-TW', BASE)).toBe('/claude-web/zh/');
  });
  it('stays for other languages, other pages, and a chosen language', () => {
    expect(langRedirect('/claude-web/', '', 'en-US', BASE)).toBeNull();
    expect(langRedirect('/claude-web/', '', '', BASE)).toBeNull();
    expect(langRedirect('/claude-web/download/', '', 'zh-CN', BASE)).toBeNull();
    expect(langRedirect('/claude-web/', '?lang=en', 'zh-CN', BASE)).toBeNull();
    expect(langRedirect('/claude-web/', '?x=1&lang=en', 'zh-CN', BASE)).toBeNull();
  });
  it('reads a language tag the way the app does (localeOf)', () => {
    for (const tag of ['zh', 'zh-CN', 'ZH-tw', 'zhx', 'en', 'fr-FR', 'zh_CN']) {
      expect(langRedirect(BASE, '', tag, BASE) !== null, tag).toBe(localeOf(tag) === 'zh');
    }
  });
  it('still works as text: Base.astro writes it inline into the page', () => {
    const inline = new Function(`return (${langRedirect.toString()})`)() as typeof langRedirect;
    expect(inline('/claude-web/', '', 'zh-CN', BASE)).toBe('/claude-web/zh/');
    expect(inline('/claude-web/', '?lang=en', 'zh-CN', BASE)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -w site -- src/i18n/paths.test.ts`
Expected: FAIL，提示找不到 `./paths`。

- [ ] **Step 3: 写 `site/src/i18n/paths.ts`**

```ts
import type { Locale } from '@i18n';

export type Page = 'home' | 'download' | 'changelog';
const SEGMENT: Record<Page, string> = { home: '', download: 'download/', changelog: 'changelog/' };

/** A page of the site in a language: English at the root, Chinese under zh/. */
export function href(base: string, locale: Locale, page: Page, hash = ''): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  return root + (locale === 'zh' ? 'zh/' : '') + SEGMENT[page] + hash;
}

/**
 * Where a visit to the English home page goes when the browser reads Chinese; null = stay. A link that chose a
 * language carries ?lang= and is never redirected. Base.astro writes this function's text into the page, so it must
 * not use anything from outside its own body (no imports, no helpers).
 */
export function langRedirect(pathname: string, search: string, navLang: string, base: string): string | null {
  const root = base.charAt(base.length - 1) === '/' ? base : base + '/';
  if (pathname !== root && pathname + '/' !== root) return null;
  if (/(^|[?&])lang=/.test(search)) return null;
  return /^zh(?![a-z])/i.test(navLang.trim()) ? root + 'zh/' : null;
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -w site -- src/i18n/paths.test.ts`
Expected: PASS（4 组测试）。

- [ ] **Step 5: 写 `site/src/i18n/index.ts` 和 `site/src/i18n/languages.ts`**

`site/src/i18n/index.ts`：

```ts
// The site's side of the shared i18n core (server/src/i18n/core.ts): the key of every text is its Chinese, the English
// is in ./en.ts. Both languages are built in one process, so nothing here reads or sets the core's current language:
// each page makes the `tr` of its own locale.
import { localeOf, registerEnglish, tIn, type Locale } from '@i18n';
import { EN_SITE } from './en';

registerEnglish(EN_SITE);

export type { Locale };
export { localeOf };
export const LOCALES: readonly Locale[] = ['en', 'zh'];

export function makeTr(locale: Locale): (zh: string, params?: Record<string, string | number>) => string {
  return (zh, params) => tIn(locale, zh, params);
}

export const otherLocale = (l: Locale): Locale => (l === 'zh' ? 'en' : 'zh');
```

`site/src/i18n/languages.ts`：

```ts
import type { Locale } from '@i18n';

/** Each language named in itself: the language switch shows the one you are not reading. */
export const LANGUAGE_NAME: Record<Locale, string> = { zh: '中文', en: 'English' };
```

- [ ] **Step 6: 写 `site/src/data/agents.ts` 和 `site/src/data/links.ts`**

`site/src/data/agents.ts`：

```ts
/** The agents Claude Web drives (server/src/protocol.ts AgentKind, without the generic acp:*). */
export const AGENTS: readonly string[] = ['Claude Code', 'Codex', 'Gemini CLI', 'Qwen Code', 'Kimi CLI', 'OpenCode', 'Cursor', 'DeepSeek Harness'];
```

`site/src/data/links.ts`：

```ts
export const REPO_URL = 'https://github.com/ypyik0669/claude-web';
export const RELEASES_URL = `${REPO_URL}/releases`;
/** README → "Web version (from source)". */
export const SOURCE_COMMANDS = ['git clone https://github.com/ypyik0669/claude-web.git', 'cd claude-web', 'npm install', 'npm run build', 'npm start'].join('\n');
```

- [ ] **Step 7: 写 `site/src/copy.ts`**

```ts
// Every text the site shows, in one place: each is a tr('中文') (the Chinese is the key, the English is in
// i18n/en.ts). .astro files take their words from here and hold none of their own (i18n/text.test.ts).
import { makeTr, type Locale } from './i18n';

export interface Chapter {
  id: string;
  title: string;
  body: string;
  /** The README walkthrough step that explains it: the start of its English heading ("3. "). */
  readme: string;
}

export function copy(locale: Locale) {
  const tr = makeTr(locale);
  const chapters: Chapter[] = [
    { id: 'agents', title: tr('派活，它们自己去干'), body: tr('一句话交代下去，Claude 会分出子代理并行干活。每个子代理是网吧里的一位客人：进门、找座位、开机。'), readme: '15. ' },
    { id: 'turns', title: tr('一回合折成一行'), body: tr('读了哪些文件、改了什么、跑了哪条命令，折成一行摘要；想看细节，点开就是完整的时间线。'), readme: '2. ' },
    { id: 'permission', title: tr('要你点头的时候，它举手'), body: tr('改文件、跑命令之前先问你。权限卡停在输入框上方，一键允许或拒绝，不会被新消息冲走。'), readme: '3. ' },
    { id: 'review', title: tr('改了什么，当场看'), body: tr('每一回合改过的文件都有一张卡，点开就是逐行对比；在哪一行留句话，它接着改。'), readme: '4. ' },
    { id: 'checkout', title: tr('干完了，结账'), body: tr('每个子代理干完到前台结账：用了多久、多少 token、大约多少钱，一目了然。'), readme: '15. ' },
    { id: 'elsewhere', title: tr('不止 Claude，也不止这台电脑'), body: tr('同一个界面也能带 Codex、Gemini CLI、Qwen Code 这些，子代理可以用任何一家的模型；另一台电脑上的对话、手机上的远程，都在这里。'), readme: '9. ' },
    { id: 'gateway', title: tr('一个地址，接所有账号'), body: tr('内置的模型网关把你所有的账号接到一个本机地址上，一个出了问题就自动换下一个。'), readme: '11. ' },
  ];
  return {
    meta: {
      title: tr('Claude Web：Claude Code，有了界面'),
      description: tr('Claude Code 的桌面版和网页版：对话、审阅、分屏、手机远程。底下跑的是官方 Claude Code，也能带 Codex、Gemini CLI 这些。免费开源。'),
      sceneAlt: tr('Claude Web 的网吧：每个子代理是一位坐在电脑前的客人'),
    },
    nav: {
      skip: tr('跳到正文'),
      label: tr('网站导航'),
      features: tr('功能'),
      download: tr('下载'),
      changelog: tr('更新内容'),
    },
    hero: {
      title: tr('Claude Code，有了界面。'),
      sub: tr('桌面版和网页版：对话、审阅、分屏、手机远程。底下跑的是官方 Claude Code，也能带 Codex、Gemini CLI 这些。'),
      fine: tr('免费开源 · Windows、macOS 和网页 · 不用注册'),
      scroll: tr('滚动看它们干活'),
    },
    dl: {
      win: tr('下载 Windows 版'),
      mac: tr('下载 macOS 版'),
      macIntel: tr('Intel 芯片的 Mac'),
      source: tr('从源码跑'),
      other: tr('其它下载方式'),
    },
    chapters,
    chapterMore: tr('详细说明'),
    stats: {
      label: tr('数字'),
      stars: tr('GitHub 星标'),
      releases: tr('发布的版本'),
      agents: tr('能带的 Agent'),
    },
    install: {
      title: tr('装上就能用'),
      body: tr('桌面版自带运行环境，不用另装 Node.js；网页版从源码跑，几条命令。'),
    },
    footer: {
      notice: tr('社区项目，与 Anthropic 无关。“Claude” 和 “Claude Code” 是 Anthropic 的商标。'),
      license: tr('© Claude Web 贡献者 · MIT 许可'),
    },
    download: {
      title: tr('下载 Claude Web'),
      version: (version: string, date: string) => tr('版本 {version} · {date}', { version, date }),
      allReleases: tr('所有版本'),
      installer: tr('安装版'),
      portable: tr('便携版（免安装，单个 exe）'),
      arm64: tr('Apple 芯片（M 系列）'),
      x64: tr('Intel 芯片'),
      macNote: tr('第一次打开时 macOS 可能会拦下，处理办法见'),
      warnings: tr('安装包的提示'),
      sourceNeeds: tr('需要 Node.js 22.13+ 和 Git。装好后打开 http://127.0.0.1:3090。'),
      copy: tr('复制'),
      copied: tr('已复制'),
      missing: tr('这个版本没有这个安装包'),
    },
  };
}

export type Copy = ReturnType<typeof copy>;
```

- [ ] **Step 8: 写 `site/src/i18n/en.ts`**

格式必须和产品的英文表一样（`scripts/i18n/catalog.mjs` 按这个格式读写）：注释行、`export const EN_SITE: Record<string, string> = {`、每行一个 `"中文": "English",`、`};`。

```ts
// The site's English texts. The key is the Chinese source text (site/src/copy.ts); see server/src/i18n/core.ts.
export const EN_SITE: Record<string, string> = {
  "Apple 芯片（M 系列）": "Apple silicon (M series)",
  "Claude Code 的桌面版和网页版：对话、审阅、分屏、手机远程。底下跑的是官方 Claude Code，也能带 Codex、Gemini CLI 这些。免费开源。": "A desktop and web app for Claude Code: conversations, review, split view, your phone as a remote. The official Claude Code runs underneath, and it drives Codex, Gemini CLI and others too. Free and open source.",
  "Claude Code，有了界面。": "Claude Code, with a face.",
  "Claude Web 的网吧：每个子代理是一位坐在电脑前的客人": "The Claude Web café: every subagent is a guest at a computer",
  "Claude Web：Claude Code，有了界面": "Claude Web: Claude Code, with a face",
  "GitHub 星标": "GitHub stars",
  "Intel 芯片": "Intel",
  "Intel 芯片的 Mac": "Intel Mac",
  "© Claude Web 贡献者 · MIT 许可": "© Claude Web contributors · MIT License",
  "一个地址，接所有账号": "One address for every account",
  "一句话交代下去，Claude 会分出子代理并行干活。每个子代理是网吧里的一位客人：进门、找座位、开机。": "Say what you want and Claude splits the work across subagents running side by side. Each one is a guest in the café: walks in, finds a seat, switches on.",
  "一回合折成一行": "One turn, one line",
  "下载": "Download",
  "下载 Claude Web": "Download Claude Web",
  "下载 Windows 版": "Download for Windows",
  "下载 macOS 版": "Download for macOS",
  "不止 Claude，也不止这台电脑": "Not just Claude, not just this computer",
  "从源码跑": "Run from source",
  "便携版（免安装，单个 exe）": "Portable (no install, a single exe)",
  "其它下载方式": "Other downloads",
  "内置的模型网关把你所有的账号接到一个本机地址上，一个出了问题就自动换下一个。": "The built-in model gateway puts all your accounts behind one local address; when one fails, it moves on to the next.",
  "免费开源 · Windows、macOS 和网页 · 不用注册": "Free and open source · Windows, macOS and the web · No sign-up",
  "功能": "Features",
  "发布的版本": "Releases",
  "同一个界面也能带 Codex、Gemini CLI、Qwen Code 这些，子代理可以用任何一家的模型；另一台电脑上的对话、手机上的远程，都在这里。": "The same window drives Codex, Gemini CLI, Qwen Code and more, and subagents can use any provider's model; conversations on another computer and your phone as a remote are all here too.",
  "复制": "Copy",
  "安装包的提示": "About the installer warnings",
  "安装版": "Installer",
  "已复制": "Copied",
  "干完了，结账": "Done? Check out at the desk",
  "所有版本": "All releases",
  "改了什么，当场看": "See what changed, right there",
  "改文件、跑命令之前先问你。权限卡停在输入框上方，一键允许或拒绝，不会被新消息冲走。": "It asks before it edits a file or runs a command. The permission card waits above the input box: allow or deny in one click, and new messages never push it away.",
  "数字": "In numbers",
  "更新内容": "What’s new",
  "桌面版和网页版：对话、审阅、分屏、手机远程。底下跑的是官方 Claude Code，也能带 Codex、Gemini CLI 这些。": "A desktop and web app: conversations, review, split view, your phone as a remote. The official Claude Code runs underneath, and it drives Codex, Gemini CLI and others too.",
  "桌面版自带运行环境，不用另装 Node.js；网页版从源码跑，几条命令。": "The desktop app brings its own runtime, so there is no Node.js to install; the web version runs from source with a few commands.",
  "每一回合改过的文件都有一张卡，点开就是逐行对比；在哪一行留句话，它接着改。": "Every turn's changed files get a card; open it for a line-by-line diff, and leave a note on any line for it to pick up.",
  "每个子代理干完到前台结账：用了多久、多少 token、大约多少钱，一目了然。": "Each subagent checks out at the front desk when it is done: how long it took, how many tokens, roughly what it cost.",
  "派活，它们自己去干": "Hand it out, they get to work",
  "滚动看它们干活": "Scroll to watch them work",
  "版本 {version} · {date}": "Version {version} · {date}",
  "社区项目，与 Anthropic 无关。“Claude” 和 “Claude Code” 是 Anthropic 的商标。": "A community project, not affiliated with Anthropic. “Claude” and “Claude Code” are trademarks of Anthropic.",
  "第一次打开时 macOS 可能会拦下，处理办法见": "macOS may stop it the first time you open it; for what to do, see",
  "网站导航": "Site",
  "能带的 Agent": "Agents it drives",
  "装上就能用": "Install it and go",
  "要你点头的时候，它举手": "It raises a hand when it needs you",
  "详细说明": "Read more",
  "读了哪些文件、改了什么、跑了哪条命令，折成一行摘要；想看细节，点开就是完整的时间线。": "The files it read, what it changed, the commands it ran, folded into one summary line. Open it for the full timeline.",
  "跳到正文": "Skip to content",
  "这个版本没有这个安装包": "Not in this release",
  "需要 Node.js 22.13+ 和 Git。装好后打开 http://127.0.0.1:3090。": "Needs Node.js 22.13+ and Git. Then open http://127.0.0.1:3090.",
};
```

- [ ] **Step 9: 让现有的 i18n 工具管到官网**

`scripts/i18n/scan.mjs` 的 `AREAS` 末尾加一项：

```js
  { dir: 'site/src', catalog: 'site/src/i18n/en.ts', export: 'EN_SITE' },
```

`web/src/i18n/coverage.test.ts` 的 `ALLOWED` 末尾加一行：

```ts
    'site/src/i18n/languages.ts': 'languages named in themselves (the site\'s language switch)',
```

- [ ] **Step 10: 写用词闸 `site/src/i18n/text.test.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectKeys } from '../../../scripts/i18n/scan.mjs';
import { EN_SITE } from './en';

const ROOT = path.resolve(__dirname, '../../..');
const SITE = path.join(ROOT, 'site/src');
const CJK = /[㐀-鿿]/;
/** web/src/features/settings/wording.test.ts's list, and 会话 (the interface says 对话). */
const BANNED_ZH = ['会话', '档案', '引擎', '窗格', '停靠'];
const BANNED_EN = [/\beffort\b/i, /ultracode/i, /\bACP\b/, /\bsessions?\b/i];

function astroFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...astroFiles(p));
    else if (p.endsWith('.astro')) out.push(p);
  }
  return out;
}

describe('the site\'s words', () => {
  const keys = [...collectKeys(ROOT).byArea.get('EN_SITE')!.keys()];

  it('are found by the shared scanner', () => {
    expect(keys.length).toBeGreaterThan(40);
  });

  it('say 对话 and none of the implementation words, in either language', () => {
    expect(keys.filter((k) => BANNED_ZH.some((w) => k.includes(w)))).toEqual([]);
    expect(Object.values(EN_SITE).filter((v) => BANNED_EN.some((re) => re.test(v)))).toEqual([]);
  });

  it('live in .ts files: an .astro file has no Chinese of its own', () => {
    const files = astroFiles(SITE);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => CJK.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
```

- [ ] **Step 11: 跑官网测试和全仓的 i18n 覆盖**

```bash
npm test -w site
env -u CLAUDE_CODE_ENTRYPOINT npx vitest run --root web src/i18n/coverage.test.ts
node scripts/i18n/extract.mjs --check
tsc --noEmit -p site
```

预期：官网测试全过；覆盖测试全过；`extract.mjs --check` 里 `EN_SITE: 0 missing, 0 unused`，其它几项和改之前一样；tsc 没有输出。

如果覆盖测试报「the same text in two areas says the same in both」，说明某个中文在产品里已有不同的英文：把 `site/src/i18n/en.ts` 里那一条改成产品的英文（用 `grep -h '^  "那句中文":' server/src/i18n/en.ts web/src/i18n/en.ts` 查），再跑一遍。

- [ ] **Step 12: 提交**

```bash
git add site/src scripts/i18n/scan.mjs web/src/i18n/coverage.test.ts
git commit -m "feat(官网): 文案走 tr()（英文表 EN_SITE 进覆盖测试）、中英路径和首次访问按浏览器语言跳转、用词闸"
```

---

### Task 3: 数据：最新版本和下载文件、README 锚点、更新内容的 Markdown

**Files:**
- Create: `site/src/data/releases.ts`、`site/src/data/site-data.json`、`site/scripts/releases.ts`、`site/src/readme.ts`、`site/src/changelog.ts`
- Test: `site/src/data/releases.test.ts`、`site/src/readme.test.ts`、`site/src/changelog.test.ts`

**Interfaces:**
- Consumes: `REPO_URL`（`site/src/data/links.ts`）；`copy(locale).chapters[].readme`；`type Locale`。
- Produces:
  - `interface Asset { name: string; url: string; size: number }`
  - `interface ReleaseInfo { version: string; date: string; url: string; win: { installer: Asset | null; portable: Asset | null }; mac: { arm64: Asset | null; x64: Asset | null } }`
  - `interface SiteData { release: ReleaseInfo | null; stars: number | null; releases: number | null; fetchedAt: string }`
  - `interface GhRelease`（GitHub API 的字段子集）、`isAppRelease(r)`、`releaseInfo(r)`、`siteData(list, stars, fetchedAt)`、`mb(bytes): string`
  - `githubSlug(heading): string`、`headings(md): string[]`、`readmeLink(locale, enPrefix): string`
  - `changelogBody(md): string`

- [ ] **Step 1: 写 `site/src/data/releases.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { isAppRelease, mb, siteData, type GhRelease } from './releases';

const asset = (name: string, size = 100) => ({ name, size, browser_download_url: `https://example.test/${name}` });
const rel = (tag: string, at: string, extra: Partial<GhRelease> = {}): GhRelease => ({
  tag_name: tag, draft: false, prerelease: false, published_at: at, html_url: `https://example.test/tag/${tag}`, assets: [], ...extra,
});

const LIST: GhRelease[] = [
  rel('engine-v2.8.4-cw.5', '2026-10-22T00:00:00Z'),
  rel('site-media', '2026-10-22T01:00:00Z', { prerelease: true }),
  rel('v0.4.0', '2026-10-23T00:00:00Z', { draft: true }),
  rel('v0.3.0', '2026-10-21T08:00:00Z'),
  rel('v0.3.1', '2026-10-21T15:38:12Z', {
    assets: [
      asset('ClaudeWeb-0.3.1-win-x64.exe', 231908768),
      asset('ClaudeWeb-0.3.1-win-x64.exe.blockmap'),
      asset('ClaudeWeb-0.3.1-portable.exe', 231679920),
      asset('ClaudeWeb-0.3.1-mac-arm64.dmg', 270214749),
      asset('ClaudeWeb-0.3.1-mac-arm64.zip'),
      asset('latest.yml'),
    ],
  }),
];

describe('siteData', () => {
  it('takes the newest published app release (v1.2.3 tags only)', () => {
    const d = siteData(LIST, 42, '2026-10-22T00:00:00Z');
    expect(d.release?.version).toBe('0.3.1');
    expect(d.release?.date).toBe('2026-10-21');
    expect(d.release?.url).toBe('https://example.test/tag/v0.3.1');
    expect(d.releases).toBe(2);
    expect(d.stars).toBe(42);
  });
  it('maps each installer, and a missing one to null', () => {
    const r = siteData(LIST, null, 'x').release!;
    expect(r.win.installer).toEqual({ name: 'ClaudeWeb-0.3.1-win-x64.exe', url: 'https://example.test/ClaudeWeb-0.3.1-win-x64.exe', size: 231908768 });
    expect(r.win.portable?.name).toBe('ClaudeWeb-0.3.1-portable.exe');
    expect(r.mac.arm64?.name).toBe('ClaudeWeb-0.3.1-mac-arm64.dmg');
    expect(r.mac.x64).toBeNull();
  });
  it('has no release when there is no app release', () => {
    expect(siteData([LIST[0], LIST[1]], null, 'x')).toEqual({ release: null, stars: null, releases: 0, fetchedAt: 'x' });
  });
});

describe('isAppRelease / mb', () => {
  it('skips drafts, prereleases and other tags', () => {
    expect(LIST.map(isAppRelease)).toEqual([false, false, false, true, true]);
  });
  it('rounds to whole MiB', () => {
    expect(mb(231908768)).toBe('221 MB');
    expect(mb(0)).toBe('0 MB');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -w site -- src/data/releases.test.ts`
Expected: FAIL，找不到 `./releases`。

- [ ] **Step 3: 写 `site/src/data/releases.ts`**

只用能被擦除的 TypeScript 语法（interface、类型标注）：`site/scripts/releases.ts` 会让 Node 直接导入它。

```ts
// The latest release and its installers, from the GitHub API (site/scripts/releases.ts writes ./site-data.json at
// build time; the pages read that file, so a visitor's browser never calls the API).
export interface GhAsset { name: string; browser_download_url: string; size: number }
export interface GhRelease { tag_name: string; draft: boolean; prerelease: boolean; published_at: string | null; html_url: string; assets: GhAsset[] }

export interface Asset { name: string; url: string; size: number }
export interface ReleaseInfo {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  url: string;
  win: { installer: Asset | null; portable: Asset | null };
  mac: { arm64: Asset | null; x64: Asset | null };
}
export interface SiteData { release: ReleaseInfo | null; stars: number | null; releases: number | null; fetchedAt: string }

/** The app's own releases: v1.2.3 tags, published (engine-v… and site-media are other things in the same repo). */
export function isAppRelease(r: GhRelease): boolean {
  return !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name);
}

function pick(r: GhRelease, re: RegExp): Asset | null {
  const a = r.assets.find((x) => re.test(x.name));
  return a ? { name: a.name, url: a.browser_download_url, size: a.size } : null;
}

/** electron-builder.yml's artifact names: ClaudeWeb-<v>-win-x64.exe, -portable.exe, -mac-<arch>.dmg. */
export function releaseInfo(r: GhRelease): ReleaseInfo {
  return {
    version: r.tag_name.slice(1),
    date: (r.published_at ?? '').slice(0, 10),
    url: r.html_url,
    win: { installer: pick(r, /-win-x64\.exe$/), portable: pick(r, /-portable\.exe$/) },
    mac: { arm64: pick(r, /-mac-arm64\.dmg$/), x64: pick(r, /-mac-x64\.dmg$/) },
  };
}

export function siteData(list: GhRelease[], stars: number | null, fetchedAt: string): SiteData {
  const apps = list.filter(isAppRelease).sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
  return { release: apps[0] ? releaseInfo(apps[0]) : null, stars, releases: apps.length, fetchedAt };
}

export const mb = (bytes: number): string => `${Math.round(bytes / 1048576)} MB`;
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -w site -- src/data/releases.test.ts`
Expected: PASS。

- [ ] **Step 5: 写抓取脚本 `site/scripts/releases.ts`**

```ts
// Writes site/src/data/site-data.json from the GitHub API: the latest release, its installers, the stars.
//   node site/scripts/releases.ts          (GITHUB_TOKEN, when set, lifts the API's rate limit)
// When the API cannot be reached the committed file stays as it is and the build goes on with it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteData, type GhRelease } from '../src/data/releases.ts';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/site-data.json');
const REPO = 'ypyik0669/claude-web';
const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'claude-web-site' };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function get(url: string): Promise<unknown> {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

try {
  const [releases, repo] = await Promise.all([
    get(`https://api.github.com/repos/${REPO}/releases?per_page=100`) as Promise<GhRelease[]>,
    get(`https://api.github.com/repos/${REPO}`) as Promise<{ stargazers_count: number }>,
  ]);
  const data = siteData(releases, repo.stargazers_count, new Date().toISOString());
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
  console.log(`site data: ${data.release?.version ?? 'no release'}, ${data.stars} stars, ${data.releases} releases`);
} catch (e) {
  console.warn(`site data: kept the committed file (${(e as Error).message})`);
}
```

- [ ] **Step 6: 先提交一份种子数据，再跑脚本刷新**

种子 `site/src/data/site-data.json`（v0.3.1 的真实文件和大小；脚本跑不通时构建就用它）：

```json
{
  "release": {
    "version": "0.3.1",
    "date": "2026-10-21",
    "url": "https://github.com/ypyik0669/claude-web/releases/tag/v0.3.1",
    "win": {
      "installer": { "name": "ClaudeWeb-0.3.1-win-x64.exe", "url": "https://github.com/ypyik0669/claude-web/releases/download/v0.3.1/ClaudeWeb-0.3.1-win-x64.exe", "size": 231908768 },
      "portable": { "name": "ClaudeWeb-0.3.1-portable.exe", "url": "https://github.com/ypyik0669/claude-web/releases/download/v0.3.1/ClaudeWeb-0.3.1-portable.exe", "size": 231679920 }
    },
    "mac": {
      "arm64": { "name": "ClaudeWeb-0.3.1-mac-arm64.dmg", "url": "https://github.com/ypyik0669/claude-web/releases/download/v0.3.1/ClaudeWeb-0.3.1-mac-arm64.dmg", "size": 270214749 },
      "x64": { "name": "ClaudeWeb-0.3.1-mac-x64.dmg", "url": "https://github.com/ypyik0669/claude-web/releases/download/v0.3.1/ClaudeWeb-0.3.1-mac-x64.dmg", "size": 279472082 }
    }
  },
  "stars": null,
  "releases": null,
  "fetchedAt": "2026-10-22T00:00:00.000Z"
}
```

然后：

```bash
npm run data -w site
```

预期：打印 `site data: 0.3.1, <n> stars, <m> releases`（如果那时已经有更新的版本，就是那个版本号）。JSON 里 `stars`、`releases` 变成数字。如果打印的是 `kept the committed file (…)`，就保留种子文件继续往下做，并在汇报里写明。

- [ ] **Step 7: 写 `site/src/readme.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { copy } from './copy';
import { githubSlug, headings, readmeLink } from './readme';
import en from '../../README.md?raw';
import zh from '../../README.zh-CN.md?raw';

describe('githubSlug: the anchors GitHub gives README headings', () => {
  it('drops punctuation, keeps letters of any script, joins with -', () => {
    expect(githubSlug('4. Review changes, Git, files: the right panel')).toBe('4-review-changes-git-files-the-right-panel');
    expect(githubSlug('4. 审阅改动、Git、文件：右侧面板')).toBe('4-审阅改动git文件右侧面板');
    expect(githubSlug('15. Background: watch subagents work in the café')).toBe('15-background-watch-subagents-work-in-the-café');
    expect(githubSlug('9. Other CLI agents (Codex / Gemini …)')).toBe('9-other-cli-agents-codex--gemini-');
  });
});

describe('readmeLink', () => {
  it('the two READMEs have their headings in the same order', () => {
    expect(headings(zh).length).toBe(headings(en).length);
  });
  it('points into the README of the page\'s language', () => {
    expect(readmeLink('en', '3. ')).toBe('https://github.com/ypyik0669/claude-web#3-permission-prompts-and-permission-modes');
    expect(readmeLink('zh', '3. ')).toBe('https://github.com/ypyik0669/claude-web/blob/main/README.zh-CN.md#3-权限审批与权限模式');
    expect(readmeLink('en', 'About the installer')).toBe('https://github.com/ypyik0669/claude-web#about-the-installer-warnings');
  });
  it('finds every chapter\'s step in both languages', () => {
    for (const locale of ['en', 'zh'] as const) for (const ch of copy(locale).chapters) expect(() => readmeLink(locale, ch.readme)).not.toThrow();
  });
  it('says which heading it could not find', () => {
    expect(() => readmeLink('en', '99. ')).toThrow(/99\. /);
  });
});
```

- [ ] **Step 8: 运行，确认失败**

Run: `npm test -w site -- src/readme.test.ts`
Expected: FAIL，找不到 `./readme`。

- [ ] **Step 9: 写 `site/src/readme.ts`**

中文 README 的标题按位置对应英文 README 的标题（两份的标题一一对应，测试会检查），所以这个文件里不用写中文。

```ts
// Links into the README for "read more": the anchor GitHub gives a heading, computed from the README itself so a
// renamed heading cannot leave a dead link. The Chinese README's headings are the English ones', in the same order.
import en from '../../README.md?raw';
import zh from '../../README.zh-CN.md?raw';
import type { Locale } from './i18n';
import { REPO_URL } from './data/links';

/** GitHub's heading anchor: lower case, punctuation dropped (letters and digits of any script stay), spaces → -. */
export function githubSlug(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
}

export function headings(md: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced) {
      const m = /^#{2,4} (.+)$/.exec(line);
      if (m) out.push(m[1].trim());
    }
  }
  return out;
}

/** The README section whose English heading starts with `enPrefix` ("3. ", "About the installer"), in `locale`. */
export function readmeLink(locale: Locale, enPrefix: string): string {
  const enHeadings = headings(en);
  const i = enHeadings.findIndex((h) => h.startsWith(enPrefix));
  if (i < 0) throw new Error(`README.md has no heading starting with "${enPrefix}"`);
  if (locale === 'en') return `${REPO_URL}#${githubSlug(enHeadings[i])}`;
  const zhHeadings = headings(zh);
  if (zhHeadings.length !== enHeadings.length) throw new Error('README.md and README.zh-CN.md have different headings');
  return `${REPO_URL}/blob/main/README.zh-CN.md#${githubSlug(zhHeadings[i])}`;
}
```

- [ ] **Step 10: 运行，确认通过**

Run: `npm test -w site -- src/readme.test.ts`
Expected: PASS。如果「the two READMEs have their headings in the same order」失败，先打印两边的 `headings()` 对比，找出是哪一处标题对不上，在汇报里写明，不要改 README。

- [ ] **Step 11: 写 `site/src/changelog.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { changelogBody } from './changelog';

const SAMPLE = [
  '# Changelog',
  '',
  '**English** · [简体中文](CHANGELOG.zh-CN.md)',
  '',
  'Installers are on the [Releases](https://github.com/ypyik0669/claude-web/releases) page.',
  '',
  '## [0.3.1] — 2026-10-21',
  '',
  'See [the notes](docs/notes/gateway.md) and [above](#fixed).',
].join('\n');

describe('changelogBody', () => {
  it('drops the title and the language line (the page has its own)', () => {
    const out = changelogBody(SAMPLE);
    expect(out).not.toMatch(/^# Changelog/m);
    expect(out).not.toMatch(/CHANGELOG\.zh-CN\.md/);
    expect(out).toMatch(/^## \[0\.3\.1\]/m);
  });
  it('points repo-relative links at GitHub and leaves the others', () => {
    const out = changelogBody(SAMPLE);
    expect(out).toContain('(https://github.com/ypyik0669/claude-web/blob/main/docs/notes/gateway.md)');
    expect(out).toContain('(https://github.com/ypyik0669/claude-web/releases)');
    expect(out).toContain('(#fixed)');
  });
  it('drops the Chinese file\'s language line too', () => {
    expect(changelogBody('# 更新日志\n\n**简体中文** · [English](CHANGELOG.md)\n\n## [0.3.1]')).toBe('\n\n## [0.3.1]');
  });
});
```

- [ ] **Step 12: 运行，确认失败**

Run: `npm test -w site -- src/changelog.test.ts`
Expected: FAIL，找不到 `./changelog`。

- [ ] **Step 13: 写 `site/src/changelog.ts`**

```ts
import { REPO_URL } from './data/links';

/** CHANGELOG(.zh-CN).md for the page: no title and no language line (the page has both), repo links made absolute. */
export function changelogBody(md: string): string {
  const lines = md.split('\n');
  const title = lines.findIndex((l) => /^# /.test(l));
  return lines
    .filter((l, i) => i !== title && !/\]\(CHANGELOG(\.zh-CN)?\.md\)/.test(l))
    .join('\n')
    .replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, `](${REPO_URL}/blob/main/$1)`);
}
```

- [ ] **Step 14: 跑官网全部测试、类型检查**

```bash
npm test -w site && tsc --noEmit -p site
```

预期：全过，tsc 没有输出。

- [ ] **Step 15: 提交**

```bash
git add site/src/data site/scripts/releases.ts site/src/readme.ts site/src/readme.test.ts site/src/changelog.ts site/src/changelog.test.ts
git commit -m "feat(官网): 构建时从 GitHub 抓最新版本和安装包、README 锚点、更新内容整理"
```

---

### Task 4: 浏览器端：识别系统、快捷键、复制按钮

**Files:**
- Create: `site/src/client/os.ts`、`site/src/client/keys.ts`、`site/src/client/main.ts`
- Test: `site/src/client/os.test.ts`、`site/src/client/keys.test.ts`

**Interfaces:**
- Produces:
  - `type Os = 'win' | 'mac' | 'other'`；`interface NavLike { userAgent: string; platform?: string; maxTouchPoints?: number; userAgentData?: { platform?: string } }`；`detectOs(nav: NavLike): Os`
  - `type KeyAction = 'download' | 'source' | 'changelog' | 'github'`；`interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean; editable: boolean }`；`keyAction(e: KeyLike): KeyAction | null`
  - `main.ts` 和页面之间的约定（Task 5、6 的 `.astro` 要照着写）：
    - `<html data-os="win|mac|other">`：由 `main.ts` 设置。CSS 据此只显示访客自己系统的下载按钮（`data-os="win|mac"` 的元素），并把下载页里访客的系统排在最前（`data-os-block="win|mac"`）。
    - 快捷键的目标：`[data-key-action="download|source|changelog|github"]`。同一个动作有多个目标时，先找 `data-key-os` 等于访客系统的那个，找不到就用第一个。
    - 复制按钮：`<button data-copy="要复制的文字" data-copied="复制后按钮上显示的字">`。

- [ ] **Step 1: 写 `site/src/client/os.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { detectOs } from './os';

const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

describe('detectOs', () => {
  it('Windows and macOS desktops', () => {
    expect(detectOs({ userAgent: WIN_CHROME, platform: 'Win32' })).toBe('win');
    expect(detectOs({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('mac');
  });
  it('prefers userAgentData when the browser has it', () => {
    expect(detectOs({ userAgent: LINUX, platform: 'Linux x86_64', userAgentData: { platform: 'Windows' } })).toBe('win');
    expect(detectOs({ userAgent: WIN_CHROME, userAgentData: { platform: 'macOS' } })).toBe('mac');
  });
  it('phones, tablets and Linux get both buttons', () => {
    expect(detectOs({ userAgent: IPHONE, platform: 'iPhone' })).toBe('other');
    expect(detectOs({ userAgent: ANDROID, platform: 'Linux armv8l' })).toBe('other');
    expect(detectOs({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('other');
    expect(detectOs({ userAgent: LINUX, platform: 'Linux x86_64' })).toBe('other');
    expect(detectOs({ userAgent: '' })).toBe('other');
  });
});
```

- [ ] **Step 2: 写 `site/src/client/keys.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { keyAction } from './keys';

const key = (k: string, more: Partial<Parameters<typeof keyAction>[0]> = {}) =>
  keyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, editable: false, ...more });

describe('keyAction', () => {
  it('D R C G, either case', () => {
    expect(key('d')).toBe('download');
    expect(key('D')).toBe('download');
    expect(key('r')).toBe('source');
    expect(key('c')).toBe('changelog');
    expect(key('g')).toBe('github');
  });
  it('nothing else', () => {
    expect(key('x')).toBeNull();
    expect(key('Enter')).toBeNull();
  });
  it('never with a modifier, while typing, or while an input method is composing', () => {
    expect(key('c', { ctrlKey: true })).toBeNull();
    expect(key('c', { metaKey: true })).toBeNull();
    expect(key('d', { altKey: true })).toBeNull();
    expect(key('d', { editable: true })).toBeNull();
    expect(key('d', { isComposing: true })).toBeNull();
  });
});
```

- [ ] **Step 3: 运行，确认失败**

Run: `npm test -w site -- src/client`
Expected: FAIL，找不到 `./os` 和 `./keys`。

- [ ] **Step 4: 写 `site/src/client/os.ts` 和 `site/src/client/keys.ts`**

`site/src/client/os.ts`：

```ts
export type Os = 'win' | 'mac' | 'other';
export interface NavLike { userAgent: string; platform?: string; maxTouchPoints?: number; userAgentData?: { platform?: string } }

/** Which installer to offer first. Phones, tablets (an iPad says "Mac" but has touch) and Linux get both buttons. */
export function detectOs(nav: NavLike): Os {
  if (/iPhone|iPad|iPod|Android/i.test(nav.userAgent)) return 'other';
  const p = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  if (/win/i.test(p)) return 'win';
  if (/mac/i.test(p)) return (nav.maxTouchPoints ?? 0) > 1 ? 'other' : 'mac';
  return 'other';
}
```

`site/src/client/keys.ts`：

```ts
export type KeyAction = 'download' | 'source' | 'changelog' | 'github';
export interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean; editable: boolean }

const KEYS: Record<string, KeyAction> = { d: 'download', r: 'source', c: 'changelog', g: 'github' };

/** The site's single-letter shortcuts (shown on the buttons). Off while typing or composing (an IME's Enter / letters). */
export function keyAction(e: KeyLike): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.editable) return null;
  return KEYS[e.key.toLowerCase()] ?? null;
}
```

- [ ] **Step 5: 运行，确认通过**

Run: `npm test -w site -- src/client`
Expected: PASS。

- [ ] **Step 6: 写 `site/src/client/main.ts`**

```ts
// The only script every page loads: the visitor's OS (which download button shows), the shortcuts, copy buttons.
import { detectOs, type NavLike } from './os';
import { keyAction } from './keys';

const os = detectOs(navigator as unknown as NavLike);
document.documentElement.dataset.os = os;

function target(action: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-key-action="${action}"][data-key-os="${os}"]`)
    ?? document.querySelector<HTMLElement>(`[data-key-action="${action}"]`);
}

addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  const editable = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const action = keyAction({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.isComposing, editable });
  const el = action && target(action);
  if (!el) return;
  e.preventDefault();
  el.click();
});

for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
  b.addEventListener('click', () => {
    const label = b.textContent;
    void navigator.clipboard.writeText(b.dataset.copy ?? '').then(() => {
      b.textContent = b.dataset.copied ?? label;
      setTimeout(() => { b.textContent = label; }, 1500);
    });
  });
}
```

- [ ] **Step 7: 类型检查**

Run: `tsc --noEmit -p site`
Expected: 没有输出。

- [ ] **Step 8: 提交**

```bash
git add site/src/client
git commit -m "feat(官网): 浏览器端识别系统、D / R / C / G 快捷键、复制按钮"
```

---

### Task 5: 样式、页面骨架、首页（中英）

**Files:**
- Create: `site/src/styles/tokens.css`、`site/src/styles/site.css`、`site/src/layouts/Base.astro`、`site/src/components/Header.astro`、`site/src/components/Footer.astro`、`site/src/components/DownloadButtons.astro`、`site/src/views/Home.astro`、`site/src/pages/zh/index.astro`
- Modify: `site/src/pages/index.astro`（替换 Task 1 的临时页）

**Interfaces:**
- Consumes: `copy(locale)`、`href`、`langRedirect`、`type Page`、`otherLocale`、`LANGUAGE_NAME`、`readmeLink`、`AGENTS`、`REPO_URL`、`RELEASES_URL`、`type SiteData`、`site-data.json`，以及 Task 4 定下的 `data-os` / `data-key-action` / `data-key-os` 约定。
- Produces:
  - `Base.astro` 的 props：`{ locale: Locale; page: Page; title?: string }`，插槽内容放进 `<main id="main">`。
  - `DownloadButtons.astro` 的 props：`{ locale: Locale }`。
  - 首页的锚点和钩子，供第二份计划接上网吧场景：`#hero-scene`（场景容器，现在放动图）、`#features`（章节外层）、`section.chapter[data-chapter=<id>]`（7 个，id 和 `copy().chapters[].id` 一致）、`#install`。

- [ ] **Step 1: 写 `site/src/styles/tokens.css`**

先把 `web/src/tokens.css` 第 14–92 行**原样**复制进来（暗色的 `:root { … }` 和 `:root[data-theme='light'] { … }` 两块，带注释），然后在后面加上官网自己的一块：

```css
/* the site's own scale: system fonts only (no Inter download), bigger display sizes than the app */
:root {
  --font-cjk: 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans SC', 'Noto Sans CJK SC', 'Source Han Sans SC';
  --font: -apple-system, 'Segoe UI Variable Text', 'Segoe UI', var(--font-cjk), system-ui, sans-serif;
  --mono: ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, 'Liberation Mono', monospace;
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --fs-meta: 12px;
  --fs-sm: 13px;
  --fs-body: 16px;
  --fs-lg: 18px;
  --fs-xl: clamp(26px, 3.2vw, 38px);
  --fs-display: clamp(40px, 6vw, 76px);
  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;
}
```

检查：`grep -c "^  --" site/src/styles/tokens.css` 的结果应该比 `sed -n 14,92p web/src/tokens.css | grep -c "^  --"` 多 14。

- [ ] **Step 2: 写 `site/src/styles/site.css`**

```css
*, *::before, *::after { box-sizing: border-box; }
html { background: var(--bg-1); color: var(--fg); font-family: var(--font); font-size: var(--fs-body); line-height: 1.6; -webkit-font-smoothing: antialiased; }
body { margin: 0; }
a { color: inherit; }
img { max-width: 100%; }
:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; border-radius: 4px; }
kbd { font-family: var(--mono); font-size: var(--fs-meta); padding: 0 5px; margin-left: 6px; border: 1px solid color-mix(in oklab, currentColor 30%, transparent); border-radius: 4px; opacity: 0.7; }

.skip { position: absolute; left: 12px; top: -48px; z-index: 10; padding: 6px 10px; border-radius: var(--r-sm); background: var(--bg-elev); }
.skip:focus { top: 12px; }

/* only the visitor's own download button (both when it is neither, and before main.ts runs) */
:root[data-os='win'] [data-os='mac'], :root[data-os='mac'] [data-os='win'] { display: none; }

.site-header { position: fixed; inset: 0 0 auto; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 14px clamp(16px, 4vw, 40px); background: linear-gradient(var(--bg-1), transparent); }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 650; text-decoration: none; }
.site-header nav { display: flex; gap: clamp(12px, 2vw, 24px); font-size: var(--fs-sm); }
.site-header nav a { color: var(--fg-1); text-decoration: none; }
.site-header nav a:hover { color: var(--fg); }

.btn { display: inline-flex; align-items: center; gap: 4px; padding: 11px 18px; border: 1px solid var(--line-1); border-radius: var(--r-md); background: var(--bg-2); color: var(--fg); font: inherit; font-weight: 600; text-decoration: none; cursor: pointer; transition: transform 160ms var(--ease-out), background-color 160ms var(--ease-out); }
.btn:hover { background: var(--bg-3); }
.btn:active { transform: scale(0.97); }
.btn-primary { border-color: transparent; background: var(--primary); color: var(--primary-fg); }
.btn-primary:hover { background: color-mix(in oklab, var(--primary) 88%, var(--bg)); }
.dl-main { display: flex; flex-wrap: wrap; gap: 10px; }
.dl-alt { display: flex; flex-wrap: wrap; gap: 16px; margin: 10px 0 0; font-size: var(--fs-sm); color: var(--fg-2); }

.hero { position: relative; min-height: 100svh; display: grid; align-items: end; overflow: hidden; }
.hero-scene { position: absolute; inset: 0; }
.hero-scene img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
.hero-scene::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, color-mix(in oklab, var(--bg-1) 92%, transparent) 0, color-mix(in oklab, var(--bg-1) 55%, transparent) 38%, transparent 70%), linear-gradient(0deg, var(--bg-1), transparent 30%); }
.hero-copy { position: relative; max-width: 600px; padding: 0 clamp(16px, 5vw, 64px) clamp(56px, 12vh, 120px); }
.hero h1 { margin: 0 0 16px; font-size: var(--fs-display); line-height: 1.05; letter-spacing: -0.02em; }
.hero-sub { margin: 0 0 28px; font-size: var(--fs-lg); color: var(--fg-1); }
.hero-fine { margin: 14px 0 0; font-size: var(--fs-sm); color: var(--fg-2); }
.hero-scroll { position: absolute; right: clamp(16px, 4vw, 40px); bottom: 24px; margin: 0; font-size: var(--fs-sm); color: var(--fg-2); }

.chapters { padding: 0 clamp(16px, 5vw, 64px); }
.chapter { min-height: 100svh; max-width: 420px; display: flex; flex-direction: column; justify-content: center; }
.chapter-n { margin: 0 0 8px; font-family: var(--mono); color: var(--accent-text); }
.chapter h2 { margin: 0 0 12px; font-size: var(--fs-xl); line-height: 1.15; }
.chapter p { margin: 0 0 16px; color: var(--fg-1); }
.chapter-more { font-size: var(--fs-sm); color: var(--accent-text); text-decoration: none; }

.stats { display: flex; flex-wrap: wrap; justify-content: center; gap: clamp(24px, 6vw, 80px); padding: 96px 16px; border-block: 1px solid var(--line); }
.stats div { text-align: center; }
.stats strong { display: block; font-family: var(--mono); font-size: clamp(36px, 5vw, 56px); }
.stats span { font-size: var(--fs-sm); color: var(--fg-2); }

.install { max-width: 720px; margin: 0 auto; padding: 120px clamp(16px, 5vw, 64px); text-align: center; }
.install h2 { font-size: var(--fs-xl); margin: 0 0 12px; }
.install p { color: var(--fg-1); }
.install .dl-main, .install .dl-alt { justify-content: center; }

.site-footer { display: grid; gap: 8px; padding: 40px clamp(16px, 5vw, 64px); border-top: 1px solid var(--line); font-size: var(--fs-sm); color: var(--fg-2); }
.site-footer p { margin: 0; }
.site-footer nav { display: flex; flex-wrap: wrap; gap: 16px; }

.page { max-width: 760px; margin: 0 auto; padding: 120px 20px 80px; }
.page h1 { margin: 0 0 8px; font-size: clamp(32px, 4vw, 44px); }
.meta { margin: 0 0 40px; color: var(--fg-2); }
.os-blocks { display: flex; flex-direction: column; gap: 32px; }
:root[data-os='win'] [data-os-block='win'], :root[data-os='mac'] [data-os-block='mac'] { order: -1; }
.files { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.files li { display: flex; justify-content: space-between; gap: 16px; padding: 12px 16px; border: 1px solid var(--line-1); border-radius: var(--r-md); background: var(--bg); }
.files .size { font-family: var(--mono); font-size: var(--fs-sm); color: var(--fg-2); }
.note { font-size: var(--fs-sm); color: var(--fg-2); }
.note a, .prose a { color: var(--accent-text); }
pre { overflow-x: auto; padding: 14px 16px; border: 1px solid var(--line-1); border-radius: var(--r-md); background: var(--bg); font-family: var(--mono); font-size: var(--fs-sm); }
.prose h2 { margin-top: 48px; }
.prose h3 { margin-top: 28px; }
.prose code { padding: 1px 5px; border-radius: 4px; background: var(--bg-2); font-family: var(--mono); font-size: 0.9em; }

@media (max-width: 720px) {
  .nav-wide { display: none; }
  .hero-scene::after { background: linear-gradient(0deg, var(--bg-1) 30%, color-mix(in oklab, var(--bg-1) 40%, transparent) 70%, transparent); }
}
@media (prefers-reduced-motion: reduce) {
  .btn { transition: none; }
}
```

- [ ] **Step 3: 写 `site/src/layouts/Base.astro`**

```astro
---
import '../styles/tokens.css';
import '../styles/site.css';
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';
import { copy } from '../copy';
import { href, langRedirect, type Page } from '../i18n/paths';
import type { Locale } from '../i18n';

interface Props { locale: Locale; page: Page; title?: string }
const { locale, page, title } = Astro.props;
const c = copy(locale);
const base = import.meta.env.BASE_URL;
const site = Astro.site!;
const pageTitle = title ? `${title} · Claude Web` : c.meta.title;
// a visitor whose browser reads Chinese lands on /zh/ — written inline so it runs before anything paints
const redirect = locale === 'en' && page === 'home'
  ? `(function(){var t=(${langRedirect.toString()})(location.pathname,location.search,navigator.language||'',${JSON.stringify(base)});if(t)location.replace(t);})();`
  : '';
---
<!doctype html>
<html lang={locale === 'zh' ? 'zh-CN' : 'en'} data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    {redirect && <script is:inline set:html={redirect} />}
    <title>{pageTitle}</title>
    <meta name="description" content={c.meta.description} />
    <meta name="theme-color" content="#12110f" />
    <link rel="icon" type="image/svg+xml" href={`${base}icon.svg`} />
    <link rel="canonical" href={new URL(href(base, locale, page), site).href} />
    <link rel="alternate" hreflang="en" href={new URL(href(base, 'en', page), site).href} />
    <link rel="alternate" hreflang="zh" href={new URL(href(base, 'zh', page), site).href} />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={pageTitle} />
    <meta property="og:description" content={c.meta.description} />
    <meta property="og:image" content={new URL(`${base}og/${locale}.png`, site).href} />
    <meta property="og:image:alt" content={c.meta.sceneAlt} />
    <meta name="twitter:card" content="summary_large_image" />
  </head>
  <body>
    <a class="skip" href="#main">{c.nav.skip}</a>
    <Header locale={locale} page={page} />
    <main id="main"><slot /></main>
    <Footer locale={locale} page={page} />
    <script>
      import '../client/main';
    </script>
  </body>
</html>
```

- [ ] **Step 4: 写 `site/src/components/Header.astro` 和 `site/src/components/Footer.astro`**

`Header.astro`：

```astro
---
import { copy } from '../copy';
import { href, type Page } from '../i18n/paths';
import { otherLocale, type Locale } from '../i18n';
import { LANGUAGE_NAME } from '../i18n/languages';
import { REPO_URL } from '../data/links';

interface Props { locale: Locale; page: Page }
const { locale, page } = Astro.props;
const c = copy(locale);
const base = import.meta.env.BASE_URL;
const other = otherLocale(locale);
// ?lang=en: a chosen language is never redirected back (i18n/paths.ts langRedirect)
const switchHref = href(base, other, page) + (other === 'en' ? '?lang=en' : '');
---
<header class="site-header">
  <a class="brand" href={href(base, locale, 'home')}><img src={`${base}icon.svg`} alt="" width="22" height="22" />Claude Web</a>
  <nav aria-label={c.nav.label}>
    <a class="nav-wide" href={href(base, locale, 'home', '#features')}>{c.nav.features}</a>
    <a href={href(base, locale, 'download')}>{c.nav.download}</a>
    <a class="nav-wide" href={href(base, locale, 'changelog')} data-key-action="changelog" aria-keyshortcuts="C">{c.nav.changelog}</a>
    <a class="nav-wide" href={REPO_URL} data-key-action="github" aria-keyshortcuts="G">GitHub</a>
    <a href={switchHref} hreflang={other} lang={other === 'zh' ? 'zh-CN' : 'en'}>{LANGUAGE_NAME[other]}</a>
  </nav>
</header>
```

`Footer.astro`：

```astro
---
import { copy } from '../copy';
import { href, type Page } from '../i18n/paths';
import { otherLocale, type Locale } from '../i18n';
import { LANGUAGE_NAME } from '../i18n/languages';
import { REPO_URL, RELEASES_URL } from '../data/links';

interface Props { locale: Locale; page: Page }
const { locale, page } = Astro.props;
const c = copy(locale);
const base = import.meta.env.BASE_URL;
const other = otherLocale(locale);
---
<footer class="site-footer">
  <p>{c.footer.notice}</p>
  <p>{c.footer.license}</p>
  <nav aria-label={c.nav.label}>
    <a href={REPO_URL}>GitHub</a>
    <a href={RELEASES_URL}>GitHub Releases</a>
    <a href={href(base, locale, 'changelog')}>{c.nav.changelog}</a>
    <a href={href(base, other, page) + (other === 'en' ? '?lang=en' : '')} hreflang={other} lang={other === 'zh' ? 'zh-CN' : 'en'}>{LANGUAGE_NAME[other]}</a>
  </nav>
</footer>
```

- [ ] **Step 5: 写 `site/src/components/DownloadButtons.astro`**

```astro
---
import data from '../data/site-data.json';
import { copy } from '../copy';
import { href } from '../i18n/paths';
import type { Locale } from '../i18n';
import { RELEASES_URL } from '../data/links';
import type { SiteData } from '../data/releases';

interface Props { locale: Locale }
const { locale } = Astro.props;
const c = copy(locale);
const base = import.meta.env.BASE_URL;
const r = (data as SiteData).release;
---
<div class="dl">
  <div class="dl-main">
    <a class="btn btn-primary" data-os="win" data-key-action="download" data-key-os="win" aria-keyshortcuts="D" href={r?.win.installer?.url ?? RELEASES_URL}>{c.dl.win}<kbd>D</kbd></a>
    <a class="btn btn-primary" data-os="mac" data-key-action="download" data-key-os="mac" aria-keyshortcuts="D" href={r?.mac.arm64?.url ?? RELEASES_URL}>{c.dl.mac}<kbd>D</kbd></a>
    <a class="btn" data-key-action="source" aria-keyshortcuts="R" href={href(base, locale, 'download', '#source')}>{c.dl.source}<kbd>R</kbd></a>
  </div>
  <p class="dl-alt">
    <a data-os="mac" href={r?.mac.x64?.url ?? RELEASES_URL}>{c.dl.macIntel}</a>
    <a href={href(base, locale, 'download')}>{c.dl.other}</a>
  </p>
</div>
```

- [ ] **Step 6: 写 `site/src/views/Home.astro`**

首屏现在用 README 的网吧动图占位（第二份计划换成真正的场景）。

```astro
---
import Base from '../layouts/Base.astro';
import DownloadButtons from '../components/DownloadButtons.astro';
import data from '../data/site-data.json';
import { copy } from '../copy';
import { readmeLink } from '../readme';
import { AGENTS } from '../data/agents';
import type { SiteData } from '../data/releases';
import type { Locale } from '../i18n';
import cafeEn from '../../../docs/images/en/cafe.gif';
import cafeZh from '../../../docs/images/zh/cafe.gif';

interface Props { locale: Locale }
const { locale } = Astro.props;
const c = copy(locale);
const d = data as SiteData;
const cafe = locale === 'zh' ? cafeZh : cafeEn;
const num = (n: number) => n.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');
const stats = [
  d.stars != null ? { n: num(d.stars), label: c.stats.stars } : null,
  d.releases != null ? { n: num(d.releases), label: c.stats.releases } : null,
  { n: num(AGENTS.length), label: c.stats.agents },
].filter((s) => s !== null);
---
<Base locale={locale} page="home">
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-scene" id="hero-scene">
      <img src={cafe.src} width={cafe.width} height={cafe.height} alt={c.meta.sceneAlt} fetchpriority="high" />
    </div>
    <div class="hero-copy">
      <h1 id="hero-title">{c.hero.title}</h1>
      <p class="hero-sub">{c.hero.sub}</p>
      <DownloadButtons locale={locale} />
      <p class="hero-fine">{c.hero.fine}</p>
    </div>
    <p class="hero-scroll" aria-hidden="true">{c.hero.scroll} ↓</p>
  </section>

  <div id="features" class="chapters">
    {c.chapters.map((ch, i) => (
      <section class="chapter" id={`ch-${ch.id}`} data-chapter={ch.id} aria-labelledby={`ch-${ch.id}-t`}>
        <p class="chapter-n">{String(i + 1).padStart(2, '0')}</p>
        <h2 id={`ch-${ch.id}-t`}>{ch.title}</h2>
        <p>{ch.body}</p>
        <a class="chapter-more" href={readmeLink(locale, ch.readme)}>{c.chapterMore} →</a>
      </section>
    ))}
  </div>

  <section class="stats" aria-label={c.stats.label}>
    {stats.map((s) => <div><strong>{s.n}</strong><span>{s.label}</span></div>)}
  </section>

  <section class="install" id="install" aria-labelledby="install-t">
    <h2 id="install-t">{c.install.title}</h2>
    <p>{c.install.body}</p>
    <DownloadButtons locale={locale} />
  </section>
</Base>
```

- [ ] **Step 7: 两个首页路由**

`site/src/pages/index.astro`（整个替换 Task 1 的临时页）：

```astro
---
import Home from '../views/Home.astro';
---
<Home locale="en" />
```

`site/src/pages/zh/index.astro`：

```astro
---
import Home from '../../views/Home.astro';
---
<Home locale="zh" />
```

- [ ] **Step 8: 跑测试、构建，检查产物**

```bash
npm test -w site && tsc --noEmit -p site && npm run build -w site
grep -c 'data-chapter=' site/dist/index.html site/dist/zh/index.html
grep -o 'location.replace' site/dist/index.html | head -1
grep -c 'location.replace' site/dist/zh/index.html
grep -o '<html lang="[^"]*"' site/dist/index.html site/dist/zh/index.html
grep -o 'Download for Windows' site/dist/index.html | head -1
grep -o '下载 Windows 版' site/dist/zh/index.html | head -1
```

预期：测试和 tsc 全过；构建出 2 个页面；两个首页各有 7 个 `data-chapter=`；英文首页有 `location.replace`，中文首页是 0；`lang` 一个是 `en`、一个是 `zh-CN`；两个按钮文字各自找得到。`text.test.ts` 会检查新加的 `.astro` 里没有中文，如果它失败，把那段中文挪进 `copy.ts`。

- [ ] **Step 9: 在浏览器里看一遍**

```bash
npm run preview -w site
```

打开 `http://localhost:4321/`，确认下面几点（用 Chrome DevTools 的「Sensors」或 UA 覆盖来切系统）：

1. 浏览器语言是中文时，自动跳到 `/zh/`；点右上角「English」回到英文页，并且不会再被跳回中文页（网址带 `?lang=en`）。
2. Windows UA 只显示「Download for Windows」，macOS UA 只显示 macOS 按钮和「Intel Mac」链接，iPhone UA 两个都显示。
3. 按 `D` 打开的是自己系统的安装包链接，`R` 跳到下载页的 #source，`C` 去更新内容，`G` 去 GitHub。
4. DevTools Console 里没有报错。

（下载页和更新内容页在 Task 6 才有，`R` 和 `C` 跳过去现在是 404，属于预期。）

- [ ] **Step 10: 提交**

```bash
git add site/src
git commit -m "feat(官网): 页面骨架、按系统显示的下载按钮、中英首页（首屏先用网吧动图占位，7 章文案、数字、下载区）"
```

---

### Task 6: 下载页和更新内容页（中英）

**Files:**
- Create: `site/src/views/DownloadView.astro`、`site/src/views/ChangelogView.astro`、`site/src/pages/download/index.astro`、`site/src/pages/changelog/index.astro`、`site/src/pages/zh/download/index.astro`、`site/src/pages/zh/changelog/index.astro`

**Interfaces:**
- Consumes: `Base.astro`（`page="download"` / `"changelog"`、`title`）、`copy(locale).download` / `.dl` / `.nav`、`mb`、`type Asset`、`type SiteData`、`RELEASES_URL`、`SOURCE_COMMANDS`、`readmeLink(locale, 'About the installer')`、`changelogBody`，以及 `data-os-block` / `data-key-action` / `data-key-os` / `data-copy` 约定。
- Produces: 页面 `/download/`（锚点 `#windows`、`#macos`、`#source`）、`/changelog/`，以及对应的 `/zh/…`。

- [ ] **Step 1: 写 `site/src/views/DownloadView.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import data from '../data/site-data.json';
import { copy } from '../copy';
import { mb, type Asset, type SiteData } from '../data/releases';
import { RELEASES_URL, SOURCE_COMMANDS } from '../data/links';
import { readmeLink } from '../readme';
import type { Locale } from '../i18n';

interface Props { locale: Locale }
const { locale } = Astro.props;
const c = copy(locale);
const r = (data as SiteData).release;
interface Row { label: string; asset: Asset | null; keyOs?: 'win' | 'mac' }
const blocks: { id: string; os: 'win' | 'mac'; name: string; rows: Row[] }[] = [
  { id: 'windows', os: 'win', name: 'Windows', rows: [
    { label: c.download.installer, asset: r?.win.installer ?? null, keyOs: 'win' },
    { label: c.download.portable, asset: r?.win.portable ?? null },
  ] },
  { id: 'macos', os: 'mac', name: 'macOS', rows: [
    { label: c.download.arm64, asset: r?.mac.arm64 ?? null, keyOs: 'mac' },
    { label: c.download.x64, asset: r?.mac.x64 ?? null },
  ] },
];
---
<Base locale={locale} page="download" title={c.download.title}>
  <article class="page">
    <h1>{c.download.title}</h1>
    <p class="meta">
      {r && <span>{c.download.version(r.version, r.date)} · </span>}
      <a href={RELEASES_URL}>{c.download.allReleases}</a>
    </p>
    <div class="os-blocks">
      {blocks.map((b) => (
        <section id={b.id} data-os-block={b.os} aria-labelledby={`h-${b.id}`}>
          <h2 id={`h-${b.id}`}>{b.name}</h2>
          <ul class="files">
            {b.rows.map((row) => (
              <li>
                <a href={row.asset?.url ?? RELEASES_URL} data-key-action={row.keyOs ? 'download' : undefined} data-key-os={row.keyOs}>{row.label}</a>
                <span class="size">{row.asset ? mb(row.asset.size) : c.download.missing}</span>
              </li>
            ))}
          </ul>
          {b.os === 'mac' && <p class="note">{c.download.macNote} <a href={readmeLink(locale, 'About the installer')}>{c.download.warnings}</a></p>}
        </section>
      ))}
      <section id="source" aria-labelledby="h-source">
        <h2 id="h-source">{c.dl.source}</h2>
        <p>{c.download.sourceNeeds}</p>
        <pre><code>{SOURCE_COMMANDS}</code></pre>
        <button class="btn" type="button" data-copy={SOURCE_COMMANDS} data-copied={c.download.copied}>{c.download.copy}</button>
      </section>
    </div>
  </article>
</Base>
```

- [ ] **Step 2: 写 `site/src/views/ChangelogView.astro`**

```astro
---
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import Base from '../layouts/Base.astro';
import { copy } from '../copy';
import { changelogBody } from '../changelog';
import type { Locale } from '../i18n';
import en from '../../../CHANGELOG.md?raw';
import zh from '../../../CHANGELOG.zh-CN.md?raw';

interface Props { locale: Locale }
const { locale } = Astro.props;
const c = copy(locale);
const md = await createMarkdownProcessor();
const { code } = await md.render(changelogBody(locale === 'zh' ? zh : en));
---
<Base locale={locale} page="changelog" title={c.nav.changelog}>
  <article class="page prose">
    <h1>{c.nav.changelog}</h1>
    <Fragment set:html={code} />
  </article>
</Base>
```

- [ ] **Step 3: 四个路由**

`site/src/pages/download/index.astro`：

```astro
---
import DownloadView from '../../views/DownloadView.astro';
---
<DownloadView locale="en" />
```

`site/src/pages/zh/download/index.astro`：

```astro
---
import DownloadView from '../../../views/DownloadView.astro';
---
<DownloadView locale="zh" />
```

`site/src/pages/changelog/index.astro`：

```astro
---
import ChangelogView from '../../views/ChangelogView.astro';
---
<ChangelogView locale="en" />
```

`site/src/pages/zh/changelog/index.astro`：

```astro
---
import ChangelogView from '../../../views/ChangelogView.astro';
---
<ChangelogView locale="zh" />
```

- [ ] **Step 4: 构建，检查产物**

```bash
npm test -w site && npm run build -w site
ls site/dist/download site/dist/zh/download site/dist/changelog site/dist/zh/changelog
grep -c 'data-os-block=' site/dist/download/index.html
grep -o 'id="source"' site/dist/zh/download/index.html
grep -o '<h2[^>]*>[^<]*0\.3\.1' site/dist/changelog/index.html | head -1
grep -c 'CHANGELOG.zh-CN.md' site/dist/changelog/index.html
grep -c 'href="docs/' site/dist/changelog/index.html
```

预期：构建出 6 个页面；四个目录里都有 `index.html`；下载页有 2 个 `data-os-block=`；中文下载页有 `id="source"`；英文更新内容页能找到 0.3.1 的标题；`CHANGELOG.zh-CN.md` 和相对的 `href="docs/` 都是 0 次。

- [ ] **Step 5: 在浏览器里看一遍**

`npm run preview -w site`，打开 `/download/` 和 `/zh/changelog/`：

1. Windows UA 下 Windows 那一节排在最前，macOS UA 下 macOS 那一节排在最前；每个文件后面显示大小。
2. 「复制」点了变成「已复制」，1.5 秒后变回来；剪贴板里是那 5 行命令。
3. 「安装包的提示」打开 README 里对应的小节。
4. 更新内容页的版本标题、列表、代码都正常显示，链接能点。
5. Console 里没有报错。

- [ ] **Step 6: 提交**

```bash
git add site/src
git commit -m "feat(官网): 下载页（按系统排序、文件大小、从源码跑可复制）和更新内容页（CHANGELOG 直接渲染），中英各一"
```

---

### Task 7: 分享图、首次加载预算、GitHub Pages 发布、笔记

**Files:**
- Create: `site/public/og/en.png`、`site/public/og/zh.png`、`site/scripts/budget.ts`、`.github/workflows/site.yml`、`docs/notes/site.md`
- Modify: `site/package.json`（`build` 脚本）、`CLAUDE.md`（笔记索引加一行）
- Test: `site/scripts/budget.test.ts`

**Interfaces:**
- Produces: `BUDGET = 1572864`；`firstLoadRefs(html: string, base: string): string[]`（页面一打开就加载的站内文件，去掉 base 前缀后的相对路径）；`firstLoadBytes(dist: string, html: string, base: string): number`。

- [ ] **Step 1: 分享图**

从网吧动图取第一帧，裁成 1200×630，放大用最近邻保住像素：

```bash
mkdir -p site/public/og
ffmpeg -v error -y -i docs/images/en/cafe.gif -frames:v 1 -vf "scale=1200:630:force_original_aspect_ratio=increase:flags=neighbor,crop=1200:630" site/public/og/en.png
ffmpeg -v error -y -i docs/images/zh/cafe.gif -frames:v 1 -vf "scale=1200:630:force_original_aspect_ratio=increase:flags=neighbor,crop=1200:630" site/public/og/zh.png
ffprobe -v error -show_entries stream=width,height -of csv=p=0 site/public/og/en.png site/public/og/zh.png
```

预期：两行都是 `1200,630`。用图片查看器打开看一眼，画面应该是网吧，不是一片黑。如果第一帧是黑的，把 `-frames:v 1` 前面加上 `-ss 1`（取第 1 秒）重做。

- [ ] **Step 2: 写 `site/scripts/budget.test.ts`**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUDGET, firstLoadBytes, firstLoadRefs } from './budget.ts';

const BASE = '/';
const HTML = [
  '<link rel="stylesheet" href="/_astro/a.css">',
  '<link rel="icon" type="image/svg+xml" href="/icon.svg">',
  '<link rel="canonical" href="/">',
  '<link rel="alternate" hreflang="zh" href="/zh/">',
  '<script type="module" src="/_astro/main.js?v=1"></script>',
  '<script src="//cdn.example.test/x.js"></script>',
  '<img src="/_astro/cafe.gif" alt="">',
  '<img src="https://example.test/remote.png" alt="">',
  '<video poster="/poster.webp"></video>',
  '<a href="/download/">x</a>',
  '<img data-src="/lazy.png" alt="">',
].join('\n');

describe('firstLoadRefs', () => {
  it('counts what loads with the page: stylesheets, icons, scripts, images, posters (not other sites)', () => {
    expect(firstLoadRefs(HTML, BASE).sort()).toEqual(['_astro/a.css', '_astro/cafe.gif', '_astro/main.js', 'icon.svg', 'poster.webp']);
  });
});

describe('firstLoadBytes', () => {
  it('adds the HTML and the files that exist in dist', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'site-budget-'));
    fs.mkdirSync(path.join(dist, '_astro'));
    fs.writeFileSync(path.join(dist, '_astro/a.css'), 'x'.repeat(100));
    fs.writeFileSync(path.join(dist, '_astro/cafe.gif'), 'x'.repeat(1000));
    expect(firstLoadBytes(dist, HTML, BASE)).toBe(Buffer.byteLength(HTML) + 1100);
    fs.rmSync(dist, { recursive: true, force: true });
  });
  it('is 1.5 MB', () => {
    expect(BUDGET).toBe(1572864);
  });
});
```

- [ ] **Step 3: 运行，确认失败**

Run: `npm test -w site -- scripts/budget.test.ts`
Expected: FAIL，找不到 `./budget.ts`。

- [ ] **Step 4: 写 `site/scripts/budget.ts`**

```ts
// The first load of each home page stays within budget (docs/superpowers/specs/2026-10-21-website-design.md §7):
// the HTML and what it loads right away (stylesheets, icons, scripts, images, video posters) — not what a script
// fetches later on purpose (the scene's lazy chunk, the theme recordings).
//   node site/scripts/budget.ts        (after astro build; `npm run build -w site` runs it)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BUDGET = 1.5 * 1024 * 1024;

const TAG = /<(script|link|img|video|source)\b[^>]*>/gi;
const attr = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag)?.[1];

export function firstLoadRefs(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(TAG)) {
    const tag = m[0];
    const kind = m[1].toLowerCase();
    if (kind === 'link' && !/^(stylesheet|preload|modulepreload|icon)$/i.test(attr(tag, 'rel') ?? '')) continue;
    const value = attr(tag, kind === 'link' ? 'href' : kind === 'video' ? 'poster' : 'src');
    if (!value) continue;
    const ref = value.split(/[?#]/)[0];
    // //host/x is another site even when the base is "/"
    if (!ref.startsWith('//') && ref.startsWith(base)) out.add(ref.slice(base.length));
  }
  return [...out];
}

export function firstLoadBytes(dist: string, html: string, base: string): number {
  let n = Buffer.byteLength(html);
  for (const rel of firstLoadRefs(html, base)) {
    const f = path.join(dist, rel);
    if (fs.existsSync(f)) n += fs.statSync(f).size;
  }
  return n;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  let over = false;
  for (const page of ['index.html', 'zh/index.html']) {
    const n = firstLoadBytes(dist, fs.readFileSync(path.join(dist, page), 'utf8'), '/');
    console.log(`${page}: first load ${(n / 1048576).toFixed(2)} MB of ${(BUDGET / 1048576).toFixed(1)} MB`);
    if (n > BUDGET) over = true;
  }
  if (over) {
    console.error('over the first-load budget (spec §7)');
    process.exit(1);
  }
}
```

- [ ] **Step 5: 运行测试，接进构建**

Run: `npm test -w site -- scripts/budget.test.ts`
Expected: PASS。

`site/package.json` 的 `build` 改成：

```json
    "build": "astro build && node scripts/budget.ts",
```

然后：

```bash
npm run build -w site
```

预期：最后两行类似 `index.html: first load 0.4x MB of 1.5 MB`、`zh/index.html: first load 0.5x MB of 1.5 MB`（中文那张动图大一些），退出码 0。

- [ ] **Step 6: 写 `.github/workflows/site.yml`**

```yaml
name: Site

# Builds site/ (Astro) and publishes it to GitHub Pages on the custom domain https://psycioxyxs.my/
# Runs when the site or what it shows changes on main, and when a release is published (new version, new installers).
# One-time setup: Pages source = GitHub Actions, custom domain psycioxyxs.my (docs/notes/site.md → 发布).

on:
  push:
    branches: [main]
    paths:
      - 'site/**'
      - 'CHANGELOG.md'
      - 'CHANGELOG.zh-CN.md'
      - 'README.md'
      - 'README.zh-CN.md'
      - 'docs/images/**'
      - 'server/src/i18n/core.ts'
      - 'scripts/i18n/**'
      - 'package-lock.json'
      - '.github/workflows/site.yml'
  release:
    types: [published]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: site-pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      # the site needs Astro and the shared i18n sources only: no install scripts (no Electron download, no node-pty build)
      - run: npm ci --ignore-scripts
      - run: node site/scripts/releases.ts
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: npm test -w site
      - run: npm run build -w site
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site/dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - id: deploy
        uses: actions/deploy-pages@v4
```

- [ ] **Step 7: 写笔记 `docs/notes/site.md`**

```markdown
# 官网（2026-10-22）

`site/`：Astro 静态站，发布在 https://psycioxyxs.my/ （GitHub Pages 自定义域名，DNS 在 Cloudflare）。设计：`docs/superpowers/specs/2026-10-21-website-design.md`；
调研：`reports/Claude Web 官网设计参考调研.md`。9 月的单页旧宣传页（`site/index.html` / `page.html` / `build.mjs`）已被替换，git 历史里有。

## 跑起来

- `npm run dev -w site`（http://localhost:4321/）、`npm run build -w site`（构建 + 首次加载预算检查）、`npm run preview -w site`、`npm test -w site`。
- `npm run data -w site`：从 GitHub API 刷新 `site/src/data/site-data.json`（最新版本、安装包、星标）。CI 每次构建前也会跑；API 不通时用仓库里那份。
- Astro 精确锁 7.4.1：7.4.2 要 Node ≥ 22.23.4，本机是 22.22.1。升级前先看 `npm view astro@<v> engines`。

## 文案

- 所有字都在 `site/src/copy.ts` 的 `tr('中文')` 里，英文在 `site/src/i18n/en.ts`（`EN_SITE`）。`scripts/i18n/scan.mjs` 的 `AREAS` 有 `site/src`，
  所以 `web/src/i18n/coverage.test.ts` 和 `node scripts/i18n/extract.mjs --check` 都管到官网；和产品同一句中文的，英文必须一样。
- `.astro` 只写结构，不写中文（`site/src/i18n/text.test.ts` 会拦）。语言名「中文 / English」在 `i18n/languages.ts`（覆盖测试的白名单里）。
- 两种语言在同一个进程里构建，所以官网不用核心的 `t()` / `setLocale`，每页用 `makeTr(locale)`（底下是 `tIn`）。
- 「详细说明」链到 README：`readmeLink(locale, '3. ')` 按英文标题开头找，中文 README 按同一位置取标题，锚点按 GitHub 的规则现算。两份 README 的标题顺序必须一致。

## 语言和系统

- 英文在 `/`，中文在 `/zh/`。英文首页里内联了一小段脚本（`i18n/paths.ts` 的 `langRedirect` 直接序列化进页面）：浏览器是中文就跳 `/zh/`；
  带 `?lang=` 的不跳（切到英文的链接都带 `?lang=en`）。不用 localStorage。`langRedirect` 不能引用函数体外的任何东西。
- `client/main.ts` 给 `<html>` 设 `data-os`，CSS 只显示自己系统的下载按钮（`data-os`），下载页把自己的系统排最前（`data-os-block`）。
  快捷键 D / R / C / G 找 `[data-key-action]`，同名多个时优先 `data-key-os` 等于自己系统的。

## 发布

- `.github/workflows/site.yml`：push main（站点、README、CHANGELOG、i18n 相关路径）或发 release 时构建并发布。第一次要把 Pages 的来源设成 GitHub Actions、绑定自定义域名 `psycioxyxs.my`；Actions 发布不读 CNAME 文件，域名只在 Pages 设置里。
- DNS（Cloudflare）：根域名 4 条 A（185.199.108.153 / 109.153 / 110.153 / 111.153）和 4 条 AAAA（2606:50c0:8000::153 … 8003::153），
  代理状态「仅 DNS」（灰云），否则 GitHub 签不出 HTTPS 证书；证书签好后在 Pages 设置里勾上 Enforce HTTPS。
- 首页首次加载 ≤ 1.5 MB（`site/scripts/budget.ts`，构建时检查，超了构建失败）；只算 HTML 直接引用的文件，脚本之后按需拉的不算。
```

- [ ] **Step 8: `CLAUDE.md` 的笔记索引加一行**

在索引表最后一行（`ascii-themes`）后面加：

```markdown
| [site](docs/notes/site.md) | 官网（2026-10-22） | site/ 的 Astro 站、文案与覆盖测试、语言跳转、按系统的下载按钮、版本数据、首次加载预算、Pages 发布 |
```

- [ ] **Step 9: 最后整体检查**

```bash
npm test -w site
tsc --noEmit -p site
env -u CLAUDE_CODE_ENTRYPOINT npx vitest run --root web src/i18n/coverage.test.ts
node scripts/i18n/extract.mjs --check
npm run build -w site
```

预期：全部通过，`EN_SITE: 0 missing, 0 unused`，构建末尾两行预算都在 1.5 MB 以内。

- [ ] **Step 10: 提交**

```bash
git add site/public/og site/scripts/budget.ts site/scripts/budget.test.ts site/package.json .github/workflows/site.yml docs/notes/site.md CLAUDE.md
git commit -m "feat(官网): 分享图、首次加载 1.5 MB 预算检查、GitHub Pages 发布流程、官网笔记"
```

- [ ] **Step 11: 上线前问用户（不要自己做）**

推送和开启 Pages 都会影响 GitHub 上的公共状态，必须先问用户。确认后：

```bash
gh api -X POST repos/ypyik0669/claude-web/pages -f build_type=workflow
gh api -X PUT repos/ypyik0669/claude-web/pages -f cname=psycioxyxs.my
git push origin main
gh run watch --exit-status $(gh run list --workflow site.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

DNS 由用户在 Cloudflare 上配（见 `docs/notes/site.md` → 发布：4 条 A、4 条 AAAA，灰云）。`gh api repos/ypyik0669/claude-web/pages -q .https_certificate.state` 变成 `approved` 后，
`gh api -X PUT repos/ypyik0669/claude-web/pages -F https_enforced=true`。然后打开 https://psycioxyxs.my/ 和 `/zh/`，把 Task 5 Step 9 和 Task 6 Step 5 的检查再做一遍。
