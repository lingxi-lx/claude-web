# 阶段 F：claude.ai 功能的本机版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 五个 claude.ai 功能做成本机版：F1 常开机器 + 交接 / 取回（Git 快照推到 `cw/handoff-<id>`，不碰用户的分支 / 暂存区 / 工作区）；F2 项目页（项目说明、项目资料、项目里的对话、跨对话工具的项目范围）；F3 从手机 / IM 派活；F4 导入 claude.ai 的数据导出 zip（对话进对话库、项目进 F2）；F5 产物发布成本机分享链接（快照、`/p/<id>/`、有效期、撤回、单个 HTML）。

**Architecture:** 纯逻辑先写、单独测：`server/src/handoff/git.ts`（快照提交、推送、取回，临时仓库里测逐字节不变）、`server/src/publish/core.ts`（id、有效期、路径包含、响应头、单个 HTML 内联）、`server/src/import/zip.ts` + `server/src/import/claude-ai.ts`（读 zip、解析导出、转成对话库消息、去重计划）、`server/src/dispatch/core.ts` + `server/src/sessions-mcp/scope.ts`（派活的形状、IM 命令、项目范围过滤、项目说明段落）。然后服务端：F2/F3（`Workspace.instructions` 等、runner 附加说明、项目资料目录进 `additionalDirectories`、sessions MCP 范围、`dispatch.start`、IM `/dispatch`）、F1/F5（`HandoffService`、`peers[].alwaysOn`、`PublishService` + `/p/` 路由 + 发到 peer）、F4（`ClaudeAiSource`、上传 + 导入）。所有新请求集中在 `server/src/cloud/handlers.ts`（`isCloudRequest` / `handleCloud`，照 `characters` 的做法），hub 只加一行分派。最后界面和 e2e。

**Tech Stack:** Node（`child_process.execFile` 跑 git，`zlib.inflateRawSync` 读 zip）、React + zustand、vitest、e2e（`server/ws-phaseN.mjs`，第二个本机 Claude Web 当常开机器、临时 bare 仓库当远端）、ui-smoke（Electron，临时 HOME）。

Spec：`docs/superpowers/specs/2026-10-24-desktop-parity-design.md` 的「F」一节（F1–F5），以及「实现方式与顺序」「跨期规则」「不做的」。

## Global Constraints

- 只在 worktree `C:\Users\YPY\claude-web\.superpowers\wt\f`（分支 `stage-f`）里改和提交；不 merge / rebase / push / stash / reset / 换分支；只 `git add <列出的路径>`，绝不 `git add -A` / `.`。
- e2e 期号只用 **37、38、39**；开发中跑 `node scripts/e2e.mjs 37 38 39`，最后跑全量。
- 起 Electron（ui-smoke）前拿锁 `until mkdir C:/Users/YPY/claude-web/.superpowers/electron.lock 2>/dev/null; do sleep 20; done`，跑完（失败也）`rmdir` 释放；只用临时 `--user-data-dir` + HOME + CLAUDE_WEB_DIR。
- 测试命令前加 `env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_WEB_DIST -u ANTHROPIC_DEFAULT_OPUS_MODEL -u ANTHROPIC_DEFAULT_SONNET_MODEL -u ANTHROPIC_DEFAULT_HAIKU_MODEL -u CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION -u CLAUDE_WEB_THINKING_DISPLAY -u CLAUDE_WEB_CONTEXT_WINDOWS -u CLAUDE_WEB_MODEL_CAPS -u ELECTRON_RUN_AS_NODE -u CLAUDE_CODE_AUTO_COMPACT_WINDOW`（下文写作 `$CLEAN`）。
- 共享文件（`server/src/protocol.ts`、`server/src/ws/hub.ts`、`web/src/i18n/*`、`web/src/features/settings/catalog.ts`、`scripts/ui-smoke.cjs`、`CLAUDE.md` 索引）只加自成一块的新代码，不重排不重排版。
- 用户看得见的字全走 `tr('中文')`，跑 `node scripts/i18n/extract.mjs --check`；不出现 会话 / 引擎 / 窗格 / 停靠 / effort / ultracode / ACP。
- 新 UI 状态存 meta.json（`settings.set`），不用 localStorage。本阶段新键：`dispatch.last`（`{ peer?: string; workspaceId?: string }`）。
- zustand 选择器返回稳定引用；Enter / Escape 先问 `imeComposing()`；菜单用 `useAnchoredMenu` / `Popover` / `useDropdown`；原生对话框用 `dlg.*`；面板不卸载。
- 新加带 `sessionId` 的请求进 `server/src/federation/rewrite.ts` 路由表（本阶段：`handoff.check` / `handoff.start` / `handoff.fetchBack` 只对本机对话——不进 FORWARD，其它机器上的对话由 planRoute 拒绝，并在 rewrite.test 里锁住）。
- 子进程 `windowsHide: true`（git 也是）。

**安全（必须）：**

- 交接绝不改用户当前分支、暂存区、工作区：快照用 **暂存区的副本**（`GIT_INDEX_FILE=<临时文件>`）跑 `git stash create`（只写对象、不写 `refs/stash`），未跟踪文件也只在这份临时暂存区里 `git add`，再 `git commit-tree <tree> -p HEAD`；`GIT_OPTIONAL_LOCKS=0`。推送用不带 `+` 的 refspec（从不强推）；远端已有同名分支就换 id（最多 5 次）。取回只 `git fetch` 进一个新的本地分支（已存在就加后缀），给 diff，**不合并**、不 checkout。
- 发布：id 是 128 位随机（32 位十六进制）；`/p/<id>/…` 只服务该快照目录：解码后拒绝 `..` 段、空字节、绝对路径，`path.resolve` + `realpath` 后必须在目录内（符号链接出界拒绝）；不需要也不接受应用令牌（路由在鉴权前，忽略 `?token=` 和 cookie）；响应头 `Content-Security-Policy: sandbox allow-scripts allow-popups`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Cache-Control: no-store`。局域网链接只有开了远程监听才给。
- claude.ai 导入对用户文件只读，唯一写的是用户选的项目资料文件夹（且不覆盖已有文件）；不调用 claude.ai 任何接口。
- 派活沿用项目的权限模式（`Workspace.permissionMode`，没有就是全局默认），需要授权的照常推到发起的窗口 / 手机 / IM。
- 真机检查：常开机器 = 本机第二个 Claude Web（临时目录）；远端 = 临时 bare 仓库，从不推到用户的真实远端。

现有锚点（写计划时核对过，基线 f3e5b10）：

- meta：`server/src/meta/store.ts:12` `Workspace { id, path, name, addedAt, order, folders? }`，:13 `SessionMeta`（一行），:15-44 `Data`（`peers?: PeerRecord[]` :40），`workspaces()` :97，`updateWorkspace` :124-131，`setSessionMeta` :140，`peers()` / `setPeer` :262 起。
- 协议：`server/src/protocol.ts` `SessionSummary` :45，`SourceCaps` :69（`continueInClaude?` :77），`AgentKind` :237，`LIBRARY_ID_PREFIXED_KINDS` :244，`Workspace` :375，`SessionMeta` :376，`ArtifactRef` :488，`ClientRequest` :492 起（`workspaces.update` :546，`artifacts.list` :574，`library.join` :732），`PeerRequest` :763，`ServerEvent` :770（`meta.changed` :790，`notice` :792）。
- 联邦：`server/src/federation/types.ts` `PeerInfo` :45-63，`PeerRecord` :66-76，`PeerRequest` :81-90（`peers.update` 的 `patch: { name?, enabled? }`）；`service.ts` `list()` :143-153，`update()` :297-306，私有 `forward()` :321-329，`route()` :332-357，`handover()` :446；`rewrite.ts` `FORWARD` :13-26，`LOCAL` :30-32，`planRoute` :65-84。
- hub：`server/src/ws/hub.ts` `Services` :88-152，`meta.on('changed')` → `meta.changed` :193，`handle()` :406，`isXRequest` 分派 :412-415，`session.open` :454，`session.send` :525，`workspaces.update` :560-571，`artifacts.list` :703。
- pool / runner：`server/src/runtime/pool.ts` `extraFolders` :68-71（`projectFolders(cwd, meta.workspaces())`），`open()` :127，权限模式默认 `ui.defaultMode` :145-150，`new SessionRunner(…, { …, additionalDirectories })` :185-186；`session-runner.ts` 构造函数 :225，`extraDirs` :227，`const append = [verify, this.thinkingSection, delegate]` :528，`options` :536-549。`server/src/meta/workspace-folders.ts`：`sameDir`、`normFolders`、`projectFolders(cwd, workspaces)`。
- sessions MCP：`server/src/sessions-mcp/tools.ts` `SessionsDeps` :17-27，`sessionsMcpServer(self, d)` :55，`find` :56，`list_sessions` :62-65（`listRows(list, self, stateOf, opts)`）。
- IM：`server/src/im/router.ts` `HELP` :9，`onCommand` :112（`/new` :120-126），`openNew` :183-188，`notify` :222，`onSessionMessage` 的 result :245。
- 对话库：`server/src/library/types.ts` `SessionSource`；`cursor-source.ts`（只读来源的样板）；`continue-in-claude.ts` `continuationEntries`；`service.ts` `continuesInClaude` :774、`continuation` :784、`join` :586、`readAll` :514、:760（来源名字）；`server/src/runtime/transcript-file.ts` `writeClaudeTranscript` :43；`server/src/index.ts` 来源列表 :408-415，HTTP handler :210（`/api/attachments` :263，静态文件 :280 起）。
- 界面：`web/src/features/sidebar/ProjectDialog.tsx`（编辑项目，94 行），`groups.tsx` `ProjectMenu` :17-46，`entries.ts` `ROW_MENU` :33，`session-actions.tsx`，`rows.tsx`；`web/src/features/composer/MachineChip.tsx`（`usable` :14）；`settings/PeersSection.tsx`；`workbench/AllArtifacts.tsx`；`files/FileMenu.tsx`；`web/src/model/attachments.ts` `uploadAttachment` :103（上传的样板）；`store/index.ts` `loadMeta` :495。
- 没有 zip 依赖（`unzipper` 只是传递依赖，打包后不一定在）→ 自己写只读 zip（stored / deflate，`zlib.inflateRawSync`）。

---

### Task 1: 交接的 Git 部分（快照、推送、取回、常开机器那边签出 / 回推）

**Files:**
- Create: `server/src/handoff/git.ts`
- Test: `server/src/handoff/git.test.ts`

**Interfaces:**

```ts
export function git(cwd: string, args: string[], o?: { env?: NodeJS.ProcessEnv }): Promise<string>; // execFile('git', …, { windowsHide: true }), GIT_OPTIONAL_LOCKS=0, GIT_TERMINAL_PROMPT=0; trims the trailing newline
export function newHandoffId(): string; // 8 hex
export function handoffRemote(cwd: string): Promise<{ ok: true; remote: string; url: string } | { ok: false; reason: string }>; // origin first, else the first remote; not a repo / no remote / no commit → reason (tr)
export function snapshotCommit(cwd: string, message: string): Promise<{ commit: string; base: string }>; // index copy + stash create + untracked on the copy + commit-tree -p HEAD
export function pushHandoff(cwd: string, remote: string, commit: string, makeId?: () => string): Promise<{ id: string; branch: string }>; // ls-remote; taken → new id (≤5); push <commit>:refs/heads/cw/handoff-<id> (no +)
export function fetchBack(cwd: string, remote: string, branch: string): Promise<{ local: string; stat: string; diff: string; files: number }>; // fetch into a free refs/heads/<branch>[-2…]; diff HEAD...local
export function checkoutHandoff(cacheRoot: string, wtRoot: string, url: string, branch: string): Promise<string>; // peer: bare cache per url, fetch, worktree add <wtRoot>/<id>
export function publishHandoff(wtDir: string, url: string, branch: string, message: string): Promise<{ commit: string; changed: boolean }>; // peer: add -A + commit in our own worktree, push HEAD:refs/heads/<branch> (fast-forward only)
```

- [ ] **Step 1: 写失败的测试**（临时仓库，远端是临时 bare 仓库）

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { git, snapshotCommit, pushHandoff, fetchBack, handoffRemote, checkoutHandoff, publishHandoff } from './git.js';

let root: string, repo: string, bare: string;
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const hashTree = (dir: string): string => {
  const h = crypto.createHash('sha256');
  const walk = (d: string) => { for (const n of fs.readdirSync(d).sort()) { if (n === '.git') continue; const p = path.join(d, n); const st = fs.lstatSync(p); h.update(path.relative(dir, p)); if (st.isDirectory()) walk(p); else h.update(fs.readFileSync(p)); } };
  walk(dir); return h.digest('hex');
};
/** everything handoff must leave alone, byte for byte */
const state = async () => ({
  index: fs.readFileSync(path.join(repo, '.git', 'index')).toString('hex'),
  head: fs.readFileSync(path.join(repo, '.git', 'HEAD'), 'utf8'),
  branch: await git(repo, ['rev-parse', 'HEAD']),
  tree: hashTree(repo),
  stash: await git(repo, ['stash', 'list']),
  status: await git(repo, ['status', '--porcelain']),
});

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-handoff-'));
  bare = path.join(root, 'remote.git'); repo = path.join(root, 'repo');
  await git(root, ['init', '--bare', '-b', 'main', bare]);
  await git(root, ['init', '-b', 'main', repo]);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'secret.env\n');
  await git(repo, ['add', '.']); await git(repo, [...ID, 'commit', '-m', 'init']);
  await git(repo, ['remote', 'add', 'origin', bare]); await git(repo, ['push', 'origin', 'main']);
  // uncommitted work of every kind
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo staged\n'); await git(repo, ['add', 'a.txt']);
  fs.appendFileSync(path.join(repo, 'a.txt'), 'three unstaged\n');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'untracked\n');
  fs.writeFileSync(path.join(repo, 'secret.env'), 'KEY=1\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('handoff git', () => {
  it('finds the remote, refuses a folder without one', async () => {
    expect(await handoffRemote(repo)).toMatchObject({ ok: true, remote: 'origin' });
    const plain = path.join(root, 'plain'); fs.mkdirSync(plain);
    expect((await handoffRemote(plain)).ok).toBe(false);
    await git(plain, ['init']);
    expect((await handoffRemote(plain)).ok).toBe(false);
  });

  it('snapshots staged + unstaged + untracked work, leaves branch / index / worktree byte-identical', async () => {
    const before = await state();
    const { commit, base } = await snapshotCommit(repo, 'handoff');
    expect(await state()).toEqual(before);
    expect(base).toBe(before.branch);
    expect(await git(repo, ['rev-parse', `${commit}^`])).toBe(base);
    expect(await git(repo, ['show', `${commit}:a.txt`])).toBe('one\ntwo staged\nthree unstaged');
    expect(await git(repo, ['show', `${commit}:new.txt`])).toBe('untracked');
    await expect(git(repo, ['show', `${commit}:secret.env`])).rejects.toThrow(); // ignored files stay out
  });

  it('a clean tree snapshots to HEAD\'s tree', async () => {
    await git(repo, ['stash', '-u']); await git(repo, ['stash', 'drop']);
    const { commit, base } = await snapshotCommit(repo, 'clean');
    expect(await git(repo, ['rev-parse', `${commit}^{tree}`])).toBe(await git(repo, ['rev-parse', `${base}^{tree}`]));
  });

  it('pushes to cw/handoff-<id> without touching the user, a taken name gets a new id, never forced', async () => {
    const { commit } = await snapshotCommit(repo, 'h');
    // someone already has cw/handoff-aaaa on the remote
    await git(repo, ['push', 'origin', 'HEAD:refs/heads/cw/handoff-aaaa']);
    const taken = await git(bare, ['rev-parse', 'refs/heads/cw/handoff-aaaa']);
    const before = await state();
    const ids = ['aaaa', 'bbbb'];
    const r = await pushHandoff(repo, 'origin', commit, () => ids.shift()!);
    expect(r).toEqual({ id: 'bbbb', branch: 'cw/handoff-bbbb' });
    expect(await git(bare, ['rev-parse', 'refs/heads/cw/handoff-bbbb'])).toBe(commit);
    expect(await git(bare, ['rev-parse', 'refs/heads/cw/handoff-aaaa'])).toBe(taken);
    expect(await git(bare, ['rev-parse', 'refs/heads/main'])).toBe(before.branch);
    expect(await state()).toEqual(before);
  });

  it('peer side: checks the branch out in its own worktree, commits and pushes back fast-forward', async () => {
    const { commit } = await snapshotCommit(repo, 'h');
    const { branch } = await pushHandoff(repo, 'origin', commit, () => 'cccc');
    const wt = await checkoutHandoff(path.join(root, 'cache'), path.join(root, 'wts'), bare, branch);
    expect(fs.readFileSync(path.join(wt, 'new.txt'), 'utf8')).toBe('untracked\n');
    fs.writeFileSync(path.join(wt, 'done.txt'), 'by the peer\n');
    const back = await publishHandoff(wt, bare, branch, 'work from the peer');
    expect(back.changed).toBe(true);
    expect(await git(bare, ['rev-parse', `refs/heads/${branch}`])).toBe(back.commit);
    expect(await git(bare, ['rev-parse', `${back.commit}^`])).toBe(commit);
    expect((await publishHandoff(wt, bare, branch, 'again')).changed).toBe(false);
  });

  it('取回 fetches into a new local branch, shows the diff, never merges or checks out', async () => {
    const { commit } = await snapshotCommit(repo, 'h');
    const { branch } = await pushHandoff(repo, 'origin', commit, () => 'dddd');
    const before = await state();
    const r = await fetchBack(repo, 'origin', branch);
    expect(r.local).toBe('cw/handoff-dddd');
    expect(await git(repo, ['rev-parse', 'refs/heads/cw/handoff-dddd'])).toBe(commit);
    expect(r.diff).toContain('new.txt');
    expect(r.files).toBeGreaterThan(0);
    expect(await state()).toEqual(before);
    // a second 取回 does not move the first branch: it gets a suffix
    const again = await fetchBack(repo, 'origin', branch);
    expect(again.local).toBe('cw/handoff-dddd-2');
  });
});
```

- [ ] **Step 2: 跑，确认失败**：`$CLEAN npx vitest run server/src/handoff/git.test.ts` → 找不到 `./git.js`。
- [ ] **Step 3: 实现 `git.ts`**。要点：`snapshotCommit` 把 `.git/index`（`git rev-parse --git-path index`）复制到临时文件，设 `GIT_INDEX_FILE` 跑 `git stash create`（空输出 = 没有已跟踪的改动 → 用 `HEAD^{tree}`；否则 `<stash>^{tree}`），再在同一份临时暂存区上 `read-tree <tree>`、`git ls-files --others --exclude-standard -z` 列出的文件 `git add --`、`write-tree`，最后 `commit-tree <tree> -p HEAD -m <message>`（`-c user.name=Claude Web -c user.email=claude-web@localhost`，用户没配身份也能用），`finally` 删临时文件。`pushHandoff` 先 `ls-remote --heads <remote> refs/heads/cw/handoff-<id>`，有输出就换 id；`push <remote> <commit>:refs/heads/cw/handoff-<id>`；push 报 rejected / already exists 也换 id。`fetchBack` 用 `git show-ref --verify --quiet refs/heads/<name>` 找空名，`fetch <remote> refs/heads/<branch>:refs/heads/<free>`，`diff --stat HEAD...<free>` + `diff HEAD...<free>`（截到 400 KB），`files` = `diff --name-only` 行数。`checkoutHandoff`：缓存目录名 = url 的 sha1 前 16 位，不存在就 `init --bare`；`fetch <url> +refs/heads/<branch>:refs/heads/<branch>`（只在我们自己的缓存仓库里）；`worktree add <wtRoot>/<id> <branch>`（已存在就直接返回）。`publishHandoff`：`status --porcelain` 空 → `{ changed: false, commit: HEAD }`；否则 `add -A`、`commit`、`push <url> HEAD:refs/heads/<branch>`。
- [ ] **Step 4: 跑到通过**：同上命令 → 6 passed。
- [ ] **Step 5: 提交**：`git add server/src/handoff/git.ts server/src/handoff/git.test.ts && git commit -m "feat(handoff): git snapshot of uncommitted work on a copy of the index, push to cw/handoff-<id> without force, 取回 into a new branch (stage F1)"`

### Task 2: 发布的纯逻辑（id、有效期、路径包含、响应头、引用的资源、单个 HTML）

**Files:**
- Create: `server/src/publish/core.ts`
- Test: `server/src/publish/core.test.ts`

**Interfaces:**

```ts
export type PublishExpiry = '1d' | '7d' | 'never';
export const PUBLISH_HEADERS: Record<string, string>; // CSP sandbox allow-scripts allow-popups, nosniff, no-referrer, no-store
export function newPublishId(): string; // crypto.randomBytes(16).toString('hex')
export function isPublishId(s: string): boolean; // /^[0-9a-f]{32}$/
export function expiresAt(e: PublishExpiry, now: number): number | null;
export function isExpired(item: { expiresAt: number | null }, now: number): boolean;
export function resolveInside(root: string, rel: string): string | null; // decoded rel; null on .., NUL, absolute, drive, outside after realpath
export function localRefs(html: string): string[]; // relative src / href in the page (no scheme, no //, no #, no data:)
export function snapshotFiles(file: string): string[]; // the file + the local files its page refers to, all inside its folder (rel paths)
export function inlineHtml(file: string): string; // <link rel=stylesheet>, <script src>, <img src> of local files → inline / data: URIs
```

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newPublishId, isPublishId, expiresAt, isExpired, resolveInside, localRefs, snapshotFiles, inlineHtml, PUBLISH_HEADERS } from './core.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-pub-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('publish core', () => {
  it('ids are 128-bit random hex', () => {
    const a = newPublishId(), b = newPublishId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(isPublishId(a)).toBe(true);
    expect(isPublishId('../x')).toBe(false);
    expect(isPublishId(a.slice(1))).toBe(false);
  });

  it('expiry: 1 day, 7 days, never', () => {
    const now = 1_000_000;
    expect(expiresAt('1d', now)).toBe(now + 86_400_000);
    expect(expiresAt('7d', now)).toBe(now + 7 * 86_400_000);
    expect(expiresAt('never', now)).toBeNull();
    expect(isExpired({ expiresAt: now - 1 }, now)).toBe(true);
    expect(isExpired({ expiresAt: now + 1 }, now)).toBe(false);
    expect(isExpired({ expiresAt: null }, now)).toBe(false);
  });

  it('headers: sandboxed without same-origin, nosniff', () => {
    expect(PUBLISH_HEADERS['Content-Security-Policy']).toBe('sandbox allow-scripts allow-popups');
    expect(PUBLISH_HEADERS['Content-Security-Policy']).not.toContain('same-origin');
    expect(PUBLISH_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });

  it('resolveInside refuses traversal, absolute paths, NUL and symlinks out', () => {
    const root = path.join(dir, 'snap'); fs.mkdirSync(path.join(root, 'img'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), 'x');
    fs.writeFileSync(path.join(root, 'img', 'a.png'), 'x');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'x');
    expect(resolveInside(root, 'index.html')).toBe(fs.realpathSync(path.join(root, 'index.html')));
    expect(resolveInside(root, 'img/a.png')).toBe(fs.realpathSync(path.join(root, 'img', 'a.png')));
    for (const bad of ['../secret.txt', 'img/../../secret.txt', '..%2fsecret.txt', '%2e%2e/secret.txt', '/etc/passwd', 'C:/Windows/win.ini', 'C:\\Windows\\win.ini', 'img\\..\\..\\secret.txt', 'a\u0000b', '%00', 'nope.html']) {
      expect(resolveInside(root, bad), bad).toBeNull();
    }
    let linked = true;
    try { fs.symlinkSync(path.join(dir, 'secret.txt'), path.join(root, 'link.txt'), 'file'); } catch { linked = false; } // Windows without developer mode
    if (linked) expect(resolveInside(root, 'link.txt')).toBeNull();
    let junction = true;
    try { fs.symlinkSync(dir, path.join(root, 'up'), 'junction'); } catch { junction = false; }
    if (junction) expect(resolveInside(root, 'up/secret.txt')).toBeNull();
  });

  it('finds the local files a page refers to, only inside its folder', () => {
    const html = '<link rel="stylesheet" href="style.css"><script src="./js/app.js"></script><img src="img/a.png"><img src="https://x.test/b.png"><a href="#top">t</a><img src="data:image/png;base64,AA"><img src="../outside.png"><a href="//cdn.test/x.js">c</a><img src="pic.png?v=2">';
    expect(localRefs(html)).toEqual(['style.css', './js/app.js', 'img/a.png', '../outside.png', 'pic.png']);
    fs.writeFileSync(path.join(dir, 'page.html'), html);
    fs.writeFileSync(path.join(dir, 'style.css'), 'body{}');
    fs.mkdirSync(path.join(dir, 'js')); fs.writeFileSync(path.join(dir, 'js', 'app.js'), '1');
    fs.mkdirSync(path.join(dir, 'img')); fs.writeFileSync(path.join(dir, 'img', 'a.png'), 'png');
    expect(snapshotFiles(path.join(dir, 'page.html')).sort()).toEqual(['img/a.png', 'js/app.js', 'page.html', 'style.css']);
  });

  it('inlines local css, scripts and pictures into one page', () => {
    fs.writeFileSync(path.join(dir, 'page.html'), '<html><head><link rel="stylesheet" href="style.css"></head><body><img src="a.png" alt="x"><script src="app.js"></script><img src="https://x.test/b.png"></body></html>');
    fs.writeFileSync(path.join(dir, 'style.css'), 'body{color:red}');
    fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dir, 'a.png'), Buffer.from([137, 80, 78, 71]));
    const out = inlineHtml(path.join(dir, 'page.html'));
    expect(out).toContain('<style>body{color:red}</style>');
    expect(out).toContain('<script>console.log(1)</script>');
    expect(out).toContain('src="data:image/png;base64,iVBORw=="');
    expect(out).toContain('https://x.test/b.png');
    expect(out).not.toContain('href="style.css"');
  });
});
```

- [ ] **Step 2: 跑，确认失败**：`$CLEAN npx vitest run server/src/publish/core.test.ts`
- [ ] **Step 3: 实现**。`resolveInside`：先 `decodeURIComponent`（抛错 → null），含 `\0` → null，`\` 统一成 `/`，`path.isAbsolute` 或 `/^[a-zA-Z]:/` → null，按 `/` 拆段任何 `..` → null；`path.resolve(root, rel)` 不在 `root + sep` 下 → null；`fs.realpathSync` 文件和 root（文件不存在 → null），真实路径不在真实 root 下 → null；不是文件 → null。`localRefs` 用 `/(?:src|href)\s*=\s*["']([^"']+)["']/gi`，去掉 `?` / `#` 后缀，跳过有 scheme（`/^[a-z][a-z0-9+.-]*:/i`）、`//`、`#`、`/` 开头的。`snapshotFiles` 只收 `resolveInside(folder, ref)` 不为 null 的（大小合计上限 50 MB，单页最多 200 个）。`inlineHtml` 用同样的包含判断，css / js 内联时把 `</` 转义成 `<\/`。
- [ ] **Step 4: 跑到通过**。
- [ ] **Step 5: 提交**：`git add server/src/publish/core.ts server/src/publish/core.test.ts && git commit -m "feat(publish): 128-bit ids, expiry, path containment, sandbox headers, a page's local files and the single-HTML export (stage F5)"`

### Task 3: 读 zip、解析 claude.ai 的导出、转成对话库消息、去重

**Files:**
- Create: `server/src/import/zip.ts`, `server/src/import/claude-ai.ts`
- Create: `server/fixtures/claude-ai-export/conversations.json`, `projects.json`, `users.json`（照官方导出的实际样子：`uuid` / `name` / `created_at` / `updated_at` / `account` / `chat_messages[{ uuid, text, content[{ type: text | thinking | tool_use | tool_result, … }], sender: human | assistant, attachments[{ file_name, file_size, file_type, extracted_content }], files[{ file_name }] }]`；项目 `uuid` / `name` / `description` / `is_private` / `is_starter_project` / `prompt_template` / `creator` / `docs[{ uuid, filename, content, created_at }]`；用户 `uuid` / `full_name` / `email_address`。故意放一条缺 `uuid` 的对话、一条 `chat_messages` 不是数组的对话、一条消息 `content` 为空只有 `text` 的、一个 artifacts 工具调用、一个 web_search 工具调用 + 结果、一个附件、一个只有名字的图片）
- Test: `server/src/import/zip.test.ts`, `server/src/import/claude-ai.test.ts`

**Interfaces:**

```ts
// zip.ts
export function readZip(buf: Buffer): Map<string, Buffer>; // stored + deflate; zip64 sizes; throws on a broken directory
export function makeZip(entries: Record<string, string | Buffer>, o?: { deflate?: boolean }): Buffer; // tests / e2e fixtures
// claude-ai.ts
export interface ClaudeAiMessage { uuid: string; sender: 'human' | 'assistant'; text: string; content: any[]; createdAt: string; attachments: { name: string; text?: string }[]; files: string[] }
export interface ClaudeAiConversation { uuid: string; name: string; createdAt: string; updatedAt: string; projectUuid?: string; messages: ClaudeAiMessage[] }
export interface ClaudeAiProject { uuid: string; name: string; description: string; instructions: string; createdAt: string; updatedAt: string; starter: boolean; docs: { filename: string; content: string }[] }
export interface ClaudeAiExport { conversations: ClaudeAiConversation[]; projects: ClaudeAiProject[]; user?: { name: string; email: string }; skipped: number }
export function parseExport(files: Map<string, Buffer>): ClaudeAiExport; // by basename anywhere in the zip; a bad item is skipped, not the whole file; neither conversations.json nor projects.json → throws (tr)
export function toSdkMessages(c: ClaudeAiConversation, sessionId: string): any[]; // SDK-shaped user / assistant rows the app renders
export function planImport(convs: ClaudeAiConversation[], existing: Map<string, string>): { add: string[]; update: string[]; same: string[] }; // existing: uuid → updatedAt
export function safeName(s: string, fallback: string): string; // a Windows-safe file / folder name
```

- [ ] **Step 1: 写失败的测试**

```ts
// zip.test.ts
import { describe, it, expect } from 'vitest';
import { readZip, makeZip } from './zip.js';

describe('zip', () => {
  it('round-trips stored and deflated entries, keeps folders in names', () => {
    for (const deflate of [false, true]) {
      const z = readZip(makeZip({ 'a.json': '[1]', 'dir/b.txt': Buffer.from('héllo'.repeat(100)) }, { deflate }));
      expect(z.get('a.json')!.toString()).toBe('[1]');
      expect(z.get('dir/b.txt')!.toString()).toBe('héllo'.repeat(100));
    }
  });
  it('refuses something that is not a zip', () => {
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow();
  });
});
```

```ts
// claude-ai.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, makeZip } from './zip.js';
import { parseExport, toSdkMessages, planImport, safeName } from './claude-ai.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'claude-ai-export');
const zipOf = (prefix = '') => readZip(makeZip(Object.fromEntries(['conversations.json', 'projects.json', 'users.json'].map((n) => [prefix + n, fs.readFileSync(path.join(FIX, n))])), { deflate: true }));

describe('claude.ai export', () => {
  it('parses conversations, projects and the user; skips broken items instead of failing', () => {
    const x = parseExport(zipOf());
    expect(x.user).toEqual({ name: 'Ada Example', email: 'ada@example.com' });
    expect(x.conversations.map((c) => c.name)).toEqual(['Plan a garden', 'Landing page', 'Untitled']);
    expect(x.skipped).toBe(2); // no uuid; chat_messages not an array
    const garden = x.conversations[0];
    expect(garden.messages.map((m) => m.sender)).toEqual(['human', 'assistant', 'human', 'assistant']);
    expect(garden.messages[0].attachments).toEqual([{ name: 'beds.txt', text: 'bed 1: tomatoes' }]);
    expect(garden.messages[2].files).toEqual(['photo.jpg']);
    expect(x.projects).toHaveLength(1);
    expect(x.projects[0]).toMatchObject({ name: 'Garden', instructions: 'Answer like a gardener.', starter: false });
    expect(x.projects[0].docs).toEqual([{ filename: 'soil.md', content: '# Soil\nLoam.' }]);
  });

  it('finds the files inside a folder of the zip too', () => {
    expect(parseExport(zipOf('data-2026-10-01/')).conversations).toHaveLength(3);
  });

  it('a zip without conversations.json or projects.json is refused', () => {
    expect(() => parseExport(readZip(makeZip({ 'other.txt': 'x' })))).toThrow();
  });

  it('turns a conversation into rows the app renders and Claude can continue from', () => {
    const x = parseExport(zipOf());
    const rows = toSdkMessages(x.conversations[0], 'claudeai-1');
    expect(rows[0]).toMatchObject({ type: 'user', session_id: 'claudeai-1', message: { role: 'user' } });
    expect(JSON.stringify(rows[0].message.content)).toContain('bed 1: tomatoes'); // the attachment's text comes along
    const assistant = rows.find((r) => r.type === 'assistant')!;
    expect(assistant.message.content.some((b: any) => b.type === 'text')).toBe(true);
    // an artifact is shown as its content, a web search as a tool call with its result right after
    const page = toSdkMessages(x.conversations[1], 'claudeai-2');
    expect(JSON.stringify(page)).toContain('```html');
    const call = page.flatMap((r) => r.message.content).find((b: any) => b.type === 'tool_use');
    expect(call).toMatchObject({ name: 'web_search' });
    const result = page.flatMap((r) => r.message.content).find((b: any) => b.type === 'tool_result');
    expect(result.tool_use_id).toBe(call.id);
    // a message with an empty content array falls back to its text
    expect(JSON.stringify(toSdkMessages(x.conversations[2], 'claudeai-3'))).toContain('only the text field');
    // every row has a stable uuid (re-reading gives the same ids)
    expect(toSdkMessages(x.conversations[0], 'claudeai-1').map((r) => r.uuid)).toEqual(rows.map((r) => r.uuid));
  });

  it('dedupes by uuid: new, newer, same', () => {
    const x = parseExport(zipOf());
    const [a, b, c] = x.conversations;
    const plan = planImport(x.conversations, new Map([[a.uuid, a.updatedAt], [b.uuid, '2000-01-01T00:00:00Z']]));
    expect(plan).toEqual({ add: [c.uuid], update: [b.uuid], same: [a.uuid] });
  });

  it('safe names', () => {
    expect(safeName('a/b:c*?', 'x')).toBe('a_b_c__');
    expect(safeName('  ', 'fallback')).toBe('fallback');
    expect(safeName('CON', 'x')).toBe('CON_');
    expect(safeName('..', 'x')).toBe('x');
  });
});
```

- [ ] **Step 2: 跑，确认失败**：`$CLEAN npx vitest run server/src/import/zip.test.ts server/src/import/claude-ai.test.ts`
- [ ] **Step 3: 写 fixture 和实现**。zip：从末尾找 EOCD（`0x06054b50`，最多往回 65 KB + 22），读中央目录（`0x02014b50`），本地头 `0x04034b50` 后跳过文件名和 extra 取数据；方法 0 原样、8 用 `zlib.inflateRawSync`，其它方法跳过那条；0xffffffff 时读 zip64 extra（id 1）。`makeZip` 写本地头 + 中央目录 + EOCD，crc 用 `zlib.crc32`（Node ≥ 22.2；没有就自己算表）。解析：`JSON.parse` 失败整份文件当缺失；每条对话 / 项目单独 try，缺 `uuid` 或 `chat_messages` 不是数组 → `skipped++`。消息：`content` 空就用 `text`；`thinking` 块保留成 `thinking`；`tool_use` 名字是 `artifacts`（或 input 里有 `content` + `type`）→ 变成文字块 `**title**\n\`\`\`<lang>\n<content>\n\`\`\``；其它 `tool_use` → `{ type: 'tool_use', id: '<msg uuid>-t<i>', name, input }`，紧跟的 `tool_result` → 单独一条 user 行的 `tool_result`（同 id）；附件 → `［附件 name］\n<extracted_content>` 文字块，`files` → `［文件 name（导出包里没有内容）］`。行的 `uuid` = 消息 uuid（tool_result 行加 `-r<i>`）。
- [ ] **Step 4: 跑到通过**。
- [ ] **Step 5: 提交**：`git add server/src/import/zip.ts server/src/import/zip.test.ts server/src/import/claude-ai.ts server/src/import/claude-ai.test.ts server/fixtures/claude-ai-export && git commit -m "feat(import): read a zip without a dependency, parse claude.ai's data export (bad items skipped), rows for the library, dedupe by uuid (stage F4)"`

### Task 4: 项目判定 / 项目说明 / 跨对话范围 / 派活的纯逻辑

**Files:**
- Create: `server/src/meta/project.ts`, `server/src/dispatch/core.ts`
- Test: `server/src/meta/project.test.ts`, `server/src/dispatch/core.test.ts`

**Interfaces:**

```ts
// meta/project.ts
export interface ProjectLike { id: string; path: string; name: string; instructions?: string }
export function projectOf<W extends ProjectLike>(s: { cwd?: string; workspaceId?: string; groupCwd?: string }, workspaces: readonly W[], caseless?: boolean): W | undefined; // meta.workspaceId, else main folder == cwd / groupCwd (as projectFolders)
export function instructionsSection(w: ProjectLike | undefined): string; // '' or the appended system-prompt block (≤ 20 000 chars)
export function inProjectScope(self: string | undefined, target: string | undefined): boolean; // same project id; a caller outside any project sees only conversations outside any project
export const MAX_INSTRUCTIONS = 20_000;
export function projectFilesDir(dataDir: string, workspaceId: string): string; // <dataDir>/projects/<id> ; id checked /^[\w-]+$/
export function safeProjectFile(name: string): string | null; // basename only, no .., no reserved chars → null
// dispatch/core.ts
export type DispatchFrom = 'phone' | 'im' | 'app';
export interface DispatchParams { prompt: string; peer?: string; workspaceId?: string; from: DispatchFrom }
export function normDispatch(p: { prompt?: unknown; peer?: unknown; workspaceId?: unknown; from?: unknown }): DispatchParams; // throws tr('派活需要一句任务') on empty; prompt ≤ 20 000
export function dispatchDefaults(last: unknown, workspaces: readonly { id: string }[], peers: readonly { id: string; enabled: boolean }[]): { peer?: string; workspaceId?: string }; // 上次的, if it still exists
export function parseImDispatch(text: string, workspaces: readonly { id: string; name: string }[]): { prompt: string; workspaceId?: string } | null; // '/dispatch …' or '/派活 …'; '项目名: 任务' picks the project (case-insensitive name)
```

- [ ] **Step 1: 写失败的测试**

```ts
// meta/project.test.ts
import { describe, it, expect } from 'vitest';
import { projectOf, instructionsSection, inProjectScope, projectFilesDir, safeProjectFile, MAX_INSTRUCTIONS } from './project.js';

const W = [
  { id: 'w1', path: 'C:\\code\\app', name: 'App', instructions: 'Use pnpm.' },
  { id: 'w2', path: 'C:\\code\\site', name: 'Site' },
];
describe('project', () => {
  it('finds the project by meta id, then by the main folder (case-insensitively on Windows)', () => {
    expect(projectOf({ cwd: 'c:/code/app/' }, W, true)?.id).toBe('w1');
    expect(projectOf({ cwd: 'C:\\elsewhere', workspaceId: 'w2' }, W, true)?.id).toBe('w2');
    expect(projectOf({ cwd: 'C:\\wt\\x', groupCwd: 'C:\\code\\site' }, W, true)?.id).toBe('w2');
    expect(projectOf({ cwd: 'C:\\code\\app\\sub' }, W, true)).toBeUndefined();
    expect(projectOf({ cwd: 'C:\\x', workspaceId: 'gone' }, W, true)).toBeUndefined();
  });
  it('instructions become an appended block, empty ones nothing', () => {
    expect(instructionsSection(W[1])).toBe('');
    expect(instructionsSection({ ...W[1], instructions: '   ' })).toBe('');
    const s = instructionsSection(W[0]);
    expect(s).toContain('App');
    expect(s).toContain('Use pnpm.');
    expect(instructionsSection({ ...W[0], instructions: 'x'.repeat(MAX_INSTRUCTIONS + 50) }).length).toBeLessThan(MAX_INSTRUCTIONS + 300);
  });
  it('project scope: same project only; outside every project sees only the outside', () => {
    expect(inProjectScope('w1', 'w1')).toBe(true);
    expect(inProjectScope('w1', 'w2')).toBe(false);
    expect(inProjectScope('w1', undefined)).toBe(false);
    expect(inProjectScope(undefined, undefined)).toBe(true);
    expect(inProjectScope(undefined, 'w1')).toBe(false);
  });
  it('project files live under the data dir, names are plain file names', () => {
    expect(projectFilesDir('/d', 'w1').replace(/\\/g, '/')).toBe('/d/projects/w1');
    expect(() => projectFilesDir('/d', '../x')).toThrow();
    expect(safeProjectFile('notes.md')).toBe('notes.md');
    for (const bad of ['../x', 'a/b', 'a\\b', '', '..', 'x\u0000', 'CON']) expect(safeProjectFile(bad), bad).toBeNull();
  });
});
```

```ts
// dispatch/core.test.ts
import { describe, it, expect } from 'vitest';
import { normDispatch, dispatchDefaults, parseImDispatch } from './core.js';

describe('dispatch', () => {
  it('normalises the request and refuses an empty task', () => {
    expect(normDispatch({ prompt: '  fix the build ', workspaceId: 'w1', from: 'phone' })).toEqual({ prompt: 'fix the build', workspaceId: 'w1', from: 'phone' });
    expect(normDispatch({ prompt: 'x', peer: '', from: 'nope' })).toEqual({ prompt: 'x', from: 'app' });
    expect(() => normDispatch({ prompt: '  ' })).toThrow();
    expect(normDispatch({ prompt: 'y'.repeat(30_000) }).prompt.length).toBe(20_000);
  });
  it('defaults to last time, when that project / machine still exists', () => {
    const ws = [{ id: 'w1' }], peers = [{ id: 'p1', enabled: true }, { id: 'p2', enabled: false }];
    expect(dispatchDefaults({ workspaceId: 'w1', peer: 'p1' }, ws, peers)).toEqual({ workspaceId: 'w1', peer: 'p1' });
    expect(dispatchDefaults({ workspaceId: 'gone', peer: 'p2' }, ws, peers)).toEqual({});
    expect(dispatchDefaults('junk', ws, peers)).toEqual({});
  });
  it('IM: /dispatch and /派活, with an optional "项目名:" in front', () => {
    const ws = [{ id: 'w1', name: 'App' }, { id: 'w2', name: '网站' }];
    expect(parseImDispatch('/dispatch run the tests', ws)).toEqual({ prompt: 'run the tests' });
    expect(parseImDispatch('/dispatch app: run the tests', ws)).toEqual({ prompt: 'run the tests', workspaceId: 'w1' });
    expect(parseImDispatch('/派活 网站：更新首页', ws)).toEqual({ prompt: '更新首页', workspaceId: 'w2' });
    expect(parseImDispatch('/派活 note: not a project', ws)).toEqual({ prompt: 'note: not a project' });
    expect(parseImDispatch('/dispatch', ws)).toBeNull();
    expect(parseImDispatch('hello', ws)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑，确认失败**：`$CLEAN npx vitest run server/src/meta/project.test.ts server/src/dispatch/core.test.ts`
- [ ] **Step 3: 实现**（`projectOf` 复用 `workspace-folders.ts` 的 `sameDir`；`instructionsSection` 的块是英文系统提示：`# Project instructions (<name>)\nThe user set these for every conversation in this project:\n<text>`；Windows 保留名 `CON PRN AUX NUL COM1-9 LPT1-9`）。
- [ ] **Step 4: 跑到通过**。
- [ ] **Step 5: 提交**：`git add server/src/meta/project.ts server/src/meta/project.test.ts server/src/dispatch/core.ts server/src/dispatch/core.test.ts && git commit -m "feat(projects): project of a conversation, instructions block, project scope, dispatch shape and the IM command (stage F2 F3)"`

### Task 5: 服务端 F2 项目页 + F3 派活

**Files:**
- Modify: `server/src/protocol.ts`（`Workspace` :375 加 `instructions?` `sessionsScope?: 'project'` `permissionMode?` `claudeAiUuid?`；`SessionMeta` :376 加 `origin?: 'dispatch'` `dispatchFrom?: DispatchFrom`；新请求块，见下）
- Modify: `server/src/meta/store.ts:12-13`（同样的字段），`updateWorkspace` :124（接受新字段）
- Create: `server/src/cloud/handlers.ts`（`isCloudRequest` / `handleCloud`，本阶段所有新请求）, `server/src/cloud/project-files.ts`, `server/src/dispatch/service.ts`
- Modify: `server/src/ws/hub.ts`（`Services` 加 `cloud?: CloudServices`；`handle()` :412-415 分派处加一行；`workspaces.update` :560-571 把新字段传下去）
- Modify: `server/src/runtime/pool.ts:68-71, 185-186`（`additionalDirectories` 加上存在且非空的项目资料目录；`projectInstructions` 交给 runner；派活的对话不改 pool，权限模式由调用方给）
- Modify: `server/src/runtime/session-runner.ts:225, 528`（opts 加 `projectInstructions?: string`，进 `append`）
- Modify: `server/src/sessions-mcp/tools.ts:17-27, 55-65`（`SessionsDeps` 加 `projectOf?(id): string | undefined`、`restricted?(selfId): boolean`；`find` 和 `list_sessions` 过滤；`list_sessions` 加可选参数 `scope: 'project' | 'all'`）
- Modify: `server/src/index.ts`（`setSessionsDeps` 传 `projectOf` / `restricted`；HTTP `/api/project-files?workspaceId=&name=` POST，`authOk`，20 MB 上限）
- Modify: `server/src/im/router.ts:9, 112`（`/dispatch` `/派活`：`parseImDispatch` → 派活服务开新对话、绑定这个聊天、发出去）
- Test: `server/src/meta/store.test.ts`（新字段存取）、`server/src/sessions-mcp/tools.test.ts`（项目范围）、`server/src/im/router.test.ts`（`/dispatch`）、`server/src/cloud/project-files.test.ts`、`server/src/dispatch/service.test.ts`

**Interfaces:**

```ts
// protocol.ts (one new block)
export type DispatchFrom = 'phone' | 'im' | 'app';
export interface ProjectFile { name: string; size: number; mtime: number }
| { kind: 'projects.files.list'; workspaceId: string }            // → { dir: string; files: ProjectFile[] }
| { kind: 'projects.files.remove'; workspaceId: string; name: string } // → { files: ProjectFile[] }
| { kind: 'dispatch.start'; prompt: string; peer?: string; workspaceId?: string; from?: DispatchFrom } // → { sessionId: string }
// workspaces.update patch gains instructions?, sessionsScope?: 'project' | null, permissionMode?: PermissionMode | null
// cloud/project-files.ts
export class ProjectFiles { constructor(dataDir: string); dir(id: string): string; list(id: string): Promise<ProjectFile[]>; write(id: string, name: string, data: Buffer | NodeJS.ReadableStream): Promise<ProjectFile>; remove(id: string, name: string): Promise<void>; hasFiles(id: string): boolean }
// dispatch/service.ts
export interface DispatchDeps { meta: MetaStore; open(p: OpenSessionParams): Promise<string>; send(sessionId: string, text: string): Promise<void>; homeDir(): string; forward?(peerId: string, req: ClientRequest): Promise<unknown> }
export class DispatchService { constructor(d: DispatchDeps); start(p: DispatchParams): Promise<{ sessionId: string }>; isDispatched(id: string): boolean }
```

- [ ] **Step 1: 写失败的测试**：store 存 `instructions` / `sessionsScope` / `permissionMode`（`null` 清掉）；tools：`restricted('a')` 为 true 时 `list_sessions` 只列同项目、`send_message` 给别的项目的对话报错「不在这个项目里」；不限制时 `scope: 'project'` 也只列同项目；router：`/dispatch app: 跑测试` → 用 `w1` 的路径开新对话、发出「跑测试」、绑定聊天、回一句已派出；`/dispatch` 不带任务 → 回用法；project-files：写、列、删，坏名字拒绝，`hasFiles`；dispatch service：`workspaceId` → `cwd = w.path`、`permissionMode = w.permissionMode`（没有就不传，pool 用全局默认）、meta `origin: 'dispatch'` + `dispatchFrom`、`dispatch.last` 记下；`peer` → 走 `forward(peer, { kind: 'dispatch.start', … })`，返回 `peer_<id>~<sid>`。
- [ ] **Step 2: 跑，确认失败**：`$CLEAN npx vitest run server/src/meta/store.test.ts server/src/sessions-mcp/tools.test.ts server/src/im/router.test.ts server/src/cloud/project-files.test.ts server/src/dispatch/service.test.ts`
- [ ] **Step 3: 实现**。派活的通知：`DispatchService` 不自己发；hub 在 pool 的 `result` / 权限请求事件上看 `meta.sessionMeta(id).origin === 'dispatch'` 时 `broadcast({ kind: 'notice', … })`（现有 `notice` 事件，手机 / 桌面都收得到；IM 那边 router 本来就回结果和授权按钮）。项目资料目录 `<dataDir>/projects/<id>/`（`dataDir()` 即 `~/.claude-web`）。
- [ ] **Step 4: 跑到通过**，再跑 `$CLEAN npm test -w server` 和 `npx tsc --noEmit -p server`。
- [ ] **Step 5: 提交**：`git add <上面列出的文件> && git commit -m "feat(projects, dispatch): instructions in every conversation of the project, project files readable through additionalDirectories, sessions tools scoped to the project, dispatch.start and /dispatch from IM (stage F2 F3)"`

### Task 6: 服务端 F1 交接 + F5 发布

**Files:**
- Modify: `server/src/federation/types.ts:45-90`（`PeerInfo` / `PeerRecord` 加 `alwaysOn?: boolean`；`peers.update` 的 patch 加 `alwaysOn?`）
- Modify: `server/src/federation/service.ts:143-153, 297-306, 321-329`（`list()` 带 `alwaysOn`，常开排前；`update()` 存 `alwaysOn`；新公开方法 `request<T>(peerId, req)`、`peerUrl(peerId)`）
- Modify: `server/src/federation/rewrite.test.ts`（锁住：`handoff.*` 带其它机器的对话 id → reject）
- Create: `server/src/handoff/service.ts`, `server/src/publish/service.ts`
- Modify: `server/src/protocol.ts`（`HandoffInfo`、`PublishedItem`、`PublishExpiry`、`SessionMeta.handedOff?` / `handoffFrom?`；请求见下）, `server/src/cloud/handlers.ts`
- Modify: `server/src/index.ts`（handler 最前面：`if (publish.handle(req, res, url)) return;`——在任何鉴权之前，主监听和远程监听共用这个 handler）
- Test: `server/src/handoff/service.test.ts`, `server/src/publish/service.test.ts`, `server/src/federation/service.test.ts`（alwaysOn）

**Interfaces:**

```ts
export interface HandoffInfo { id: string; peerId: string; peerName: string; remote: string; branch: string; commit: string; base: string; remoteSessionId?: string; at: number; fetched?: string[] }
export type PublishExpiry = '1d' | '7d' | 'never';
export interface PublishedItem { id: string; name: string; source: string; entry: string; createdAt: number; updatedAt: number; expiresAt: number | null; files: number; bytes: number; peerId?: string; peerName?: string; url?: string }
| { kind: 'handoff.check'; sessionId: string }          // → { ok: boolean; reason?: string; remote?: string }
| { kind: 'handoff.start'; sessionId: string; peerId: string; prompt?: string } // → HandoffInfo
| { kind: 'handoff.receive'; id: string; url: string; branch: string; title?: string; events: CanonicalEvent[]; permissionMode?: PermissionMode; prompt?: string; from: string } // peer side → { sessionId: string; cwd: string }
| { kind: 'handoff.publish'; branch: string }           // peer side: commit + push its worktree → { commit: string; changed: boolean }
| { kind: 'handoff.fetchBack'; sessionId: string }      // → { branch: string; stat: string; diff: string; files: number }
| { kind: 'publish.create'; path: string; expiry: PublishExpiry; id?: string } // id = 重新发布
| { kind: 'publish.list' }                              // → { items: PublishedItem[]; local: string; lan: string | null }
| { kind: 'publish.revoke'; id: string }
| { kind: 'publish.toPeer'; path: string; expiry: PublishExpiry; peerId: string } // → PublishedItem (url on the peer)
| { kind: 'publish.receive'; name: string; entry: string; expiry: PublishExpiry; files: { rel: string; data: string }[] } // peer side
| { kind: 'publish.inline'; path: string }              // → { path: string } (<dataDir>/exports/<name>.html)
// handoff/service.ts
export interface HandoffDeps { meta: MetaStore; federation: { request<T>(peerId: string, req: ClientRequest): Promise<T>; list(): PeerInfo[] }; cwdOf(sessionId: string): Promise<string | undefined>; readAll(sessionId: string): Promise<any[]>; titleOf?(sessionId: string): Promise<string | undefined>; stop?(sessionId: string): Promise<void>; open(p: OpenSessionParams): Promise<string>; send(sessionId: string, text: string): Promise<void>; dataDir: string; serverName(): string }
export class HandoffService { check(sessionId): Promise<…>; start(sessionId, peerId, prompt?): Promise<HandoffInfo>; receive(req): Promise<{ sessionId; cwd }>; publish(branch): Promise<…>; fetchBack(sessionId): Promise<…> }
// publish/service.ts
export class PublishService { constructor(o: { dir: string; now?: () => number; lanBase?: () => string | null; localBase: () => string; exportsDir: string }); create(path, expiry, id?): Promise<PublishedItem>; receive(req): Promise<PublishedItem>; list(): PublishedItem[]; revoke(id): Promise<void>; inline(path): Promise<string>; handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean; sweep(): Promise<void> }
```

- [ ] **Step 1: 写失败的测试**。handoff：临时仓库 + bare 远端，假 federation 记下 `handoff.receive` 的参数；`start` 后用户仓库状态逐字节不变（复用 Task 1 的 `state()` 思路）、meta `handedOff` 记下、receive 收到 `events`（`replayEvents` 的结果）和分支；不是 Git / 没远端 → `check` 给原因、`start` 拒绝；对方离线 → 报错且远端分支已推（可重试，不丢）；`receive` 在临时 dataDir 里签出 worktree、写 transcript（`HOME` 指到临时目录）、meta `handoffFrom`；`fetchBack` 先请对方 `handoff.publish`（失败也继续）、再 fetch 进新分支。publish：`create` 把页面和它引用的本地文件复制进 `<dir>/<id>/`，再发布同 id 更新快照；起一个 `http.createServer((q, s) => svc.handle(q, s, new URL(q.url!, 'http://x')) || s.writeHead(418).end())`：`/p/<id>/` → 200 + 两个头 + 页面；`/p/<id>/style.css` → 200；`/p/<id>/../index.json`、`/p/<id>/%2e%2e/x`、`/p/<不存在>/` → 404；带 `?token=` 照样（不看）；过期（`now` 往后拨）→ 404 并删除；`revoke` 后 404；`list` 的 `lan` 只在 `lanBase()` 给值时有。
- [ ] **Step 2: 跑，确认失败**：`$CLEAN npx vitest run server/src/handoff server/src/publish server/src/federation`
- [ ] **Step 3: 实现**。交接流程：`check` → `snapshotCommit` → `pushHandoff` → `federation.request(peerId, handoff.receive)`（带 `replayEvents(readAll)`，标题，`meta.sessionMeta(sid).permissionMode`）→ `stop` 本机进程 → meta `handedOff`。对方：`checkoutHandoff(<dataDir>/handoff/repos, <dataDir>/handoff/worktrees, url, branch)`，`writeClaudeTranscript(wt, newId, toClaudeEntries(events, { cwd: wt, sessionId: newId }))`，改名「<标题>（从 <机器> 交接）」，meta `handoffFrom: { from, branch, url, id }`；有 `prompt` 才 `open` + `send`（没有就留着，用户在侧栏打开）。远端 URL 用 `git remote get-url`（本机路径 / file:// / ssh / https 都原样交给对方）。publish 的 `handle`：只认 `^/p/([0-9a-f]{32})(/.*)?$`；没有尾部 `/` → 301 到 `/p/<id>/`；空路径 → `entry`；MIME 用现有 `FILE_MIME` 那一套加 html / css / js；每个响应都带 `PUBLISH_HEADERS`。`index.json` 放在 `<dir>/index.json`（不在任何快照目录里）。启动和每小时 `sweep()` 删过期的。
- [ ] **Step 4: 跑到通过**；`$CLEAN npm test -w server`；`npx tsc --noEmit -p server`。
- [ ] **Step 5: 提交**：`git add <上面列出的文件> && git commit -m "feat(handoff, publish): 交给常开机器继续 (snapshot branch, worktree + transcript on the peer, read-only here, 取回 as a new branch with its diff); publish a page as a sandboxed /p/<id>/ snapshot with expiry, revoke, LAN link and a copy on the always-on machine (stage F1 F5)"`

### Task 7: 服务端 F4 导入 claude.ai

**Files:**
- Modify: `server/src/protocol.ts`（`AgentKind` :237 加 `'claudeai'`；`LIBRARY_ID_PREFIXED_KINDS` :244 加 `'claudeai'`；`ClaudeAiScan` / `ClaudeAiImportResult`；请求 `claudeai.scan` / `claudeai.import`）
- Create: `server/src/library/claudeai-source.ts`, `server/src/import/claude-ai-service.ts`
- Modify: `server/src/index.ts:408-415`（来源列表加 `new ClaudeAiSource(<dataDir>/claude-ai)`；HTTP `POST /api/import/claude-ai`，`authOk`，2 GB 上限，存到 `<dataDir>/claude-ai/uploads/<随机>.zip`）
- Modify: `server/src/library/service.ts:760`（来源名字 `claude.ai`）, `server/src/cloud/handlers.ts`
- Test: `server/src/library/claudeai-source.test.ts`, `server/src/import/claude-ai-service.test.ts`

**Interfaces:**

```ts
export interface ClaudeAiScan { conversations: number; projects: number; docs: number; add: number; update: number; same: number; skipped: number; user?: string }
export interface ClaudeAiImportResult extends ClaudeAiScan { projectsCreated: number; projectsUpdated: number; filesWritten: number; filesKept: number }
| { kind: 'claudeai.scan'; path: string }                    // path = what /api/import/claude-ai returned
| { kind: 'claudeai.import'; path: string; folder?: string } // folder: where project files go (one sub-folder per project); none = projects skipped
export class ClaudeAiSource implements SessionSource { kind = 'claudeai'; caps = { resume: true, rename: false, archive: false, delete: false, fork: false, continueInClaude: true }; constructor(root: string) }
export class ClaudeAiImport { constructor(o: { root: string; meta: MetaStore; library: { join(kind: AgentKind, on: boolean): Promise<void>; invalidate(kind?: AgentKind): void } }); scan(zip: string): Promise<ClaudeAiScan>; run(zip: string, folder?: string): Promise<ClaudeAiImportResult> }
```

- [ ] **Step 1: 写失败的测试**。service：fixture 打成 zip（`makeZip`）→ `scan` 数对；`run` 把对话存成 `<root>/conversations/<uuid>.json`，项目在 `folder/<safeName>` 建文件夹、写 `soil.md`、`addWorkspace` + `instructions` + `claudeAiUuid`、加入对话库来源；再导一次：对话 `same`、项目 `updated`、文件 `kept`（已有的不覆盖，内容不同也不覆盖）；不给 `folder` → 不建项目；上传的路径必须在 `<root>/uploads/` 里（别的路径拒绝）。source：`list` 出 `claudeai-<uuid>` 的行（标题、时间、`cwd` = 项目文件夹或主目录）、`read` 给 `toSdkMessages` 的行（新到旧分页）、`status()` 的名字是 claude.ai。
- [ ] **Step 2: 跑，确认失败**：`$CLEAN npx vitest run server/src/library/claudeai-source.test.ts server/src/import/claude-ai-service.test.ts`
- [ ] **Step 3: 实现**。「接着聊」不用新代码：`continueInClaude: true` 让 `LibraryService.continuation()` 把历史写进新的 Claude transcript（同 dsh）。导入完删掉上传的 zip。
- [ ] **Step 4: 跑到通过**；`$CLEAN npm test -w server`；`npx tsc --noEmit -p server -p web`（`AgentKind` 变了，web 侧有 `Record<AgentKind, …>` 就补上）。
- [ ] **Step 5: 提交**：`git add <上面列出的文件> && git commit -m "feat(import): claude.ai data export into the library (read-only source claudeai-<uuid>, 接着聊 in Claude) and its projects into projects with their files in a folder you pick; re-import dedupes by uuid (stage F4)"`

### Task 8: 界面（项目页、常开机器、交接 / 取回、派活、导入 claude.ai、发布）

**Files:**
- Modify: `web/src/features/sidebar/ProjectDialog.tsx`（标签：设置 / 说明 / 资料 / 对话；说明 = 文本框 + 「跨对话工具只看见本项目的对话」+ 权限模式；资料 = 拖进来 / 选文件上传到 `/api/project-files`，列表可删；对话 = 这个项目里的对话，点开）
- Create: `web/src/features/sidebar/project-page.ts`（纯函数：项目里的对话 `projectSessions(sessions, w, meta)`、上传地址 `projectFileUrl`）+ `project-page.test.ts`
- Modify: `web/src/features/composer/MachineChip.tsx:14, 30`（常开排前，副标题「合上电脑也继续」）；`web/src/features/settings/PeersSection.tsx`（每台机器一个「常开」开关 → `peers.update { alwaysOn }`）
- Create: `web/src/features/cloud/HandoffDialog.tsx`（选常开机器 + 可选「接着做什么」，不能交接时写原因）、`web/src/features/cloud/HandedOffBar.tsx`（输入框位置：「已交给 <机器>」+ 打开那边的对话 + 取回）、`web/src/features/cloud/FetchBackDialog.tsx`（分支名 + stat + diff，用现有 DiffView / `<pre>`；写明「不会自动合并」）
- Modify: `web/src/features/sidebar/entries.ts:33`（`ROW_MENU` 加 `'handoff-peer'`）、`session-actions.tsx`（「交给常开机器继续…」）、`rows.tsx`（`origin === 'dispatch'` 的行标「从手机派来」，`handedOff` 的行标「已交给 <机器>」）、`web/src/features/composer/Composer.tsx`（`handedOff` → 换成 `HandedOffBar`，不能发送）
- Create: `web/src/features/cloud/DispatchDialog.tsx`（一句任务 + 机器 + 项目，默认 `dispatch.last`；手机布局顶栏和命令面板里的「派活」入口）
- Create: `web/src/features/cloud/ClaudeAiImportDialog.tsx`（选 zip → 上传 → `claudeai.scan` 预览 → 选项目资料文件夹 → `claudeai.import`；写明「一次性导入，不是实时同步」）；设置 catalog 加一行入口（「导入 claude.ai 数据」）
- Create: `web/src/features/cloud/PublishDialog.tsx`（有效期 1 天 / 7 天 / 永久；本机链接、局域网链接或「去开远程监听」；发布到常开机器；导出成单个 HTML）、`web/src/features/cloud/PublishedList.tsx`（已发布：打开、复制、重新发布、撤回）
- Modify: `web/src/features/files/FileMenu.tsx`（「发布…」「导出成单个 HTML」）、`web/src/features/workbench/AllArtifacts.tsx`（顶部「已发布」）
- Modify: `web/src/i18n/en.ts` 等（`node scripts/i18n/extract.mjs` 生成的条目）
- Test: `web/src/features/sidebar/project-page.test.ts`、`web/src/features/sidebar/entries.test.ts`（新菜单项）、`web/src/features/cloud/publish-links.test.ts`（链接拼装：本机 / 局域网 / peer）

- [ ] **Step 1: 写失败的测试**（纯函数：`projectSessions` 按 `projectOf` 同样的规则挑对话并按时间排；`publishLinks({ item, local, lan })` 给出 `{ local, lan|null, peer|null }`；`ROW_MENU` 里 `handoff-peer` 在 `handoff` 后面，只有本机的、在 Git 项目里的对话可用（`caps.ts` 的判断））。
- [ ] **Step 2: 跑，确认失败**：`$CLEAN npm test -w web -- project-page entries publish-links`
- [ ] **Step 3: 实现界面**。选择器只取原始字段（`s.sessionMeta[id]`、`s.workspaces`），派生在 `useMemo`；对话框都有 `data-id`（`project-page`、`handoff-dialog`、`dispatch-dialog`、`claudeai-import`、`publish-dialog`）给 ui-smoke；Esc 先问 `imeComposing()`。
- [ ] **Step 4: 跑到通过**；`node scripts/i18n/extract.mjs` 后 `--check`；`$CLEAN npm test -w web`；`npx tsc --noEmit -p web`。
- [ ] **Step 5: 提交**：`git add <上面列出的文件> && git commit -m "feat(ui): project page (instructions, files, conversations), always-on machines, 交给常开机器继续 / 已交给 / 取回, 派活, import claude.ai data, publish and 已发布 (stage F)"`

### Task 9: e2e 37–39、ui-smoke、全量、笔记、spec「阶段 F 完成后留下的」

**Files:**
- Create: `server/ws-phase37.mjs`（交接：自己起 A、B 两个 server，各自临时 HOME / CLAUDE_WEB_DIR；临时仓库 + 临时 bare 远端；A 配对 B、标常开；在 A 的临时 HOME 写一个 Claude transcript 当本机对话；`handoff.check` → `handoff.start` → B 上有 worktree 和新对话、A 的仓库 index / HEAD / 工作区哈希不变、bare 远端有 `cw/handoff-<id>`；在 B 的 worktree 改一个文件 → A `handoff.fetchBack` → 新分支 + diff 里有那个文件、A 的分支没动）
- Create: `server/ws-phase38.mjs`（发布：写一个带 css 的页面 → `publish.create` → 不带令牌 GET `/p/<id>/` 200 + CSP + nosniff → `/p/<id>/../` 404 → `publish.revoke` → 404；`publish.inline` 产出单文件）
- Create: `server/ws-phase39.mjs`（导入 + 项目 + 派活：fixture zip POST 到 `/api/import/claude-ai` → `claudeai.scan` / `claudeai.import`（临时文件夹）→ `library.list` 有 `claudeai-` 行、`library.read` 有消息、再导入 `same`；`workspaces.update` 写 instructions → `projects.files.*`；`dispatch.start` 带 `workspaceId` 用假上游跑一轮 → meta `origin: 'dispatch'`、假上游收到的系统提示里有项目说明、请求里的 additionalDirectories 有项目资料目录）
- Modify: `scripts/e2e.mjs`（期号列表加 37、38、39）
- Modify: `scripts/ui-smoke.cjs`（一段：打开项目页四个标签、派活对话框、发布对话框、导入对话框能开能关，无 console 错误）
- Modify: `docs/notes/federation.md`（常开机器 + 交接）、`docs/notes/pages.md`（发布）、`docs/notes/library.md`（claude.ai 来源）、`docs/notes/sessions-env.md`（项目范围）、`docs/notes/phase06-remote-im.md`（派活 / IM `/dispatch`）、`docs/notes/ui-redesign-4-sidebar.md` 或 stage C 那节（项目页）
- Modify: `docs/superpowers/specs/2026-10-24-desktop-parity-design.md`（末尾加「阶段 F 完成后留下的」）

- [ ] **Step 1**：写三期 e2e，`$CLEAN node scripts/e2e.mjs 37 38 39` 跑到通过。
- [ ] **Step 2**：ui-smoke 段；拿锁 → `$CLEAN node scripts/ui-smoke.cjs` → 释放锁。
- [ ] **Step 3**：全量：`$CLEAN npm run typecheck`、`$CLEAN npm test`、`$CLEAN npm run build:all`、`$CLEAN npm run e2e`、（锁）`$CLEAN node scripts/ui-smoke.cjs`、`node scripts/i18n/extract.mjs --check`。已知偶发：ui-smoke 审阅 diff 评论那条、e2e 第 6 期端口冲突——各重跑一次并写进报告。
- [ ] **Step 4**：笔记 + spec 一节（写明没验证的：外网常开机器、真手机推送、真 IM 平台、真 claude.ai 导出包只按公开的格式和 fixture）。
- [ ] **Step 5: 提交**：`git add server/ws-phase37.mjs server/ws-phase38.mjs server/ws-phase39.mjs scripts/e2e.mjs scripts/ui-smoke.cjs docs/notes/… docs/superpowers/specs/2026-10-24-desktop-parity-design.md && git commit -m "test, docs: stage F e2e (handoff with a second local instance and a bare remote, publish → open → revoke, claude.ai import + project + dispatch), ui-smoke, notes"`
