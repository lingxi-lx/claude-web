# 内嵌浏览器（阶段 10，2026-09-04）

- `Tile` 加了 `{kind:'browser'; url}`。桌面端 `webviewTag: true` 渲染 `<webview>`（`will-attach-webview` 里把我们的 preload 摘掉、`did-attach-webview` 里拒绝弹窗）；浏览器端降级成受限 iframe，**被 `X-Frame-Options` 拒绝的站点就是一片空白，这是浏览器行为不是 bug**，底部一直提示「用右上角在系统浏览器打开」。
- 地址栏的 `normalise()` 认 `localhost:3000`、`:3000`、裸域名，都不像就当搜索词丢给 Google。
