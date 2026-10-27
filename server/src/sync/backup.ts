// Sync bundle (spec §8): source settings, account references, model mappings, privacy and routing rules.
// Not in it: process state (health, cooldowns, counters, sidecar ids, learned endpoint quirks), model-list caches,
// absolute paths. Credentials and privacy rules only travel inside the passphrase-encrypted part (crypto.ts).
import crypto from 'node:crypto';
import type { MetaStore } from '../meta/store.js';
import type { SecretService } from '../secrets/service.js';
import type { Provider } from '../protocol.js';
import type { GatewayGroup, GatewayKeyGroup } from '../gateway/types.js';
import type { UpstreamAccount } from '../upstreams/types.js';
import { open, seal, type SealedBox } from './crypto.js';
import { tr } from '../i18n/index.js';

export type SyncProvider = Omit<Provider, 'apiKey'> & { hasKey: boolean };
export interface SyncAccountRef {
  id: string;
  kind: UpstreamAccount['kind'];
  name: string;
  enabled: boolean;
  credentialKind: UpstreamAccount['credentialKind'];
  source: UpstreamAccount['source'];
  maxConcurrent?: number;
  dailyRequestLimit?: number;
  identity?: { email?: string; plan?: string };
  hasCredential: boolean;
}

export interface SyncPublic {
  providers: SyncProvider[];
  accounts: SyncAccountRef[];
  /** gateway route groups: members and model mappings */
  gatewayGroups: GatewayGroup[];
  /** what share keys may use (the keys themselves never travel: a key is minted per machine) */
  keyGroups: GatewayKeyGroup[];
  /** routing and model settings (`routing.*`, `models.*`) */
  settings: Record<string, unknown>;
}

export interface SyncSecret {
  providers: Record<string, string>;
  accounts: Record<string, { credential: string; proxy?: string }>;
  /** privacy rules travel encrypted (they name the things the user wants hidden) */
  privacy: Record<string, unknown>;
}

export interface SyncBundle {
  format: 'claude-web-sync';
  version: 1;
  createdAt: number;
  /** a hash of the exporting server's id (which device it came from, not who) */
  from: string;
  public: SyncPublic;
  secret?: SealedBox;
}

/** Fields of a provider that are this machine's learned / cached state, not settings. */
const PROVIDER_LOCAL = ['models', 'modelNames', 'modelEfforts', 'modelContext', 'modelsAt', 'modelsError', 'promptEffortModels', 'noPromptCacheKey', 'noResponsesApi', 'noCacheRetention'] as const;
const PUBLIC_SETTINGS = /^(routing|models)\./;
const PRIVATE_SETTINGS = /^privacy\./;

/** A string that is an absolute path on some OS (C:\…, \\server\…, /home/…, ~/…). */
export function looksLikePath(v: unknown): boolean {
  return typeof v === 'string' && (/^[A-Za-z]:[\\/]/.test(v) || /^\\\\/.test(v) || /^~[\\/]/.test(v) || /^\/(home|Users|root|var|etc|opt|tmp|mnt|usr)\//.test(v));
}

/** Drop absolute paths anywhere in a settings value. */
export function stripPaths(v: unknown): unknown {
  if (looksLikePath(v)) return undefined;
  if (Array.isArray(v)) return v.map(stripPaths).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { const y = stripPaths(x); if (y !== undefined) out[k] = y; }
    return out;
  }
  return v;
}

function pickSettings(all: Record<string, unknown>, re: RegExp): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all)) if (re.test(k)) { const y = stripPaths(v); if (y !== undefined) out[k] = y; }
  return out;
}

export function publicProvider(p: Provider): SyncProvider {
  const { apiKey, ...rest } = p;
  const out: any = { ...rest, hasKey: !!apiKey };
  for (const k of PROVIDER_LOCAL) delete out[k];
  return out as SyncProvider;
}

export function accountRef(a: UpstreamAccount): SyncAccountRef {
  return {
    id: a.id, kind: a.kind, name: a.name, enabled: a.enabled, credentialKind: a.credentialKind, source: a.source,
    ...(a.maxConcurrent ? { maxConcurrent: a.maxConcurrent } : {}),
    ...(a.dailyRequestLimit ? { dailyRequestLimit: a.dailyRequestLimit } : {}),
    ...(a.identity?.email || a.identity?.plan ? { identity: { email: a.identity.email, plan: a.identity.plan } } : {}),
    hasCredential: !!a.credential,
  };
}

export async function buildBundle(meta: MetaStore, secrets: SecretService | undefined, o: { passphrase?: string }): Promise<SyncBundle> {
  const reveal = async (v: string | undefined) => (v ? (secrets ? secrets.reveal(v) : v) : '');
  const settings = meta.settings() as Record<string, unknown>;
  const pub: SyncPublic = {
    providers: meta.providers().map(publicProvider),
    accounts: meta.upstreamAccounts().map(accountRef),
    gatewayGroups: JSON.parse(JSON.stringify(meta.data.gatewayGroups ?? [])),
    keyGroups: JSON.parse(JSON.stringify(meta.gatewayKeyGroups())),
    settings: pickSettings(settings, PUBLIC_SETTINGS),
  };
  const bundle: SyncBundle = {
    format: 'claude-web-sync', version: 1, createdAt: Date.now(),
    from: crypto.createHash('sha256').update(await meta.serverId()).digest('hex').slice(0, 12),
    public: pub,
  };
  if (o.passphrase) {
    const sec: SyncSecret = { providers: {}, accounts: {}, privacy: pickSettings(settings, PRIVATE_SETTINGS) };
    for (const p of meta.providers()) if (p.apiKey) sec.providers[p.id] = await reveal(p.apiKey);
    for (const a of meta.upstreamAccounts()) {
      if (!a.credential) continue;
      sec.accounts[a.id] = { credential: await reveal(a.credential), ...(a.proxy ? { proxy: await reveal(a.proxy) } : {}) };
    }
    bundle.secret = await seal(JSON.stringify(sec), o.passphrase);
  }
  return bundle;
}

export function parseBundle(text: string): SyncBundle {
  let v: any;
  try { v = JSON.parse(text); } catch { throw new Error(tr('不是同步文件')); }
  if (v?.format !== 'claude-web-sync' || v.version !== 1 || !v.public) throw new Error(tr('不是同步文件'));
  const pub = v.public;
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  return {
    format: 'claude-web-sync', version: 1, createdAt: Number(v.createdAt) || 0, from: String(v.from ?? ''),
    public: {
      providers: arr(pub.providers).filter((p: any) => p && typeof p.id === 'string'),
      accounts: arr(pub.accounts).filter((a: any) => a && typeof a.id === 'string'),
      gatewayGroups: arr(pub.gatewayGroups).filter((g: any) => g && typeof g.id === 'string'),
      keyGroups: arr(pub.keyGroups).filter((g: any) => g && typeof g.id === 'string'),
      settings: pub.settings && typeof pub.settings === 'object' ? (stripPaths(pub.settings) as Record<string, unknown>) : {},
    },
    ...(v.secret ? { secret: v.secret as SealedBox } : {}),
  };
}

export async function openSecret(b: SyncBundle, passphrase?: string): Promise<SyncSecret | null> {
  if (!b.secret) return null;
  if (!passphrase) throw new Error(tr('这个文件带着加密的密钥，要输入导出时的口令'));
  const v = JSON.parse(await open(b.secret, passphrase));
  return { providers: v.providers ?? {}, accounts: v.accounts ?? {}, privacy: v.privacy ?? {} };
}
