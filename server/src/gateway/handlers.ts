// Hub dispatch for `gateway.*` requests (kept out of hub.ts).
import type { GatewayRequest } from './types.js';
import type { GatewayService } from './service.js';
import { keyView } from '../upstreams/keys.js';

export const isGatewayRequest = (req: { kind: string }): req is GatewayRequest => req.kind.startsWith('gateway.');

export async function handleGatewayRequest(gw: GatewayService, req: GatewayRequest): Promise<unknown> {
  switch (req.kind) {
    case 'gateway.status':
      return gw.status();
    case 'gateway.set':
      await gw.setEnabled(!!req.enabled);
      return gw.status();
    case 'gateway.revealKey':
      return gw.revealKey();
    case 'gateway.regenerateKey':
      await gw.regenerateKey();
      return gw.status();
    case 'gateway.groups.upsert':
      return gw.upsertGroup(req.group);
    case 'gateway.groups.remove':
      await gw.removeGroup(req.id);
      return null;
    case 'gateway.reset':
      gw.reset(req.groupId, req.providerId);
      return gw.status();
    case 'gateway.test':
      return gw.test(req.groupId, req.protocol);
    case 'gateway.keys.status':
      return gw.keys.status();
    case 'gateway.keys.create': {
      const r = await gw.keys.create(req.groupId, req.name, { expiresAt: req.expiresAt });
      gw.emit('changed');
      return { key: keyView(r.key), plaintext: r.plaintext };
    }
    case 'gateway.keys.update': {
      const k = await gw.keys.update(req.id, req.patch);
      gw.emit('changed');
      return keyView(k);
    }
    case 'gateway.keys.remove':
      await gw.keys.remove(req.id);
      gw.emit('changed');
      return null;
    case 'gateway.keys.reveal':
      return gw.keys.reveal(req.id);
    case 'gateway.keyGroups.upsert':
      return gw.keys.upsertGroup(req.group);
    case 'gateway.keyGroups.remove':
      await gw.keys.removeGroup(req.id);
      return null;
    case 'gateway.local.set':
      return gw.setLocalPort(req.port);
    case 'gateway.lan.status':
      return gw.lanStatus();
    case 'gateway.lan.set':
      return gw.setLan(req.config);
    case 'gateway.audit.list':
      return gw.audit.list(req);
    case 'gateway.audit.clear':
      await gw.audit.clear();
      return null;
    case 'gateway.audit.export':
      return gw.audit.exportText();
    case 'gateway.routing.status':
      return gw.routingStatus(req.limit);
    case 'gateway.routing.ensure':
      await gw.ensureRoutingGroup();
      return gw.routingStatus();
    case 'gateway.routing.set':
      return gw.setRouting(req.patch ?? {});
    case 'gateway.routing.decisions':
      return gw.router.log.recent(gw.routingGroup()?.id, req.limit ?? 50);
    case 'gateway.settings.set':
      if (req.patch.audit) await gw.setAudit(req.patch.audit);
      if (req.patch.allowQueryKey !== undefined) await gw.setAllowQueryKey(req.patch.allowQueryKey);
      return gw.lanStatus();
  }
  throw new Error(`unknown request ${(req as { kind: string }).kind}`);
}
