// Remote sync (sync.* remote half): one of the three backends writes the same passphrase-sealed bundle that
// 导出 produces. The backend settings live in meta.json under `sync.remote`; every credential is stored through
// SecretService and only ever leaves the server as a mask. Push takes the backend lock, writes with the etag it
// read (conditional put), and always releases the lock; pull body becomes the ordinary SyncService preview, so
// the existing per-item merge UI applies it.
import type { MetaStore } from '../meta/store.js';
import type { SyncService } from './service.js';
import type { FetchLike, PutOptions, SyncBackend } from './backends/types.js';
import { decodeUtf8, SyncConflictError, SyncHttpError } from './backends/types.js';
import { WebDavBackend } from './backends/webdav.js';
import { S3Backend } from './backends/s3.js';
import { GitHubBackend } from './backends/github.js';
import type {
  SyncRemoteBackend, SyncRemoteConfig, SyncRemotePullResult, SyncRemotePushResult, SyncRemoteRequest,
  SyncRemoteStatus, SyncRemoteTestResult,
} from './types.js';
import { tr } from '../i18n/index.js';
import { guardedFetch, type LookupAll } from '../net/netguard.js';

export const SYNC_REMOTE_SETTING = 'sync.remote';
/** The one file each backend folder holds. */
export const SYNC_REMOTE_BUNDLE_KEY = 'claude-web-sync.json';
/** What a stored credential reads as on the wire (the same shape IM / 联网 keys use). */
export const SYNC_REMOTE_MASK = '••••••';

const MAX_FIELD = 2048;
const MAX_SECRET = 8 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

interface StoredWebDav { url?: string; username?: string; password?: string }
interface StoredS3 { endpoint?: string; bucket?: string; region?: string; accessKeyId?: string; secretAccessKey?: string; prefix?: string }
interface StoredGitHub { repo?: string; branch?: string; path?: string; token?: string }
interface StoredRemote {
  version: 1;
  backend: SyncRemoteBackend;
  webdav: StoredWebDav;
  s3: StoredS3;
  github: StoredGitHub;
  lastPushAt?: number;
  lastPullAt?: number;
  lastTestAt?: number;
  lastError?: string;
}

/** The config with every credential revealed — only used to build a backend; never returned by an operation. */
export interface ResolvedRemoteConfig {
  backend: SyncRemoteBackend;
  webdav: { url: string; username: string; password: string };
  s3: { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; prefix: string };
  github: { repo: string; branch: string; path: string; token: string };
}

/** The two SecretService calls this service needs (SecretService fits; tests pass a fake). */
export interface RemoteSyncSecrets {
  protect(plain: string, id: string): Promise<string>;
  reveal(v?: string): Promise<string>;
}

export interface RemoteSyncDeps {
  meta: MetaStore;
  sync: Pick<SyncService, 'buildText' | 'preview' | 'cancel'>;
  secrets?: RemoteSyncSecrets;
  /** tests inject a fake backend; production builds the three real ones */
  backendFactory?: (config: ResolvedRemoteConfig, signal?: AbortSignal) => SyncBackend;
  fetch?: FetchLike;
  /** tests: the resolver netguard uses (set it to guard an injected fetch too) */
  lookup?: LookupAll;
  now?: () => number;
  /** lock owner shown to other machines; default `claude-web` */
  owner?: string;
}

const isMask = (v: unknown): boolean => typeof v === 'string' && /^•+$/.test(v);
const dict = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const text = (v: unknown, max = MAX_FIELD): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const secretText = (v: unknown): string => (typeof v === 'string' && v ? v.slice(0, MAX_SECRET) : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function clean<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}

/** Whatever is in `sync.remote` → a shape the rest of this file can trust (a hand-edited meta.json included). */
export function readStoredRemote(raw: unknown): StoredRemote {
  const r = dict(raw);
  const w = dict(r.webdav);
  const s = dict(r.s3);
  const g = dict(r.github);
  const backend: SyncRemoteBackend = r.backend === 's3' || r.backend === 'github' ? r.backend : 'webdav';
  return {
    version: 1,
    backend,
    webdav: clean({
      url: text(w.url), username: text(w.username), password: secretText(w.password),
    }),
    s3: clean({
      endpoint: text(s.endpoint), bucket: text(s.bucket), region: text(s.region, 64),
      accessKeyId: text(s.accessKeyId, 512), secretAccessKey: secretText(s.secretAccessKey), prefix: text(s.prefix, 512),
    }),
    github: clean({
      repo: text(g.repo, 300), branch: text(g.branch, 300), path: text(g.path, 512), token: secretText(g.token),
    }),
    ...(num(r.lastPushAt) !== undefined ? { lastPushAt: num(r.lastPushAt) } : {}),
    ...(num(r.lastPullAt) !== undefined ? { lastPullAt: num(r.lastPullAt) } : {}),
    ...(num(r.lastTestAt) !== undefined ? { lastTestAt: num(r.lastTestAt) } : {}),
    ...(typeof r.lastError === 'string' && r.lastError ? { lastError: r.lastError.slice(0, 2000) } : {}),
  };
}

/** Stored config with the credentials replaced by the mask (what any client may see). */
export function maskedRemoteConfig(s: StoredRemote): SyncRemoteConfig {
  return {
    backend: s.backend,
    webdav: { url: s.webdav.url ?? '', username: s.webdav.username ?? '', password: s.webdav.password ? SYNC_REMOTE_MASK : '' },
    s3: {
      endpoint: s.s3.endpoint ?? '', bucket: s.s3.bucket ?? '', region: s.s3.region ?? '',
      accessKeyId: s.s3.accessKeyId ?? '', secretAccessKey: s.s3.secretAccessKey ? SYNC_REMOTE_MASK : '',
      prefix: s.s3.prefix ?? '',
    },
    github: {
      repo: s.github.repo ?? '', branch: s.github.branch ?? '', path: s.github.path ?? '',
      token: s.github.token ? SYNC_REMOTE_MASK : '',
    },
  };
}

/** `settings.get` must not carry the encrypted credentials either: they read as masks like every other key. */
export function maskSyncRemoteSettings<T extends Record<string, unknown>>(settings: T): T {
  const raw = settings[SYNC_REMOTE_SETTING];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return settings;
  const s = readStoredRemote(raw);
  return {
    ...settings,
    [SYNC_REMOTE_SETTING]: {
      ...maskedRemoteConfig(s),
      ...(s.lastPushAt ? { lastPushAt: s.lastPushAt } : {}),
      ...(s.lastPullAt ? { lastPullAt: s.lastPullAt } : {}),
      ...(s.lastTestAt ? { lastTestAt: s.lastTestAt } : {}),
      ...(s.lastError ? { lastError: s.lastError } : {}),
    },
  } as T;
}

function missingFor(s: StoredRemote): string[] {
  switch (s.backend) {
    case 'webdav':
      return s.webdav.url ? [] : [tr('WebDAV 地址')];
    case 's3': {
      const out: string[] = [];
      if (!s.s3.bucket) out.push(tr('S3 存储桶'));
      if (!s.s3.accessKeyId) out.push(tr('S3 Access Key'));
      if (!s.s3.secretAccessKey) out.push(tr('S3 Secret Key'));
      return out;
    }
    case 'github': {
      const out: string[] = [];
      if (!s.github.repo || !/^[^/\s]+\/[^/\s]+$/.test(s.github.repo)) out.push(tr('GitHub 仓库（owner/repo）'));
      if (!s.github.token) out.push(tr('GitHub 令牌'));
      return out;
    }
  }
}

function splitRepo(value: string): [string, string] {
  const m = /^([^/\s]+)\/([^/\s]+)$/.exec(String(value ?? '').trim());
  if (!m) throw new Error(tr('GitHub 仓库要写成 owner/repo'));
  return [m[1], m[2]];
}

/** Build the real backend from a resolved config (no network until an operation runs). */
export function createRemoteBackend(config: ResolvedRemoteConfig, o: { fetch?: FetchLike; timeoutMs?: number } = {}): SyncBackend {
  switch (config.backend) {
    case 'webdav':
      return new WebDavBackend({
        baseUrl: config.webdav.url,
        username: config.webdav.username || undefined,
        password: config.webdav.password || undefined,
        fetch: o.fetch,
        timeoutMs: o.timeoutMs,
      });
    case 's3':
      return new S3Backend({
        endpoint: config.s3.endpoint || undefined,
        region: config.s3.region || undefined,
        bucket: config.s3.bucket,
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
        prefix: config.s3.prefix || undefined,
        fetch: o.fetch,
        timeoutMs: o.timeoutMs,
      });
    case 'github': {
      const [owner, repo] = splitRepo(config.github.repo);
      return new GitHubBackend({
        owner, repo,
        token: config.github.token || undefined,
        branch: config.github.branch || undefined,
        prefix: config.github.path || undefined,
        fetch: o.fetch,
        timeoutMs: o.timeoutMs,
      });
    }
  }
}

/** Errors in words a person can act on (the backends already word conflicts; this adds HTTP / network hints). */
export function syncRemoteErrorText(e: unknown): string {
  if (e instanceof SyncConflictError) return e.message;
  if (e instanceof SyncHttpError) {
    const hint: Record<number, string> = {
      401: tr('同步服务说凭据不对（HTTP 401），检查账号、密码或令牌'),
      403: tr('同步服务不让这次操作（HTTP 403），检查账号权限和令牌范围'),
      404: tr('同步服务找不到地址（HTTP 404），检查 WebDAV 地址、存储桶或仓库'),
      409: tr('同步文件在远端已经变了（HTTP 409），先拉取再试'),
      412: tr('同步文件在远端已经变了（HTTP 412），先拉取再试'),
      429: tr('同步服务限流了（HTTP 429），等一会再试'),
    };
    return hint[e.status] ?? e.message;
  }
  const name = (e as { name?: string })?.name;
  if (name === 'AbortError') return tr('已取消');
  if (name === 'TimeoutError') return tr('连接同步服务超时了，检查地址和网络');
  if (e instanceof TypeError) return tr('连不上同步服务：{message}', { message: e.message });
  return e instanceof Error ? e.message : String(e);
}

function mergeSignals(a: AbortSignal | null | undefined, b: AbortSignal | undefined): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.aborted) return a;
  if (b.aborted) return b;
  const out = new AbortController();
  const onAbort = () => out.abort((a as { reason?: unknown }).reason ?? (b as { reason?: unknown }).reason);
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return out.signal;
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * Status / config / test / push / pull over one remote backend. One operation at a time; cancel stops the one
 * in flight (the fetch signal) or forgets a pulled preview.
 */
export class RemoteSyncService {
  private current: AbortController | null = null;

  constructor(private readonly deps: RemoteSyncDeps) {}

  status(): SyncRemoteStatus {
    const s = this.read();
    const missing = missingFor(s);
    return {
      ...maskedRemoteConfig(s),
      configured: missing.length === 0,
      missing,
      ...(s.lastPushAt ? { lastPushAt: s.lastPushAt } : {}),
      ...(s.lastPullAt ? { lastPullAt: s.lastPullAt } : {}),
      ...(s.lastTestAt ? { lastTestAt: s.lastTestAt } : {}),
      ...(s.lastError ? { lastError: s.lastError } : {}),
    };
  }

  /** Store the form. Secret fields: the mask keeps what is stored, `''` removes it, anything else replaces it. */
  async set(config: SyncRemoteConfig): Promise<SyncRemoteStatus> {
    if (!config || typeof config !== 'object') throw new Error(tr('同步设置不完整'));
    const backend = config.backend;
    if (backend !== 'webdav' && backend !== 's3' && backend !== 'github') throw new Error(tr('不认识的同步方式'));
    const cur = this.read();
    const input = config as unknown as Record<string, unknown>;
    const w = dict(input.webdav);
    const s = dict(input.s3);
    const g = dict(input.github);

    const field = (v: unknown, old?: string, max = MAX_FIELD): string => (typeof v === 'string' ? v.trim().slice(0, max) : (old ?? ''));
    const secret = async (v: unknown, old: string | undefined, id: string): Promise<string | undefined> => {
      if (typeof v !== 'string') return old;
      const t = v.trim();
      if (isMask(t)) return old;
      if (!t) return undefined;
      if (v.length > MAX_SECRET) throw new Error(tr('同步凭据太长了'));
      // a password may contain spaces around it: trim only decides whether this is an empty / mask value
      return this.deps.secrets ? await this.deps.secrets.protect(v, id) : v;
    };

    const password = await secret(w.password, cur.webdav.password, 'sync-remote:webdav-password');
    const secretAccessKey = await secret(s.secretAccessKey, cur.s3.secretAccessKey, 'sync-remote:s3-secret-key');
    const token = await secret(g.token, cur.github.token, 'sync-remote:github-token');

    const next: StoredRemote = {
      version: 1,
      backend,
      webdav: clean({
        url: field(w.url, cur.webdav.url),
        username: field(w.username, cur.webdav.username),
        ...(password ? { password } : {}),
      }),
      s3: clean({
        endpoint: field(s.endpoint, cur.s3.endpoint),
        bucket: field(s.bucket, cur.s3.bucket, 255),
        region: field(s.region, cur.s3.region, 64),
        accessKeyId: field(s.accessKeyId, cur.s3.accessKeyId, 512),
        ...(secretAccessKey ? { secretAccessKey } : {}),
        prefix: field(s.prefix, cur.s3.prefix, 512),
      }),
      github: clean({
        repo: field(g.repo, cur.github.repo, 300),
        branch: field(g.branch, cur.github.branch, 300),
        path: field(g.path, cur.github.path, 512),
        ...(token ? { token } : {}),
      }),
      ...(cur.lastPushAt ? { lastPushAt: cur.lastPushAt } : {}),
      ...(cur.lastPullAt ? { lastPullAt: cur.lastPullAt } : {}),
      ...(cur.lastTestAt ? { lastTestAt: cur.lastTestAt } : {}),
    };
    await this.deps.meta.setSetting(SYNC_REMOTE_SETTING, clean(next));
    return this.status();
  }

  async test(): Promise<SyncRemoteTestResult> {
    return this.run(async (signal) => {
      const { backend } = await this.makeBackend(signal);
      const cur = await backend.get(SYNC_REMOTE_BUNDLE_KEY);
      await this.patch({ lastTestAt: this.now(), lastError: undefined });
      return {
        ok: true,
        remoteExists: !!cur,
        message: cur ? tr('连接成功，远端已有同步文件') : tr('连接成功，远端还没有同步文件'),
      };
    });
  }

  async push(passphrase?: string): Promise<SyncRemotePushResult> {
    const pass = typeof passphrase === 'string' && passphrase ? passphrase : undefined;
    return this.run(async (signal) => {
      const built = await this.deps.sync.buildText(pass);
      const { backend } = await this.makeBackend(signal);
      const lock = await backend.lock(SYNC_REMOTE_BUNDLE_KEY, this.deps.owner ?? 'claude-web');
      if (!lock) throw new SyncConflictError(tr('另一台电脑正在同步，等它完成后重试'));

      let warning: string | undefined;
      let result!: SyncRemotePushResult;
      try {
        const cur = await backend.get(SYNC_REMOTE_BUNDLE_KEY);
        const opts: PutOptions = { contentType: 'application/json; charset=utf-8' };
        if (cur?.etag) opts.ifMatch = cur.etag;
        else if (!cur) opts.ifNoneMatch = true;
        // a WebDAV server that returns no etag cannot be checked conditionally; the lock still keeps our own
        // machines apart, so write under it rather than refuse a first sync.
        const put = await backend.put(SYNC_REMOTE_BUNDLE_KEY, built.text, opts);
        result = {
          ok: true,
          at: this.now(),
          bytes: Buffer.byteLength(built.text, 'utf8'),
          ...(put.etag ? { etag: put.etag } : {}),
        };
      } finally {
        try {
          await backend.unlock(SYNC_REMOTE_BUNDLE_KEY, lock);
        } catch (e) {
          warning = tr('文件已经推送，但同步锁没能释放：{message}', { message: syncRemoteErrorText(e) });
        }
      }
      await this.patch({ lastPushAt: result.at, lastError: undefined });
      return warning ? { ...result, warning } : result;
    });
  }

  /** Fetch the remote bundle and hand it to the ordinary preview (token valid 10 minutes, apply as usual). */
  async pull(passphrase?: string): Promise<SyncRemotePullResult> {
    const pass = typeof passphrase === 'string' && passphrase ? passphrase : undefined;
    return this.run(async (signal) => {
      const { backend } = await this.makeBackend(signal);
      const cur = await backend.get(SYNC_REMOTE_BUNDLE_KEY);
      if (!cur) throw new Error(tr('远端还没有同步文件，先推送一次'));
      const preview = await this.deps.sync.preview(decodeUtf8(cur.data), pass);
      const at = this.now();
      await this.patch({ lastPullAt: at, lastError: undefined });
      return { ...preview, pulledAt: at, ...(cur.etag ? { etag: cur.etag } : {}) };
    });
  }

  /** No token: stop whatever is in flight. With a token: forget that pulled preview. */
  cancel(token?: string): null {
    if (token) this.deps.sync.cancel(token);
    this.current?.abort();
    return null;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private read(): StoredRemote {
    return readStoredRemote(this.deps.meta.settings()[SYNC_REMOTE_SETTING]);
  }

  private async patch(update: Partial<StoredRemote>): Promise<void> {
    const next: StoredRemote = { ...this.read(), ...update };
    if (update.lastError === undefined) delete next.lastError;
    await this.deps.meta.setSetting(SYNC_REMOTE_SETTING, clean(next));
  }

  private async resolved(s: StoredRemote): Promise<ResolvedRemoteConfig> {
    const reveal = async (v: string | undefined): Promise<string> => {
      if (!v) return '';
      if (!this.deps.secrets) return v;
      try {
        return await this.deps.secrets.reveal(v);
      } catch (e) {
        throw new Error(tr('无法解密同步凭据：{message}', { message: (e as Error).message }));
      }
    };
    return {
      backend: s.backend,
      webdav: { url: s.webdav.url ?? '', username: s.webdav.username ?? '', password: await reveal(s.webdav.password) },
      s3: {
        endpoint: s.s3.endpoint ?? '', bucket: s.s3.bucket ?? '', region: s.s3.region ?? '',
        accessKeyId: s.s3.accessKeyId ?? '', secretAccessKey: await reveal(s.s3.secretAccessKey), prefix: s.s3.prefix ?? '',
      },
      github: { repo: s.github.repo ?? '', branch: s.github.branch ?? '', path: s.github.path ?? '', token: await reveal(s.github.token) },
    };
  }

  private fetchFor(signal?: AbortSignal): FetchLike {
    // netguard: the user's own WebDAV / S3 / GitHub Enterprise may sit on the LAN or this machine, never on a
    // link-local / cloud-metadata address (every redirect hop and the dialled address are checked)
    const base: FetchLike = this.deps.fetch && !this.deps.lookup
      ? this.deps.fetch
      : guardedFetch({ policy: 'local', ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}), ...(this.deps.lookup ? { lookup: this.deps.lookup } : {}) });
    if (!signal) return base;
    return (input, init = {}) => {
      if (signal.aborted) return Promise.reject(abortError());
      const merged = mergeSignals(init.signal as AbortSignal | null | undefined, signal);
      return base(input, { ...init, ...(merged ? { signal: merged } : {}) });
    };
  }

  private async makeBackend(signal?: AbortSignal): Promise<{ backend: SyncBackend; config: ResolvedRemoteConfig }> {
    const s = this.read();
    const missing = missingFor(s);
    if (missing.length) throw new Error(tr('远程同步还缺：{fields}', { fields: missing.join('、') }));
    const config = await this.resolved(s);
    if (this.deps.backendFactory) return { backend: this.deps.backendFactory(config, signal), config };
    return {
      backend: createRemoteBackend(config, { fetch: this.fetchFor(signal), timeoutMs: REQUEST_TIMEOUT_MS }),
      config,
    };
  }

  private async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.current) throw new Error(tr('正在进行另一项同步操作，等它完成或取消'));
    const abort = new AbortController();
    this.current = abort;
    try {
      return await fn(abort.signal);
    } catch (e) {
      const message = syncRemoteErrorText(e);
      await this.patch({ lastError: message }).catch(() => {});
      throw new Error(message, { cause: e });
    } finally {
      if (this.current === abort) this.current = null;
    }
  }
}

export const isRemoteSyncRequest = (req: { kind: string }): req is SyncRemoteRequest => req.kind.startsWith('sync.remote.');

export async function handleRemoteSyncRequest(svc: RemoteSyncService, req: SyncRemoteRequest): Promise<unknown> {
  switch (req.kind) {
    case 'sync.remote.status': return svc.status();
    case 'sync.remote.set': return svc.set(req.config);
    case 'sync.remote.test': return svc.test();
    case 'sync.remote.push': return svc.push(typeof req.passphrase === 'string' ? req.passphrase : undefined);
    case 'sync.remote.pull': return svc.pull(typeof req.passphrase === 'string' ? req.passphrase : undefined);
    case 'sync.remote.cancel': return svc.cancel(typeof req.token === 'string' ? req.token : undefined);
  }
}
