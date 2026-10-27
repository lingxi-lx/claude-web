// PluginService: what is under <dataDir>/plugins, which plugins are on, and the approval of an executable
// plugin's permissions (bound to a hash of its manifest: a changed manifest has to be approved again).
// State lives in meta.json settings (`plugins.state`) — never the secrets themselves.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MetaStore } from '../meta/store.js';
import type { SecretService } from '../secrets/service.js';
import { dataDir } from '../files/service.js';
import { loadDeclarativeDir, parseSource, setPluginSources, type LoadedDeclarative } from './declarative.js';
import { BOOTSTRAP, PluginRunner, readManifest } from './runtime.js';
import type { DeclarativeSource, PluginHook, PluginListResult, PluginManifest, PluginView } from './protocol.js';
import { tr } from '../i18n/index.js';

interface PluginState { enabled: boolean; approvedHash?: string }
const STATE_KEY = 'plugins.state';

export const pluginsDir = () => path.join(dataDir(), 'plugins');

const manifestHash = (m: PluginManifest) =>
  crypto.createHash('sha256').update(JSON.stringify({ main: m.main, hooks: [...m.hooks].sort(), permissions: m.permissions })).digest('hex').slice(0, 24);

interface Executable { folder: string; dir: string; manifest?: PluginManifest; error?: string; runner?: PluginRunner }

export class PluginService {
  private declarative: LoadedDeclarative[] = [];
  private executables: Executable[] = [];
  /** sources an executable plugin's `sources` hook returned, by plugin id */
  private provided = new Map<string, DeclarativeSource[]>();
  private warnings: string[] = [];

  constructor(private deps: { meta: MetaStore; secrets?: SecretService; dir?: string }) {}

  get dir(): string { return this.deps.dir ?? pluginsDir(); }
  private bootstrap(): string { return path.join(this.dir, '.runtime', 'host.cjs'); }

  private state(): Record<string, PluginState> {
    const v = this.deps.meta.settings()[STATE_KEY];
    return v && typeof v === 'object' ? (v as Record<string, PluginState>) : {};
  }
  private async setState(id: string, patch: Partial<PluginState> | null) {
    const all = { ...this.state() };
    if (patch === null) delete all[id];
    else all[id] = { ...(all[id] ?? { enabled: false }), ...patch };
    await this.deps.meta.setSetting(STATE_KEY, all);
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.bootstrap()), { recursive: true }).catch(() => {});
    await fs.writeFile(this.bootstrap(), BOOTSTRAP, 'utf8').catch(() => {});
    await this.reload();
  }

  async reload(): Promise<void> {
    for (const e of this.executables) e.runner?.stop();
    this.warnings = [];
    this.declarative = await loadDeclarativeDir(this.dir);
    this.executables = [];
    let names: string[] = [];
    try { names = await fs.readdir(this.dir); } catch { /* none yet */ }
    for (const n of names.sort()) {
      if (n.startsWith('.')) continue;
      const dir = path.join(this.dir, n);
      try {
        if (!(await fs.stat(dir)).isDirectory()) continue;
      } catch { continue; }
      try {
        const manifest = await readManifest(dir);
        this.executables.push({ folder: n, dir, manifest, runner: new PluginRunner(dir, manifest, { bootstrap: this.bootstrap(), secret: (name) => this.secret(manifest, name) }) });
      } catch (e) {
        this.executables.push({ folder: n, dir, error: (e as Error).message });
      }
    }
    const ids = new Set<string>();
    for (const d of this.declarative) if (d.def) { if (ids.has(d.def.id)) this.warnings.push(tr('插件 id 重复：{id}', { id: d.def.id })); ids.add(d.def.id); }
    for (const e of this.executables) if (e.manifest) { if (ids.has(e.manifest.id)) this.warnings.push(tr('插件 id 重复：{id}', { id: e.manifest.id })); ids.add(e.manifest.id); }
    await this.refreshProvided();
    this.publish();
  }

  /**
   * An approved secret: `provider:<id>` is that provider's key (decrypted here, sent only to this child).
   * Only names the manifest declares, only for a plugin whose current manifest the user approved.
   */
  private async secret(m: PluginManifest, name: string): Promise<string | undefined> {
    const st = this.state()[m.id];
    if (!st?.enabled || st.approvedHash !== manifestHash(m)) return undefined;
    if (!(m.permissions.secrets ?? []).includes(name)) return undefined;
    const pid = /^provider:(.+)$/.exec(name)?.[1];
    const p = pid ? this.deps.meta.provider(pid) : undefined;
    if (!p?.apiKey) return undefined;
    return this.deps.secrets ? this.deps.secrets.reveal(p.apiKey) : p.apiKey;
  }

  private enabled(id: string): boolean { return this.state()[id]?.enabled === true; }
  private approved(m: PluginManifest): boolean { return this.state()[m.id]?.approvedHash === manifestHash(m); }

  private async refreshProvided() {
    this.provided.clear();
    for (const e of this.executables) {
      const m = e.manifest;
      if (!m || !e.runner || !this.enabled(m.id) || !this.approved(m) || !m.hooks.includes('source-provider')) continue;
      try {
        const list = await e.runner.call<unknown[]>('source-provider', {});
        // data only: everything goes through the same validation as a JSON file
        this.provided.set(m.id, (Array.isArray(list) ? list : []).flatMap((s) => { try { return [parseSource(s)]; } catch { return []; } }));
      } catch (err) {
        e.error = (err as Error).message;
      }
    }
  }

  private publish() {
    const list: { pluginId: string; source: DeclarativeSource }[] = [];
    for (const d of this.declarative) if (d.def && this.enabled(d.def.id)) for (const s of d.def.sources) list.push({ pluginId: d.def.id, source: s });
    for (const [id, srcs] of this.provided) for (const s of srcs) list.push({ pluginId: id, source: s });
    setPluginSources(list);
  }

  list(): PluginListResult {
    const st = this.state();
    const plugins: PluginView[] = [];
    for (const d of this.declarative) {
      if (!d.def) {
        plugins.push({ id: d.file, kind: 'declarative', name: d.file, file: d.file, enabled: false, approved: true, hooks: [], permissions: {}, sources: 0, models: 0, error: d.error });
        continue;
      }
      plugins.push({
        id: d.def.id, kind: 'declarative', name: d.def.name, version: d.def.version, description: d.def.description, file: d.file,
        enabled: st[d.def.id]?.enabled === true, approved: true, hooks: [], permissions: {},
        sources: d.def.sources.length, models: d.def.sources.reduce((n, s) => n + s.models.length, 0),
      });
    }
    for (const e of this.executables) {
      const m = e.manifest;
      if (!m) {
        plugins.push({ id: e.folder, kind: 'executable', name: e.folder, file: e.folder, enabled: false, approved: false, hooks: [], permissions: {}, sources: 0, models: 0, error: e.error });
        continue;
      }
      const provided = this.provided.get(m.id) ?? [];
      plugins.push({
        id: m.id, kind: 'executable', name: m.name, version: m.version, description: m.description, file: e.folder,
        enabled: st[m.id]?.enabled === true, approved: this.approved(m), hooks: m.hooks, permissions: m.permissions,
        sources: provided.length, models: provided.reduce((n, s) => n + s.models.length, 0),
        isolation: e.runner?.isolation, running: e.runner?.running, error: e.error, lastOutput: e.runner?.lastOutput() || undefined,
      });
    }
    return { plugins, dir: this.dir, warnings: this.warnings };
  }

  private find(id: string): { decl?: LoadedDeclarative; exe?: Executable } {
    const decl = this.declarative.find((d) => d.def?.id === id || d.file === id);
    if (decl) return { decl };
    const exe = this.executables.find((e) => e.manifest?.id === id || e.folder === id);
    if (exe) return { exe };
    throw new Error(tr('没有这个插件'));
  }

  /** Turn on. An executable plugin needs `approve: true` (its permissions were shown to the user) the first time and after a manifest change. */
  async enable(id: string, approve = false): Promise<PluginListResult> {
    const { decl, exe } = this.find(id);
    if (decl) {
      if (!decl.def) throw new Error(decl.error ?? tr('插件文件无效'));
      await this.setState(decl.def.id, { enabled: true });
    } else if (exe) {
      if (!exe.manifest) throw new Error(exe.error ?? tr('插件文件无效'));
      if (!this.approved(exe.manifest) && !approve) throw new Error(tr('先确认这个插件要的权限'));
      await this.setState(exe.manifest.id, { enabled: true, approvedHash: manifestHash(exe.manifest) });
    }
    await this.refreshProvided();
    this.publish();
    return this.list();
  }

  async disable(id: string): Promise<PluginListResult> {
    const { decl, exe } = this.find(id);
    const pid = decl?.def?.id ?? exe?.manifest?.id ?? id;
    exe?.runner?.stop();
    await this.setState(pid, { enabled: false });
    this.provided.delete(pid);
    this.publish();
    return this.list();
  }

  /** Delete the file / folder (only ever inside the plugins directory). */
  async remove(id: string): Promise<PluginListResult> {
    const { decl, exe } = this.find(id);
    const name = decl?.file ?? exe?.folder;
    if (!name) throw new Error(tr('没有这个插件'));
    const target = path.resolve(this.dir, name);
    const rel = path.relative(this.dir, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(tr('没有这个插件'));
    exe?.runner?.stop();
    await fs.rm(target, { recursive: true, force: true });
    await this.setState(decl?.def?.id ?? exe?.manifest?.id ?? id, null);
    await this.reload();
    return this.list();
  }

  /** Whether any enabled, approved plugin declares the hook (the gateway calls nothing when none does). */
  hasHook(hook: Exclude<PluginHook, 'source-provider'>): boolean {
    return this.executables.some((e) => !!e.manifest && !!e.runner && this.enabled(e.manifest.id) && this.approved(e.manifest) && e.manifest.hooks.includes(hook));
  }

  /**
   * The gateway's extension points: every enabled, approved plugin declaring the hook, in name order. Each
   * call is isolated (a plugin that throws or times out is skipped, the request goes on unchanged).
   * gateway/service.ts calls `request-before` on each attempt's body after 隐私保护 redacted it, and
   * `response-after` on a whole non-streamed answer before it is restored (GatewayHookPayload).
   */
  async runHook<T>(hook: Exclude<PluginHook, 'source-provider'>, payload: T, onSkip?: (pluginId: string, why: 'too-large' | 'timeout' | 'error') => void): Promise<T> {
    let cur = payload;
    for (const e of this.executables) {
      const m = e.manifest;
      if (!m || !e.runner || !this.enabled(m.id) || !this.approved(m) || !m.hooks.includes(hook)) continue;
      try {
        const out = await e.runner.call<T | null>(hook, cur);
        if (out !== null && out !== undefined) cur = out;
      } catch (err) {
        const msg = (err as Error).message;
        e.error = msg;
        // the caller records it (the gateway: on the request's activity line), so a skip is never silent
        try { onSkip?.(m.id, /too large/i.test(msg) ? 'too-large' : /time(d)? ?out/i.test(msg) ? 'timeout' : 'error'); } catch { /* the caller's problem */ }
      }
    }
    return cur;
  }

  stop(): void { for (const e of this.executables) e.runner?.stop(); }
}
