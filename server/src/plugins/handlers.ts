// Hub dispatch for `plugins.*` requests (kept out of hub.ts).
import type { PluginService } from './service.js';
import type { PluginRequest } from './protocol.js';
import { tr } from '../i18n/index.js';

export const isPluginRequest = (req: { kind: string }): req is PluginRequest => req.kind.startsWith('plugins.');

export async function handlePluginRequest(svc: PluginService, req: PluginRequest): Promise<unknown> {
  switch (req.kind) {
    case 'plugins.list': return svc.list();
    case 'plugins.reload': await svc.reload(); return svc.list();
    case 'plugins.enable': return svc.enable(String(req.id), req.approve === true, req.allowUnrestricted === true);
    case 'plugins.disable': return svc.disable(String(req.id));
    case 'plugins.remove': return svc.remove(String(req.id));
    case 'plugins.market.status': return svc.marketStatus();
    case 'plugins.market.refresh': return svc.refreshMarket();
    case 'plugins.market.set':
      if (!req.config || typeof req.config !== 'object') throw new Error(tr('插件市场设置不对'));
      return svc.setMarketConfig(req.config);
    case 'plugins.install':
      if (!req.id && !req.url && !req.path) throw new Error(tr('缺少插件包'));
      return svc.installPlugin({ ...(req.id ? { id: String(req.id) } : {}), ...(req.url ? { url: String(req.url) } : {}), ...(req.path ? { path: String(req.path) } : {}), ...(req.sha256 ? { sha256: String(req.sha256) } : {}) });
  }
  throw new Error(`unknown plugin request ${(req as { kind: string }).kind}`);
}
