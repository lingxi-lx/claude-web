// 托管程序 (spec 2026-10-26 §3.2): CLIProxyAPI and Magpie — download from their GitHub releases, verify SHA-256,
// keep the previous build for rollback, run on 127.0.0.1 with an allocated port and keys of our own (encrypted in
// meta like every other secret), health-check, stop with the whole process tree, and register the running gateway
// as an Anthropic-compatible provider. A copy the user already runs is connected instead of installed again.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { dataDir } from '../files/service.js';
import { tr } from '../i18n/index.js';
import type { MetaStore } from '../meta/store.js';
import type { ProviderService } from '../providers/service.js';
import type { SecretService } from '../secrets/service.js';
import { freePort, unpack } from '../upstreams/sidecar.js';
import { planModels } from '../channels/plan.js';
import { MANIFESTS, type EngineManifest } from './manifests/index.js';
import { startProcess, stopTree, tailLog } from './process.js';
import type { EngineId, EngineStatus } from './types.js';

const READY_MS = 30_000;
const HEALTH_MS = 30_000;
const DETECT_TTL = 10_000;

interface Build { entry: string; sha256: string; verified: 'release' | 'recorded'; asset: string; at: number }
interface EngineState {
  version?: string;
  previousVersion?: string;
  builds?: Record<string, Build>;
  port?: number;
  clientKey?: string;
  managementKey?: string;
  providerId?: string;
  mode?: 'managed' | 'connected';
  connectedPort?: number;
  /** it was running when the server last stopped (started again at startup) */
  autoStart?: boolean;
}

interface Runtime {
  child: ChildProcess;
  port: number;
  health: EngineStatus['health'];
  detail?: string;
  stopping: boolean;
  monitor?: NodeJS.Timeout;
  fails: number;
}

interface GhAsset { name: string; browser_download_url: string; size?: number; digest?: string | null }
interface GhRelease { tag_name: string; assets: GhAsset[] }

export interface EngineDeps {
  meta: MetaStore;
  secrets?: SecretService;
  providers: Pick<ProviderService, 'upsert' | 'remove' | 'refreshModels' | 'list'>;
  /** default <dataDir>/engines */
  root?: string;
}

const exe = process.platform === 'win32' ? '.exe' : '';
const OS_WORDS: Record<string, RegExp> = { win32: /(windows|win64|win32|[-_.]win[-_.])/i, darwin: /(darwin|macos|[-_.]mac[-_.]|osx)/i, linux: /linux/i };
const ARCH_WORDS: Record<string, RegExp> = { x64: /(amd64|x86_64|x64)/i, arm64: /(arm64|aarch64)/i };
const NOT_A_BUILD = /(\.(sha256|sha512|sig|asc|txt|json|deb|rpm|dmg|pkg|msi|appimage|apk|sbom|pem)$)|checksums|sha256sums|installer|setup/i;
const isArchive = (name: string) => /\.zip$/i.test(name) ? 'zip' as const : /\.(tar\.gz|tgz)$/i.test(name) ? 'tar.gz' as const : null;

export const platformKey = () => `${process.platform}-${process.arch}`;

/** The build for this OS / CPU among a release's assets (the manifest's preference first, archives before bare files). */
export function pickAsset(m: Pick<EngineManifest, 'prefer'>, assets: GhAsset[], platform = process.platform, arch = process.arch): GhAsset | null {
  const os = OS_WORDS[platform];
  const cpu = ARCH_WORDS[arch];
  if (!os || !cpu) return null;
  const fits = assets.filter((a) => os.test(a.name) && cpu.test(a.name) && !NOT_A_BUILD.test(a.name));
  const score = (a: GhAsset) => (m.prefer?.test(a.name) ? 0 : 2) + (isArchive(a.name) ? 0 : 1);
  return fits.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))[0] ?? null;
}

async function portFree(port: number): Promise<boolean> {
  const srv = net.createServer();
  try {
    await new Promise<void>((r, j) => { srv.once('error', j); srv.listen(port, '127.0.0.1', () => r()); });
    await new Promise<void>((r) => srv.close(() => r()));
    return true;
  } catch {
    return false;
  }
}

/** Find the executable anywhere (three levels) under `dir`. */
async function findEntry(dir: string, entry: string, depth = 0): Promise<string | null> {
  const names = new Set([`${entry}${exe}`, entry]);
  let items: import('node:fs').Dirent[] = [];
  try { items = await fs.readdir(dir, { withFileTypes: true }); } catch { return null; }
  for (const d of items) if (d.isFile() && names.has(d.name)) return path.join(dir, d.name);
  // CLIProxyAPI's archives have been seen as CLIProxyAPI*/cli-proxy-api*; accept the entry as a name prefix too
  for (const d of items) if (d.isFile() && d.name.toLowerCase().startsWith(entry.toLowerCase()) && (!exe || d.name.toLowerCase().endsWith(exe))) return path.join(dir, d.name);
  if (depth >= 3) return null;
  for (const d of items) if (d.isDirectory()) { const hit = await findEntry(path.join(dir, d.name), entry, depth + 1); if (hit) return hit; }
  return null;
}

export class EngineManager extends EventEmitter {
  readonly root: string;
  private runs = new Map<EngineId, Runtime>();
  private busy = new Map<EngineId, Promise<unknown>>();
  private detected = new Map<EngineId, { at: number; hit: { port: number; version?: string } | null }>();
  private restarts = new Map<EngineId, number[]>();

  constructor(private deps: EngineDeps) {
    super();
    this.root = deps.root ?? path.join(dataDir(), 'engines');
  }

  private state(id: EngineId): EngineState {
    const all = this.deps.meta.engineState();
    return (all[id] ??= {}) as EngineState;
  }
  private async save() { await this.deps.meta.saveChannels(); }

  private async protect(plain: string, id: string): Promise<string> {
    return this.deps.secrets ? this.deps.secrets.protect(plain, `engine-${id}`) : plain;
  }
  private async reveal(v: string | undefined): Promise<string> {
    if (!v) return '';
    return this.deps.secrets ? this.deps.secrets.reveal(v) : v;
  }

  /** One operation per engine at a time (an install and a start racing would both download / spawn). */
  private serial<T>(id: EngineId, fn: () => Promise<T>): Promise<T> {
    const prev = this.busy.get(id) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.busy.set(id, next);
    return next.finally(() => { if (this.busy.get(id) === next) this.busy.delete(id); });
  }

  private manifest(id: EngineId): EngineManifest {
    const m = MANIFESTS[id];
    if (!m) throw new Error(tr('没有这个托管程序：{id}', { id }));
    return m;
  }

  private binary(id: EngineId, version = this.state(id).version): string | null {
    if (!version) return null;
    const b = this.state(id).builds?.[version];
    if (!b) return null;
    const p = path.join(this.root, id, version, b.entry);
    return existsSync(p) ? p : null;
  }

  // ---- status ----

  private async detect(id: EngineId): Promise<{ port: number; version?: string } | null> {
    const hit = this.detected.get(id);
    if (hit && Date.now() - hit.at < DETECT_TTL) return hit.hit;
    const m = this.manifest(id);
    const found = await m.detect(m.defaultPort).catch(() => null);
    const out = found ? { port: m.defaultPort, ...found } : null;
    this.detected.set(id, { at: Date.now(), hit: out });
    return out;
  }

  private warnings(id: EngineId): string[] {
    const st = this.state(id);
    const out: string[] = [];
    for (const w of this.manifest(id).warnings) if (w === 'self-update') out.push(tr('Magpie 会在后台自己更新，实际运行的版本可能和这里装的不同'));
    const b = st.version ? st.builds?.[st.version] : undefined;
    if (b?.verified === 'recorded') out.push(tr('这个版本的发布没有附带 SHA-256：首次安装时记下了文件的哈希，只能保证之后没被换过'));
    return out;
  }

  async status(id: EngineId): Promise<EngineStatus> {
    const m = this.manifest(id);
    const st = this.state(id);
    const run = this.runs.get(id);
    const installed = !!this.binary(id);
    let health: EngineStatus['health'] = run?.health ?? 'stopped';
    let detail = run?.detail;
    let running = !!run && run.health !== 'stopped';
    let port = run?.port ?? st.port;
    if (st.mode === 'connected' && st.connectedPort) {
      port = st.connectedPort;
      const alive = await m.detect(st.connectedPort).catch(() => null);
      running = !!alive;
      health = alive ? 'ok' : 'error';
      detail = alive ? undefined : tr('连不上 127.0.0.1:{port} 上的 {name}', { port: st.connectedPort, name: m.name });
    }
    const detected = !running && st.mode !== 'connected' ? await this.detect(id) : null;
    const b = st.version ? st.builds?.[st.version] : undefined;
    return {
      id,
      name: m.name,
      repo: m.repo,
      platform: platformKey(),
      installed,
      running,
      ...(st.mode ? { mode: st.mode } : {}),
      ...(installed && st.version ? { version: st.version } : {}),
      ...(st.previousVersion ? { previousVersion: st.previousVersion } : {}),
      ...(b ? { verified: b.verified } : {}),
      ...(port ? { port } : {}),
      health,
      ...(detail ? { detail } : {}),
      ...(detected ? { detected } : {}),
      ...(st.providerId && this.deps.providers.list().some((p) => p.id === st.providerId) ? { providerId: st.providerId } : {}),
      warnings: this.warnings(id),
    };
  }

  async statuses(): Promise<EngineStatus[]> {
    return Promise.all((Object.keys(MANIFESTS) as EngineId[]).map((id) => this.status(id)));
  }

  // ---- install / upgrade / rollback ----

  private async release(m: EngineManifest, tag?: string): Promise<GhRelease> {
    const url = tag ? `https://api.github.com/repos/${m.repo}/releases/tags/${encodeURIComponent(tag)}` : `https://api.github.com/repos/${m.repo}/releases/latest`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'claude-web' }, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new Error(tr('读不到 {name} 的发布列表：{message}', { name: m.name, message: (e as Error).message }));
    }
    if (!res.ok) throw new Error(tr('读不到 {name} 的发布列表：HTTP {status}', { name: m.name, status: res.status }));
    const j = await res.json() as GhRelease;
    if (!j?.tag_name || !Array.isArray(j.assets)) throw new Error(tr('{name} 的发布信息格式不对', { name: m.name }));
    return j;
  }

  /** The release's own SHA-256 for this asset: GitHub's asset digest, else a checksums file published with it. */
  private async releaseHash(rel: GhRelease, asset: GhAsset): Promise<string | null> {
    if (asset.digest && /^sha256:[0-9a-f]{64}$/i.test(asset.digest)) return asset.digest.slice(7).toLowerCase();
    const sums = rel.assets.find((a) => a.name === `${asset.name}.sha256`) ?? rel.assets.find((a) => /(checksums?|sha256sums?)(\.txt)?$/i.test(a.name));
    if (!sums) return null;
    try {
      const text = await (await fetch(sums.browser_download_url, { signal: AbortSignal.timeout(20_000) })).text();
      for (const line of text.split(/\r?\n/)) {
        const mm = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
        if (mm && (mm[2].trim() === asset.name || path.basename(mm[2].trim()) === asset.name)) return mm[1].toLowerCase();
      }
      // a `<asset>.sha256` file holding only the hash
      const only = /^([0-9a-f]{64})\b/i.exec(text.trim());
      return sums.name === `${asset.name}.sha256` && only ? only[1].toLowerCase() : null;
    } catch {
      return null;
    }
  }

  install(id: EngineId, tag?: string): Promise<EngineStatus> {
    return this.serial(id, async () => { await this.installNow(id, tag); return this.status(id); });
  }

  private async installNow(id: EngineId, tag?: string): Promise<string> {
    const m = this.manifest(id);
    const st = this.state(id);
    const rel = await this.release(m, tag ?? m.pin);
    const version = rel.tag_name;
    if (this.binary(id, version)) {
      if (st.version !== version) { st.previousVersion = st.version; st.version = version; await this.save(); }
      return version;
    }
    const asset = pickAsset(m, rel.assets);
    if (!asset) throw new Error(tr('{name} {version} 没有这个平台（{platform}）的版本', { name: m.name, version, platform: platformKey() }));
    const expected = await this.releaseHash(rel, asset);
    const dir = path.join(this.root, id);
    const tmp = path.join(dir, `.tmp-${crypto.randomBytes(4).toString('hex')}`);
    await fs.mkdir(tmp, { recursive: true });
    try {
      let res: Response;
      try {
        res = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(10 * 60_000) });
      } catch (e) {
        throw new Error(tr('下载 {name} 失败：{message}', { name: m.name, message: (e as Error).message }));
      }
      if (!res.ok) throw new Error(tr('下载 {name} 失败：HTTP {status}', { name: m.name, status: res.status }));
      const buf = Buffer.from(await res.arrayBuffer());
      if (asset.size && buf.length !== asset.size) throw new Error(tr('{name} 下载不完整（{got} / {want} 字节）', { name: m.name, got: buf.length, want: asset.size }));
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      if (expected && hash !== expected) throw new Error(tr('{name} 校验失败（SHA-256 和发布的不一致），已丢弃', { name: m.name }));
      // no published hash: one we recorded earlier for the same file must still match
      const before = st.builds?.[version];
      if (!expected && before && before.asset === asset.name && before.sha256 !== hash) throw new Error(tr('{name} 的文件和上次安装时记下的哈希不一致，已丢弃', { name: m.name }));
      const kind = isArchive(asset.name);
      const dl = path.join(tmp, kind === 'zip' ? 'download.zip' : kind ? 'download.tar.gz' : `${m.entry}${exe}`);
      await fs.writeFile(dl, buf);
      if (kind) {
        const out = path.join(tmp, 'x');
        await fs.mkdir(out, { recursive: true });
        await unpack(kind, dl, out);
      }
      const found = kind ? await findEntry(path.join(tmp, 'x'), m.entry) : dl;
      if (!found) throw new Error(tr('{name} 的安装包里没有找到 {entry}', { name: m.name, entry: m.entry }));
      const entryName = `${m.entry}${exe}`;
      const dest = path.join(dir, version);
      await fs.rm(dest, { recursive: true, force: true });
      await fs.mkdir(dest, { recursive: true });
      // the whole folder the executable came from (some builds ship files next to it)
      if (kind) await fs.cp(path.dirname(found), dest, { recursive: true });
      else await fs.copyFile(found, path.join(dest, entryName));
      if (path.basename(found) !== entryName && kind) await fs.rename(path.join(dest, path.basename(found)), path.join(dest, entryName));
      await fs.chmod(path.join(dest, entryName), 0o755).catch(() => {});
      st.builds = { ...(st.builds ?? {}), [version]: { entry: entryName, sha256: hash, verified: expected ? 'release' : 'recorded', asset: asset.name, at: Date.now() } };
      if (st.version && st.version !== version) st.previousVersion = st.version;
      st.version = version;
      // keep the current and the previous build only
      for (const v of Object.keys(st.builds)) {
        if (v === st.version || v === st.previousVersion) continue;
        delete st.builds[v];
        await fs.rm(path.join(dir, v), { recursive: true, force: true }).catch(() => {});
      }
      await this.save();
      return version;
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  upgrade(id: EngineId): Promise<EngineStatus> {
    return this.serial(id, async () => {
      const st = this.state(id);
      const was = st.version;
      const running = this.runs.has(id);
      const now = await this.installNow(id);
      if (now === was) return this.status(id);
      if (running) {
        await this.stopNow(id, false);
        try {
          await this.startNow(id);
        } catch (e) {
          // the new build does not come up: back to the one that did
          st.version = was;
          st.previousVersion = now;
          await this.save();
          await this.startNow(id).catch(() => {});
          throw new Error(tr('新版本启动失败，已回到 {version}：{message}', { version: was ?? '?', message: (e as Error).message }));
        }
      }
      return this.status(id);
    });
  }

  rollback(id: EngineId): Promise<EngineStatus> {
    return this.serial(id, async () => {
      const st = this.state(id);
      if (!st.previousVersion || !this.binary(id, st.previousVersion)) throw new Error(tr('没有可以回退的上一个版本'));
      const running = this.runs.has(id);
      if (running) await this.stopNow(id, false);
      [st.version, st.previousVersion] = [st.previousVersion, st.version];
      await this.save();
      if (running) await this.startNow(id);
      return this.status(id);
    });
  }

  // ---- run ----

  start(id: EngineId): Promise<EngineStatus> {
    return this.serial(id, async () => { await this.startNow(id); return this.status(id); });
  }

  private async keys(id: EngineId, m: EngineManifest): Promise<{ clientKey: string; managementKey: string }> {
    const st = this.state(id);
    let clientKey = m.fixedClientKey ?? await this.reveal(st.clientKey).catch(() => '');
    if (!clientKey) {
      clientKey = `cw-${crypto.randomBytes(24).toString('hex')}`;
      st.clientKey = await this.protect(clientKey, id);
    }
    let managementKey = '';
    if (m.managementKey) {
      managementKey = await this.reveal(st.managementKey).catch(() => '');
      if (!managementKey) {
        managementKey = crypto.randomBytes(24).toString('hex');
        st.managementKey = await this.protect(managementKey, `${id}-management`);
      }
    }
    await this.save();
    return { clientKey, managementKey };
  }

  private async startNow(id: EngineId): Promise<void> {
    const m = this.manifest(id);
    const st = this.state(id);
    if (st.mode === 'connected') {
      const port = st.connectedPort ?? m.defaultPort;
      if (!(await m.detect(port))) throw new Error(tr('连不上 127.0.0.1:{port} 上的 {name}', { port, name: m.name }));
      return;
    }
    if (this.runs.get(id)?.health === 'ok') return;
    if (!this.binary(id)) await this.installNow(id);
    const bin = this.binary(id);
    if (!bin) throw new Error(tr('{name} 没有装好', { name: m.name }));
    const { clientKey, managementKey } = await this.keys(id, m);
    // the port it had last time when it is free (the provider's address stays the same), else a new one
    const port = st.port && st.port !== m.defaultPort && await portFree(st.port) ? st.port : await freePort();
    if (st.port !== port) { st.port = port; await this.save(); }
    const dir = path.join(this.root, id, 'data');
    await fs.mkdir(dir, { recursive: true });
    const ctx = { port, dir, clientKey, managementKey };
    if (m.prepare) await m.prepare(ctx);
    const child = startProcess(bin, m.args(ctx), { cwd: dir, env: m.env(ctx), root: this.root, id });
    const run: Runtime = { child, port, health: 'starting', stopping: false, fails: 0 };
    this.runs.set(id, run);
    let spawnError = '';
    child.once('error', (e) => { spawnError = e.message; });
    child.once('exit', (code, signal) => {
      if (this.runs.get(id) !== run) return;
      this.clearMonitor(run);
      this.runs.delete(id);
      this.emit('changed', id);
      if (run.stopping) return;
      this.crashed(id, tr('{name} 退出了（{code}）', { name: m.name, code: code ?? signal ?? '?' }));
    });
    const deadline = Date.now() + READY_MS;
    while (Date.now() < deadline) {
      if (this.runs.get(id) !== run) throw new Error(spawnError || tr('{name} 启动后马上退出了，看看日志', { name: m.name }));
      if (await m.health({ port, clientKey }).catch(() => false)) {
        run.health = 'ok';
        run.detail = undefined;
        this.monitor(id, run, m, clientKey);
        st.autoStart = true;
        await this.save();
        await this.register(id, m.baseUrl(port), clientKey);
        this.emit('changed', id);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    run.stopping = true;
    await stopTree(child);
    this.runs.delete(id);
    throw new Error(tr('{name} 30 秒内没有就绪，看看日志', { name: m.name }));
  }

  /** Unexpected exit: up to three restarts within ten minutes (2 s, 4 s, 8 s apart), then it stays down with the reason. */
  private crashed(id: EngineId, why: string): void {
    const now = Date.now();
    const recent = (this.restarts.get(id) ?? []).filter((t) => now - t < 10 * 60_000);
    this.detected.delete(id);
    if (recent.length >= 3) {
      this.restarts.set(id, recent);
      this.emit('crash', id, why);
      return;
    }
    recent.push(now);
    this.restarts.set(id, recent);
    const t = setTimeout(() => {
      if (this.runs.has(id) || !this.state(id).autoStart) return;
      void this.start(id).catch((e) => this.emit('crash', id, (e as Error).message));
    }, 1000 * 2 ** recent.length);
    t.unref?.();
  }

  private monitor(id: EngineId, run: Runtime, m: EngineManifest, clientKey: string): void {
    this.clearMonitor(run);
    run.monitor = setInterval(() => {
      if (this.runs.get(id) !== run) return;
      void m.health({ port: run.port, clientKey }).catch(() => false).then((ok) => {
        if (ok) { run.fails = 0; if (run.health !== 'ok') { run.health = 'ok'; run.detail = undefined; this.emit('changed', id); } return; }
        run.fails += 1;
        if (run.fails >= 3 && run.health === 'ok') {
          run.health = 'error';
          run.detail = tr('连续 3 次健康检查没有回应');
          this.emit('changed', id);
        }
      });
    }, HEALTH_MS);
    run.monitor.unref?.();
  }

  private clearMonitor(run: Runtime) { if (run.monitor) { clearInterval(run.monitor); run.monitor = undefined; } }

  /** Point an Anthropic-format provider at the gateway (the same profile every time; its address follows the port). */
  private async register(id: EngineId, baseUrl: string, key: string): Promise<void> {
    const m = this.manifest(id);
    const st = this.state(id);
    const exists = st.providerId && this.deps.providers.list().some((p) => p.id === st.providerId);
    // authStyle (spec §5.1, added by the privacy slice): magpie takes Bearer or x-api-key; unknown for CLIProxyAPI
    const auth = (m.id === 'magpie' ? { authStyle: 'both' } : {}) as Record<string, unknown>;
    const saved = await this.deps.providers.upsert({ ...(exists ? { id: st.providerId } : {}), name: m.name, type: 'anthropic', baseUrl, apiKey: key, ...auth });
    st.providerId = saved.id;
    this.deps.meta.channelLinks()[saved.id] = { catalogId: id, engine: id };
    await this.save();
    // the model list in the background: the source shows up at once, its models a moment later
    void this.deps.providers.refreshModels([saved.id]).then(async ([r]) => {
      const p = this.deps.providers.list().find((x) => x.id === saved.id);
      // a default model / family map the first time (the user's own choice later is kept)
      if (r?.ok && p && !p.defaultModel && p.models?.length) await this.deps.providers.upsert({ id: p.id, ...planModels('anthropic', p.models) });
      this.emit('changed', id);
    }).catch(() => {});
  }

  stop(id: EngineId): Promise<EngineStatus> {
    return this.serial(id, async () => { await this.stopNow(id, true); return this.status(id); });
  }

  private async stopNow(id: EngineId, byUser: boolean): Promise<void> {
    const st = this.state(id);
    if (byUser) { st.autoStart = false; await this.save(); }
    const run = this.runs.get(id);
    if (!run) return;
    run.stopping = true;
    this.clearMonitor(run);
    await stopTree(run.child);
    if (this.runs.get(id) === run) this.runs.delete(id);
    this.detected.delete(id);
    this.emit('changed', id);
  }

  /** Server shutdown: stop what we started, but remember it should come back. */
  async stopAll(): Promise<void> {
    for (const [id, run] of [...this.runs]) {
      run.stopping = true;
      this.clearMonitor(run);
      await stopTree(run.child).catch(() => {});
      this.runs.delete(id);
    }
  }

  /** Server start: bring back the engines that were running. */
  async resume(): Promise<void> {
    for (const id of Object.keys(MANIFESTS) as EngineId[]) {
      const st = this.state(id);
      if (st.mode !== 'connected' && st.autoStart && this.binary(id)) await this.start(id).catch((e) => console.error(`[engines] ${id}: ${(e as Error).message}`));
    }
  }

  uninstall(id: EngineId): Promise<EngineStatus> {
    return this.serial(id, async () => {
      await this.stopNow(id, true);
      await this.forgetProvider(id);
      await fs.rm(path.join(this.root, id), { recursive: true, force: true });
      delete this.deps.meta.engineState()[id];
      await this.save();
      this.detected.delete(id);
      return this.status(id);
    });
  }

  /** Stop using it as a source (the build stays installed). */
  disconnect(id: EngineId): Promise<EngineStatus> {
    return this.serial(id, async () => {
      await this.stopNow(id, true);
      await this.forgetProvider(id);
      const st = this.state(id);
      if (st.mode === 'connected') { delete st.mode; delete st.connectedPort; delete st.clientKey; }
      await this.save();
      return this.status(id);
    });
  }

  private async forgetProvider(id: EngineId): Promise<void> {
    const st = this.state(id);
    if (st.providerId) {
      if (this.deps.providers.list().some((p) => p.id === st.providerId)) await this.deps.providers.remove(st.providerId);
      delete this.deps.meta.channelLinks()[st.providerId];
      delete st.providerId;
    }
  }

  /** Use a copy the user already runs: check it answers (and the key works), then register it. */
  connect(id: EngineId, port?: number, key?: string): Promise<EngineStatus> {
    return this.serial(id, async () => {
      const m = this.manifest(id);
      const p = port ?? m.defaultPort;
      if (!Number.isInteger(p) || p <= 0 || p > 65535) throw new Error(tr('端口不对'));
      if (!(await m.detect(p))) throw new Error(tr('127.0.0.1:{port} 上没有找到 {name}', { port: p, name: m.name }));
      const clientKey = key?.trim() || m.fixedClientKey;
      if (!clientKey) throw new Error(tr('连接 {name} 需要它的客户端 Key（配置里 access.api-keys 的一项）', { name: m.name }));
      if (!(await m.health({ port: p, clientKey }).catch(() => false))) throw new Error(tr('{name} 拒绝了这个 Key，或者没有回应', { name: m.name }));
      if (this.runs.has(id)) await this.stopNow(id, true);
      const st = this.state(id);
      st.mode = 'connected';
      st.connectedPort = p;
      st.clientKey = await this.protect(clientKey, id);
      await this.save();
      await this.register(id, m.baseUrl(p), clientKey);
      this.detected.delete(id);
      return this.status(id);
    });
  }

  logs(id: EngineId, lines = 200): Promise<string> {
    this.manifest(id);
    return tailLog(this.root, id, Math.max(1, Math.min(5000, lines)));
  }
}
