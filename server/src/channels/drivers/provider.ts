// API providers (and free / keyless endpoints): a provider profile in ProviderService is the source.
import { tr } from '../../i18n/index.js';
import type { MetaStore } from '../../meta/store.js';
import type { Provider, ProviderType } from '../../protocol.js';
import type { ProviderService } from '../../providers/service.js';
import { filterModels } from '../catalog.js';
import { planModels } from '../plan.js';
import { projectProvider } from '../registry.js';
import type { CatalogEntry, SourceSummary } from '../types.js';
import type { AddInput, ChannelDriver, DriverContext } from './types.js';

/** What a keyless endpoint gets as its key: the CLI and the gateway send a Bearer either way (Kilo answers it). */
export const KEYLESS_KEY = 'anonymous';

export type ProviderDeps = Pick<ProviderService, 'list' | 'refreshModels' | 'upsert' | 'remove'>;

const PROVIDER_ID = /^provider:([A-Za-z0-9_-]+)$/;
const typeOf = (protocol: CatalogEntry['protocol']): ProviderType => protocol;

function uniqueName(name: string, taken: string[]): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  for (let i = 2; ; i++) if (!set.has(`${name} ${i}`)) return `${name} ${i}`;
}

/** A provider profile, with what its catalog entry says about it (free / may train / limits). */
export function projectLinked(p: Provider, entry: CatalogEntry | undefined, keyless: boolean): SourceSummary {
  const base = projectProvider(p);
  if (!entry) return { ...base, actions: { ...base.actions, canRemove: true } };
  const freeHints = new Set((entry.models ?? []).filter((m) => m.free).map((m) => m.id));
  const filterRe = entry.modelFilter ? (() => { try { return new RegExp(entry.modelFilter!, 'i'); } catch { return null; } })() : null;
  const hintById = new Map((entry.models ?? []).map((m) => [m.id, m]));
  const models = base.models.map((m) => {
    const hint = hintById.get(m.id);
    const free = entry.free === true || m.free || freeHints.has(m.id) || (entry.free === 'some' && !!filterRe?.test(m.id));
    return {
      ...m,
      free,
      ...(m.contextWindow === undefined && hint?.contextWindow ? { contextWindow: hint.contextWindow } : {}),
      capabilities: { ...(hint?.capabilities ?? {}), ...m.capabilities },
      ...(entry.mayTrain ? { mayTrain: true } : {}),
    };
  });
  return {
    ...base,
    category: entry.category === 'local-engine' ? 'local-engine' : entry.free === true || entry.category === 'free' ? 'free' : base.category,
    // a pull that failed is shown as needing attention (never as ready with yesterday's list only)
    health: p.modelsError && !models.length ? 'attention' : base.health,
    ...(p.modelsError ? { detail: p.modelsError } : {}),
    models,
    catalogId: entry.id,
    needs: keyless ? 'none' : entry.needs,
    ...(entry.mayTrain ? { mayTrain: true } : {}),
    ...(entry.limits ? { limits: entry.limits } : {}),
    ...(entry.signupUrl ? { signupUrl: entry.signupUrl } : {}),
    actions: { ...base.actions, canRemove: true },
  };
}

export class ProviderDriver implements ChannelDriver {
  readonly id = 'provider' as const;
  readonly kind = 'provider' as const;
  readonly needs = 'key' as const;

  constructor(private providers: ProviderDeps, private meta: MetaStore | undefined, private catalog: () => CatalogEntry[]) {}

  owns(sourceId: string) { return PROVIDER_ID.test(sourceId); }

  list(ctx: DriverContext): SourceSummary[] {
    const byId = new Map(ctx.catalog.map((e) => [e.id, e]));
    return ctx.providers
      // an engine's provider is shown as the engine
      .filter((p) => !ctx.links[p.id]?.engine)
      .map((p) => {
        const link = ctx.links[p.id];
        return projectLinked(p, link ? byId.get(link.catalogId) : undefined, !!link?.keyless);
      });
  }

  async add(entry: CatalogEntry, input: AddInput): Promise<string> {
    const key = entry.needs === 'none' ? (input.key?.trim() || KEYLESS_KEY) : input.key?.trim() ?? '';
    if (!key) throw new Error(tr('这个来源需要 API Key'));
    if (entry.retired) throw new Error(tr('这个来源已经下线'));
    const type = typeOf(entry.protocol);
    const name = uniqueName(input.name?.trim() || entry.name, this.providers.list().map((p) => p.name));
    // authStyle is the privacy slice's field (spec §5.1); stored as is until that type lands
    const auth = (entry.authStyle && entry.authStyle !== 'none' ? { authStyle: entry.authStyle } : {}) as Record<string, unknown>;
    const saved = await this.providers.upsert({ name, type, baseUrl: entry.baseUrl ?? '', apiKey: key, ...auth });
    if (this.meta) {
      this.meta.channelLinks()[saved.id] = { catalogId: entry.id, ...(entry.needs === 'none' && key === KEYLESS_KEY ? { keyless: true } : {}) };
      await this.meta.saveChannels();
    }
    const [r] = await this.providers.refreshModels([saved.id]);
    if (!r?.ok) {
      // a one-step add that cannot list models leaves nothing half-made behind
      await this.forget(saved.id);
      throw new Error(r?.error || tr('读不到模型列表'));
    }
    const models = filterModels(entry, this.providers.list().find((p) => p.id === saved.id)?.models ?? []);
    const plan = planModels(type, models, (entry.models ?? []).map((m) => m.id));
    if (plan.defaultModel) await this.providers.upsert({ id: saved.id, ...plan });
    return `provider:${saved.id}`;
  }

  async refresh(sourceId: string): Promise<void> {
    const id = PROVIDER_ID.exec(sourceId)?.[1];
    if (!id || !this.providers.list().some((p) => p.id === id)) throw new Error(tr('没有这个来源'));
    const [result] = await this.providers.refreshModels([id]);
    if (!result.ok) throw new Error(result.error);
  }

  async remove(sourceId: string): Promise<void> {
    const id = PROVIDER_ID.exec(sourceId)?.[1];
    if (!id || !this.providers.list().some((p) => p.id === id)) throw new Error(tr('没有这个来源'));
    if (this.meta?.channelLinks()[id]?.engine) throw new Error(tr('这是托管程序的来源，请在托管程序里移除'));
    await this.forget(id);
  }

  private async forget(id: string): Promise<void> {
    await this.providers.remove(id);
    if (this.meta) {
      delete this.meta.channelLinks()[id];
      await this.meta.saveChannels();
    }
  }
}
