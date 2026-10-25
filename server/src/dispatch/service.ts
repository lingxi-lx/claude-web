// 派活 (stage F3): a task from the phone / an IM chat becomes a new conversation on this computer (or, with `peer`,
// on another machine of the federation), in the project's folder and permission mode. Marked `origin: 'dispatch'` in
// its meta (the sidebar row says 从手机派来); 上次的 machine and project are remembered in settings `dispatch.last`.
import type { ClientRequest, OpenSessionParams, PermissionMode, Workspace } from '../protocol.js';
import { peerSessionId } from '../federation/types.js';
import { dispatchDefaults, normDispatch, type DispatchParams } from './core.js';
import { tr } from '../i18n/index.js';

export const LAST_KEY = 'dispatch.last';

export interface DispatchMeta {
  workspaces(): (Pick<Workspace, 'id' | 'path' | 'name'> & { permissionMode?: PermissionMode })[];
  settings(): Record<string, unknown>;
  setSetting(k: string, v: unknown): Promise<unknown>;
  setSessionMeta(id: string, patch: Record<string, unknown>): Promise<unknown>;
  sessionMeta(id: string): { origin?: string };
}

export interface DispatchDeps {
  meta: DispatchMeta;
  open(p: OpenSessionParams): { sessionId: string; send(text: string): void };
  homeDir(): string;
  forward?(peerId: string, req: ClientRequest): Promise<unknown>;
  peers?(): { id: string; name: string; enabled: boolean; state?: string }[];
}

export class DispatchService {
  constructor(private readonly d: DispatchDeps) {}

  isDispatched(id: string): boolean { return this.d.meta.sessionMeta(id).origin === 'dispatch'; }

  /** What the 派活 form offers: the projects (of `peer`, when given), the machines, 上次的 pick. */
  async defaults(peer?: string): Promise<{ workspaces: { id: string; name: string; path: string }[]; peers: { id: string; name: string; online: boolean }[]; last: { peer?: string; workspaceId?: string } }> {
    const peers = (this.d.peers?.() ?? []).filter((p) => p.enabled);
    if (peer) {
      if (!this.d.forward) throw new Error(tr('没有这台机器'));
      const r: any = await this.d.forward(peer, { kind: 'dispatch.defaults' });
      return { workspaces: Array.isArray(r?.workspaces) ? r.workspaces : [], peers: peers.map((p) => ({ id: p.id, name: p.name, online: p.state === 'online' })), last: {} };
    }
    const ws = this.d.meta.workspaces();
    const last = dispatchDefaults(this.d.meta.settings()[LAST_KEY], ws, peers);
    return { workspaces: ws.map((w) => ({ id: w.id, name: w.name, path: w.path })), peers: peers.map((p) => ({ id: p.id, name: p.name, online: p.state === 'online' })), last };
  }

  async start(raw: { prompt?: unknown; peer?: unknown; workspaceId?: unknown; from?: unknown }): Promise<{ sessionId: string }> {
    const p: DispatchParams = normDispatch(raw);
    if (p.peer) {
      if (!this.d.forward) throw new Error(tr('没有这台机器'));
      const r: any = await this.d.forward(p.peer, { kind: 'dispatch.start', prompt: p.prompt, ...(p.workspaceId ? { workspaceId: p.workspaceId } : {}), from: p.from });
      if (typeof r?.sessionId !== 'string') throw new Error(tr('那台机器没有开出对话'));
      await this.d.meta.setSetting(LAST_KEY, { peer: p.peer, ...(p.workspaceId ? { workspaceId: p.workspaceId } : {}) });
      return { sessionId: peerSessionId(p.peer, r.sessionId) };
    }
    const w = p.workspaceId ? this.d.meta.workspaces().find((x) => x.id === p.workspaceId) : undefined;
    if (p.workspaceId && !w) throw new Error(tr('这个项目已经不在了'));
    const cwd = w?.path ?? this.d.homeDir();
    const r = this.d.open({ cwd, ...(w?.permissionMode ? { permissionMode: w.permissionMode } : {}) });
    await this.d.meta.setSessionMeta(r.sessionId, { origin: 'dispatch', dispatchFrom: p.from, ...(w ? { workspaceId: w.id } : {}) });
    r.send(p.prompt);
    await this.d.meta.setSetting(LAST_KEY, p.workspaceId ? { workspaceId: p.workspaceId } : {});
    return { sessionId: r.sessionId };
  }
}
