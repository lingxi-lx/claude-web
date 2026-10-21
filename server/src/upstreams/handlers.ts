// Hub dispatch for `upstreams.*` and `tasks.*` requests (kept out of hub.ts).
import type { TaskRequest, UpstreamRequest } from './types.js';
import type { UpstreamService } from './service.js';
import type { MaintenanceScheduler } from './tasks.js';

export const isUpstreamRequest = (req: { kind: string }): req is UpstreamRequest =>
  req.kind.startsWith('upstreams.') || req.kind.startsWith('tasks.');

export async function handleUpstreamRequest(svc: UpstreamService, tasks: MaintenanceScheduler, req: UpstreamRequest): Promise<unknown> {
  switch (req.kind) {
    case 'upstreams.status': return svc.status();
    case 'upstreams.sidecars.status': return svc.sidecarStatus();
    case 'upstreams.sidecars.install': return svc.installSidecar(req.id);
    case 'upstreams.sidecars.start': return svc.startSidecar(req.id);
    case 'upstreams.sidecars.stop': return svc.stopSidecar(req.id);
    case 'upstreams.sidecars.logs': return svc.sidecarLogs(req.id, req.lines);
    case 'upstreams.sync': return svc.syncFamily(req.id);
    case 'upstreams.oauth.start': return svc.oauthStart(req.realm === 'global' ? 'global' : 'cn');
    case 'upstreams.oauth.poll': return svc.oauthPoll(req.state);
    case 'tasks.list':
    case 'tasks.upsert':
    case 'tasks.remove':
    case 'tasks.run':
    case 'tasks.runs':
      return tasks.handle(req as TaskRequest);
    case 'upstreams.add': return svc.add(req.input);
    case 'upstreams.update': return svc.update(req.id, req.patch);
    case 'upstreams.remove': await svc.remove(req.id); return null;
    case 'upstreams.probe': return svc.probe(req.id);
    case 'upstreams.reset': await svc.reset(req.id); return svc.status();
    case 'upstreams.groups.upsert': return svc.upsertGroup(req.group);
    case 'upstreams.groups.remove': await svc.removeGroup(req.id); return null;
    case 'upstreams.attachDefault': return svc.attachDefault(req.id);
    case 'upstreams.models.refresh': return svc.refreshModels(req.id);
    case 'upstreams.proxies': return svc.proxies(req.id);
    case 'upstreams.proxies.add': return svc.addProxy(req.id, req.input);
    case 'upstreams.proxies.update': return svc.updateProxy(req.id, req.proxyId, req.patch);
    case 'upstreams.proxies.remove': return svc.removeProxy(req.id, req.proxyId);
    case 'upstreams.proxies.reset': return svc.resetProxy(req.id, req.proxyId);
    case 'upstreams.loginTunnel.open': return svc.openLoginTunnel(req.id, req.proxyId);
    case 'upstreams.loginTunnel.close': await svc.closeLoginTunnel(req.tunnelId); return null;
    case 'upstreams.guard.get': return svc.guard(req.id);
    case 'upstreams.guard.set': return svc.saveGuard(req.id, req.patch);
  }
  throw new Error(`unknown request ${(req as { kind: string }).kind}`);
}
