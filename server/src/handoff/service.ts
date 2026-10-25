// 交给常开机器继续 (stage F1): a conversation in a Git project goes on on the always-on machine.
//
// Here: snapshot the work (committed or not) without touching the user's branch / index / work tree, push it to a new
// `cw/handoff-<id>` on the project's remote (never forced), hand the peer the branch and the conversation (replayed as
// a Claude transcript, like 交接 in 会话内核), stop the process here and mark the conversation read-only (`handedOff`).
// There (`receive`): a bare cache of the remote + a worktree of the branch under its own data dir, a new Claude
// conversation in it seeded with the history; it starts only when a next step was given. 取回 (`fetchBack`): the peer
// commits and pushes its worktree (fast-forward), this machine fetches the branch into a NEW local branch and shows
// the diff — nothing is merged or checked out.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ClientRequest, CloudRequest, HandoffInfo, OpenSessionParams, PermissionMode } from '../protocol.js';
import type { CanonicalEvent } from '../session/canonical.js';
import { toClaudeEntries } from '../session/handoff.js';
import { replayEvents } from '../library/continue-in-claude.js';
import { writeClaudeTranscript } from '../runtime/transcript-file.js';
import { isPeerId } from '../federation/types.js';
import { checkoutHandoff, deleteRemoteBranch, fetchBack, git, handoffRemote, publishHandoff, pushHandoff, redactUrl, snapshotCommit, untrackedFiles, type UntrackedInfo } from './git.js';
import { tr } from '../i18n/index.js';

const BRANCH = /^cw\/handoff-[\w-]{1,40}$/;
const MAX_EVENTS = 5_000;

export interface HandoffDeps {
  meta: { sessionMeta(id: string): { handedOff?: HandoffInfo; permissionMode?: PermissionMode }; setSessionMeta(id: string, patch: Record<string, unknown>): Promise<unknown> };
  request<T = unknown>(peerId: string, req: ClientRequest): Promise<T>;
  peers(): { id: string; name: string; enabled: boolean; state?: string; alwaysOn?: boolean }[];
  summaryOf(sessionId: string): Promise<{ cwd: string; title?: string } | undefined>;
  readAll(sessionId: string): Promise<any[]>;
  stop?(sessionId: string): Promise<void>;
  /** A turn is running here now (the hand-off refuses: the snapshot would miss what it is still writing). */
  isRunning?(sessionId: string): boolean;
  open?(p: OpenSessionParams): { sessionId: string; send(text: string): void };
  rename?(sessionId: string, title: string, cwd: string): Promise<void>;
  dataDir: string;
  serverName(): string;
  writeTranscript?(cwd: string, sessionId: string, entries: object[]): void;
  now?(): number;
}

interface Received { branch: string; url: string; cwd: string; sessionId: string; at: number }

/** Only what a transcript replay needs, from a peer we cannot fully trust: text, tool notes; nothing else. */
function cleanEvents(raw: unknown): CanonicalEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: CanonicalEvent[] = [];
  for (const e of raw.slice(0, MAX_EVENTS) as any[]) {
    if (!e || typeof e !== 'object') continue;
    if ((e.kind === 'user' || e.kind === 'assistant') && typeof e.text === 'string') out.push({ t: 0, kind: e.kind, text: e.text.slice(0, 200_000) } as CanonicalEvent);
    else if (e.kind === 'tool' && typeof e.name === 'string') out.push({ t: 0, kind: 'tool', id: String(e.id ?? ''), name: e.name.slice(0, 200), input: e.input && typeof e.input === 'object' ? e.input : {}, ...(e.ok === false ? { ok: false } : {}) } as CanonicalEvent);
  }
  return out;
}

export class HandoffService {
  constructor(private readonly d: HandoffDeps) {}

  /** Conversations a hand-off is under way for (one at a time each; sends are refused meanwhile, like after it). */
  private readonly inFlight = new Set<string>();
  /** Read-only here: handed to another machine, or being handed right now (F4: hub / IM / sessions MCP / schedules ask this). */
  isReadOnly(sessionId: string): boolean {
    return this.inFlight.has(sessionId) || !!this.d.meta.sessionMeta(sessionId).handedOff;
  }
  /** The same, as what a sender is told (null = writable). */
  readOnlyReason(sessionId: string): string | null {
    if (this.inFlight.has(sessionId)) return tr('这个对话正在交接，这时不能再发消息');
    const h = this.d.meta.sessionMeta(sessionId).handedOff;
    return h ? tr('这个对话已经交给「{name}」继续了，这里只能看', { name: h.peerName }) : null;
  }

  private get indexFile() { return path.join(this.d.dataDir, 'handoff', 'received.json'); }
  private received(): Received[] {
    try { const v = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  private remember(r: Received) {
    const all = [...this.received().filter((x) => x.branch !== r.branch), r];
    fs.mkdirSync(path.dirname(this.indexFile), { recursive: true });
    fs.writeFileSync(this.indexFile, JSON.stringify(all, null, 2));
  }

  async check(sessionId: string): Promise<{ ok: boolean; reason?: string; remote?: string; untracked?: UntrackedInfo }> {
    if (isPeerId(sessionId)) return { ok: false, reason: tr('这个对话在其它机器上') };
    const done = this.d.meta.sessionMeta(sessionId).handedOff;
    if (done) return { ok: false, reason: tr('已经交给「{name}」了', { name: done.peerName }) };
    const s = await this.d.summaryOf(sessionId);
    if (!s?.cwd) return { ok: false, reason: tr('找不到这个对话的项目文件夹') };
    const r = await handoffRemote(s.cwd);
    if (!r.ok) return { ok: false, reason: r.reason };
    // F2: the new files Git does not track — carried only when the user ticks them in; key files never
    const untracked = await untrackedFiles(s.cwd).catch(() => undefined);
    return { ok: true, remote: redactUrl(r.url), ...(untracked ? { untracked } : {}) };
  }

  async start(sessionId: string, peerId: string, prompt?: string, o: { includeUntracked?: boolean } = {}): Promise<HandoffInfo & { skipped?: string[] }> {
    if (this.inFlight.has(sessionId)) throw new Error(tr('这个对话正在交接'));
    this.inFlight.add(sessionId);
    try {
      return await this.startLocked(sessionId, peerId, prompt, o);
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  private async startLocked(sessionId: string, peerId: string, prompt: string | undefined, o: { includeUntracked?: boolean }): Promise<HandoffInfo & { skipped?: string[] }> {
    const peer = this.d.peers().find((p) => p.id === peerId && p.enabled);
    if (!peer) throw new Error(tr('没有这台机器'));
    if (peer.state && peer.state !== 'online') throw new Error(tr('机器「{name}」现在连不上', { name: peer.name }));
    // F4: a running turn is still writing files — refuse before the snapshot, not stop it afterwards
    if (this.d.isRunning?.(sessionId)) throw new Error(tr('这个对话还在运行，先停下它再交接'));
    const ok = await this.check(sessionId);
    if (!ok.ok) throw new Error(ok.reason);
    const s = (await this.d.summaryOf(sessionId))!;
    const remote = await handoffRemote(s.cwd);
    if (!remote.ok) throw new Error(remote.reason);
    const title = s.title?.trim() || tr('未命名对话');
    const { commit, base, skipped } = await snapshotCommit(s.cwd, `Claude Web hand-off: ${title.slice(0, 120)}`, { includeUntracked: !!o.includeUntracked });
    const { id, branch } = await pushHandoff(s.cwd, remote.remote, commit);
    let r: any;
    try {
      const events = replayEvents(await this.d.readAll(sessionId));
      const mode = this.d.meta.sessionMeta(sessionId).permissionMode;
      r = await this.d.request(peerId, {
        kind: 'handoff.receive', id, url: remote.url, branch, title, events, from: this.d.serverName(),
        ...(mode ? { permissionMode: mode } : {}), ...(prompt?.trim() ? { prompt: prompt.trim() } : {}),
      });
    } catch (e: any) {
      // F3: the peer never got it — take the branch off the remote again (a plain delete, never forced)
      const why = e?.message ?? String(e);
      try { await deleteRemoteBranch(s.cwd, remote.remote, branch); } catch {
        throw new Error(tr('交接失败：{why}。远端上留下了分支 {branch}，可以自己删掉', { why, branch }));
      }
      throw new Error(tr('交接失败：{why}', { why }));
    }
    await this.d.stop?.(sessionId).catch(() => { /* not running */ });
    const info: HandoffInfo = { id, peerId, peerName: peer.name, remote: remote.remote, branch, commit, base, at: (this.d.now ?? Date.now)(), ...(typeof r?.sessionId === 'string' ? { remoteSessionId: r.sessionId } : {}) };
    await this.d.meta.setSessionMeta(sessionId, { handedOff: info });
    return { ...info, ...(skipped.length ? { skipped } : {}) };
  }

  /** The always-on machine's side. */
  async receive(req: Extract<CloudRequest, { kind: 'handoff.receive' }>): Promise<{ sessionId: string; cwd: string }> {
    if (!BRANCH.test(req.branch)) throw new Error('bad handoff branch');
    if (typeof req.url !== 'string' || !req.url.trim() || req.url.startsWith('-')) throw new Error('bad remote');
    const root = path.join(this.d.dataDir, 'handoff');
    const cwd = await checkoutHandoff(path.join(root, 'repos'), path.join(root, 'worktrees'), req.url, req.branch);
    const from = String(req.from || '?').slice(0, 80);
    let events = cleanEvents(req.events);
    if (!events.length) events = [{ t: 0, kind: 'user', text: tr('（这个对话从「{from}」交接过来）', { from }) } as CanonicalEvent];
    const sessionId = randomUUID();
    (this.d.writeTranscript ?? writeClaudeTranscript)(cwd, sessionId, toClaudeEntries(events, { cwd, sessionId }));
    const title = tr('{title}（从 {from} 交接）', { title: String(req.title || tr('未命名对话')).slice(0, 120), from });
    await this.d.rename?.(sessionId, title, cwd).catch(() => {});
    const at = (this.d.now ?? Date.now)();
    // stored without credentials: the full URL stays only in the cache repo's own `origin` (checkoutHandoff)
    const shown = redactUrl(req.url);
    await this.d.meta.setSessionMeta(sessionId, { handoffFrom: { id: req.id, from, branch: req.branch, url: shown, cwd, at }, ...(req.permissionMode ? { permissionMode: req.permissionMode } : {}) });
    this.remember({ branch: req.branch, url: shown, cwd, sessionId, at });
    if (req.prompt?.trim() && this.d.open) {
      const r = this.d.open({ sessionId, cwd, ...(req.permissionMode ? { permissionMode: req.permissionMode } : {}) });
      r.send(req.prompt.trim());
    }
    return { sessionId, cwd };
  }

  /** The always-on machine sends its work back on the hand-off branch (fast-forward only). */
  async publish(branch: string): Promise<{ commit: string; changed: boolean }> {
    if (!BRANCH.test(branch)) throw new Error('bad handoff branch');
    const r = this.received().find((x) => x.branch === branch);
    if (!r || !fs.existsSync(r.cwd)) throw new Error(tr('这台机器上没有这个交接'));
    // the cache repo's `origin` has the URL as given (credentials included); older entries kept the URL here
    const target = await git(r.cwd, ['remote', 'get-url', 'origin']).then(() => 'origin', () => r.url);
    return publishHandoff(r.cwd, target, branch, `Claude Web: work from ${this.d.serverName()}`);
  }

  async fetchBack(sessionId: string): Promise<{ branch: string; stat: string; diff: string; files: number; saved: boolean; saveError?: string }> {
    const info = this.d.meta.sessionMeta(sessionId).handedOff;
    if (!info) throw new Error(tr('这个对话没有交给其它机器'));
    const s = await this.d.summaryOf(sessionId);
    if (!s?.cwd) throw new Error(tr('找不到这个对话的项目文件夹'));
    // the peer pushes what it has (its uncommitted work too); offline: whatever is on the remote already
    let saveError = '';
    await this.d.request<{ changed: boolean }>(info.peerId, { kind: 'handoff.publish', branch: info.branch }).catch((e: any) => { saveError = String(e?.message ?? e) || '?'; });
    const r = await fetchBack(s.cwd, info.remote, info.branch);
    await this.d.meta.setSessionMeta(sessionId, { handedOff: { ...info, fetched: [...(info.fetched ?? []), r.local] } });
    return { branch: r.local, stat: r.stat, diff: r.diff, files: r.files, saved: !saveError, ...(saveError ? { saveError } : {}) };
  }
}
