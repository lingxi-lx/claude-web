import { tr } from '../i18n/index.js';
import type { EngineManager } from '../engines/manager.js';
import type { MetaStore } from '../meta/store.js';
import type { ProviderService } from '../providers/service.js';
import type { UpstreamService } from '../upstreams/service.js';
import { BASELINE, filterModels, loadRemote, mergeCatalog, summarize, updateRemote, withPluginEntries, type RemoteCatalogSetting } from './catalog.js';
import { createDrivers, type ChannelDriver, type DriverContext } from './drivers/index.js';
import { categories } from './registry.js';
import type { CatalogEntry, ChannelCatalogOverride, ChannelStatus, SourceSummary } from './types.js';

export interface ChannelDeps {
  providers: Pick<ProviderService, 'list' | 'refreshModels'> & Partial<Pick<ProviderService, 'upsert' | 'remove' | 'modelFilter'>>;
  upstreams: Pick<UpstreamService, 'status' | 'syncFamily' | 'probe'>;
  /** 托管程序 (absent in tests that only project providers / upstreams) */
  engines?: EngineManager;
  /** catalog links, user overrides, the remote-catalog setting */
  meta?: MetaStore;
}

const REMOTE_SETTING = 'channels.remoteCatalog';

export class ChannelService {
  private drivers: ChannelDriver[];
  private remote: CatalogEntry[] = [];
  private remoteLoaded = false;

  constructor(private deps: ChannelDeps) {
    const p = deps.providers;
    const missing = async (): Promise<never> => { throw new Error(tr('来源服务还没准备好')); };
    this.drivers = createDrivers({
      providers: {
        list: () => p.list(),
        refreshModels: (ids) => p.refreshModels(ids),
        upsert: (x) => (p.upsert ? p.upsert(x) : missing()),
        remove: (id) => (p.remove ? p.remove(id) : missing()),
      },
      upstreams: deps.upstreams,
      engines: deps.engines,
      meta: deps.meta,
      catalog: () => this.catalog(),
    });
    // a free-only source (Kilo, OpenRouter :free …) keeps only its free models from every pull
    if (deps.meta && 'modelFilter' in deps.providers) {
      const meta = deps.meta;
      deps.providers.modelFilter = (providerId, models) => {
        const link = meta.channelLinks()[providerId];
        return link ? filterModels(this.catalog().find((e) => e.id === link.catalogId), models) : models;
      };
    }
  }

  private overrides(): Record<string, ChannelCatalogOverride> {
    return (this.deps.meta?.channelCatalog() ?? {}) as Record<string, ChannelCatalogOverride>;
  }

  /** baseline < signed remote < the user's own changes; then the enabled plugins' sources */
  catalog(): CatalogEntry[] {
    return withPluginEntries(mergeCatalog(BASELINE, this.remote, this.overrides()));
  }

  private async ensureRemote() {
    if (this.remoteLoaded) return;
    this.remoteLoaded = true;
    const setting = this.deps.meta?.settings()[REMOTE_SETTING] as RemoteCatalogSetting | undefined;
    if (setting?.enabled) this.remote = await loadRemote();
  }

  private async context(): Promise<DriverContext> {
    await this.ensureRemote();
    return {
      providers: this.deps.providers.list(),
      upstream: this.deps.upstreams.status(),
      engines: this.deps.engines ? await this.deps.engines.statuses() : [],
      links: this.deps.meta?.channelLinks() ?? {},
      catalog: this.catalog(),
    };
  }

  async status(): Promise<ChannelStatus> {
    const ctx = await this.context();
    const sources = this.drivers.flatMap((d) => d.list(ctx));
    sources.sort((a, b) => categories[a.category] - categories[b.category]
      || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const added = new Set<string>();
    for (const s of sources) {
      if (s.catalogId) added.add(s.catalogId);
      if (s.kind !== 'provider' && s.kind !== 'engine' && (s.accountCount ?? 0) > 0) added.add(s.kind);
    }
    return { sources, warnings: ctx.upstream.warnings ?? [], available: summarize(ctx.catalog, added, this.overrides()) };
  }

  private owner(id: string): ChannelDriver {
    const d = this.drivers.find((x) => x.owns(id));
    if (d) return d;
    if (/^(provider|upstream|engine):[A-Za-z0-9_-]+$/.test(id)) throw new Error(tr('没有这个来源'));
    throw new Error(tr('来源地址无效'));
  }

  async refresh(id: string): Promise<ChannelStatus> {
    const d = this.owner(id);
    if (!d.refresh) throw new Error(tr('没有这个来源'));
    await d.refresh(id);
    return this.status();
  }

  /** One step: catalog entry (+ key) → a working source with its models, or the reason it could not be made. */
  async add(catalogId: string, key?: string, name?: string): Promise<{ source: SourceSummary | null; status: ChannelStatus }> {
    await this.ensureRemote();
    const entry = this.catalog().find((e) => e.id === catalogId);
    if (!entry) throw new Error(tr('目录里没有这个来源'));
    const d = this.drivers.find((x) => x.id === entry.driver);
    if (!d?.add) throw new Error(tr('这个来源还不能在这里添加'));
    const sourceId = await d.add(entry, { key, name });
    const status = await this.status();
    return { source: status.sources.find((s) => s.id === sourceId) ?? null, status };
  }

  async remove(id: string): Promise<ChannelStatus> {
    const d = this.owner(id);
    if (!d.remove) throw new Error(tr('这个来源不能在这里移除（账号在来源详情里管理）'));
    await d.remove(id);
    return this.status();
  }

  async setCatalog(id: string, override: ChannelCatalogOverride | null): Promise<ChannelStatus> {
    if (!this.deps.meta) throw new Error(tr('来源服务还没准备好'));
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) throw new Error(tr('来源地址无效'));
    const all = this.deps.meta.channelCatalog();
    if (override === null) delete all[id];
    else all[id] = { ...(override.hidden ? { hidden: true } : {}), ...(override.patch ? { patch: JSON.parse(JSON.stringify(override.patch)) as Record<string, unknown> } : {}) };
    await this.deps.meta.saveChannels();
    return this.status();
  }

  async updateCatalog(): Promise<ChannelStatus> {
    const setting = this.deps.meta?.settings()[REMOTE_SETTING] as RemoteCatalogSetting | undefined;
    this.remote = await updateRemote(setting);
    this.remoteLoaded = true;
    return this.status();
  }
}
