// Remote sync backends (spec §7.9): the same four operations over WebDAV, S3 and GitHub.
// The network is always an injected fetch, so tests use an in-memory fake and the app can route every request
// through the user's proxy / privacy hooks. Keys are relative paths under the backend's prefix; `..`, absolute
// paths and backslashes are refused before a URL is built.
import crypto from 'node:crypto';
import { tr } from '../../i18n/index.js';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface PutOptions {
  /** only write if the remote still has this etag / version */
  ifMatch?: string;
  /** only write if the remote does not exist yet (lock acquisition) */
  ifNoneMatch?: boolean;
  contentType?: string;
}

export interface PutResult { etag?: string; version?: string }
export interface GetResult { data: Uint8Array; etag?: string; version?: string }
export interface LockHandle { key: string; token: string; owner: string; expiresAt: number }

export interface SyncBackend {
  readonly kind: 'webdav' | 's3' | 'github';
  put(key: string, data: Uint8Array | string, opts?: PutOptions): Promise<PutResult>;
  /** null when the object does not exist (never an error: a first sync is normal) */
  get(key: string): Promise<GetResult | null>;
  /** null when another owner holds a live lock */
  lock(key: string, owner?: string, ttlMs?: number): Promise<LockHandle | null>;
  /** accepts the handle returned by lock, or just its token */
  unlock(key: string, lock: LockHandle | string): Promise<void>;
}

/** A conditional write / delete lost the race with another machine. */
export class SyncConflictError extends Error {
  readonly code = 'sync-conflict';
  constructor(message = tr('同步文件在远端已经变了，先拉取再试')) {
    super(message);
    this.name = 'SyncConflictError';
  }
}

export class SyncHttpError extends Error {
  constructor(readonly status: number, readonly body: string, message = tr('同步服务返回了 HTTP {status}', { status })) {
    super(message);
    this.name = 'SyncHttpError';
  }
}

/** A relative key under the remote prefix: no absolute paths, drives, `..`, NUL or backslashes. */
export function assertSyncKey(key: string): string {
  if (typeof key !== 'string') throw new Error(tr('同步文件名不合法'));
  const k = key.trim();
  if (!k || k !== key || k.length > 512 || k.includes('\0') || /[\\]/.test(k)) throw new Error(tr('同步文件名不合法'));
  if (k.startsWith('/') || /^[A-Za-z]:/.test(k)) throw new Error(tr('同步文件名不合法'));
  const parts = k.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) throw new Error(tr('同步文件名不合法'));
  return k;
}

/** Percent-encode each segment but keep the `/` separators. */
export function encodeKeyPath(key: string): string {
  return assertSyncKey(key).split('/').map((p) => encodeURIComponent(p)).join('/');
}

export function lockKeyFor(key: string): string {
  return `_locks/${assertSyncKey(key)}.lock`;
}

export const DEFAULT_LOCK_TTL_MS = 5 * 60_000;
export const newLockToken = (): string => crypto.randomUUID();

export function lockExpired(expiresAt: number, now = Date.now()): boolean {
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function decodeUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

export function parseLock(text: string): { token?: string; owner?: string; expiresAt: number } | null {
  try {
    const v = JSON.parse(text);
    return {
      ...(typeof v?.token === 'string' ? { token: v.token } : {}),
      ...(typeof v?.owner === 'string' ? { owner: v.owner } : {}),
      expiresAt: typeof v?.expiresAt === 'number' ? v.expiresAt : 0,
    };
  } catch {
    return null;
  }
}

export async function bytesOf(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

export function signalFor(ms: number | undefined): AbortSignal | undefined {
  return ms && ms > 0 ? AbortSignal.timeout(ms) : undefined;
}
