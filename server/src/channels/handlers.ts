// Hub dispatch for `channels.*` requests (kept out of hub.ts). No sessionId: no federation routing entry.
import { tr } from '../i18n/index.js';
import type { ChannelService } from './service.js';
import type { ChannelRequest, ChannelStatus, SourceSummary } from './types.js';

const KINDS = new Set(['channels.status', 'channels.refresh', 'channels.add', 'channels.remove', 'channels.catalog.set', 'channels.catalog.update', 'channels.catalog.remote']);

export const isChannelRequest = (req: { kind: string }): req is ChannelRequest => KINDS.has(req.kind);

export async function handleChannelRequest(
  svc: Pick<ChannelService, 'status' | 'refresh'> & Partial<Pick<ChannelService, 'add' | 'remove' | 'setCatalog' | 'updateCatalog' | 'setRemoteCatalog'>>,
  req: ChannelRequest,
): Promise<ChannelStatus | { source: SourceSummary | null; status: ChannelStatus }> {
  switch (req.kind) {
    case 'channels.status': return svc.status();
    case 'channels.refresh':
      if (typeof req.id !== 'string' || !req.id) throw new Error(tr('缺少来源'));
      return svc.refresh(req.id);
    case 'channels.add':
      if (typeof req.catalogId !== 'string' || !req.catalogId) throw new Error(tr('缺少来源'));
      if (!svc.add) break;
      return svc.add(req.catalogId, typeof req.key === 'string' ? req.key : undefined, typeof req.name === 'string' ? req.name : undefined);
    case 'channels.remove':
      if (typeof req.id !== 'string' || !req.id) throw new Error(tr('缺少来源'));
      if (!svc.remove) break;
      return svc.remove(req.id);
    case 'channels.catalog.set':
      if (typeof req.id !== 'string' || !req.id) throw new Error(tr('缺少来源'));
      if (!svc.setCatalog) break;
      return svc.setCatalog(req.id, req.override ?? null);
    case 'channels.catalog.update':
      if (!svc.updateCatalog) break;
      return svc.updateCatalog();
    case 'channels.catalog.remote':
      if (!svc.setRemoteCatalog) break;
      return svc.setRemoteCatalog(req.setting ?? null);
  }
  throw new Error(`unknown channel request ${(req as { kind: string }).kind}`);
}
