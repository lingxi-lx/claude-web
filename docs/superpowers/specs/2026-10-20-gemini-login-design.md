# Gemini 网页账号：弹窗登录 + 粘贴兜底（2026-10-20）

用户反馈：手动复制 cookie 太复杂，而且总失败——第一次只复制了 `gemini.google.com` 那一栏（缺 `.google.com` 上的
SAPISID 等，组件回 400）；第二次复制后浏览器继续用，`__Secure-1PSIDTS` 被浏览器轮换，组件里的副本马上失效。

## 用户看到的

- 添加账号 → Gemini：桌面版是一个大按钮「登录 Google 账号」+ 小链接「改用粘贴 cookie」；网页版只有粘贴。
- 点按钮：弹出独立登录窗口（Google 登录页，登录后跳到 gemini.google.com）。检测到登录态齐了 → 自动关窗 → 自动添加
  → 向导显示结果并关闭。用户自己关窗 = 取消，提示被 Google 拦时可改用粘贴。
- 账号行：Gemini 账号「已过期 / 出错」时多一个「重新登录」，打开同一份 cookie 存储的窗口，拿到后换凭据。
- 粘贴兜底：三步说明（F12 → Network → 任一请求 → 复制 Request Headers 的 `cookie:` 整行）；粘贴后本地检查，
  缺什么直接列出（并提示「可能只复制了 gemini.google.com 那一栏」），不齐时「添加」灰掉；开头的 `cookie:` 自动去掉。

## 实现

- `desktop/src/gemini-login.ts`：`BrowserWindow` + `persist:gemini-<随机>` 分区（每个 Google 账号一份，不跟 Chrome、
  内置浏览器共用，所以不会被别处轮换掉）；UA 用 `cleanUserAgent`。每次导航 / cookie 变化检查：在 gemini.google.com 上且
  必需的 cookie 齐了 → `session.cookies.get({url:'https://gemini.google.com'})` 拼成整串 → resolve
  `{cookie, partition, userAgent}` → 关窗。关窗 = `null`。同时只允许一个登录窗口。
- IPC `desktop:gemini:login(partition?)`，preload 暴露 `geminiLogin`。
- `web/src/features/gateway/gemini-cookie.ts`：`normalizeCookie`（去 `cookie:` 前缀、换行）、`missingCookies`（必需：
  SID / HSID / SSID / APISID / SAPISID / __Secure-1PSID，与组件的报错一致），单元测试。桌面主进程用同一份名单（复制，桌面包不引 web）。
- 分区记在 meta.json `gateway.geminiLogins`（账号 id → 分区名，不含秘密）。
- 服务端不改接口：添加走 `upstreams.add`，重新登录走 `upstreams.update { credential }`。

## 顺带

Gemini 组件默认监听 `0.0.0.0`（源码 `internal/app/config.go` 的默认 `Host`），没有命令行参数，但 `--config` 读 JSON
并覆盖默认值：启动前写 `<dir>/gemini.json` = `{"host":"127.0.0.1"}`，参数加 `--config`。

## 测试

纯函数单测；`npm run typecheck`、`npm test`、`build:all`、i18n 检查、ui-smoke。真实 Google 登录只能用户手测
（也是唯一能确认 Google 是否拦截内嵌窗口的办法）。
