# 录屏（阶段 E3，2026-10-25）

## 怎么走

- 「+」菜单 → 录屏（只有桌面版：`desktop.captureSources` 在才显示）→ 我们自己的选择框 `features/recording/SourcePicker.tsx`：
  整个屏幕、窗口（排除本应用自己的窗口：`getMediaSourceId()`）、内置浏览器的标签。
- 选了以后 `desktop.chooseCapture(pick)`：主进程 `desktop/src/capture.ts` 的 `PendingPicks` 记下「这个窗口选了什么」，10 秒内
  有效、取一次就删。`session.defaultSession.setDisplayMediaRequestHandler` 只把这一次 getDisplayMedia 交给选中的源；没选、
  过期、别的 webContents 发起的，一律拒绝。内置浏览器标签只认**本窗口**的 `<webview>`（`hostWebContents` 是发起者）。
- 3 秒倒数（Esc 取消）→ `MediaRecorder`：mp4（avc1）能用就 mp4，否则 webm vp9 / vp8。上限 10 分钟或 190 MB（附件上限 200 MB）。
  标题栏那一行正中一个红点 + 时间，点了停；系统那边停止共享也会停。
- 录完是输入框里的一个芯片「录屏 · m:ss」；发送时视频上传到对话目录的 `recordings/rec-<start>.<ext>`，正文前加一句说明视频路径，
  再加关键帧图片。

## 抽帧（`keyframes.ts` / `extract.ts`）

- MediaRecorder 写的 webm 没有时长（`duration = Infinity`）：先 seek 到 1e9 等 `durationchange`，拿不到就用录制时长。
- `sampleTimes`：每 0.5 秒看一帧，最多 240 次（长视频拉大间隔）。每帧画成 64×36 灰度，`frameDiff` 平均绝对差。
- `pickKeyframes`：第一帧 + 变化最大的（阈值 8，彼此至少隔 1 秒），最多 12 张，按时间排；只剩第一帧而视频 ≥ 2 秒就补最后一帧。
  图按长边 1568 缩，JPEG 0.8。抽帧失败只发视频路径，toast 说一句。

## 录下 Claude 的操作（B5）

- 浏览器 ⋯ 菜单的开关 `browser.recordActions`（默认关；桌面版才有）。宿主（`browser/host.ts` → `record-actions.ts`）收到这一轮
  第一个浏览器动作时，录这个对话自己的标签（不倒数）；对话回到 idle 就停。
- 视频进 `recordings/browser-<start>.<ext>`，位置记在 `sessionMeta.browserRecordings`（最近 20 个，`{ path, start, end }`）；
  `ChatView` 的回合末尾，开始时间落在这一轮里的显示芯片「录下的操作 · m:ss」，点了在内置浏览器里放。

## 测试

- 纯函数：`keyframes.test.ts`、`desktop/src/capture.test.ts`。
- ui-smoke `stage-e`：+ 菜单有录屏、选择框里「整个屏幕」至少一张缩略图、Esc 关掉、什么都没录（一个带桌面桥替身的窗口，
  `captureSources` 走真的 `desktopCapturer`）。真录 5 秒 + 发给模型这一步没在自动测试里做。
