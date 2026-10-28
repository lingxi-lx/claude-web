// GitHub backend (spec §7.9): the Contents API over an injected fetch. Each put is one commit; the file sha is
// the version used for conditional writes, and locks are a tiny `_locks/<key>.lock` file (created only when it
// does not exist), so two machines cannot both hold the same sync lock.
import type { FetchLike, GetResult, LockHandle, PutOptions, PutResult, SyncBackend } from './types.js';
import {
  assertSyncKey, decodeUtf8, DEFAULT_LOCK_TTL_MS, lockExpired, newLockToken, parseLock, signalFor,
  SyncConflictError, SyncHttpError, utf8,
} from './types.js';
import { tr } from '../../i18n/index.js';

export interface GitHubOptions {
  owner: string;
  repo: string;
  token?: string;
  /** default branch when omitted */
  branch?: string;
  /** `https://api.github.com` by default (GitHub Enterprise uses its own host) */
  apiBase?: string;
  /** all sync files live under this prefix */
  prefix?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** commit author / committer; GitHub's default is used when omitted */
  committer?: { name: string; email: string };
  now?: () => Date;
}

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

export class GitHubBackend implements SyncBackend {
  readonly kind = 'github' as const;
  private readonly owner: string;
  private readonly repo: string;
  private readonly token?: string;
  private readonly branch?: string;
  private readonly api: string;
  private readonly prefix: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs?: number;
  private readonly committer?: { name: string; email: string };
  private readonly now: () => Date;

  constructor(opts: GitHubOptions) {
    this.owner = String(opts.owner ?? '').trim();
    this.repo = String(opts.repo ?? '').trim();
    if (!NAME_RE.test(this.owner) || !NAME_RE.test(this.repo)) throw new Error(tr('GitHub 仓库名字不合法'));
    this.token = opts.token?.trim() || undefined;
    if (this.token && /[\r\n]/.test(this.token)) throw new Error(tr('GitHub 令牌不合法'));
    this.branch = opts.branch?.trim() || undefined;
    let u: URL;
    try { u = new URL(String(opts.apiBase ?? 'https://api.github.com').trim()); } catch { throw new Error(tr('GitHub 地址不合法')); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(tr('GitHub 地址必须是 http 或 https'));
    if (u.username || u.password || u.search || u.hash) throw new Error(tr('GitHub 地址不能带账号或参数'));
    this.api = u.toString().replace(/\/+$/, '');
    this.prefix = String(opts.prefix ?? '').trim().replace(/^\/+|\/+$/g, '');
    if (this.prefix && !this.prefix.split('/').every((p) => p && p !== '.' && p !== '..' && !p.includes('\\'))) throw new Error(tr('GitHub 前缀不合法'));
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs;
    this.committer = opts.committer;
    this.now = opts.now ?? (() => new Date());
  }

  private objectKey(key: string): string {
    return this.prefix ? `${this.prefix}/${assertSyncKey(key)}` : assertSyncKey(key);
  }

  private url(objectKey: string): string {
    const path = objectKey.split('/').map((p) => encodeURIComponent(p)).join('/');
    const ref = this.branch ? `?ref=${encodeURIComponent(this.branch)}` : '';
    return `${this.api}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${path}${ref}`;
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'claude-web-sync',
    };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    if (json) h['content-type'] = 'application/json';
    return h;
  }

  private async request(method: string, objectKey: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(this.url(objectKey), {
      method,
      headers: this.headers(body !== undefined),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: signalFor(this.timeoutMs),
    });
  }

  private async getObject(objectKey: string): Promise<GetResult | null> {
    const res = await this.request('GET', objectKey);
    if (res.status === 404) return null;
    if (!res.ok) throw new SyncHttpError(res.status, await res.text().catch(() => ''));
    const v = await res.json().catch(() => null) as { type?: string; sha?: string; encoding?: string; content?: string } | null;
    if (!v || v.type !== 'file' || typeof v.sha !== 'string') throw new Error(tr('GitHub 返回的内容不是一个文件'));
    if (v.encoding !== 'base64' || typeof v.content !== 'string') throw new Error(tr('GitHub 上的同步文件太大了'));
    return { data: new Uint8Array(Buffer.from(v.content.replace(/\s+/g, ''), 'base64')), etag: v.sha, version: v.sha };
  }

  private async putObject(objectKey: string, data: Uint8Array, opts: PutOptions = {}): Promise<PutResult> {
    const body: Record<string, unknown> = {
      message: `sync: ${objectKey}`,
      content: Buffer.from(data).toString('base64'),
      ...(this.branch ? { branch: this.branch } : {}),
      ...(this.committer ? { committer: this.committer } : {}),
    };
    if (opts.ifMatch) body.sha = opts.ifMatch;
    const res = await this.request('PUT', objectKey, body);
    if (res.status === 409 || res.status === 412 || res.status === 422) throw new SyncConflictError();
    if (res.status !== 200 && res.status !== 201) throw new SyncHttpError(res.status, await res.text().catch(() => ''));
    const v = await res.json().catch(() => null) as { content?: { sha?: string } } | null;
    const sha = v?.content?.sha;
    return { ...(sha ? { etag: sha, version: sha } : {}) };
  }

  private async deleteObject(objectKey: string, sha: string): Promise<void> {
    const res = await this.request('DELETE', objectKey, {
      message: `sync: remove ${objectKey}`,
      sha,
      ...(this.branch ? { branch: this.branch } : {}),
      ...(this.committer ? { committer: this.committer } : {}),
    });
    if (res.status === 404) return;
    if (res.status === 409 || res.status === 412) throw new SyncConflictError();
    if (res.status !== 200 && res.status !== 204) throw new SyncHttpError(res.status, await res.text().catch(() => ''));
  }

  async put(key: string, data: Uint8Array | string, opts: PutOptions = {}): Promise<PutResult> {
    const objectKey = this.objectKey(key);
    // the Contents API needs the current sha to replace a file: an unconditional put reads it first (and still
    // fails as a conflict if another machine wrote in between)
    let effective = opts;
    if (!opts.ifMatch && !opts.ifNoneMatch) {
      const current = await this.getObject(objectKey);
      if (current?.etag) effective = { ...opts, ifMatch: current.etag };
    }
    return this.putObject(objectKey, typeof data === 'string' ? utf8(data) : data, effective);
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
    try { await this.deleteObject(lockObject, current.etag!); } catch (e) {
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
    await this.deleteObject(lockObject, current.etag!);
  }
}
