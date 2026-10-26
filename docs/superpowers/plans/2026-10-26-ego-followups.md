# ego lite Follow-ups and Full-Access Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make every server-raised permission card obey one rule (full access asks nothing; other modes unchanged), put `ego_browser` behind the server gate for every agent, and make image-returning built-in tools visible to the model on our own engine (ccb).

**Architecture:** `server/src/web/site-gate.ts` and `server/src/computer/access.ts` are the server-raised gates. Each already knows the conversation; both get the conversation's permission mode and skip the card when it is `bypassPermissions`. `ego_browser` goes through the web gate as a script request. Image tools get `_meta: {'anthropic/alwaysLoad': true}` so ccb does not defer them behind `ExecuteExtraTool` (which stringifies results).

**Tech Stack:** TypeScript, Node, Vitest, React (permission cards), existing e2e phase scripts (`server/ws-phase*.mjs`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-26-unified-model-sources-design.md` §14 (14.1–14.4).
- Rule: conversation in `bypassPermissions` → no server-raised card at all, the action runs. Every other mode keeps its current behavior exactly (scripts ask every time, sites by allow-list, computer access every time).
- `ego_browser` card: "允许一次 / 拒绝" only, full script shown, title includes first URL host in the script. Deny or timeout → script does not run, tool returns a clear refusal, NOT the fallback-to-built-in hint.
- `ego_browser` is added to `webAllowedTools` so Claude does not show its own second card.
- alwaysLoad only on tools that return images; no other tool gains it.
- User-visible strings via `tr()` with English entries; `node scripts/i18n/extract.mjs --check` must be 0/0.
- Child processes `windowsHide: true`. Do not change unrelated behavior. Commit identity `ypyik0669`, new commits, no amend.
- Test env: unset `CLAUDE_CODE_ENTRYPOINT CLAUDE_WEB_DIST ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION CLAUDE_WEB_THINKING_DISPLAY CLAUDE_WEB_CONTEXT_WINDOWS CLAUDE_WEB_MODEL_CAPS ELECTRON_RUN_AS_NODE`.

### Task 1: Full-access mode skips every server-raised card

**Files:** modify `server/src/web/site-gate.ts`, `server/src/computer/access.ts`, `server/src/computer/http.ts` (or wherever access is wired), `server/src/index.ts` wiring if the mode getter must be injected; tests next to each; update the header comments that describe the old policy; `docs/notes/search-computer.md` short note.

- [ ] Tests first: `needsAsk('eval', host, {mode:'bypassPermissions'})` → `'no'`; every other mode → `'eval'` (unchanged). Site ops unchanged. Computer access: a deps-injected `mode(sessionId)` returning `bypassPermissions` → `{granted:true}` with zero events emitted and nothing pending; other five modes → card raised as before; unknown conversation still refused.
- [ ] RED, implement minimal change (computer access gets an optional `mode` dep; absent → old behavior), GREEN.
- [ ] Wire the real mode getter for computer access the same way the web gate gets `gate.mode` (find where `gate.mode` is built in startup and reuse the pool lookup).
- [ ] `npm test -w server -- --run src/web src/computer`, typecheck, i18n check. Commit `feat(permissions): full access asks nothing, scripts and computer control included`.

### Task 2: `ego_browser` behind the server gate

**Files:** `server/src/web/service.ts` (ego_browser case), `server/src/web/site-gate.ts` (request shape if needed), `server/src/web/allowed-tools` location of `webAllowedTools`, `web/src/features/chat/PermissionCards.tsx` and `permission-dock.ts` for the server-raised ego card, tests.

- [ ] Tests first (service level with a fake gate): default mode → `gate.ask` called once with `{tool:'ego_browser', eval:true, script:<full>, host:<first URL host or ''>}`, script runs only after `once`; `deny` → `runEgoScript` never called, result text says the user refused and does NOT contain `EGO_FALLBACK`; timeout behaves as deny; `bypassPermissions` → no ask, runs; no gate → runs. An answer of `always` must not be offered/accepted for scripts (treat as once).
- [ ] `webAllowedTools` contains `mcp__web__ego_browser` (test exists for the list — extend it).
- [ ] Web card: server-raised request for `ego_browser` renders the existing ego card look (title 「Claude 想在 ego lite 里运行一段脚本（host）」, full script code block), buttons 允许一次 / 拒绝 only. Add/extend a web unit test for the card props.
- [ ] Remove now-dead agent-side ego card path only if nothing else uses it; otherwise keep.
- [ ] Tests, typecheck, i18n. Commit `feat(web): ego_browser asks through the server for every agent`.

### Task 3: Image tools visible on ccb

**Files:** `server/src/web/mcp.ts`, `server/src/computer/mcp.ts`, any other in-repo MCP server that returns image content (grep `type: 'image'` / `image/png` in `server/src/**/mcp.ts` and preview tools), their tests; `docs/notes/ego-lite.md` pit line update.

- [ ] Inventory: list every tool whose result can contain an image content block. Record the list in the report.
- [ ] Tests first: each of those tools carries `_meta['anthropic/alwaysLoad'] === true`; a sample of non-image tools does not.
- [ ] Implement using the existing `ALWAYS_LOAD` constant (export/share it rather than duplicating).
- [ ] New e2e phase `server/ws-phase41.mjs` modeled on `ws-phase40.mjs`: our engine (ccb) against a fake upstream calls `browser_screenshot` (fake browser host answering with a real 1×1 PNG) and asserts the tool_result reaching the model is an image block, not text containing base64. Also assert the tool is not behind ExecuteExtraTool. If the built-in browser cannot be faked headlessly, use the computer MCP screenshot or another image tool and state which.
- [ ] Register phase41 in the e2e runner. Run phase40 and phase41. Commit `fix(web): image tools are not deferred on our engine, so screenshots reach the model as images`.

### Task 4: e2e for the permission rule across agents, full verification

**Files:** `server/ws-phase40.mjs` (extend), maybe a fake Codex/ACP path if phase scripts already have one (reuse; do not build a large new harness), `docs/notes/ego-lite.md`.

- [ ] Extend phase40: default mode on both Claude engines → exactly one server card for ego_browser (no agent card); bypassPermissions → zero cards and script runs. If an existing phase drives Codex or ACP with a fake binary, add the same two checks there; if none exists, record the gap honestly in the report instead of faking it.
- [ ] Update `docs/notes/ego-lite.md` and `docs/notes/search-computer.md` with the new rule and tests.
- [ ] Run full verification: typecheck, `npm test`, `npm run build:all`, `npm run e2e`, `node scripts/ui-smoke.cjs`, i18n check. Do not run heavy checks concurrently. Commit `test(e2e): one ego card in default mode, none in full access`.
