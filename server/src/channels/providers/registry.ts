// The provider registry (P2): stable ordering, lookup by id, and the channel projection the upstream page uses before
// anything is configured. Pure data and pure functions — no network, no disk, no credentials.
import type { SourceCategory, SourceNeeds } from '../types.js';
import { PROVIDERS } from './builtins.js';
import type { ProviderAuth, ProviderChannel, ProviderDescriptor, ProviderKind } from './types.js';

/** The upstream page's left filter order (spec §6.2): subscription, API key, local, custom, remote. */
const KIND_ORDER: Record<ProviderKind, number> = {
  subscription: 0,
  'api-key': 1,
  local: 2,
  custom: 3,
  remote: 4,
};

const CATEGORY: Record<ProviderKind, SourceCategory> = {
  subscription: 'subscription',
  'api-key': 'api',
  local: 'local-engine',
  custom: 'api',
  remote: 'api',
};

const NEEDS: Record<ProviderAuth, SourceNeeds> = {
  'oauth-loopback': 'login',
  'device-code': 'login',
  'paste-token': 'login',
  'local-credential': 'login',
  checkin: 'login',
  'api-key': 'key',
  none: 'none',
};

/** Codepoint ordering, not locale ordering: the same list on every machine. */
function compare(a: ProviderDescriptor, b: ProviderDescriptor): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Every built-in descriptor, sorted stably (kind, then name, then id). */
export function list(): ProviderDescriptor[] {
  return [...PROVIDERS].sort(compare);
}

/** Look one up by its stable id. */
export function get(id: string): ProviderDescriptor | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

export const listProviders = list;
export const getProvider = get;

/**
 * The unconfigured channel rows for the upstream page: every descriptor with `health: 'unconfigured'`, no models and
 * no credential fields (the projection copies only the descriptor's public fields). Input order never matters.
 */
export function providerChannels(descriptors: readonly ProviderDescriptor[] = list()): ProviderChannel[] {
  return [...descriptors].sort(compare).map((provider) => ({
    id: provider.id,
    providerId: provider.id,
    name: provider.name,
    kind: provider.kind,
    auth: provider.auth,
    ...(provider.loginHint === undefined ? {} : { loginHint: provider.loginHint }),
    ...(provider.docsUrl === undefined ? {} : { docsUrl: provider.docsUrl }),
    ...(provider.free === undefined ? {} : { free: provider.free }),
    modelSource: provider.modelSource,
    health: 'unconfigured' as const,
    category: CATEGORY[provider.kind],
    needs: NEEDS[provider.auth],
    models: [],
    actions: {
      canAddAccount: NEEDS[provider.auth] === 'login',
      canEditProvider: provider.kind !== 'subscription',
      canManageEngine: provider.kind === 'local',
      canRemove: false,
    },
  }));
}
