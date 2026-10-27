// Declarative sources: JSON files under <dataDir>/plugins/*.json. Data only — an endpoint, a protocol, how it
// authenticates, its models and their capabilities. Nothing in them is executed; unknown fields are dropped.
// The channels catalog reads what is enabled through `pluginSources()` (the hook: call it from the catalog
// projection and append the result; see docs/notes/plugins-sync-share.md).
// The signed remote catalog (spec §5.3) goes through the same validation and can only carry data.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SourceSummary } from '../channels/types.js';
import type { DeclarativeModel, DeclarativeSource, PluginAuth, PluginProtocol } from './protocol.js';

const PROTOCOLS: PluginProtocol[] = ['anthropic', 'openai', 'openai-responses', 'gemini'];
const AUTHS: PluginAuth[] = ['bearer', 'x-api-key', 'both', 'none'];
const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_FILE = 512 * 1024;

export interface DeclarativeFile { id: string; name: string; version?: string; description?: string; sources: DeclarativeSource[] }

const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

function privateHost(h: string): boolean {
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
}

/** A source URL: https, or http to this machine / a private address. Credentials in the URL are refused. */
export function checkEndpoint(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error(`bad endpoint: ${raw.slice(0, 80)}`); }
  if (u.username || u.password) throw new Error('endpoint must not carry credentials');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && privateHost(u.hostname))) throw new Error('endpoint must be https (http only for local / private hosts)');
  return u.toString().replace(/\/+$/, '');
}

function model(v: any): DeclarativeModel | null {
  const id = str(v?.id, 120);
  if (!id) return null;
  const caps = v?.capabilities ?? {};
  return {
    id,
    ...(str(v.name) ? { name: str(v.name) } : {}),
    ...(num(v.contextWindow) ? { contextWindow: num(v.contextWindow) } : {}),
    ...(num(v.maxOutput) ? { maxOutput: num(v.maxOutput) } : {}),
    capabilities: { tools: bool(caps.tools), images: bool(caps.images), reasoning: bool(caps.reasoning), stream: bool(caps.stream) },
    free: v.free === true,
    ...(v.mayTrain === true ? { mayTrain: true } : {}),
  };
}

/** One source, validated; throws on what cannot be used. */
export function parseSource(v: any): DeclarativeSource {
  const id = str(v?.id, 64);
  if (!id || !ID.test(id)) throw new Error('source id must be 1-64 of A-Z a-z 0-9 _ . -');
  const protocol = v.protocol as PluginProtocol;
  if (!PROTOCOLS.includes(protocol)) throw new Error(`source ${id}: protocol must be one of ${PROTOCOLS.join(', ')}`);
  const auth = (v.auth ?? 'bearer') as PluginAuth;
  if (!AUTHS.includes(auth)) throw new Error(`source ${id}: auth must be one of ${AUTHS.join(', ')}`);
  const models = (Array.isArray(v.models) ? v.models : []).map(model).filter(Boolean).slice(0, 500) as DeclarativeModel[];
  const cat = ['free', 'subscription', 'api', 'local-engine'].includes(v.category) ? v.category : undefined;
  return {
    id,
    name: str(v.name) ?? id,
    endpoint: checkEndpoint(String(v.endpoint ?? '')),
    protocol,
    auth,
    ...(str(v.secretName, 64) ? { secretName: str(v.secretName, 64) } : {}),
    ...(cat ? { category: cat } : {}),
    models,
    ...(str(v.docs, 300) ? { docs: str(v.docs, 300) } : {}),
  };
}

/** A whole file: `{ id, name, sources: [...] }`, or a single source object. */
export function parseDeclarative(text: string, fallbackId: string): DeclarativeFile {
  const v = JSON.parse(text);
  if (!v || typeof v !== 'object') throw new Error('not a JSON object');
  const list = Array.isArray(v.sources) ? v.sources : [v];
  const id = str(v.id, 64) && ID.test(String(v.id)) && Array.isArray(v.sources) ? String(v.id) : fallbackId;
  return {
    id,
    name: str(v.name) ?? id,
    ...(str(v.version, 40) ? { version: str(v.version, 40) } : {}),
    ...(str(v.description, 300) ? { description: str(v.description, 300) } : {}),
    sources: list.slice(0, 50).map(parseSource),
  };
}

export interface LoadedDeclarative { file: string; def?: DeclarativeFile; error?: string }

/** Every `*.json` directly under `dir` (folders are executable plugins). */
export async function loadDeclarativeDir(dir: string): Promise<LoadedDeclarative[]> {
  let names: string[];
  try { names = await fs.readdir(dir); } catch { return []; }
  const out: LoadedDeclarative[] = [];
  for (const n of names.sort()) {
    if (!n.endsWith('.json') || n.startsWith('.')) continue;
    const f = path.join(dir, n);
    try {
      const st = await fs.stat(f);
      if (!st.isFile()) continue;
      if (st.size > MAX_FILE) { out.push({ file: n, error: 'file too large' }); continue; }
      out.push({ file: n, def: parseDeclarative(await fs.readFile(f, 'utf8'), n.replace(/\.json$/, '')) });
    } catch (e) {
      out.push({ file: n, error: (e as Error).message });
    }
  }
  return out;
}

// ---- what the channels catalog reads ----

let enabledSources: { pluginId: string; source: DeclarativeSource }[] = [];

/** Set by PluginService whenever plugins load / are enabled / disabled. */
export function setPluginSources(list: { pluginId: string; source: DeclarativeSource }[]): void { enabledSources = list; }

/**
 * Sources from enabled plugins, shaped like the channels catalog's entries (ids `plugin:<plugin>/<source>`).
 * Data only: they carry no credential; the user fills the secret in when adding it as a provider.
 */
export function pluginSources(): SourceSummary[] {
  return enabledSources.map(({ pluginId, source: s }) => ({
    id: `plugin:${pluginId}/${s.id}`,
    kind: 'provider',
    name: s.name,
    category: s.category ?? (s.models.length && s.models.every((m) => m.free) ? 'free' : 'api'),
    health: 'unconfigured',
    detail: s.endpoint,
    models: s.models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
      capabilities: { tools: m.capabilities?.tools, images: m.capabilities?.images, reasoning: m.capabilities?.reasoning },
      free: !!m.free,
      ...(m.mayTrain ? { mayTrain: true } : {}),
    })),
    actions: { canAddAccount: false, canEditProvider: true, canManageEngine: false },
  }));
}

/** The raw definitions (for turning one into a provider). */
export function pluginSourceDefs(): { pluginId: string; source: DeclarativeSource }[] { return enabledSources; }

// ---- signed remote catalog (data only) ----

/**
 * Ed25519 public keys (PEM) the remote catalog is signed with. Empty until a key ships with a release: until then
 * nothing verifies and the remote layer stays off (the built-in baseline and live model lists still work).
 */
export const CATALOG_PUBLIC_KEYS: string[] = [];

export interface RemoteCatalog { version: number; issuedAt: number; sources: DeclarativeSource[] }

/**
 * Verify `body` (the exact bytes downloaded) against a base64 Ed25519 signature, then parse it as data. Anything
 * that is not a source definition is dropped; there is no field that could carry code.
 */
export function verifyRemoteCatalog(body: string, signatureB64: string, keys: string[] = CATALOG_PUBLIC_KEYS): RemoteCatalog {
  const sig = Buffer.from(signatureB64, 'base64');
  const ok = keys.some((pem) => {
    try { return crypto.verify(null, Buffer.from(body, 'utf8'), crypto.createPublicKey(pem), sig); } catch { return false; }
  });
  if (!ok) throw new Error('catalog signature does not verify');
  const v = JSON.parse(body);
  const sources = (Array.isArray(v?.sources) ? v.sources : []).flatMap((s: unknown) => { try { return [parseSource(s)]; } catch { return []; } });
  return { version: num(v?.version) ?? 0, issuedAt: num(v?.issuedAt) ?? 0, sources };
}

/**
 * Lay a verified remote catalog over the local one without touching what the user did: a source the user
 * edited, turned off or deleted stays as the user left it; only untouched entries are added or updated.
 */
export function mergeRemoteCatalog(
  local: DeclarativeSource[],
  remote: DeclarativeSource[],
  user: { edited: string[]; disabled: string[]; deleted: string[] },
): DeclarativeSource[] {
  const keep = new Set([...user.edited, ...user.disabled]);
  const gone = new Set(user.deleted);
  const out = new Map(local.map((s) => [s.id, s]));
  for (const r of remote) {
    if (gone.has(r.id) || keep.has(r.id)) continue;
    out.set(r.id, r);
  }
  return [...out.values()];
}
