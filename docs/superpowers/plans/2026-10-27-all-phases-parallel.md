# All phases in parallel — workstream map

> 2026-10-27 · P0–P10 同时推进；每个工作流只碰自己的文件集，共享文件冻结。

## Rules

- 只改自己名下的文件；共享文件一律不改：`server/src/protocol.ts`、`web/src/i18n/en.ts`、`web/src/store/**`、`web/src/app/**`、`web/src/features/rail/**`、`web/src/features/workbench/**`、`web/src/main.tsx`、`package.json`。
- 新的用户可见字一律 `tr('中文')`；把新 key 写进报告，主线程统一补 `en.ts`。
- 不跑 `npm install`；不跑 `git add/commit/reset/checkout/clean`；不跑全量 `npm test`（只跑自己模块的 vitest + `tsc --noEmit`）。
- 不读/打印环境变量、密钥、`.env`。
- 完成报告：改了哪些文件、跑了哪些测试、结果、还差什么。

## Workstreams

| 线 | 期 | 文件集 | 目标 |
|---|---|---|---|
| W1 协议 | P1 | `server/src/gateway/**` | `/v1/models`、Gemini generateContent、错误信封、SSE、协议矩阵 |
| W2 上游 | P2 | `server/src/channels/**` | 全量 provider 描述符、账号/额度/目录骨架 |
| W3 路由 | P3 | `server/src/routing/**` | 7 种选择器、意图判断接口、决策轨迹 |
| W4 隐私 | P5 | `server/src/privacy/**` | 检测、占位符、流式还原、记录、fail-closed |
| W5 操控 | P6 | `server/src/computer/**`、`server/src/vision/**`、`server/src/web/observe.ts` | UIA 树/ref、任务计划、视觉 seer + 缓存 |
| W6 插件/同步/共享 | P7/P9 | `server/src/plugins/**`、`server/src/sync/**`、`server/src/share/**` | 插件 hooks/沙箱、WebDAV/S3/GitHub、共享限额 |
| W7 接入/导入 | P8 | `server/src/agent-config/**`、`server/src/agents/**`、`server/src/import/**` | Agent 适配器、漂移、CPA/Magpie 导入 |
| W8 界面 | P0/P4 | `web/src/features/model-hub/pages/**`、`web/src/styles/hub.css` | 9 个页面的真实骨架与数据 |

## Integration

1. 每条线先 `tsc --noEmit` + 自己模块的 vitest。
2. 主线程按 W1 → W2 → W3 → W4 → W5 → W6 → W7 → W8 做一次整体 `npm run typecheck`。
3. 补 `web/src/i18n/en.ts`（一次性）、跑 `node scripts/i18n/extract.mjs --check`。
4. `npm run build:all`、`npm test`、桌面截图验收。

## Shared contracts

- `server/src/gateway/compat/*` 是 P1 的公开契约；后续接线只依赖它的 `handleCompat(req,res,url,ctx)`。
- `server/src/channels/providers/*` 只描述 provider（id/name/kind/auth/models），不发起网络请求。
- `server/src/routing/selectors.ts` 是纯函数；`router.ts` 只调用它。
- `server/src/computer/uia.ts` 用注入的 tree/input 接口，测试用假树；真实 Windows helper 在 P6 后半段接。
- `web/src/features/model-hub/pages/*` 只读 `useGateway` / `useStore`，不改 store。
