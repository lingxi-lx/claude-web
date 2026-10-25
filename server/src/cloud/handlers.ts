// Stage F (local versions of claude.ai features): every new request in one place, so the hub only gains one line.
// 项目资料 / 派活 here; 交接 (handoff), 发布 (publish) and 导入 claude.ai are added by their services.
import type { CloudRequest } from '../protocol.js';
import type { ProjectFiles } from './project-files.js';
import type { DispatchService } from '../dispatch/service.js';
import { tr } from '../i18n/index.js';

const KINDS = new Set<string>([
  'projects.files.list', 'projects.files.remove', 'dispatch.start', 'dispatch.defaults',
  'handoff.check', 'handoff.start', 'handoff.receive', 'handoff.publish', 'handoff.fetchBack',
  'publish.create', 'publish.list', 'publish.revoke', 'publish.toPeer', 'publish.receive', 'publish.inline',
  'claudeai.scan', 'claudeai.import',
]);

export function isCloudRequest(req: { kind: string }): req is CloudRequest { return KINDS.has(req.kind); }

/** The parts of the services this file talks to (each service file declares its own full class). */
export interface CloudServices {
  projectFiles: ProjectFiles;
  dispatch: DispatchService;
  workspaceExists(id: string): boolean;
  handoff?: {
    check(sessionId: string): Promise<unknown>;
    start(sessionId: string, peerId: string, prompt?: string): Promise<unknown>;
    receive(req: Extract<CloudRequest, { kind: 'handoff.receive' }>): Promise<unknown>;
    publish(branch: string): Promise<unknown>;
    fetchBack(sessionId: string): Promise<unknown>;
  };
  publish?: {
    create(path: string, expiry: Extract<CloudRequest, { kind: 'publish.create' }>['expiry'], id?: string): Promise<unknown>;
    list(): unknown;
    revoke(id: string): Promise<unknown>;
    toPeer(path: string, expiry: Extract<CloudRequest, { kind: 'publish.toPeer' }>['expiry'], peerId: string): Promise<unknown>;
    receive(req: Extract<CloudRequest, { kind: 'publish.receive' }>): Promise<unknown>;
    inline(path: string): Promise<unknown>;
  };
  claudeAi?: {
    scan(path: string): Promise<unknown>;
    run(path: string, folder?: string): Promise<unknown>;
  };
}

const off = () => new Error(tr('这个功能现在不可用'));

/** `conn.peer`: another machine of the federation asks; `conn.remote`: a paired phone / remote window. */
export async function handleCloud(c: CloudServices | undefined, req: CloudRequest, conn: { peer: boolean; remote: boolean }): Promise<unknown> {
  if (!c) throw off();
  switch (req.kind) {
    case 'projects.files.list': {
      if (!c.workspaceExists(req.workspaceId)) throw new Error(tr('这个项目已经不在了'));
      return { dir: c.projectFiles.dir(req.workspaceId), files: await c.projectFiles.list(req.workspaceId) };
    }
    case 'projects.files.remove': {
      if (!c.workspaceExists(req.workspaceId)) throw new Error(tr('这个项目已经不在了'));
      await c.projectFiles.remove(req.workspaceId, req.name);
      return { files: await c.projectFiles.list(req.workspaceId) };
    }
    case 'dispatch.start': {
      // a phone (remote connection) says so itself; another machine passes on where it came from
      const from = conn.remote && !conn.peer ? 'phone' : req.from;
      return c.dispatch.start({ prompt: req.prompt, peer: req.peer, workspaceId: req.workspaceId, from });
    }
    case 'dispatch.defaults': return c.dispatch.defaults(req.peer);
    case 'handoff.check': if (!c.handoff) throw off(); return c.handoff.check(req.sessionId);
    case 'handoff.start': if (!c.handoff) throw off(); return c.handoff.start(req.sessionId, req.peerId, req.prompt);
    case 'handoff.receive': if (!c.handoff) throw off(); return c.handoff.receive(req);
    case 'handoff.publish': if (!c.handoff) throw off(); return c.handoff.publish(req.branch);
    case 'handoff.fetchBack': if (!c.handoff) throw off(); return c.handoff.fetchBack(req.sessionId);
    case 'publish.create': if (!c.publish) throw off(); return c.publish.create(req.path, req.expiry, req.id);
    case 'publish.list': if (!c.publish) throw off(); return c.publish.list();
    case 'publish.revoke': if (!c.publish) throw off(); return c.publish.revoke(req.id);
    case 'publish.toPeer': if (!c.publish) throw off(); return c.publish.toPeer(req.path, req.expiry, req.peerId);
    case 'publish.receive': if (!c.publish) throw off(); return c.publish.receive(req);
    case 'publish.inline': if (!c.publish) throw off(); return c.publish.inline(req.path);
    case 'claudeai.scan': if (!c.claudeAi) throw off(); return c.claudeAi.scan(req.path);
    case 'claudeai.import': if (!c.claudeAi) throw off(); return c.claudeAi.run(req.path, req.folder);
  }
}
