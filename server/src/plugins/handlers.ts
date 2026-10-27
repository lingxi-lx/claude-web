// Hub dispatch for `plugins.*` requests (kept out of hub.ts).
import type { PluginService } from './service.js';
import type { PluginListResult, PluginRequest } from './protocol.js';

export const isPluginRequest = (req: { kind: string }): req is PluginRequest => req.kind.startsWith('plugins.');

export async function handlePluginRequest(svc: PluginService, req: PluginRequest): Promise<PluginListResult> {
  switch (req.kind) {
    case 'plugins.list': return svc.list();
    case 'plugins.reload': await svc.reload(); return svc.list();
    case 'plugins.enable': return svc.enable(String(req.id), req.approve === true);
    case 'plugins.disable': return svc.disable(String(req.id));
    case 'plugins.remove': return svc.remove(String(req.id));
  }
  throw new Error(`unknown plugin request ${(req as { kind: string }).kind}`);
}
