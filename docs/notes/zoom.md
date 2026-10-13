# 界面缩放（2026-10-10 用户要求：台式机分辨率高，界面看着小）

桌面版整个窗口的页面缩放（和浏览器的 Ctrl + / − 是同一种东西），50%–300%，所有窗口一个值，重启后记得。网页版什么都不做：浏览器自己的缩放就是它（`matchBrowserKey` 不拦这几个键）。

- **为什么不用 Electron 自带的 `zoomIn` / `zoomOut` / `resetZoom` 菜单 role**（以前菜单里就是它们）：不记（Electron 不把每个 host 的缩放存盘，桌面版每次启动又是新端口）、放大要按 Ctrl+Shift+=、系统按钮 / 红绿灯 / 最小窗口都不跟着变。
- **壳是主人**：`desktop/src/zoom.ts`（纯函数 + `zoom.test.ts`）+ `main.ts` 的 `currentZoom()` / `applyZoom(win)` / `setZoom(ask, from)`。存在 `flags.json` 的 `zoom`（不是 meta.json：建窗口时就要知道，否则先画一帧 100% 再跳）。建窗口用 `webPreferences.zoomFactor`，`dom-ready` 再 `applyZoom` 一次（Chromium 按 host 记缩放，启动页没有 host）。`<webview>`（内嵌浏览器）各有自己的 partition，不跟着缩放。
- **步长**：`ZOOM_STEPS`（0.5 … 3，浏览器那一套）。`nextZoom(cur, 'in' | 'out' | 'reset' | 数字, max)`。
- **上限看屏幕**（`zoomLimit(workArea)`）：页面至少要 900 个自己的像素宽（760 以下是手机布局，而手机布局没有标题栏的处理），所以**窗口的最小尺寸跟着比例变大**（`minWindow(z)`：宽 900 × z；高 max(600, 480 × z)——放大时允许页面矮到 480，否则 1080p + 125% 系统缩放的屏幕只能到 125%），比现在小的窗口会被撑大并挪回屏幕内（`fitWindow`）；这个最小窗口放不进屏幕工作区的比例就不给。实测 1536 × 816 的工作区上限是 150%。存着的值比当前屏幕的上限大（换了显示器）时启动就压到上限。
- **页面这边**：`web/src/ui/zoom.ts`（`installZoom()` 在 App 里装一次；`useZoom()` / `getZoom()` / `changeZoom()`；`canZoom` = 在桌面壳里），纯的部分 `ui/zoom-math.ts`。桥：`desktop.getZoom()`（preload 里 `webFrame.getZoomFactor()`，同步——首帧就要）、`zoomInfo()`、`setZoom(ask)`、`onZoom(cb)`。壳每次请求都向**所有**窗口广播结果（变没变都发），有焦点的那个窗口出一条 toast（「界面缩放 125%」/「已经放到最大了（150%）：再大，窗口就放不进这块屏幕」）。
- **以窗口像素计的东西要除以比例**：`<html>` 上的 `--zoom`。系统按钮宽 138、红绿灯的位置都是窗口像素，而页面的 1px 是窗口的 zoom 个像素：样式里给它们留的地方写成 `calc(142px / var(--zoom, 1))`（mac 的 84px / 76px 同理）；`tab-row.ts` 的 `captionWidth(zoom)` 是同一个除法（`rowStacked` / `tempsFolded` 多了 `zoom` 参数）；报给壳的按钮区域高度反过来要乘（`captionHeightAt(zoom, …)`）；mac 的红绿灯由壳按 `trafficLightY(z)` 挪。**新加「给系统按钮留地方」的规则时也要除。**
- **入口**：菜单加速器 `CmdOrCtrl+=` / `-` / `0`，外加不显示的 `Plus`、`numadd` / `numsub` / `num0`（main.ts，直接调 `setZoom`，不经页面）；`SHORTCUTS` 里的 `zoom.in / zoom.out / zoom.reset`（速查表、命令面板；`runCommand` 走 `changeZoom`）；设置 → 外观 →「界面缩放」（`settings/ZoomControl.tsx`：− · 比例下拉 · +，网页版不画控件，行的说明里写了用浏览器的缩放）。条目 id 是 `ui.zoom`，但它**不是 meta.json 的键**。
- **toast 可以带 key**（顺手加的）：`toast(text, ok, ms, key)`，同 key 的那条还在时原地改字、重新计时（连按五下 Ctrl+= 是一条在变的提示，不是五条）；`mergeToasts` 跟着把文字换掉。
- **验证**（都在真的桌面壳上，临时家目录 / 数据目录 / `--user-data-dir`）：`--remote-debugging-port` 连页面（`Runtime.evaluate` 调 `window.desktop.setZoom(...)`、读 `--zoom` / `innerWidth` / 行的 `padding-right`、点设置里的控件）——记住的比例启动就生效、一步放大、窗口被撑大且仍是桌面布局、flags.json、设置控件、上限 / 非法请求、还原、重启后还在；`--inspect` 连主进程（`Menu.getApplicationMenu()` 的条目和加速器、`webContents.sendInputEvent` 发 Ctrl+= / Ctrl+- / Ctrl+0 确实触发加速器、逐项 `click()`）。脚本在会话 scratchpad，不入库。**没验的**：macOS（红绿灯位置、84px 让位）、Linux、多显示器之间拖窗口后的上限。
- 界面冒烟只看网页这一面：外观页有「界面缩放」一行、没有控件、`--zoom` 是 1。
