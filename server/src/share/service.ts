// 远程共享 (spec §8): share keys are ordinary gateway keys in the `share` key group, each with its own rules
// (GatewayKey.share: route groups / models it may use, concurrency, daily / weekly / monthly quotas), checked by
// GatewayKeyStore.verify / canSpend on every request. Other machines reach them through the gateway's existing
// LAN listener — default off; it only serves /v1… and /healthz, so no management call is ever reachable there —
// and every remote request runs the same path as a local one (protocol translation, privacy hook, audit log).
import type { GatewayService } from '../gateway/service.js';
import type { GatewayKey, ShareRules } from '../gateway/types.js';
import { SHARE_GROUP, currentPeriod, keyView } from '../upstreams/keys.js';
import { tr } from '../i18n/index.js';
import type { ShareKeyView, ShareRequest, ShareStatus } from './types.js';
export type { ShareKeyView, ShareRequest, ShareStatus } from './types.js';
export { checkShareKey, shareUsage, type ShareLimitCode, type ShareLimitResult, type ShareUsage } from './limits.js';

export { SHARE_GROUP };
/** private ranges: what a fresh share group admits from outside this machine */
const PRIVATE_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined);
const quota = (q: any) => {
  const requests = num(q?.requests);
  const tokens = num(q?.tokens);
  return requests || tokens ? { ...(requests ? { requests } : {}), ...(tokens ? { tokens } : {}) } : undefined;
};

/** Clean what the client sent: only known fields, positive integers, string lists. */
export function cleanRules(r: ShareRules | undefined): ShareRules {
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean))].slice(0, 100) : undefined);
  const out: ShareRules = {};
  const rg = list(r?.routeGroupIds);
  if (rg?.length) out.routeGroupIds = rg;
  const models = list(r?.models);
  if (models?.length) out.models = models;
  const sources = list(r?.sources);
  if (sources?.length) out.sources = sources;
  if (r?.subscription === true) out.subscription = true;
  const budget = typeof r?.paidBudgetUsd === 'number' && Number.isFinite(r.paidBudgetUsd) && r.paidBudgetUsd > 0 ? Math.round(r.paidBudgetUsd * 100) / 100 : 0;
  if (budget > 0) out.paidBudgetUsd = budget;
  const c = num(r?.concurrent);
  if (c) out.concurrent = c;
  for (const k of ['daily', 'weekly', 'monthly'] as const) { const q = quota(r?.[k]); if (q) out[k] = q; }
  if (typeof r?.note === 'string' && r.note.trim()) out.note = r.note.trim().slice(0, 200);
  return out;
}

export class ShareService {
  constructor(private gateway: GatewayService) {}

  private get keys() { return this.gateway.keys; }

  private async ensureGroup() {
    if (!this.keys.group(SHARE_GROUP)) {
      // the group's empty route-group list is only its ceiling ("no extra limit"); each key reaches nothing until
      // route groups are ticked for it (effectiveGroup), so a fresh key with nothing ticked can call nothing
      await this.keys.upsertGroup({ id: SHARE_GROUP, name: tr('共享'), allowLan: true, ipAllowlist: PRIVATE_RANGES, routeGroupIds: [] });
    }
    return this.keys.group(SHARE_GROUP)!;
  }

  private view(k: GatewayKey): ShareKeyView {
    const day = new Date().toISOString().slice(0, 10);
    const today = k.stats.day === day ? k.stats : { requests: 0, tokensIn: 0, tokensOut: 0 };
    const p = currentPeriod(k);
    return {
      ...keyView(k),
      usage: { todayRequests: today.requests, todayTokens: today.tokensIn + today.tokensOut, weekRequests: p.weekRequests, weekTokens: p.weekTokens, monthRequests: p.monthRequests, monthTokens: p.monthTokens },
    };
  }

  status(): ShareStatus {
    const lan = this.gateway.lanStatus();
    const group = this.keys.group(SHARE_GROUP);
    const port = lan.running ? lan.port : lan.port || 0;
    const hosts = lan.bind === '0.0.0.0' ? lan.addresses : [lan.bind].filter((b) => b && b !== '127.0.0.1');
    return {
      gatewayEnabled: this.gateway.status().enabled,
      lan,
      endpoints: lan.running && port ? hosts.map((h) => `http://${h}:${port}`) : [],
      ipAllowlist: group?.ipAllowlist ?? PRIVATE_RANGES,
      keys: this.keys.list().filter((k) => k.keyGroupId === SHARE_GROUP).map((k) => this.view(k)),
      routeGroups: this.gateway.status().groups.map((g) => ({ id: g.id, name: g.name })),
    };
  }

  async setLan(r: Extract<ShareRequest, { kind: 'share.lan.set' }>): Promise<ShareStatus> {
    if (r.ipAllowlist !== undefined) {
      await this.ensureGroup();
      await this.keys.upsertGroup({ id: SHARE_GROUP, ipAllowlist: r.ipAllowlist.map(String) });
    }
    if (r.enabled !== undefined || r.bind !== undefined || r.port !== undefined) {
      await this.gateway.setLan({
        ...(r.enabled !== undefined ? { enabled: !!r.enabled } : {}),
        ...(r.bind !== undefined ? { bind: String(r.bind) } : {}),
        ...(r.port !== undefined ? { port: Number(r.port) } : {}),
        ...(r.confirmAny ? { confirmAny: true } : {}),
      });
    }
    return this.status();
  }

  async create(name: string, rules?: ShareRules, expiresAt?: number): Promise<{ key: ShareKeyView; plaintext: string }> {
    await this.ensureGroup();
    const { key, plaintext } = await this.keys.create(SHARE_GROUP, String(name ?? ''), { share: cleanRules(rules), ...(num(expiresAt) ? { expiresAt: num(expiresAt) } : {}) });
    this.gateway.emit('changed');
    return { key: this.view(key), plaintext };
  }

  private own(id: string): GatewayKey {
    const k = this.keys.list().find((x) => x.id === id);
    if (!k || k.keyGroupId !== SHARE_GROUP) throw new Error(tr('没有这个共享密钥'));
    return k;
  }

  async update(id: string, patch: Extract<ShareRequest, { kind: 'share.keys.update' }>['patch']): Promise<ShareKeyView> {
    this.own(id);
    const k = await this.keys.update(id, {
      ...(patch.name !== undefined ? { name: String(patch.name) } : {}),
      ...(patch.enabled !== undefined ? { enabled: !!patch.enabled } : {}),
      ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt === null ? null : num(patch.expiresAt) ?? null } : {}),
      ...(patch.rules !== undefined ? { share: cleanRules(patch.rules) } : {}),
    });
    this.gateway.emit('changed');
    return this.view(k);
  }

  async remove(id: string): Promise<null> {
    this.own(id);
    await this.keys.remove(id);
    this.gateway.emit('changed');
    return null;
  }
}

export const isShareRequest = (req: { kind: string }): req is ShareRequest => req.kind.startsWith('share.');

export async function handleShareRequest(svc: ShareService, req: ShareRequest): Promise<unknown> {
  switch (req.kind) {
    case 'share.status': return svc.status();
    case 'share.lan.set': return svc.setLan(req);
    case 'share.keys.create': return svc.create(req.name, req.rules, req.expiresAt);
    case 'share.keys.update': return svc.update(String(req.id), req.patch ?? {});
    case 'share.keys.delete': return svc.remove(String(req.id));
  }
  throw new Error(`unknown share request ${(req as { kind: string }).kind}`);
}
