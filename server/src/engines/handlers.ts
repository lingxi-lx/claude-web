// Hub dispatch for `engines.*` (kept out of hub.ts). No sessionId on any of these: no federation routing entry.
import { tr } from '../i18n/index.js';
import type { EngineManager } from './manager.js';
import { MANIFESTS } from './manifests/index.js';
import type { EngineId, EngineRequest } from './types.js';

const KINDS = new Set(['engines.status', 'engines.install', 'engines.upgrade', 'engines.rollback', 'engines.start', 'engines.stop', 'engines.uninstall', 'engines.connect', 'engines.logs']);

export const isEngineRequest = (req: { kind: string }): req is EngineRequest => KINDS.has(req.kind);

const engineId = (id: unknown): EngineId => {
  if (typeof id !== 'string' || !(id in MANIFESTS)) throw new Error(tr('没有这个托管程序：{id}', { id: String(id) }));
  return id as EngineId;
};

export async function handleEngineRequest(svc: EngineManager, req: EngineRequest): Promise<unknown> {
  switch (req.kind) {
    case 'engines.status': return { engines: await svc.statuses() };
    case 'engines.install': return svc.install(engineId(req.id), typeof req.version === 'string' && req.version ? req.version : undefined);
    case 'engines.upgrade': return svc.upgrade(engineId(req.id));
    case 'engines.rollback': return svc.rollback(engineId(req.id));
    case 'engines.start': return svc.start(engineId(req.id));
    case 'engines.stop': return svc.stop(engineId(req.id));
    case 'engines.uninstall': return svc.uninstall(engineId(req.id));
    case 'engines.connect': return svc.connect(engineId(req.id), typeof req.port === 'number' ? req.port : undefined, typeof req.key === 'string' ? req.key : undefined);
    case 'engines.logs': return { text: await svc.logs(engineId(req.id), typeof req.lines === 'number' ? req.lines : 200) };
  }
  throw new Error(`unknown engine request ${(req as { kind: string }).kind}`);
}
