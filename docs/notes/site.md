# 官网（2026-10-22）

`site/`：Astro 静态站，发布在 https://psycioxyxs.my/ （GitHub Pages 自定义域名，DNS 在 Cloudflare）。设计：`docs/superpowers/specs/2026-10-21-website-design.md`；
调研：`reports/Claude Web 官网设计参考调研.md`。9 月的单页旧宣传页（`site/index.html` / `page.html` / `build.mjs`）已被替换，git 历史里有。

## 跑起来

- `npm run dev --prefix site`（http://localhost:4321/）、`npm run build --prefix site`（构建 + 首次加载预算检查）、`npm run preview --prefix site`、`npm test --prefix site`。
- `npm run data --prefix site`：从 GitHub API 刷新 `site/src/data/site-data.json`（最新版本、安装包、星标）。CI 每次构建前也会跑；API 不通时用仓库里那份。
- `site/` 是独立包（自己的 lockfile 和 node_modules，`npm run site:install`），不是根 workspace：Astro 要 `cookie@2`，根目录里 express 带的是 `cookie@0.7`，放进 workspace 会解析错、构建失败，还会顺带升级产品的 vite / zod。
- 新 clone 下来先 `npm run site:install`（官网有自己的 node_modules），再跑根目录的 `npm run typecheck` / `npm test`——这两个现在也查官网；CI 里是 `npm ci --prefix site`。
- **别用 `npm install --prefix site`**（2026-10-25）：在仓库根这么跑，npm 会往 `site/package.json` 里加 `"claude-web": "file:.."`，并建一个 JUNCTION `site/node_modules/claude-web` → 仓库根；之后谁递归删 `site/node_modules`，就会顺着它把整个仓库删掉（之前 server / web / desktop 整个没了，多半就是它）。`site:install` 现在是 `cd site && npm install --no-save`：在 site 里装，不加根这个依赖，`site/package.json` / `site/package-lock.json` 不动（npm 10 不带 `--no-save` 会把锁文件里的 `libc` 字段删掉）。装完可以 `cmd /c "dir /AL /S /B site\node_modules"` 确认没有链接（应该是 File Not Found）。已经有那个 junction 的 checkout：先 `cmd /c rmdir site\node_modules\claude-web`（不带 /s，只删链接），再 `git checkout -- site/package.json site/package-lock.json`。`npm ci --prefix site` 不写 package.json，CI 照旧。
- 没有 `site/package-lock.json` 时（重新生成锁文件），进 `site/` 用 `npx -y npm@11 install`（别在根用 `--prefix site`，见上一条）：npm 10.9.4 全新安装 vitest 4.1.x 会在 npm 内部崩溃（`reading 'edgesOut'`）；有锁文件后 npm 10 正常。
- Astro 精确锁 7.4.1：7.4.2 要 Node ≥ 22.23.4，本机是 22.22.1。升级前先看 `npm view astro@<v> engines`。

## 文案

- 所有字都在 `site/src/copy.ts` 的 `tr('中文')` 里，英文在 `site/src/i18n/en.ts`（`EN_SITE`）。`scripts/i18n/scan.mjs` 的 `AREAS` 有 `site/src`，
  所以 `web/src/i18n/coverage.test.ts` 和 `node scripts/i18n/extract.mjs --check` 都管到官网；和产品同一句中文的，英文必须一样。
- `.astro` 只写结构，不写中文（`site/src/i18n/text.test.ts` 会拦）。语言名「中文 / English」在 `i18n/languages.ts`（覆盖测试的白名单里）。
- 两种语言在同一个进程里构建，所以官网不用核心的 `t()` / `setLocale`，每页用 `makeTr(locale)`（底下是 `tIn`）。
- 「详细说明」链到 README：`readmeLink(locale, '3. ')` 按英文标题开头找，中文 README 按同一位置取标题，锚点按 GitHub 的规则现算。两份 README 的标题顺序必须一致。

## 更新内容

- 更新内容页直接渲染 CHANGELOG。`changelogBody` 把代码以外像标签的 `<…>`（`<kbd>` 除外）转义掉，所以 CHANGELOG 里写 `<relay host>` 这种占位符会原样显示；有一条测试拿真的两份 CHANGELOG 跑。

## 语言和系统

- 英文在 `/`，中文在 `/zh/`。英文首页里内联了一小段脚本（`i18n/paths.ts` 的 `langRedirect` 直接序列化进页面）：浏览器是中文就跳 `/zh/`；
  带 `?lang=` 的不跳（切到英文的链接都带 `?lang=en`）。不用 localStorage。`langRedirect` 不能引用函数体外的任何东西。
- 只有从站外进来的才跳：`langRedirect(loc, navLang, referrer, base)` 里 `document.referrer` 是本站的就不跳；跳的时候保留 `#锚点`。选了英文不会跨访问记住（没有 referrer 的下一次访问照样跳），这是有意的（不用 localStorage）。
- `client/main.ts` 给 `<html>` 设 `data-os`，CSS 只显示自己系统的下载按钮（`data-os`），下载页把自己的系统排最前（`data-os-block`）。
  快捷键 D / R / C / G 找 `[data-key-action]`，同名多个时优先 `data-key-os` 等于自己系统的。按住不放的重复按键（`repeat`）不算；
  系统是 `other`（Linux / ChromeOS / 手机，没有对应安装包）时 D 去下载页（页头「下载」链接的 `data-key-action="download-page"`），不会点到 Windows 的 exe。

## 发布

- `.github/workflows/site.yml`：push main（站点、README、CHANGELOG、i18n 相关路径）或发 release 时构建并发布。
- 发 release 时不在 tag 上构建：`github-pages` 环境只允许 main 部署，所以 release 那次只跑 `redispatch`，用 `gh workflow run site.yml --ref main` 在 main 上重跑一次，下一次运行里官网就是新版本和新安装包。
- Pages 设置（已设好）：来源 GitHub Actions，自定义域名 `psycioxyxs.my`；Actions 发布不读 CNAME 文件，域名只在 Pages 设置里。
- DNS（Cloudflare，zone `psycioxyxs.my`，备注「GitHub Pages - Claude Web site」，已建好）：根域名 4 条 A（185.199.108.153 / 109.153 / 110.153 / 111.153）、
  4 条 AAAA（2606:50c0:8000::153 … 8003::153），`www` CNAME → `ypyik0669.github.io`；全部「仅 DNS」（灰云），否则 GitHub 签不出 HTTPS 证书。
- HTTPS 已强制（2026-10-22 证书签好，覆盖 `psycioxyxs.my` 和 `www`；查证书：`gh api repos/ypyik0669/claude-web/pages -q .https_certificate.state` 是 `approved`）。
- `concurrency` 是 `cancel-in-progress: false`（和 GitHub 的 Pages 模板一样）：正在发布的那次不会被打断；但同一组里 GitHub 最多只留一个排队的运行，
  更新的排队运行会顶掉还没开始的旧的（旧的显示为已取消）——不丢东西，因为每次都从 main 的最新提交构建。
- PR 上的 CI（`ci.yml`）在 `build:all` 之后跑 `npm run build:site`（Astro 构建 + 1.5 MB 预算检查，不联网），官网构建坏了合并前就能看到。
- 首页首次加载 ≤ 1.5 MB（`site/scripts/budget.ts`，构建时检查，超了构建失败）；只算 HTML 直接引用的文件，脚本之后按需拉的不算。
- 分享图 `site/public/og/{en,zh}.png`：网吧动图第一帧，`ffmpeg -i docs/images/<lang>/cafe.gif -frames:v 1 -vf "scale=1200:630:force_original_aspect_ratio=increase:flags=neighbor,crop=1200:630"`（最近邻放大保住像素）。

## 给第二份计划（首屏网吧）

- 网吧场景上线前，首页 7 个章节按内容高度排（`.chapter` 只有 `padding-block`），首屏也不放「滚动看它们干活」（底下还没有会动的东西）。
  场景上线时一起恢复：章节 `min-height: 100svh`，首屏提示加回 `tr('滚动看它们干活')` 和 `en.ts` 里的英文。
- `#hero-scene` 现在在 `.hero` 里，`.hero` 是 `overflow: hidden`，章节（`#features`）是 `.hero` 的兄弟：要让场景跟着章节一路钉住，
  得在 `.hero` + `#features` 外面包一层，sticky / fixed 放不进现在这个 `.hero`。另外 `site/scripts/budget.ts` 不算 CSS 里 `url()` 引的字体，
  也不算脚本 import 出来的 chunk——像素字体和场景的 chunk 都得补进预算检查。
