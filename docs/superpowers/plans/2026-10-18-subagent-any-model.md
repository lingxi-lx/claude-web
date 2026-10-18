# 子代理用任何模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, this session). Steps use `- [ ]`.

**Goal:** A conversation's subagents can be put on any configured model, whatever the main conversation runs on; the pick does not follow the main model / provider.

**Architecture:** The pick is stored as a full `(provider, model)` pair (`cw-x:<provider>:<model>`). When it names another provider than the conversation's, the runner points the engine at the gateway's split route. The route passes **main** requests on to the base URL the engine would have used, byte for byte with the engine's own credential (so account logins, the cache shim and Gemini all work), and sends **subagent** requests (recognised by an alias model id) to the picked provider through the gateway's translating `run`, with that provider's key.

**Tech stack:** TypeScript, node:http, vitest, React/zustand.

Spec: `docs/superpowers/specs/2026-10-18-subagent-any-model-design.md`. Probe that settled risk 1: `scripts/probe-oauth-base.mjs` (both engines send `Authorization: Bearer <oauth token>` + `anthropic-beta: …oauth-2025-04-20…` to a local `ANTHROPIC_BASE_URL`, path kept).

## Global constraints

- Visible text through `tr('中文')`, English in `web/src/i18n/en.ts` / server `en.ts`; `node scripts/i18n/extract.mjs --check` clean. Say 对话 not 会话.
- Never send an account token (Bearer `sk-ant-oat…`) to a third-party provider; never log one.
- The split route stays loopback-only; its key is in the URL path and checked with `timingSafeEqual`.
- Tests: `npm run typecheck`, `npm test` (with `env -u` of the inherited vars in CLAUDE.md), `npm run e2e`, `node scripts/ui-smoke.cjs`.

## Decisions taken while planning (deviations from the spec, with reasons)

1. **Main requests are a transparent proxy**, not a gateway group: the route forwards them to `mainBase + path` with the engine's headers (hop-by-hop removed). One mechanism for every main kind; fingerprinting relays see the engine's own request.
2. **Alias on non-Anthropic wires is `cw-sub-<hex(model)>`**: ccb's Gemini / Grok clients map any id containing haiku / sonnet / opus to a family default (no opt-out like OpenAI's `CLAUDE_WEB_SERVED_MODELS`). The Anthropic wire keeps `cw-sub/<model>` (verified with real relays 2026-10-17).
3. **Account as subagent target:**
   - a `claude-account` profile: any Anthropic-wire main (provider, gateway, the machine's account, another account) — the route sends it to `https://api.anthropic.com` with the profile's token.
   - the machine's own login (`claude`): only under an Anthropic-format provider / gateway main. The engine then keeps the account login (provider key variables removed), main requests are re-keyed to the provider's key (and the `oauth-2025-04-20` beta taken out), subagent requests pass through to api.anthropic.com with the engine's login.
   - Not offered (left out of the menu, the note says why): account targets under an OpenAI / Grok / Gemini main; the machine's login under another account.
4. Unsupported combinations are left out of the menu rather than greyed.

## File map

- `server/src/models/subagent.ts` — pick format, resolution, defaults, aliases, `splitSupport()` (shared with web).
- `server/src/gateway/split.ts` — hook types (`SplitMain`, `SplitSub`).
- `server/src/gateway/service.ts` — `splitEndpoint` / `serveSplit` rewritten; `proxyMain`.
- `server/src/runtime/session-runner.ts` — env for each main kind.
- `server/src/runtime/pool.ts`, `server/src/ws/hub.ts`, `server/src/protocol.ts` — resolution / storage.
- `web/src/features/models/SubagentChip.tsx`, `subagent-label.ts`, `web/src/features/composer/Composer.tsx` — menu, label, default.
- Tests next to each; e2e `server/ws-phase28.mjs`.

### Task 1: pick model (`models/subagent.ts`)

**Produces:**
- `SUBAGENT_DEFAULT = 'subagentModel'` (global setting key); `SUBAGENT_DEFAULTS` kept for reading the old per-provider map.
- `fullPick(value: string, providerId: string | undefined): string` — '' stays ''; a `cw-x:` value stays; a plain id becomes `crossValue(providerKey(providerId), value)`.
- `subagentModelFor(o: { recorded?: SubagentPick; settings: Record<string, unknown>; providerId: string | undefined }): string` — recorded → `fullPick(recorded.model, recorded.providerId)` (no provider check any more); else `settings.subagentModel` when a string; else the old `subagentModels[providerKey(providerId)]` made full; else ''.
- `subagentTarget(value: string, mainProviderId: string | undefined): { kind: 'same'; model: string } | { kind: 'cross'; pick: SubagentPick } | null` — null for ''.
- `subAlias(model, wire: 'anthropic' | 'other' = 'anthropic')`, `isSubAlias(id, model)` (either form).
- `splitSupport(o: { mainType: ProviderType | 'claude'; subType: ProviderType | 'claude' }): boolean` — the matrix in decision 3 (`mainType`/`subType` 'claude' = the machine's login).

- [ ] Write tests in `models/subagent.test.ts` for each function (old `subagentModelFor` cases rewritten: moving provider keeps the pick; old map converted; global wins over old map; `subagentTarget` same/cross/''; alias forms; matrix rows).
- [ ] Run `cd server && npx vitest run src/models/subagent.test.ts` — FAIL.
- [ ] Implement; run again — PASS.

### Task 2: split route (`gateway/service.ts`, `gateway/split.ts`)

**Produces:**
```ts
export interface SplitMain { base: string; rekey?: string /* Bearer for main requests instead of the engine's credential */ }
export type SplitSub = { kind: 'provider'; providerId: string } | { kind: 'account'; token?: string /* absent: the engine's own login */ };
splitEndpoint(main: SplitMain, sub: SplitSub, model: string, wire: 'anthropic' | 'other'): string | null // the base URL, key inside: /gateway/~s/<token>/k/<key>
```
`serveSplit`: parse `/gateway/~s/<token>/k/<key>(rest)`; 401 on a bad key; read the body; model = body.model, or for Gemini the id in `/models/<id>:<action>`; `isSubAlias` → subagent:
- `provider`: normalise the path (`/models/…` → `/v1beta/models/…`, else `/v1` prefix), real model into body / path, `run` with a one-member group (as today; `passthroughHeaders` already swaps the credential); `anthropic-beta`'s `oauth-2025-04-20` token removed from `req.rawHeaders` first.
- `account`: forward to `https://api.anthropic.com` + path with the engine's headers; `token` set → authorization replaced by `Bearer <token>`, x-api-key removed, the oauth beta ensured.
Otherwise main: forward to `main.base` + path (query kept, `key` param removed) with the engine's headers; `rekey` → authorization `Bearer <rekey>`, x-api-key removed, oauth beta removed. Response status / headers / body piped back unchanged.
`thinking.display` dropped for non-Claude subagent models as today.

- [ ] Tests in `gateway/service.test.ts` (fake upstreams on 127.0.0.1): bad key 401; anthropic main passthrough keeps headers and body bytes; account sub with token sends Bearer token to the anthropic upstream (base overridable for tests via a `deps.anthropicBase`); provider sub never receives the engine's Bearer; openai main (`/chat/completions`) to main base; gemini main `/models/x:streamGenerateContent` to main base and hex alias to the sub provider; rekey replaces the credential and the oauth beta.
- [ ] FAIL → implement → PASS. Old split tests updated to the new signature.

### Task 3: runner env (`runtime/session-runner.ts`)

For a cross pick (`subagentTarget(...).kind === 'cross'`) and `splitSupport` true:
- main kind from `this.provider?.type` / `this.account` / the machine's account (`userAnthropicEnv().relay` → unsupported: warn, keep main model).
- `mainBase` = the env value the engine would use: `ANTHROPIC_BASE_URL` (provider / gateway), `OPENAI_BASE_URL` (openai), `GROK_BASE_URL` (grok, default `https://api.x.ai/v1`), `GEMINI_BASE_URL` (gemini, default `https://generativelanguage.googleapis.com/v1beta`), `https://api.anthropic.com` (accounts).
- that variable set to the split base; `CLAUDE_CODE_SUBAGENT_MODEL` = alias for the wire; OpenAI wire also adds the alias to `CLAUDE_WEB_SERVED_MODELS`.
- machine login as target under a provider: `rekey = provider key`, `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` removed from the engine env.
- plan key includes the pick (already does) so a change restarts the process.
- [ ] Tests in `session-runner.test.ts` (it captures the spawned env): one per main kind + the reverse case + unsupported (`CLAUDE_CODE_SUBAGENT_MODEL` absent).

### Task 4: storage / resolution (`pool.ts`, `hub.ts`, `protocol.ts`)

- pool: `subagentModelFor({ recorded, settings: m.settings(), providerId })`; an explicit value saved as `fullPick(explicit, params.providerId)`.
- hub `session.setSubagentModel`: no 「刚刚换了供应商」 error any more; saves `fullPick(req.model, providerId)`; the runner gets the full value.
- runner `setSubagentModel` / constructor take full values; `info.subagentModel` is full.
- [ ] pool tests: provider switch keeps the pick; global default used for a new conversation; old map converted.

### Task 5: web menu / label / default

- `SubagentChip`: no `lockProvider` filter to one provider — `alsoProviders` = every provider with `splitSupport(main, it)` plus the account rows when supported; current = `crossPick(value)`; onPick always `crossValue(it.providerId || 'claude', it.model)`; default toggle writes `subagentModel` (global) with the full value; label 「新对话都这样」.
- `subagentLabel`: a pick on the main provider shows just the model; another shows 「供应商 / 模型」 (account: 「Claude 账号 / 模型」).
- `Composer`: `wSubModel` from `subagentModelFor({ recorded: wSub, settings, providerId })`; live chip value `info.subagentModel`; resumed chip same function.
- `ModelMenu`: `lockProvider` keeps working as 「排第一」 + filter to `lockProvider ∪ alsoProviders`.
- lock note text: 「子代理（Task、工作流）用哪个模型，任何供应商的都行：主任务还是用主模型」 everywhere (old account-only sentence removed from en.ts).
- [ ] web tests (`subagent-cross.test.ts`): account conversation lists provider models; openai main lists anthropic / openai / gemini; the machine account is not offered under openai main; label forms.

### Task 6: e2e + smoke + notes

- `server/ws-phase28.mjs`: add rounds for an account-style main (fake api.anthropic.com via the test base override) and an OpenAI main with a Gemini subagent; assert which upstream got which request and that no Bearer `sk-ant-oat` reached a provider.
- ui-smoke `subagent-chip` section: open the chip in an account conversation, provider models listed.
- `docs/notes/models.md` 「子代理用别家的模型」 rewritten; spec status line.
- [ ] `npm run typecheck`, `npm test`, `npm run e2e`, `node scripts/ui-smoke.cjs`, `node scripts/i18n/extract.mjs --check`.

### Task 7: real-machine check

- Temp `CLAUDE_WEB_DIR`, real account login + the user's real relay (super-nb) profile: account main with relay subagent; relay main with account subagent (reverse). Record outcomes in `models` note. If the reverse is refused by the relay, drop the machine-login target under providers (`splitSupport` row) and say so.
