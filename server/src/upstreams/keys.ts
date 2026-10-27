// Gateway keys: groups (what a key may use and where from), the keys themselves (minted once, stored as a
// salted hash), the migration of the old single key, and today's counters behind the daily budgets.
import crypto from 'node:crypto';
import type { MetaStore } from '../meta/store.js';
import type { SecretService } from '../secrets/service.js';
import type { GatewayKey, GatewayKeyGroup, GatewayKeyStatus, ShareRules } from '../gateway/types.js';
import { tr } from '../i18n/index.js';
import { globMatch, modelAllowed } from './routing.js';

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
/** ISO week, local time: `2026-W43` */
export function isoWeek(d = new Date()): string {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - day + 3);
  const first = new Date(t.getFullYear(), 0, 4);
  const w = 1 + Math.round(((t.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getDay() + 6) % 7)) / 7);
  return `${t.getFullYear()}-W${String(w).padStart(2, '0')}`;
}
const emptyPeriod = () => ({ week: isoWeek(), weekRequests: 0, weekTokens: 0, month: thisMonth(), monthRequests: 0, monthTokens: 0 });
/** The key's period counters, rolled over when the week / month changed (a copy; not written back). */
export function currentPeriod(k: GatewayKey): NonNullable<GatewayKey['period']> {
  const p = { ...(k.period ?? emptyPeriod()) };
  const w = isoWeek();
  const m = thisMonth();
  if (p.week !== w) Object.assign(p, { week: w, weekRequests: 0, weekTokens: 0 });
  if (p.month !== m) Object.assign(p, { month: m, monthRequests: 0, monthTokens: 0 });
  return p;
}

/**
 * The rules a share key actually runs under: its group's, narrowed by the key's own (never widened).
 * Route groups intersect (the group's empty list = all); models must pass both lists; concurrency takes the lower.
 */
export function effectiveGroup(g: GatewayKeyGroup, share?: ShareRules): GatewayKeyGroup {
  if (!share) return g;
  let routeGroupIds = g.routeGroupIds;
  if (share.routeGroupIds?.length) routeGroupIds = g.routeGroupIds.length ? share.routeGroupIds.filter((id) => g.routeGroupIds.includes(id)) : share.routeGroupIds;
  // a narrowing that leaves nothing must stay nothing, not fall back to "all"
  if (share.routeGroupIds?.length && !routeGroupIds.length) routeGroupIds = ['~none~'];
  let modelAllowlist = g.modelAllowlist;
  if (share.models?.length) {
    modelAllowlist = g.modelAllowlist?.length
      ? share.models.filter((m) => modelAllowed(m, g.modelAllowlist) || g.modelAllowlist!.some((p) => globMatch(m, p)))
      : share.models;
    if (!modelAllowlist.length) modelAllowlist = ['~none~'];
  }
  const conc = [g.rateLimit?.concurrent, share.concurrent].filter((n): n is number => !!n && n > 0);
  const rateLimit = conc.length ? { ...g.rateLimit, concurrent: Math.min(...conc) } : g.rateLimit;
  return { ...g, routeGroupIds, ...(modelAllowlist ? { modelAllowlist } : {}), ...(rateLimit ? { rateLimit } : {}) };
}

export function newKeyParts(): { plaintext: string; prefix: string; hash: string; salt: string } {
  const plaintext = `cwg-${crypto.randomBytes(24).toString('hex')}`;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + plaintext).digest('hex');
  return { plaintext, prefix: `${plaintext.slice(0, 8)}…${plaintext.slice(-4)}`, hash, salt };
}

export function verifyKey(presented: string, key: Pick<GatewayKey, 'salt' | 'hash'>): boolean {
  const got = crypto.createHash('sha256').update(key.salt + presented).digest();
  const want = Buffer.from(key.hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export const keyView = (k: GatewayKey) => {
  const { hash: _hash, salt: _salt, secret: _secret, ...rest } = k;
  return rest;
};

export class GatewayKeyStore {
  constructor(private meta: MetaStore, private secrets?: SecretService) {}

  groups(): GatewayKeyGroup[] { return this.meta.gatewayKeyGroups(); }
  list(): GatewayKey[] { return this.meta.gatewayKeys(); }
  group(id: string): GatewayKeyGroup | undefined { return this.groups().find((g) => g.id === id); }

  status(): GatewayKeyStatus {
    return { groups: this.groups(), keys: this.list().map(keyView), defaultKeyId: 'key_default' };
  }

  async ensureDefaultGroup(): Promise<GatewayKeyGroup> {
    let g = this.group('default');
    if (!g) {
      g = { id: 'default', name: tr('默认密钥组'), routeGroupIds: [], allowLan: false, ipAllowlist: [], createdAt: Date.now() };
      this.groups().push(g);
      await this.meta.saveGatewayKeys();
    }
    return g;
  }

  /** The single key of the old gateway becomes `key_default`, still revealable. */
  async migrateLegacy(legacy: string): Promise<void> {
    if (!legacy) return;
    const group = await this.ensureDefaultGroup();
    const existing = this.list().find((k) => k.id === 'key_default');
    if (existing) {
      // the same key already migrated; a different one (a second server instance, tests) replaces it
      if (!verifyKey(legacy, existing)) await this.replaceLegacy(legacy);
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + legacy).digest('hex');
    this.list().push({
      id: 'key_default',
      name: tr('默认密钥'),
      keyGroupId: group.id,
      prefix: `${legacy.slice(0, 8)}…${legacy.slice(-4)}`,
      hash,
      salt,
      secret: this.secrets ? await this.secrets.protect(legacy, 'gateway-key:key_default') : legacy,
      enabled: true,
      createdAt: Date.now(),
      stats: { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, day: today() },
    });
    await this.meta.saveGatewayKeys();
  }

  /** 重新生成: the old key's row keeps its id and stats but gets the new secret. */
  async replaceLegacy(plaintext: string): Promise<void> {
    const k = this.list().find((x) => x.id === 'key_default');
    if (!k) return this.migrateLegacy(plaintext);
    k.salt = crypto.randomBytes(16).toString('hex');
    k.hash = crypto.createHash('sha256').update(k.salt + plaintext).digest('hex');
    k.prefix = `${plaintext.slice(0, 8)}…${plaintext.slice(-4)}`;
    k.secret = this.secrets ? await this.secrets.protect(plaintext, 'gateway-key:key_default') : plaintext;
    k.enabled = true;
    await this.meta.saveGatewayKeys();
  }

  async create(groupId: string | undefined, name: string, opts: { expiresAt?: number; rateLimit?: GatewayKeyGroup['rateLimit']; share?: ShareRules } = {}): Promise<{ key: GatewayKey; plaintext: string }> {
    const group = groupId ? this.group(groupId) : await this.ensureDefaultGroup();
    if (!group) throw new Error(tr('没有这个密钥组'));
    if (opts.rateLimit) {
      group.rateLimit = { ...group.rateLimit, ...opts.rateLimit };
      await this.meta.saveGatewayKeys();
    }
    const parts = newKeyParts();
    const key: GatewayKey = {
      id: `key_${crypto.randomBytes(5).toString('hex')}`,
      name: name.trim() || tr('新密钥'),
      keyGroupId: group.id,
      prefix: parts.prefix,
      hash: parts.hash,
      salt: parts.salt,
      enabled: true,
      ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
      ...(opts.share ? { share: opts.share } : {}),
      createdAt: Date.now(),
      stats: { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, day: today() },
    };
    this.list().push(key);
    await this.meta.saveGatewayKeys();
    return { key, plaintext: parts.plaintext };
  }

  async update(id: string, patch: { name?: string; enabled?: boolean; keyGroupId?: string; expiresAt?: number | null; share?: ShareRules | null }): Promise<GatewayKey> {
    const k = this.list().find((x) => x.id === id);
    if (!k) throw new Error(tr('没有这个密钥'));
    if (patch.name !== undefined) k.name = patch.name.trim() || k.name;
    if (patch.enabled !== undefined) k.enabled = patch.enabled;
    if (patch.keyGroupId !== undefined) {
      if (!this.group(patch.keyGroupId)) throw new Error(tr('没有这个密钥组'));
      k.keyGroupId = patch.keyGroupId;
    }
    if (patch.expiresAt !== undefined) {
      if (patch.expiresAt === null) delete k.expiresAt;
      else k.expiresAt = patch.expiresAt;
    }
    if (patch.share !== undefined) {
      if (patch.share === null) delete k.share;
      else k.share = patch.share;
    }
    await this.meta.saveGatewayKeys();
    return k;
  }

  async remove(id: string): Promise<void> {
    // the old gateway provider profiles still carry this key in their endpoint
    if (id === 'key_default') throw new Error(tr('默认密钥不能删除（旧的网关供应商还在用它，可以在设置里重新生成）'));
    this.meta.data.gatewayKeys = this.list().filter((k) => k.id !== id);
    await this.meta.saveGatewayKeys();
  }

  async reveal(id: string): Promise<string> {
    const k = this.list().find((x) => x.id === id);
    if (!k?.secret) throw new Error(tr('这个密钥只在创建时显示一次'));
    return this.secrets ? this.secrets.reveal(k.secret) : k.secret;
  }

  verify(presented: string): { key: GatewayKey; group: GatewayKeyGroup } | null {
    const now = Date.now();
    for (const k of this.list()) {
      if (!k.enabled || (k.expiresAt && k.expiresAt < now)) continue;
      if (!verifyKey(presented, k)) continue;
      const g = this.group(k.keyGroupId);
      if (g) return { key: k, group: effectiveGroup(g, k.share) };
    }
    return null;
  }

  recordUsage(id: string, tokensIn: number, tokensOut: number, costUsd: number): void {
    const k = this.list().find((x) => x.id === id);
    if (!k) return;
    const day = today();
    if (k.stats.day !== day) k.stats = { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, day };
    k.stats.requests += 1;
    k.stats.tokensIn += tokensIn;
    k.stats.tokensOut += tokensOut;
    k.stats.costUsd += costUsd;
    const p = currentPeriod(k);
    p.weekRequests += 1; p.monthRequests += 1;
    p.weekTokens += tokensIn + tokensOut; p.monthTokens += tokensIn + tokensOut;
    k.period = p;
    k.lastUsedAt = Date.now();
    // written by saveUsage() at most every 30 s (the gateway's timer), like the account counters
  }

  canSpend(key: GatewayKey, group: GatewayKeyGroup): { ok: true } | { ok: false; message: string } {
    const day = today();
    const s = key.stats.day === day ? key.stats : { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, day };
    const lim = group.rateLimit;
    if (lim?.dailyTokens && s.tokensIn + s.tokensOut >= lim.dailyTokens) return { ok: false, message: tr('这个密钥今天的 token 额度已用完') };
    if (lim?.dailyCostUsd && s.costUsd >= lim.dailyCostUsd) return { ok: false, message: tr('这个密钥今天的费用额度已用完') };
    const sh = key.share;
    if (sh) {
      const p = currentPeriod(key);
      const over = (q: ShareRules['daily'], requests: number, tokens: number) => !!q && ((!!q.requests && requests >= q.requests) || (!!q.tokens && tokens >= q.tokens));
      if (over(sh.daily, s.requests, s.tokensIn + s.tokensOut)) return { ok: false, message: tr('这个共享密钥今天的额度已用完') };
      if (over(sh.weekly, p.weekRequests, p.weekTokens)) return { ok: false, message: tr('这个共享密钥本周的额度已用完') };
      if (over(sh.monthly, p.monthRequests, p.monthTokens)) return { ok: false, message: tr('这个共享密钥本月的额度已用完') };
    }
    return { ok: true };
  }

  async upsertGroup(patch: Partial<GatewayKeyGroup> & { id?: string }): Promise<GatewayKeyGroup> {
    let g = patch.id ? this.group(patch.id) : undefined;
    if (!g) {
      g = {
        id: patch.id && /^[A-Za-z0-9_-]{1,40}$/.test(patch.id) ? patch.id : `kg_${crypto.randomBytes(4).toString('hex')}`,
        name: tr('新密钥组'),
        routeGroupIds: [],
        allowLan: false,
        ipAllowlist: [],
        createdAt: Date.now(),
      };
      this.groups().push(g);
    }
    if (patch.name !== undefined) g.name = patch.name.trim() || g.name;
    if (patch.routeGroupIds !== undefined) g.routeGroupIds = [...new Set(patch.routeGroupIds)];
    if (patch.modelAllowlist !== undefined) g.modelAllowlist = patch.modelAllowlist.filter(Boolean);
    if (patch.modelDeny !== undefined) g.modelDeny = patch.modelDeny.filter(Boolean);
    if (patch.allowLan !== undefined) g.allowLan = patch.allowLan;
    if (patch.ipAllowlist !== undefined) g.ipAllowlist = patch.ipAllowlist.map((x) => x.trim()).filter(Boolean);
    if (patch.rateLimit !== undefined) g.rateLimit = patch.rateLimit;
    await this.meta.saveGatewayKeys();
    return g;
  }

  async removeGroup(id: string): Promise<void> {
    if (id === 'default') throw new Error(tr('默认密钥组不能删除'));
    this.meta.data.gatewayKeyGroups = this.groups().filter((g) => g.id !== id);
    this.meta.data.gatewayKeys = this.list().filter((k) => k.keyGroupId !== id);
    await this.meta.saveGatewayKeys();
  }

  async saveUsage(): Promise<void> { await this.meta.saveGatewayKeys(); }
}
