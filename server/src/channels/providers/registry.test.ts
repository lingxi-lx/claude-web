import { describe, expect, it } from 'vitest';
import { BUILTIN_PROVIDERS, PROVIDERS } from './builtins';
import { get, getProvider, list, listProviders, providerChannels } from './registry';
import type { ProviderAuth, ProviderKind, ProviderModelSource } from './types';

const KINDS: ProviderKind[] = ['subscription', 'api-key', 'local', 'custom', 'remote'];
const AUTH: ProviderAuth[] = ['oauth-loopback', 'device-code', 'paste-token', 'local-credential', 'checkin', 'api-key', 'none'];
const MODEL_SOURCES: ProviderModelSource[] = ['account', 'live', 'local', 'upstream', 'static', 'none'];

const REQUIRED = [
  'codex', 'gemini', 'antigravity', 'kimi', 'grok', 'devin', 'copilot', 'kiro', 'cline', 'qoder', 'trae',
  'workbuddy', 'zcode', 'factory', 'kilo', 'mimo', 'opencode', 'local', 'custom', 'remote-magpie', 'cpa',
];

const CHANNEL_KEYS = new Set([
  'id', 'providerId', 'name', 'kind', 'auth', 'loginHint', 'docsUrl', 'free', 'modelSource',
  'health', 'category', 'needs', 'models', 'actions',
]);

describe('provider descriptors', () => {
  it('ships at least 35 descriptors with every required provider', () => {
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(35);
    expect(BUILTIN_PROVIDERS).toBe(PROVIDERS);
    const ids = new Set(PROVIDERS.map((provider) => provider.id));
    expect(ids.size).toBe(PROVIDERS.length);
    for (const id of REQUIRED) expect(ids.has(id), id).toBe(true);
  });

  it('gives every descriptor the public fields the wizard needs', () => {
    for (const provider of PROVIDERS) {
      expect(provider.id).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
      expect(provider.name.trim()).not.toBe('');
      expect(KINDS).toContain(provider.kind);
      expect(AUTH).toContain(provider.auth);
      expect(MODEL_SOURCES).toContain(provider.modelSource);
      expect(provider.loginHint?.trim()).toBeTruthy();
      expect(provider.docsUrl).toMatch(/^https:\/\//);
      expect([undefined, true, false, 'some']).toContain(provider.free);
      // A descriptor is data: nothing can carry a key or a token.
      expect(Object.keys(provider).some((key) => /key|token|secret|credential|password|baseurl/i.test(key))).toBe(false);
    }
  });

  it('covers the wizard kinds (and more than one api-key preset)', () => {
    for (const kind of KINDS) expect(PROVIDERS.some((provider) => provider.kind === kind), kind).toBe(true);
    expect(PROVIDERS.filter((provider) => provider.kind === 'api-key').length).toBeGreaterThanOrEqual(10);
    expect(PROVIDERS.filter((provider) => provider.kind === 'subscription').length).toBeGreaterThanOrEqual(10);
  });

  it('lists deterministically by kind, name, then id', () => {
    const first = list().map((provider) => provider.id);
    const second = listProviders().map((provider) => provider.id);
    expect(first).toEqual(second);
    const order = { subscription: 0, 'api-key': 1, local: 2, custom: 3, remote: 4 } as const;
    for (let i = 1; i < first.length; i++) {
      const prev = get(first[i - 1])!;
      const cur = get(first[i])!;
      expect(order[prev.kind]).toBeLessThanOrEqual(order[cur.kind]);
      if (prev.kind === cur.kind) {
        expect(prev.name.toLowerCase() <= cur.name.toLowerCase()).toBe(true);
        if (prev.name.toLowerCase() === cur.name.toLowerCase()) expect(prev.id < cur.id).toBe(true);
      }
    }
  });

  it('gets one provider by id and returns nothing for an unknown id', () => {
    expect(get('codex')?.name).toBe('Codex');
    expect(getProvider('remote-magpie')?.kind).toBe('remote');
    expect(get('nope')).toBeUndefined();
    expect(getProvider('nope')).toBeUndefined();
  });
});

describe('providerChannels', () => {
  it('projects every descriptor as an unconfigured, modelless channel', () => {
    const channels = providerChannels();
    expect(channels).toHaveLength(list().length);
    for (const channel of channels) {
      expect(channel.health).toBe('unconfigured');
      expect(channel.models).toEqual([]);
      expect(channel.actions.canRemove).toBe(false);
    }
    expect(channels.find((channel) => channel.id === 'codex')).toMatchObject({
      kind: 'subscription', category: 'subscription', needs: 'login',
      actions: { canAddAccount: true, canEditProvider: false, canManageEngine: false },
    });
    expect(channels.find((channel) => channel.id === 'anthropic')).toMatchObject({
      kind: 'api-key', category: 'api', needs: 'key',
      actions: { canAddAccount: false, canEditProvider: true, canManageEngine: false },
    });
    expect(channels.find((channel) => channel.id === 'ollama')).toMatchObject({
      kind: 'local', category: 'local-engine', needs: 'none',
      actions: { canAddAccount: false, canEditProvider: true, canManageEngine: true },
    });
  });

  it('never leaks secrets: the projection copies only the public descriptor fields', () => {
    const channels = providerChannels();
    expect(JSON.stringify(channels)).not.toMatch(/"(?:apiKey|api_key|accessToken|refreshToken|secret|password|credential)"\s*:/i);
    for (const channel of channels) {
      for (const key of Object.keys(channel)) expect(CHANNEL_KEYS.has(key), key).toBe(true);
    }
  });

  it('sorts regardless of the input order', () => {
    const forward = providerChannels(PROVIDERS).map((channel) => channel.id);
    const backward = providerChannels([...PROVIDERS].reverse()).map((channel) => channel.id);
    expect(forward).toEqual(backward);
    expect(forward).toEqual(list().map((provider) => provider.id));
  });
});

describe('channels/registry re-exports', () => {
  it('exposes the provider registry additively', async () => {
    const registry = await import('../registry');
    expect(registry.listProviders).toBe(listProviders);
    expect(registry.getProvider).toBe(getProvider);
    expect(registry.providerChannels).toBe(providerChannels);
    // The existing configured-source projection is unchanged: no providers / no accounts still means three families.
    const status = registry.projectChannels({ providers: [], upstream: { accounts: [], groups: [], families: [] } });
    expect(status.sources.map((source) => source.id)).toEqual([
      'upstream:claude', 'upstream:gemini', 'upstream:workbuddy',
    ]);
  });
});
