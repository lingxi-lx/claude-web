// Egress guard (port of Magpie internal/netguard): where a server-side fetch of a URL the *user* (or a file /
// catalog the user loaded) supplied may connect. The address, not the name, is judged: every DNS answer is checked
// before the request, and a direct connection checks the address it actually dials (undici `connect.lookup`), so a
// name that answers public first and 127.0.0.1 next (DNS rebinding) is refused at connect time.
//
// Policies:
//  - 'public'  — the open internet only (plugin market / packages, the signed remote catalog);
//  - 'lan'     — also private ranges (RFC 1918, fc00::/7, CGNAT/Tailscale): a NAS WebDAV, a MinIO on the LAN;
//  - 'local'   — also loopback: for features that exist to reach a service on this machine (a local OTLP
//                collector, a local S3 / WebDAV, an Ollama-style source).
// Never allowed, whatever the policy: link-local (169.254.0.0/16 — cloud metadata 169.254.169.254 — and fe80::/10),
// unspecified, multicast, broadcast / reserved, documentation, benchmarking-that-is-not-fake-IP, Teredo, and the
// IPv4-in-IPv6 forms (mapped, NAT64, 6to4) of anything refused.
//
// Through a proxy (network.proxy) the proxy resolves the name: the pre-check of the name's answers still runs, the
// connect-time check cannot — the same trade Magpie makes ("hand a proxy the name").
import dns from 'node:dns';
import net from 'node:net';
import { Agent, type Dispatcher } from 'undici';
import { proxy } from './proxy.js';
import { tr } from '../i18n/index.js';

export type EgressPolicy = 'public' | 'lan' | 'local';

export type AddressClass =
  | 'public' | 'fake-ip' | 'private' | 'loopback'
  // never fetched
  | 'link-local' | 'metadata' | 'unspecified' | 'multicast' | 'reserved' | 'invalid';

// ---- address arithmetic -------------------------------------------------------------------------------------

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((a, o) => ((a << 8) + Number(o)) >>> 0, 0) >>> 0;
}
function inV4(ip: number, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
}

/** An IPv6 literal → 16 bytes (null when it is not one). Handles `::`, an embedded IPv4 tail and a zone id. */
export function v6Bytes(raw: string): Uint8Array | null {
  let s = raw.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (!net.isIPv6(s)) return null;
  let tail: number[] = [];
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) {
    const n = v4ToInt(m[2]);
    tail = [(n >>> 16) & 0xffff, n & 0xffff];
    s = m[1].endsWith('::') ? m[1] : m[1].slice(0, -1);
  }
  const [head, rest] = s.includes('::') ? s.split('::') : [s, undefined];
  const hp = head ? head.split(':').filter((x) => x !== '') : [];
  const rp = rest !== undefined && rest ? rest.split(':').filter((x) => x !== '') : [];
  const groups = [...hp.map((x) => parseInt(x, 16))];
  const fill = 8 - hp.length - rp.length - tail.length;
  if (rest !== undefined) for (let i = 0; i < fill; i++) groups.push(0);
  groups.push(...rp.map((x) => parseInt(x, 16)), ...tail);
  if (groups.length !== 8 || groups.some((g) => !Number.isFinite(g) || g < 0 || g > 0xffff)) return null;
  const out = new Uint8Array(16);
  groups.forEach((g, i) => { out[i * 2] = g >> 8; out[i * 2 + 1] = g & 0xff; });
  return out;
}

function inV6(b: Uint8Array, prefix: number[], bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const byte = i >> 3;
    const bit = 7 - (i & 7);
    if (((b[byte] >> bit) & 1) !== (((prefix[byte] ?? 0) >> bit) & 1)) return false;
  }
  return true;
}
const p6 = (s: string): number[] => Array.from(v6Bytes(s)!);

const V4_RULES: [string, number, AddressClass][] = [
  ['169.254.169.254', 32, 'metadata'],
  ['100.100.100.200', 32, 'metadata'], // Alibaba Cloud metadata
  ['0.0.0.0', 8, 'unspecified'],
  ['127.0.0.0', 8, 'loopback'],
  ['10.0.0.0', 8, 'private'],
  ['172.16.0.0', 12, 'private'],
  ['192.168.0.0', 16, 'private'],
  ['100.64.0.0', 10, 'private'], // CGNAT / Tailscale
  ['169.254.0.0', 16, 'link-local'],
  ['192.0.0.0', 24, 'reserved'],
  ['192.0.2.0', 24, 'reserved'],
  ['198.51.100.0', 24, 'reserved'],
  ['203.0.113.0', 24, 'reserved'],
  ['198.18.0.0', 15, 'fake-ip'], // benchmarking; where Clash / Surge / Loon fake-ip resolvers answer
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'], // incl. 255.255.255.255
];

/** What kind of address this is (IPv4 or IPv6 literal). */
export function classifyAddress(ip: string): AddressClass {
  const host = ip.replace(/^\[|\]$/g, '');
  if (net.isIPv4(host)) {
    const n = v4ToInt(host);
    for (const [base, bits, cls] of V4_RULES) if (inV4(n, base, bits)) return cls;
    return 'public';
  }
  const b = v6Bytes(host);
  if (!b) return 'invalid';
  const v4 = (o: number) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
  if (b.every((x) => x === 0)) return 'unspecified';
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return 'loopback';
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible) are that IPv4 address
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) return classifyAddress(v4(12));
  if (inV6(b, p6('::'), 96)) return 'reserved';
  if (inV6(b, p6('64:ff9b::'), 96)) return classifyAddress(v4(12)); // NAT64
  if (inV6(b, p6('64:ff9b:1::'), 48)) return 'private'; // local-use NAT64
  if (inV6(b, p6('2002::'), 16)) return classifyAddress(v4(2)); // 6to4
  if (inV6(b, p6('fd00:ec2::254'), 128)) return 'metadata'; // AWS IMDS over IPv6
  if (inV6(b, p6('fe80::'), 10)) return 'link-local';
  if (inV6(b, p6('fec0::'), 10)) return 'private'; // site-local (deprecated)
  if (inV6(b, p6('fc00::'), 7)) return 'private'; // ULA (fd00::/8 among it)
  if (inV6(b, p6('ff00::'), 8)) return 'multicast';
  if (inV6(b, p6('100::'), 64)) return 'reserved'; // discard
  if (inV6(b, p6('2001:db8::'), 32)) return 'reserved'; // documentation
  if (inV6(b, p6('2001::'), 32)) return 'reserved'; // Teredo
  return 'public';
}

/** Whether `policy` lets a request connect to an address of this class. */
export function classAllowed(cls: AddressClass, policy: EgressPolicy): boolean {
  switch (cls) {
    case 'public':
    case 'fake-ip': // a fake-IP answer stands for the internet host the name names (the resolver carries it there)
      return true;
    case 'private': return policy === 'lan' || policy === 'local';
    case 'loopback': return policy === 'local';
    default: return false;
  }
}

export function addressAllowed(ip: string, policy: EgressPolicy): boolean {
  return classAllowed(classifyAddress(ip), policy);
}

export class EgressError extends Error {
  readonly code = 'EGRESS_DENIED';
  constructor(message: string, readonly cls?: AddressClass) { super(message); this.name = 'EgressError'; }
}

function refusal(host: string, cls: AddressClass, policy: EgressPolicy): EgressError {
  if (cls === 'metadata' || cls === 'link-local') return new EgressError(tr('不能访问 {host}：这是本机的链路本地 / 云元数据地址', { host }), cls);
  if (cls === 'loopback') return new EgressError(tr('不能访问 {host}：这个功能不允许连本机地址', { host }), cls);
  if (cls === 'private') return new EgressError(tr('不能访问 {host}：这个功能只能连公网地址', { host }), cls);
  void policy;
  return new EgressError(tr('不能访问 {host}：这个地址不能用', { host }), cls);
}

// ---- names --------------------------------------------------------------------------------------------------

export type LookupAll = (host: string) => Promise<{ address: string; family: number }[]>;
const systemLookup: LookupAll = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

export interface GuardOptions {
  policy: EgressPolicy;
  /** tests inject a resolver */
  lookup?: LookupAll;
  /** schemes allowed (default http + https) */
  protocols?: string[];
}

const hostOf = (u: URL) => u.hostname.replace(/^\[|\]$/g, '').toLowerCase();

/**
 * Check a URL before fetching it: scheme, no credentials in it, and every address its name resolves to.
 * Names under `.localhost` / `localhost` are loopback without asking DNS. Throws EgressError (a showable sentence).
 */
export async function checkUrl(raw: string | URL, o: GuardOptions): Promise<URL> {
  let u: URL;
  try { u = typeof raw === 'string' ? new URL(raw) : new URL(raw.toString()); } catch { throw new EgressError(tr('地址不合法')); }
  const protocols = o.protocols ?? ['http:', 'https:'];
  if (!protocols.includes(u.protocol)) throw new EgressError(tr('地址必须是 {protocols}', { protocols: protocols.map((p) => p.replace(':', '')).join(' / ') }));
  if (u.username || u.password) throw new EgressError(tr('地址里不能带账号密码'));
  const host = hostOf(u);
  if (!host) throw new EgressError(tr('地址不合法'));
  if (net.isIP(host)) {
    const cls = classifyAddress(host);
    if (!classAllowed(cls, o.policy)) throw refusal(host, cls, o.policy);
    return u;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    if (!classAllowed('loopback', o.policy)) throw refusal(host, 'loopback', o.policy);
    return u;
  }
  let answers: { address: string; family: number }[];
  try { answers = await (o.lookup ?? systemLookup)(host); } catch { throw new EgressError(tr('找不到主机 {host}', { host })); }
  if (!answers.length) throw new EgressError(tr('找不到主机 {host}', { host }));
  for (const a of answers) {
    const cls = classifyAddress(a.address);
    if (!classAllowed(cls, o.policy)) throw refusal(host, cls, o.policy);
  }
  return u;
}

// ---- the guarded fetch ----------------------------------------------------------------------------------------

const agents = new Map<EgressPolicy, Agent>();

/** A direct dispatcher whose every connection checks the address it dials (the DNS-rebinding half). */
export function guardedAgent(policy: EgressPolicy, lookup?: LookupAll): Agent {
  const make = () => new Agent({
    connect: {
      lookup(hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
        const all = (lookup ?? systemLookup)(hostname);
        all.then((list) => {
          const bad = list.find((a) => !addressAllowed(a.address, policy));
          if (bad) return cb(refusal(hostname, classifyAddress(bad.address), policy) as unknown as NodeJS.ErrnoException, '', 0);
          if (!list.length) return cb(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), '', 0);
          if (options?.all) return cb(null, list.map((a) => ({ address: a.address, family: a.family })));
          return cb(null, list[0].address, list[0].family);
        }, (e) => cb(e as NodeJS.ErrnoException, '', 0));
      },
    },
  });
  if (lookup) return make();
  let a = agents.get(policy);
  if (!a) { a = make(); agents.set(policy, a); }
  return a;
}

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface GuardedFetchOptions extends GuardOptions {
  /** the fetch to call (tests inject one); default the process fetch with a connect-time guard when direct */
  fetch?: FetchFn;
  /** redirects followed when the caller did not ask for `redirect: 'manual'` (each hop checked again) */
  maxRedirects?: number;
}

// a hop to another origin keeps only these: any other header may be a credential (x-api-key, x-amz-security-token,
// an OTLP collector's custom auth header)
const CROSS_ORIGIN_SAFE = new Set(['accept', 'accept-encoding', 'accept-language', 'content-type', 'user-agent']);

function withoutCredentials(h: RequestInit['headers']): Headers {
  const out = new Headers(h);
  for (const k of [...out.keys()]) if (!CROSS_ORIGIN_SAFE.has(k.toLowerCase())) out.delete(k);
  return out;
}

/**
 * `fetch` for a URL someone else chose. The URL and every redirect hop are checked; a direct connection is pinned to
 * checked addresses. A caller passing `redirect: 'manual'` gets the 3xx back as usual (and checks the next hop by
 * calling this again).
 */
export function guardedFetch(o: GuardedFetchOptions): FetchFn {
  return async (input, init = {}) => {
    const first = input;
    const manual = init.redirect === 'manual' || init.redirect === 'error';
    let url = await checkUrl(first, o);
    const max = o.maxRedirects ?? 5;
    for (let hop = 0; ; hop++) {
      const extra: Record<string, unknown> = {};
      // the injected fetch (tests, a caller's own) is used as given; the process fetch gets the guarded dispatcher
      // unless the proxy carries this origin (then the proxy resolves the name, already pre-checked above)
      if (!o.fetch && !proxy.proxiedFor(url)) extra.dispatcher = guardedAgent(o.policy, o.lookup) as unknown as Dispatcher;
      const f: FetchFn = o.fetch ?? ((i, n) => fetch(i, n));
      const res = await f(url, { ...init, ...extra, redirect: 'manual' } as RequestInit);
      if (manual || res.status < 300 || res.status >= 400 || res.status === 304) return res;
      const loc = res.headers.get('location');
      if (!loc) return res;
      if (hop >= max) throw new EgressError(tr('重定向次数太多'));
      try { await res.body?.cancel(); } catch { /* already done */ }
      const from = new URL(url).origin;
      url = await checkUrl(new URL(loc, url), o);
      // like fetch's own redirect handling: credentials never follow a hop to another origin
      if (new URL(url).origin !== from) init = { ...init, headers: withoutCredentials(init.headers) };
      // a 303 (and the 301 / 302 of a POST, as browsers do) turns into a GET without a body
      const method = String(init.method ?? 'GET').toUpperCase();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) init = { ...init, method: 'GET', body: undefined };
    }
  };
}
