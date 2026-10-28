// S3 backend (spec §7.9): path-style objects + SigV4, through the injected fetch.
// Locking is an ordinary tiny object (`_locks/<key>.lock`) written with `If-None-Match: *`, so no extra
// service is needed; a stale lock (past its expiry) is replaced once. The bucket needs PutObject/GetObject/
// DeleteObject only.
import crypto from 'node:crypto';
import type { FetchLike, GetResult, LockHandle, PutOptions, PutResult, SyncBackend } from './types.js';
import {
  assertSyncKey, bytesOf, decodeUtf8, DEFAULT_LOCK_TTL_MS, lockExpired, newLockToken, parseLock,
  signalFor, SyncConflictError, SyncHttpError, utf8,
} from './types.js';
import { tr } from '../../i18n/index.js';

export interface S3Options {
  /** `https://s3.us-east-1.amazonaws.com` by default; a MinIO / gateway URL works too */
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** all objects live under this prefix */
  prefix?: string;
  fetch?: FetchLike;
  /** tests inject a clock; production uses the real one */
  now?: () => Date;
  timeoutMs?: number;
}

const hex = (b: Buffer | Uint8Array | string) => crypto.createHash('sha256').update(typeof b === 'string' ? b : Buffer.from(b)).digest('hex');
const hmac = (key: Buffer | string, data: string) => crypto.createHmac('sha256', key).update(data).digest();
/** AWS's RFC 3986 encoding (encodeURIComponent leaves `!'()*` alone). */
const awsEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

function canonicalQuery(u: URL): string {
  const pairs: [string, string][] = [];
  u.searchParams.forEach((v, k) => pairs.push([k, v]));
  return pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]))).map(([k, v]) => `${awsEncode(k)}=${awsEncode(v)}`).join('&');
}

export class S3Backend implements SyncBackend {
  readonly kind = 's3' as const;
  private readonly endpoint: string;
  private readonly region: string;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly sessionToken?: string;
  private readonly prefix: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly timeoutMs?: number;

  constructor(opts: S3Options) {
    this.region = String(opts.region ?? 'us-east-1').trim() || 'us-east-1';
    const endpoint = String(opts.endpoint ?? `https://s3.${this.region}.amazonaws.com`).trim();
    let u: URL;
    try { u = new URL(endpoint); } catch { throw new Error(tr('S3 地址不合法')); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(tr('S3 地址必须是 http 或 https'));
    if (u.username || u.password || u.search || u.hash) throw new Error(tr('S3 地址不能带账号或参数'));
    this.endpoint = u.toString().replace(/\/+$/, '');
    this.bucket = String(opts.bucket ?? '').trim();
    if (!this.bucket || !/^[A-Za-z0-9._-]{1,255}$/.test(this.bucket)) throw new Error(tr('S3 存储桶名字不合法'));
    this.accessKeyId = String(opts.accessKeyId ?? '').trim();
    this.secretAccessKey = String(opts.secretAccessKey ?? '');
    if (!this.accessKeyId || !this.secretAccessKey) throw new Error(tr('S3 凭据不完整'));
    this.sessionToken = opts.sessionToken || undefined;
    this.prefix = String(opts.prefix ?? '').trim().replace(/^\/+|\/+$/g, '');
    if (this.prefix && !this.prefix.split('/').every((p) => p && p !== '.' && p !== '..' && !p.includes('\\'))) throw new Error(tr('S3 前缀不合法'));
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.timeoutMs = opts.timeoutMs;
  }

  private objectKey(key: string): string {
    return this.prefix ? `${this.prefix}/${assertSyncKey(key)}` : assertSyncKey(key);
  }

  private url(objectKey: string): string {
    const path = objectKey.split('/').map(awsEncode).join('/');
    return `${this.endpoint}/${awsEncode(this.bucket)}/${path}`;
  }

  private sign(method: string, url: string, headers: Record<string, string>, payloadHash: string): Record<string, string> {
    const u = new URL(url);
    const date = this.now();
    const stamp = amzDate(date);
    const short = stamp.slice(0, 8);
    const all: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) all[k.toLowerCase()] = v;
    all.host = u.host;
    all['x-amz-content-sha256'] = payloadHash;
    all['x-amz-date'] = stamp;
    if (this.sessionToken) all['x-amz-security-token'] = this.sessionToken;
    const names = Object.keys(all).sort();
    const canonicalHeaders = names.map((n) => `${n}:${String(all[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
    const signedHeaders = names.join(';');
    const canonicalRequest = [method, u.pathname || '/', canonicalQuery(u), canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${short}/${this.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, hex(canonicalRequest)].join('\n');
    const kDate = hmac(`AWS4${this.secretAccessKey}`, short);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = hmac(kSigning, stringToSign).toString('hex');
    const out: Record<string, string> = { ...headers, 'x-amz-date': stamp, 'x-amz-content-sha256': payloadHash };
    if (this.sessionToken) out['x-amz-security-token'] = this.sessionToken;
    out.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return out;
  }

  private async request(method: string, objectKey: string, body?: Uint8Array, extra: Record<string, string> = {}): Promise<Response> {
    const url = this.url(objectKey);
    const payloadHash = hex(body ?? Buffer.alloc(0));
    const headers = this.sign(method, url, { ...extra }, payloadHash);
    return this.fetchImpl(url, {
      method,
      headers,
      ...(body ? { body: body as unknown as BodyInit } : {}),
      signal: signalFor(this.timeoutMs),
    });
  }

  private async putObject(objectKey: string, data: Uint8Array, opts: PutOptions = {}): Promise<PutResult> {
    const headers: Record<string, string> = { 'content-type': opts.contentType ?? 'application/octet-stream' };
    if (opts.ifMatch) headers['if-match'] = opts.ifMatch;
    if (opts.ifNoneMatch) headers['if-none-match'] = '*';
    const res = await this.request('PUT', objectKey, data, headers);
    if (res.status === 412 || res.status === 409) throw new SyncConflictError();
    if (res.status !== 200 && res.status !== 201 && res.status !== 204) throw new SyncHttpError(res.status, await res.text().catch(() => ''));
    const etag = res.headers.get('etag') ?? undefined;
    return { ...(etag ? { etag, version: etag } : {}) };
  }

  private async getObject(objectKey: string): Promise<GetResult | null> {
    const res = await this.request('GET', objectKey);
    if (res.status === 404) return null;
    if (!res.ok) throw new SyncHttpError(res.status, await res.text().catch(() => ''));
    const etag = res.headers.get('etag') ?? undefined;
    return { data: await bytesOf(res), ...(etag ? { etag, version: etag } : {}) };
  }

  private async deleteObject(objectKey: string, ifMatch?: string): Promise<void> {
    const res = await this.request('DELETE', objectKey, undefined, ifMatch ? { 'if-match': ifMatch } : {});
    if (res.status === 404) return;
    if (res.status === 412 || res.status === 409) throw new SyncConflictError();
    if (res.status !== 200 && res.status !== 204) throw new SyncHttpError(res.status, await res.text().catch(() => ''));
  }

  async put(key: string, data: Uint8Array | string, opts: PutOptions = {}): Promise<PutResult> {
    return this.putObject(this.objectKey(key), typeof data === 'string' ? utf8(data) : data, opts);
  }

  async get(key: string): Promise<GetResult | null> {
    return this.getObject(this.objectKey(key));
  }

  async lock(key: string, owner = 'claude-web', ttlMs = DEFAULT_LOCK_TTL_MS): Promise<LockHandle | null> {
    const lockObject = this.objectKey(`_locks/${assertSyncKey(key)}.lock`);
    const ttl = Math.max(30_000, Math.min(ttlMs, 24 * 60 * 60_000));
    const now = this.now().getTime();
    const token = newLockToken();
    const expiresAt = now + ttl;
    const body = utf8(JSON.stringify({ token, owner, expiresAt }));
    const acquire = async () => this.putObject(lockObject, body, { ifNoneMatch: true, contentType: 'application/json' });

    try {
      await acquire();
      return { key, token, owner, expiresAt };
    } catch (e) {
      if (!(e instanceof SyncConflictError)) throw e;
    }

    const current = await this.getObject(lockObject);
    if (!current) return null;
    const parsed = parseLock(decodeUtf8(current.data));
    if (parsed && !lockExpired(parsed.expiresAt, now)) return null;
    // stale lock: remove exactly the version we read, then race for it once more
    try { await this.deleteObject(lockObject, current.etag); } catch (e) {
      if (e instanceof SyncConflictError) return null;
      throw e;
    }
    try {
      await acquire();
      return { key, token, owner, expiresAt };
    } catch (e) {
      if (e instanceof SyncConflictError) return null;
      throw e;
    }
  }

  async unlock(key: string, lock: LockHandle | string): Promise<void> {
    const lockObject = this.objectKey(`_locks/${assertSyncKey(key)}.lock`);
    const token = typeof lock === 'string' ? lock : lock.token;
    const current = await this.getObject(lockObject);
    if (!current) return;
    const parsed = parseLock(decodeUtf8(current.data));
    if (!parsed?.token || parsed.token !== token) throw new SyncConflictError(tr('这个同步锁已经不属于当前任务了'));
    await this.deleteObject(lockObject, current.etag);
  }
}
