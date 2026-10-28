// WebDAV backend (spec §7.9): PUT with If-Match / If-None-Match, GET, and the server's native LOCK / UNLOCK.
// All requests go through the injected fetch; credentials are separate options, never put in the URL.
import type { FetchLike, GetResult, LockHandle, PutOptions, PutResult, SyncBackend } from './types.js';
import { bytesOf, DEFAULT_LOCK_TTL_MS, encodeKeyPath, signalFor, SyncConflictError, SyncHttpError, utf8 } from './types.js';
import { tr } from '../../i18n/index.js';

export interface WebDavOptions {
  /** folder URL, e.g. `https://dav.example.com/claude-web/` */
  baseUrl: string;
  username?: string;
  password?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** extra headers (e.g. a reverse proxy token); never used for Authorization */
  headers?: Record<string, string>;
}

const xmlEscape = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));

function cleanToken(raw: string | null): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  return t.replace(/^</, '').replace(/>$/, '');
}

export class WebDavBackend implements SyncBackend {
  readonly kind = 'webdav' as const;
  private readonly base: string;
  private readonly auth?: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs?: number;
  private readonly extra: Record<string, string>;

  constructor(opts: WebDavOptions) {
    let u: URL;
    try { u = new URL(String(opts.baseUrl ?? '')); } catch { throw new Error(tr('WebDAV 地址不合法')); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(tr('WebDAV 地址必须是 http 或 https'));
    if (u.username || u.password) throw new Error(tr('WebDAV 账号请单独填写，不要写进地址'));
    if (u.search || u.hash) throw new Error(tr('WebDAV 地址不能带参数'));
    this.base = u.toString().replace(/\/*$/, '/');
    this.auth = opts.username !== undefined || opts.password !== undefined
      ? `Basic ${Buffer.from(`${opts.username ?? ''}:${opts.password ?? ''}`).toString('base64')}`
      : undefined;
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs;
    this.extra = { ...(opts.headers ?? {}) };
  }

  private url(key: string): string {
    return new URL(encodeKeyPath(key), this.base).toString();
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const out: Record<string, string> = { ...this.extra };
    if (this.auth) out.authorization = this.auth;
    for (const [k, v] of Object.entries(extra)) out[k.toLowerCase()] = v;
    return out;
  }

  private request(method: string, key: string, init: { headers?: Record<string, string>; body?: Uint8Array } = {}): Promise<Response> {
    return this.fetchImpl(this.url(key), {
      method,
      headers: this.headers(init.headers),
      ...(init.body ? { body: init.body as unknown as BodyInit } : {}),
      signal: signalFor(this.timeoutMs),
    });
  }

  async put(key: string, data: Uint8Array | string, opts: PutOptions = {}): Promise<PutResult> {
    const headers: Record<string, string> = { 'content-type': opts.contentType ?? 'application/octet-stream' };
    if (opts.ifMatch) headers['if-match'] = opts.ifMatch;
    if (opts.ifNoneMatch) headers['if-none-match'] = '*';
    const res = await this.request('PUT', key, { headers, body: typeof data === 'string' ? utf8(data) : data });
    if (res.status === 412 || res.status === 409) throw new SyncConflictError();
    if (res.status !== 200 && res.status !== 201 && res.status !== 204) throw new SyncHttpError(res.status, await res.text().catch(() => ''));
    const etag = res.headers.get('etag') ?? undefined;
    return { ...(etag ? { etag, version: etag } : {}) };
  }

  async get(key: string): Promise<GetResult | null> {
    const res = await this.request('GET', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new SyncHttpError(res.status, await res.text().catch(() => ''));
    const etag = res.headers.get('etag') ?? undefined;
    return { data: await bytesOf(res), ...(etag ? { etag, version: etag } : {}) };
  }

  async lock(key: string, owner = 'claude-web', ttlMs = DEFAULT_LOCK_TTL_MS): Promise<LockHandle | null> {
    const ttl = Math.max(30_000, Math.min(ttlMs, 24 * 60 * 60_000));
    const body = new TextEncoder().encode(
      '<?xml version="1.0" encoding="utf-8"?>'
      + '<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope>'
      + '<D:locktype><D:write/></D:locktype>'
      + `<D:owner><D:href>${xmlEscape(owner)}</D:href></D:owner></D:lockinfo>`,
    );
    const res = await this.request('LOCK', key, {
      headers: { 'content-type': 'application/xml; charset=utf-8', depth: '0', timeout: `Second-${Math.ceil(ttl / 1000)}` },
      body,
    });
    // 423 Locked / 409 Conflict: someone else holds it
    if (res.status === 423 || res.status === 409) return null;
    if (res.status !== 200 && res.status !== 201) throw new SyncHttpError(res.status, await res.text().catch(() => ''));
    const text = await res.text().catch(() => '');
    const fromBody = /<[^>]*locktoken[^>]*>\s*<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/i.exec(text)?.[1];
    const token = cleanToken(res.headers.get('lock-token')) ?? cleanToken(fromBody ?? null);
    if (!token) throw new Error(tr('同步服务没有返回锁令牌'));
    return { key, token, owner, expiresAt: Date.now() + ttl };
  }

  async unlock(key: string, lock: LockHandle | string): Promise<void> {
    const raw = typeof lock === 'string' ? lock : lock.token;
    const token = raw.startsWith('<') ? raw : `<${raw}>`;
    const res = await this.request('UNLOCK', key, { headers: { 'lock-token': token } });
    // already gone = done
    if (res.status === 200 || res.status === 204 || res.status === 404 || res.status === 409) return;
    throw new SyncHttpError(res.status, await res.text().catch(() => ''));
  }
}
