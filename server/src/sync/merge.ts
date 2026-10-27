// Merging a sync bundle into this machine, item by item (spec §8: never "last write wins" over all credentials).
//  - settings, route groups, key groups: per key / per field; what is only here stays.
//  - a provider / account whose credential differs on both sides is a conflict: both are kept (the incoming one
//    as a copy named 「…（同步）」), nothing is overwritten.
// `planMerge` only reads; `applyMerge` writes what the user kept in the preview.
import crypto from 'node:crypto';
import type { MetaStore } from '../meta/store.js';
import type { SecretService } from '../secrets/service.js';
import type { Provider } from '../protocol.js';
import type { UpstreamAccount } from '../upstreams/types.js';
import { filterSettings, isPrivateSetting, isPublicSetting, type SyncBundle, type SyncProvider, type SyncSecret } from './backup.js';
import { tr } from '../i18n/index.js';
import type { SyncPlanItem } from './types.js';
export type { SyncCollection, SyncPlanItem } from './types.js';

const IGNORE = new Set(['createdAt', 'updatedAt', 'hasKey', 'hasCredential', 'id']);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function diffFields(local: Record<string, any>, incoming: Record<string, any>): string[] {
  return Object.keys(incoming).filter((k) => !IGNORE.has(k) && !same(local[k], incoming[k]));
}

/** The settings an import may write: clear-part keys must be public ones, encrypted-part keys private ones
 *  (re-checked here, not only in parseBundle / openSecret, so a hand-built bundle cannot widen it). */
function incomingSettings(b: SyncBundle, sec: SyncSecret | null): Record<string, unknown> {
  return { ...filterSettings(b.public.settings, isPublicSetting), ...filterSettings(sec?.privacy, isPrivateSetting) };
}

async function reveal(secrets: SecretService | undefined, v: string | undefined): Promise<string> {
  if (!v) return '';
  return secrets ? secrets.reveal(v).catch(() => '') : v;
}

export async function planMerge(meta: MetaStore, secrets: SecretService | undefined, b: SyncBundle, sec: SyncSecret | null): Promise<SyncPlanItem[]> {
  const out: SyncPlanItem[] = [];
  for (const p of b.public.providers) {
    const local = meta.provider(p.id);
    const key = sec?.providers[p.id];
    if (!local) { out.push({ key: `provider:${p.id}`, collection: 'provider', id: p.id, name: p.name, action: 'add', withSecret: !!key }); continue; }
    const localKey = await reveal(secrets, local.apiKey);
    const fields = diffFields(local as any, p as any);
    if (key && localKey && key !== localKey) {
      out.push({ key: `provider:${p.id}`, collection: 'provider', id: p.id, name: p.name, action: 'conflict', withSecret: true, note: tr('两边的密钥不同：都保留，传入的另存为「{name}（同步）」', { name: p.name }) });
      continue;
    }
    const fillsKey = !!key && !localKey;
    out.push({ key: `provider:${p.id}`, collection: 'provider', id: p.id, name: p.name, action: fields.length || fillsKey ? 'update' : 'same', ...(fields.length ? { fields } : {}), withSecret: fillsKey });
  }
  const accounts = meta.upstreamAccounts();
  for (const a of b.public.accounts) {
    const local = accounts.find((x) => x.id === a.id);
    const cred = sec?.accounts[a.id]?.credential;
    if (!local) {
      out.push(cred
        ? { key: `account:${a.id}`, collection: 'account', id: a.id, name: a.name, action: 'add', withSecret: true }
        : { key: `account:${a.id}`, collection: 'account', id: a.id, name: a.name, action: 'skip', note: tr('文件里没有这个账号的凭据（导出时没设口令）') });
      continue;
    }
    const localCred = await reveal(secrets, local.credential);
    if (cred && localCred && cred !== localCred) {
      out.push({ key: `account:${a.id}`, collection: 'account', id: a.id, name: a.name, action: 'conflict', withSecret: true, note: tr('两边的凭据不同：都保留，传入的另存为「{name}（同步）」', { name: a.name }) });
      continue;
    }
    const fields = diffFields(local as any, { name: a.name, enabled: a.enabled, maxConcurrent: a.maxConcurrent, dailyRequestLimit: a.dailyRequestLimit });
    out.push({ key: `account:${a.id}`, collection: 'account', id: a.id, name: a.name, action: fields.length ? 'update' : 'same', ...(fields.length ? { fields } : {}) });
  }
  const groups = meta.data.gatewayGroups ?? [];
  for (const g of b.public.gatewayGroups) {
    const local = groups.find((x) => x.id === g.id);
    const fields = local ? diffFields(local as any, g as any) : [];
    out.push({ key: `gatewayGroup:${g.id}`, collection: 'gatewayGroup', id: g.id, name: g.name, action: !local ? 'add' : fields.length ? 'update' : 'same', ...(fields.length ? { fields } : {}) });
  }
  for (const g of b.public.keyGroups) {
    const local = meta.gatewayKeyGroups().find((x) => x.id === g.id);
    const fields = local ? diffFields(local as any, g as any) : [];
    out.push({ key: `keyGroup:${g.id}`, collection: 'keyGroup', id: g.id, name: g.name, action: !local ? 'add' : fields.length ? 'update' : 'same', ...(fields.length ? { fields } : {}) });
  }
  const settings = meta.settings() as Record<string, unknown>;
  for (const [k, v] of Object.entries(incomingSettings(b, sec))) {
    out.push({ key: `setting:${k}`, collection: 'setting', id: k, name: k, action: !(k in settings) ? 'add' : same(settings[k], v) ? 'same' : 'update' });
  }
  return out;
}

const copyId = () => crypto.randomBytes(4).toString('hex');

export async function applyMerge(meta: MetaStore, secrets: SecretService | undefined, b: SyncBundle, sec: SyncSecret | null, plan: SyncPlanItem[], skip: string[] = []): Promise<{ applied: number; conflicts: number }> {
  const skipped = new Set(skip);
  const protect = async (plain: string, id: string) => (secrets ? secrets.protect(plain, id) : plain);
  let applied = 0;
  let conflicts = 0;
  let touchedUpstreams = false;
  let touchedKeys = false;
  let touchedGateway = false;
  for (const it of plan) {
    if (skipped.has(it.key) || it.action === 'same' || it.action === 'skip') continue;
    if (it.collection === 'provider') {
      const p = b.public.providers.find((x) => x.id === it.id) as SyncProvider;
      const { hasKey: _h, createdAt: _c, ...rest } = p;
      const key = sec?.providers[it.id];
      if (it.action === 'conflict') {
        await meta.upsertProvider({ ...rest, id: `${it.id}-${copyId()}`, name: tr('{name}（同步）', { name: p.name }), ...(key ? { apiKey: key } : {}) } as Partial<Provider>);
        conflicts++;
      } else {
        const local = meta.provider(it.id);
        const patch: Partial<Provider> = { id: it.id };
        if (!local) Object.assign(patch, rest);
        else for (const f of it.fields ?? []) (patch as any)[f] = (rest as any)[f];
        if (key && (!local || !local.apiKey)) patch.apiKey = key;
        await meta.upsertProvider(patch);
      }
      applied++;
    } else if (it.collection === 'account') {
      const a = b.public.accounts.find((x) => x.id === it.id)!;
      const s = sec?.accounts[it.id];
      const list = meta.upstreamAccounts();
      const local = list.find((x) => x.id === it.id);
      if (it.action === 'add' || it.action === 'conflict') {
        if (!s) continue;
        const id = it.action === 'add' ? it.id : `${it.id}-${copyId()}`;
        const now = Date.now();
        const acc: UpstreamAccount = {
          id, kind: a.kind, name: it.action === 'add' ? a.name : tr('{name}（同步）', { name: a.name }), enabled: a.enabled,
          credential: await protect(s.credential, `upstream:${id}`), credentialKind: a.credentialKind, source: a.source ?? 'paste',
          ...(s.proxy ? { proxy: await protect(s.proxy, `upstream-proxy:${id}`) } : {}),
          ...(a.maxConcurrent ? { maxConcurrent: a.maxConcurrent } : {}),
          ...(a.dailyRequestLimit ? { dailyRequestLimit: a.dailyRequestLimit } : {}),
          ...(a.identity ? { identity: a.identity } : {}),
          createdAt: now, updatedAt: now, health: 'unknown',
        };
        list.push(acc);
        if (it.action === 'conflict') conflicts++;
      } else if (local) {
        for (const f of it.fields ?? []) (local as any)[f] = (a as any)[f];
        local.updatedAt = Date.now();
      }
      touchedUpstreams = true;
      applied++;
    } else if (it.collection === 'gatewayGroup') {
      const g = b.public.gatewayGroups.find((x) => x.id === it.id)!;
      const list = (meta.data.gatewayGroups ??= []);
      const i = list.findIndex((x) => x.id === it.id);
      if (i < 0) list.push(g);
      else for (const f of it.fields ?? []) (list[i] as any)[f] = (g as any)[f];
      touchedGateway = true;
      applied++;
    } else if (it.collection === 'keyGroup') {
      const g = b.public.keyGroups.find((x) => x.id === it.id)!;
      const list = meta.gatewayKeyGroups();
      const i = list.findIndex((x) => x.id === it.id);
      if (i < 0) list.push(g);
      else for (const f of it.fields ?? []) (list[i] as any)[f] = (g as any)[f];
      touchedKeys = true;
      applied++;
    } else if (it.collection === 'setting') {
      const all = incomingSettings(b, sec);
      if (!Object.prototype.hasOwnProperty.call(all, it.id)) continue;
      await meta.setSetting(it.id, all[it.id]);
      applied++;
    }
  }
  if (touchedUpstreams) await meta.saveUpstreams();
  if (touchedKeys) await meta.saveGatewayKeys();
  if (touchedGateway) await meta.saveGateway();
  return { applied, conflicts };
}
