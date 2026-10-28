// The remote plugin market (spec P7): one meta setting (`plugins.market`), a signed / validated catalog, a disk
// cache, and a one-click install that downloads an archive, checks its SHA-256 / signature, extracts it safely,
// validates plugin.json and only then moves it under the plugins directory. Nothing downloaded is ever executed:
// an executable plugin still has to be enabled (and its permissions approved) through PluginService afterwards.
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MetaStore } from '../meta/store.js';
import { tr } from '../i18n/index.js';
import { guardedFetch, type EgressPolicy, type LookupAll } from '../net/netguard.js';
import { extractPluginArchive, isGzipBytes, isZipBytes, writePluginTree } from './archive.js';
import { parseDeclarative } from './declarative.js';
import { parseManifest, PLUGIN_ID_RE } from './manifest.js';
import { isCompatible, isEd25519PublicKey, parseSignedMarketCatalog, sha256Hex, verifyArchiveSignature, type MarketEntry } from './market.js';
import type { PluginInstallResult, PluginMarketConfig, PluginMarketStatus } from './protocol.js';

const MARKET_SETTING = 'plugins.market';
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const MAX_DECLARATIVE_BYTES = 512 * 1024;
const CATALOG_TIMEOUT_MS = 20_000;
const PACKAGE_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

export interface PluginMarketDeps {
  meta: Pick<MetaStore, 'settings' | 'setSetting'>;
  /** the plugins directory (`PluginService.dir`) */
  dir: () => string;
  appVersion?: string;
  /** tests inject one; the app uses the process's fetch (with its proxy settings) */
  fetch?: typeof fetch;
  /** tests: netguard's resolver (set it to guard an injected fetch too) */
  lookup?: LookupAll;
  now?: () => number;
}

export interface PluginInstallInput { id?: string; url?: string; path?: string; sha256?: string }

interface MarketCache { version: 1; url: string; fetchedAt: number; body: string }

function defaultAppVersion(): string {
  try {
    const file = new URL('../../package.json', import.meta.url);
    return String((JSON.parse(fsSync.readFileSync(file, 'utf8')) as { version?: string }).version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isLoopback = (host: string): boolean => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';

/** `plugins.market`: an https catalog URL and an optional Ed25519 public key. Throws a showable message; `config()` catches hand-edited values. */
export function normalizeMarketConfig(raw: unknown): PluginMarketConfig {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(tr('插件市场设置不对'));
  const v = raw as Record<string, unknown>;
  let url: string | undefined;
  if (v.url !== undefined && v.url !== null) {
    if (typeof v.url !== 'string') throw new Error(tr('插件市场设置不对'));
    const s = v.url.trim();
    if (s) {
      let u: URL;
      try { u = new URL(s); } catch { throw new Error(tr('插件市场地址必须是 https 地址')); }
      if (u.protocol !== 'https:' || u.username || u.password) throw new Error(tr('插件市场地址必须是 https 地址'));
      if (u.toString().length > 2000) throw new Error(tr('插件市场地址太长'));
      url = u.toString();
    }
  }
  let publicKey: string | undefined;
  if (v.publicKey !== undefined && v.publicKey !== null) {
    if (typeof v.publicKey !== 'string') throw new Error(tr('插件市场设置不对'));
    const key = v.publicKey.trim();
    if (key) {
      if (key.length > 8000) throw new Error(tr('插件市场的公钥太长'));
      if (!isEd25519PublicKey(key)) throw new Error(tr('插件市场的公钥不是 Ed25519 公钥'));
      publicKey = key;
    }
  }
  return { ...(url ? { url } : {}), ...(publicKey ? { publicKey } : {}) };
}

async function readCapped(res: Response, max: number, tooBig: string): Promise<Buffer> {
  const len = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(len) && len > max) throw new Error(tooBig);
  if (!res.body) {
    const b = Buffer.from(await res.arrayBuffer());
    if (b.length > max) throw new Error(tooBig);
    return b;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error(tooBig);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** The package format from the bytes (an explicit catalog `kind` still wins over this). */
function sniffKind(bytes: Buffer, hint: string): 'declarative' | 'executable' | null {
  if (isZipBytes(bytes) || isGzipBytes(bytes)) return 'executable';
  if (/\.json$/i.test(hint)) return 'declarative';
  const head = bytes.subarray(0, 128).toString('utf8').trimStart();
  return head.startsWith('{') || head.startsWith('[') ? 'declarative' : null;
}

export class PluginMarketService {
  private memory?: MarketCache;

  constructor(private deps: PluginMarketDeps) {}

  get dir(): string { return this.deps.dir(); }
  private now(): number { return this.deps.now?.() ?? Date.now(); }
  private appVersion(): string { return this.deps.appVersion ?? defaultAppVersion(); }
  private cacheFile(): string { return path.join(this.dir, '.market', 'catalog.json'); }

  config(): PluginMarketConfig {
    try { return normalizeMarketConfig(this.deps.meta.settings()[MARKET_SETTING]); } catch { return {}; }
  }

  /** Save the market URL / key; an empty field clears it. Returns the status with the cache that still matches. */
  async setConfig(raw: unknown): Promise<PluginMarketStatus> {
    const next = normalizeMarketConfig(raw);
    const prev = this.config();
    await this.deps.meta.setSetting(MARKET_SETTING, next);
    if (prev.url !== next.url) this.memory = undefined;
    if (!next.url) await fs.rm(this.cacheFile(), { force: true }).catch(() => {});
    return this.status();
  }

  private async readCache(): Promise<MarketCache | null> {
    try {
      const file = this.cacheFile();
      const st = await fs.stat(file);
      // the JSON envelope repeats the body with escapes: allow a few times the raw catalog cap
      if (!st.isFile() || st.size > MAX_CATALOG_BYTES * 4 || st.size <= 0) return null;
      const j = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<MarketCache>;
      if (!j || j.version !== 1 || typeof j.url !== 'string' || typeof j.body !== 'string' || typeof j.fetchedAt !== 'number') return null;
      return { version: 1, url: j.url, fetchedAt: j.fetchedAt, body: j.body };
    } catch {
      return null;
    }
  }

  private async writeCache(c: MarketCache): Promise<void> {
    const file = this.cacheFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${this.now()}.tmp`;
    const text = JSON.stringify(c);
    await fs.writeFile(tmp, text, { mode: 0o600 });
    try {
      await fs.rename(tmp, file);
    } catch {
      await fs.rm(tmp, { force: true }).catch(() => {});
      await fs.writeFile(file, text, { mode: 0o600 });
    }
  }

  /** The cached catalog for the configured URL (never a network call). */
  async status(): Promise<PluginMarketStatus> {
    const config = this.config();
    if (!config.url) return { config, entries: [], errors: [], signed: false };
    const cached = this.memory && this.memory.url === config.url ? this.memory : await this.readCache();
    if (!cached || cached.url !== config.url) return { config, entries: [], errors: [], signed: false };
    try {
      const parsed = parseSignedMarketCatalog(cached.body, config.publicKey);
      return { config, ...parsed.catalog, fetchedAt: cached.fetchedAt, signed: parsed.signed };
    } catch (e) {
      // a key change / hand-edited cache: show why instead of silently installing from it
      return { config, entries: [], errors: [], fetchedAt: cached.fetchedAt, signed: false, error: (e as Error).message };
    }
  }

  /** Fetch, verify and cache the catalog. A failure keeps the last good cache and throws a showable message. */
  async refresh(): Promise<PluginMarketStatus> {
    const config = this.config();
    if (!config.url) throw new Error(tr('还没设置插件市场地址'));
    const bytes = await this.download(config.url, MAX_CATALOG_BYTES, CATALOG_TIMEOUT_MS, tr('插件市场目录太大'));
    const body = bytes.toString('utf8');
    const parsed = parseSignedMarketCatalog(body, config.publicKey);
    const fetchedAt = this.now();
    const cache: MarketCache = { version: 1, url: config.url, fetchedAt, body };
    await this.writeCache(cache);
    this.memory = cache;
    return { config, ...parsed.catalog, fetchedAt, signed: parsed.signed };
  }

  /** netguard: the market and its entries are on the internet; a direct install URL may also be this machine / LAN */
  private fetcher(policy: EgressPolicy): (u: URL, init: RequestInit) => Promise<Response> {
    if (this.deps.fetch && !this.deps.lookup) return this.deps.fetch;
    return guardedFetch({ policy, ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}), ...(this.deps.lookup ? { lookup: this.deps.lookup } : {}) });
  }

  private async download(url: string, maxBytes: number, timeoutMs: number, tooBig: string, policy: EgressPolicy = 'public'): Promise<Buffer> {
    const f = this.fetcher(policy);
    let cur: URL;
    try { cur = new URL(url); } catch { throw new Error(tr('插件市场地址不合法')); }
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // the catalog setting and catalog entry URLs are https-only; a direct install URL may also be this machine
      const httpLocal = cur.protocol === 'http:' && isLoopback(cur.hostname);
      if ((cur.protocol !== 'https:' && !httpLocal) || cur.username || cur.password) throw new Error(tr('插件市场地址必须是 https 地址'));
      const res = await f(cur, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json, application/zip, application/gzip, application/octet-stream' },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new Error(tr('下载失败：HTTP {status}', { status: res.status }));
        cur = new URL(location, cur);
        continue;
      }
      if (!res.ok) throw new Error(tr('下载失败：HTTP {status}', { status: res.status }));
      return await readCapped(res, maxBytes, tooBig);
    }
    throw new Error(tr('插件市场重定向次数太多'));
  }

  private async readLocal(file: string): Promise<Buffer> {
    const target = path.resolve(file);
    let st;
    try { st = await fs.stat(target); } catch { throw new Error(tr('没有这个插件包')); }
    if (!st.isFile()) throw new Error(tr('没有这个插件包'));
    if (st.size > MAX_PACKAGE_BYTES) throw new Error(tr('插件包太大'));
    return fs.readFile(target);
  }

  /** An id / folder / `.json` may not already exist (an upgrade must remove the old one first). */
  private async assertFree(id: string): Promise<void> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    const low = id.toLowerCase();
    for (const n of names) {
      if (n === '.tmp' || n === '.market' || n === '.runtime') continue;
      if (n.replace(/\.json$/i, '').toLowerCase() === low) throw new Error(tr('这个插件已经安装'));
    }
  }

  private async installDeclarative(bytes: Buffer, expected: { id?: string; name?: string; version?: string }): Promise<PluginInstallResult['installed']> {
    if (bytes.length > MAX_DECLARATIVE_BYTES) throw new Error(tr('插件文件太大'));
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    let def;
    try {
      def = parseDeclarative(text, expected.id || 'plugin');
    } catch (e) {
      throw new Error(tr('插件定义无效：{why}', { why: (e as Error).message }));
    }
    if (!PLUGIN_ID_RE.test(def.id) || def.id.startsWith('.') || /[. ]$/.test(def.id)) throw new Error(tr('插件 id 不合法'));
    if (expected.id && def.id !== expected.id) throw new Error(tr('插件清单的 id 和目录条目不一致'));
    await fs.mkdir(this.dir, { recursive: true });
    await this.assertFree(def.id);
    const tmpDir = path.join(this.dir, '.tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const temp = path.join(tmpDir, `${def.id}.${process.pid}.${this.now()}.json`);
    await fs.writeFile(temp, text, { mode: 0o600 });
    const file = `${def.id}.json`;
    try {
      await fs.rename(temp, path.join(this.dir, file));
    } catch (e) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw e;
    }
    return { id: def.id, name: def.name, version: def.version ?? '0.0.0', kind: 'declarative', file };
  }

  private async installExecutable(bytes: Buffer, expected: { id?: string }): Promise<PluginInstallResult['installed']> {
    const files = extractPluginArchive(bytes);
    const raw = files.get('plugin.json');
    if (!raw) throw new Error(tr('插件包缺少 plugin.json'));
    let manifest;
    try {
      manifest = parseManifest(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')));
    } catch (e) {
      throw new Error(tr('插件清单无效：{why}', { why: (e as Error).message }));
    }
    if (expected.id && manifest.id !== expected.id) throw new Error(tr('插件清单的 id 和目录条目不一致'));
    if (manifest.id.startsWith('.') || /[. ]$/.test(manifest.id)) throw new Error(tr('插件 id 不合法'));
    const main = manifest.main.replace(/\\/g, '/');
    if (!files.has(main)) throw new Error(tr('插件包缺少入口文件：{main}', { main: manifest.main }));
    await fs.mkdir(this.dir, { recursive: true });
    await this.assertFree(manifest.id);
    const tmpDir = path.join(this.dir, '.tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const staging = await fs.mkdtemp(path.join(tmpDir, 'install-'));
    try {
      await writePluginTree(staging, files);
      await fs.rename(staging, path.join(this.dir, manifest.id));
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
    return { id: manifest.id, name: manifest.name, version: manifest.version, kind: 'executable', file: manifest.id };
  }

  /**
   * Download / read, verify, extract and install one package. Returns what went in; the caller reloads the service.
   * `id` installs the catalog entry with that id; `url` / `path` install a package directly.
   */
  async install(input: PluginInstallInput): Promise<PluginInstallResult['installed']> {
    const id = str(input.id);
    const directUrl = str(input.url);
    const localPath = str(input.path);
    if (!id && !directUrl && !localPath) throw new Error(tr('缺少插件包'));
    const config = this.config();
    let entry: MarketEntry | undefined;
    if (id) {
      const st = await this.status();
      if (st.error) throw new Error(st.error);
      entry = st.entries.find((e) => e.id === id);
      if (!entry) throw new Error(tr('市场里没有这个插件：{id}', { id: id.slice(0, 80) }));
      if (!isCompatible(entry, this.appVersion())) throw new Error(tr('这个插件需要更新版本的 claude-web'));
    }
    const expected = {
      id: entry?.id ?? id,
      name: entry?.name,
      version: entry?.version,
      sha256: str(input.sha256).toLowerCase() || entry?.sha256,
      signature: entry?.signature,
      kind: entry?.kind,
    };
    if (expected.sha256 && !/^[a-f0-9]{64}$/.test(expected.sha256)) throw new Error(tr('插件包的校验值不合法'));
    let bytes: Buffer;
    if (localPath) {
      bytes = await this.readLocal(localPath);
    } else {
      const url = directUrl || entry?.url;
      if (!url) throw new Error(tr('缺少插件包地址'));
      bytes = await this.download(url, MAX_PACKAGE_BYTES, PACKAGE_TIMEOUT_MS, tr('插件包太大'), directUrl ? 'local' : 'public');
    }
    if (expected.sha256 && sha256Hex(bytes) !== expected.sha256) throw new Error(tr('插件包的校验值不对'));
    if (expected.signature) {
      if (!config.publicKey) throw new Error(tr('插件包带签名，但插件市场没有配置公钥'));
      if (!verifyArchiveSignature(bytes, expected.signature, config.publicKey)) throw new Error(tr('插件包签名不对'));
    }
    const kind = expected.kind ?? sniffKind(bytes, localPath || directUrl);
    if (!kind) throw new Error(tr('只支持 .zip / .tar.gz / .json 格式的插件包'));
    if (kind === 'declarative' && (isZipBytes(bytes) || isGzipBytes(bytes))) throw new Error(tr('插件包的格式和目录条目的类型不一致'));
    return kind === 'declarative' ? this.installDeclarative(bytes, expected) : this.installExecutable(bytes, expected);
  }
}
