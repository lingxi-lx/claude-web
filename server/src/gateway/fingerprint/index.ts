// 客户端指纹 (client fingerprint), opt-in per source: the gateway's requests to a provider / account look like the
// official CLI's — User-Agent and identity headers, header order and casing, top-level JSON key order, and the TLS
// ClientHello (the tlsfp helper's uTLS when it is built, else Node's TLS options as close as OpenSSL gets).
//
// Settings (meta.json, `settings.set`):
//   gateway.fingerprint      { [providerOrAccountId | '*']: 'off' | 'auto' | 'claude-code' | 'codex' | 'gemini-cli' }
//                            — missing / 'off' = nothing changes (the default)
//   gateway.fingerprint.tls  'auto' (helper when present, else Node) | 'node' | 'off' (headers / body only)
import type http from 'node:http';
import { proxy as processProxy, proxyAgentFor } from '../../net/proxy.js';
import { accountProxyAgent } from '../../upstreams/proxy.js';
import type { Outbound } from '../convert.js';
import { directAgent, HelperAgent, ShapedAgent, tlsOptions } from './agent.js';
import { helper } from './helper.js';
import { autoProfile, PROFILE_IDS, PROFILES, type Profile, type ProfileId } from './profiles.js';
import { shapeBody, shapeHeaders } from './shape.js';

export { PROFILES, PROFILE_IDS, autoProfile, type Profile, type ProfileId } from './profiles.js';
export { orderPairs, reorderTopLevel, shapeBody, shapeHeaders } from './shape.js';
export { helper as tlsfpHelper, findHelper } from './helper.js';

export const FINGERPRINT_KEY = 'gateway.fingerprint';
export const FINGERPRINT_TLS_KEY = 'gateway.fingerprint.tls';

export type FingerprintChoice = 'off' | 'auto' | ProfileId;
export type TlsMode = 'auto' | 'node' | 'off';

/** What the user chose for this source: its own entry, else the '*' entry, else off. */
export function fingerprintChoice(settings: Record<string, unknown>, id: string): FingerprintChoice {
  const map = settings[FINGERPRINT_KEY];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return 'off';
  const m = map as Record<string, unknown>;
  const v = Object.prototype.hasOwnProperty.call(m, id) ? m[id] : m['*'];
  return v === 'auto' || (typeof v === 'string' && (PROFILE_IDS as readonly string[]).includes(v)) ? (v as FingerprintChoice) : 'off';
}

export function tlsMode(settings: Record<string, unknown>): TlsMode {
  const v = settings[FINGERPRINT_TLS_KEY];
  return v === 'node' || v === 'off' ? v : 'auto';
}

/** The fields of a gateway target this looks at. */
export interface FingerprintTarget { id: string; protocol?: string; chatPath?: string }

export function resolveProfile(settings: Record<string, unknown>, target: FingerprintTarget, outbound: Outbound): Profile | null {
  const choice = fingerprintChoice(settings, target.id);
  if (choice === 'off') return null;
  const id = choice === 'auto' ? autoProfile(outbound, target) : choice;
  return id ? PROFILES[id] : null;
}

export interface ClientFingerprint {
  profile: Profile;
  /** headers / body are shaped only when the profile speaks this request's protocol (TLS is shaped regardless) */
  shapes: boolean;
  headers(h: Record<string, string>): Record<string, string>;
  body<T extends Buffer | null>(b: T): T;
  /** sendUpstream's agentFor: the profile's wire shape over direct / the process proxy / the account's `proxy` */
  agentFor(accountProxy?: string): (u: URL) => http.Agent | undefined;
}

const shaped = new Map<string, ShapedAgent>(); // wrappers over helper agents
const helpers = new Map<string, HelperAgent>();
const SHAPED_MAX = 64;

function remember<T>(map: Map<string, T>, key: string, make: () => T): T {
  let v = map.get(key);
  if (!v) {
    if (map.size >= SHAPED_MAX) map.delete(map.keys().next().value as string);
    v = make();
    map.set(key, v);
  }
  return v;
}

/** The agent for one request to `u` (exported for tests). */
export function fingerprintAgent(profile: Profile, u: URL, opts: { accountProxy?: string; tls: TlsMode; helperEndpoint?: () => { port: number; token: string } | null }): http.Agent {
  const https = u.protocol === 'https:';
  const proxyUrl = opts.accountProxy ?? (proxyAgentFor(u) ? processProxy.url : null);
  const inner = (opts.accountProxy ? accountProxyAgent(opts.accountProxy) : undefined) ?? proxyAgentFor(u) ?? directAgent(u.protocol);
  const endpoint = opts.helperEndpoint ?? (() => helper.endpoint());
  // the helper speaks http / socks5 proxies; socks4 stays with Node
  const viaHelper = https && profile.helper && opts.tls === 'auto' && !/^socks4/i.test(proxyUrl ?? '') && endpoint() !== null;
  if (viaHelper) {
    if (opts.helperEndpoint) return new ShapedAgent(new HelperAgent(endpoint, profile.id, proxyUrl), null, profile.headerOrder, 'https:');
    const h = remember(helpers, `${profile.id}|${proxyUrl ?? ''}`, () => new HelperAgent(endpoint, profile.id, proxyUrl));
    return remember(shaped, `helper|${profile.id}|${proxyUrl ?? ''}`, () => new ShapedAgent(h, null, profile.headerOrder, 'https:'));
  }
  const tls = https && opts.tls !== 'off' ? tlsOptions(profile.tls) : null;
  // kept per inner agent: a changed process proxy hands out a new one, and its wrappers go with it
  let m = byInner.get(inner);
  if (!m) byInner.set(inner, (m = new Map()));
  return remember(m, `${profile.id}|${u.protocol}|${tls ? 'tls' : 'plain'}`, () => new ShapedAgent(inner, tls, profile.headerOrder, https ? 'https:' : 'http:'));
}
const byInner = new WeakMap<http.Agent, Map<string, ShapedAgent>>();

/**
 * The fingerprint for one gateway attempt, or null when the source has none (the default: then nothing about the
 * request changes). `path` is the upstream path (count_tokens has its own header order).
 */
export function clientFingerprint(settings: Record<string, unknown>, target: FingerprintTarget, ctx: { outbound: Outbound; path: string; stream?: boolean }): ClientFingerprint | null {
  const profile = resolveProfile(settings, target, ctx.outbound);
  if (!profile) return null;
  const shapes = profile.outbounds.includes(ctx.outbound);
  const tls = tlsMode(settings);
  const path = ctx.path.split('?')[0];
  return {
    profile,
    shapes,
    headers: (h) => (shapes ? shapeHeaders(profile, h, { path, stream: !!ctx.stream }) : h),
    body: (b) => (shapes ? shapeBody(profile, b) : b),
    agentFor: (accountProxy) => (u: URL) => fingerprintAgent(profile, u, { accountProxy, tls }),
  };
}
