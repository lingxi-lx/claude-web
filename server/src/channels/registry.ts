import type { Provider } from '../protocol.js';
import type { UpstreamKind, UpstreamStatus } from '../upstreams/types.js';
import type { ChannelStatus, SourceCategory, SourceHealth, SourceKind, SourceSummary } from './types.js';

export interface ChannelProjectionInput { providers: Provider[]; upstream: UpstreamStatus }

export const categories: Record<SourceCategory, number> = { free: 0, subscription: 1, api: 2, 'local-engine': 3 };
export const families: { kind: UpstreamKind; sourceKind: SourceKind; name: string }[] = [
  { kind: 'claude', sourceKind: 'claude-account', name: 'Claude' },
  { kind: 'gemini', sourceKind: 'gemini-web', name: 'Gemini' },
  { kind: 'workbuddy', sourceKind: 'workbuddy', name: 'WorkBuddy' },
];

export function projectProvider(provider: Provider): SourceSummary {
  const seen = new Set<string>();
  const models = (provider.models ?? []).filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((id) => ({
    id,
    name: provider.modelNames?.[id] || id,
    ...(provider.modelContext?.[id] === undefined ? {} : { contextWindow: provider.modelContext[id] }),
    capabilities: {},
    free: id.endsWith(':free'),
  }));
  return {
    id: `provider:${provider.id}`,
    kind: 'provider',
    name: provider.name,
    category: 'api',
    health: models.length ? 'ready' : 'unconfigured',
    models,
    providerId: provider.id,
    actions: { canAddAccount: false, canEditProvider: true, canManageEngine: false },
  };
}

export function projectFamily(kind: UpstreamKind, sourceKind: SourceKind, name: string, upstream: UpstreamStatus): SourceSummary {
  const accounts = upstream.accounts.filter((account) => account.kind === kind);
  const healthyAccountCount = accounts.filter((account) => account.enabled && account.health === 'ok').length;
  const health: SourceHealth = !accounts.length ? 'unconfigured'
    : accounts.every((account) => !account.enabled) ? 'disabled'
      : healthyAccountCount ? 'ready' : 'attention';
  const sidecar = kind === 'claude' ? undefined : upstream.sidecars?.find((item) => item.id === kind);
  return {
    id: `upstream:${kind}`,
    kind: sourceKind,
    name,
    category: 'subscription',
    health,
    models: [],
    accountCount: accounts.length,
    healthyAccountCount,
    upstreamKind: kind,
    ...(sidecar ? { engine: {
      installed: sidecar.installed,
      running: sidecar.running,
      ...(sidecar.version === undefined ? {} : { version: sidecar.version }),
    } } : {}),
    actions: { canAddAccount: true, canEditProvider: false, canManageEngine: kind !== 'claude' },
  };
}

export function projectChannels(input: ChannelProjectionInput): ChannelStatus {
  const sources = [
    ...input.providers.map(projectProvider),
    ...families.map((family) => projectFamily(family.kind, family.sourceKind, family.name, input.upstream)),
  ];
  sources.sort((a, b) => categories[a.category] - categories[b.category]
    || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { sources, warnings: input.upstream.warnings ?? [] };
}

// P2 provider descriptors (codex / copilot / api-key presets / local / custom / remote …) live in providers/.
// Re-exported here so callers keep one registry entry point. Purely additive: projectChannels above still projects
// only configured sources, so existing callers see exactly the same output until accounts land.
export { get, getProvider, list, listProviders, providerChannels } from './providers/registry.js';
export type { ProviderAuth, ProviderChannel, ProviderDescriptor, ProviderKind, ProviderModelSource } from './providers/types.js';
