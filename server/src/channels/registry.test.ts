import { describe, expect, it } from 'vitest';
import type { Provider } from '../protocol';
import type { UpstreamAccountView, UpstreamKind, UpstreamStatus } from '../upstreams/types';
import { projectChannels } from './registry';

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    name: 'OpenRouter',
    type: 'openai',
    baseUrl: 'https://user:password@example.com/v1',
    apiKey: 'enc:secret',
    models: ['qwen/free:free'],
    modelContext: { 'qwen/free:free': 131072 },
    createdAt: 0,
    ...overrides,
  };
}

function account(
  kind: UpstreamKind,
  id: string,
  overrides: Partial<UpstreamAccountView> = {},
): UpstreamAccountView {
  return {
    id,
    kind,
    name: `${kind} private account`,
    enabled: true,
    credentialKind: 'oauth',
    source: 'oauth',
    createdAt: 0,
    updatedAt: 0,
    health: 'ok',
    credentialMasked: 'enc:credential-••••',
    hasProxy: true,
    identity: { email: 'private@example.com' },
    ...overrides,
  };
}

function upstream(accounts: UpstreamAccountView[] = [], overrides: Partial<UpstreamStatus> = {}): UpstreamStatus {
  return { accounts, groups: [], families: [], ...overrides };
}

describe('projectChannels', () => {
  it('projects API providers alongside all three upstream families without secrets', () => {
    const result = projectChannels({ providers: [provider()], upstream: upstream() });

    expect(result.sources).toHaveLength(4);
    const source = result.sources.find((item) => item.id === 'provider:p1');
    expect(source).toMatchObject({
      kind: 'provider',
      name: 'OpenRouter',
      category: 'api',
      health: 'ready',
      providerId: 'p1',
      models: [{ id: 'qwen/free:free', name: 'qwen/free:free', contextWindow: 131072, capabilities: {}, free: true }],
      actions: { canAddAccount: false, canEditProvider: true, canManageEngine: false },
    });
    expect(JSON.stringify(result)).not.toContain('enc:secret');
    expect(JSON.stringify(result)).not.toContain('password@example.com');
  });

  it('projects account health, sidecars, and no account credentials or identity', () => {
    const result = projectChannels({
      providers: [],
      upstream: upstream([
        account('claude', 'c1'),
        account('gemini', 'g1', { health: 'expired' }),
        account('workbuddy', 'w1'),
      ], {
        sidecars: [
          { id: 'gemini', installed: false, running: false },
          { id: 'workbuddy', installed: true, running: true, version: '1.2.3' },
        ],
      }),
    });

    expect(result.sources.map((source) => source.id)).toEqual([
      'upstream:claude', 'upstream:gemini', 'upstream:workbuddy',
    ]);
    expect(result.sources.map((source) => [source.kind, source.category])).toEqual([
      ['claude-account', 'subscription'],
      ['gemini-web', 'subscription'],
      ['workbuddy', 'subscription'],
    ]);
    expect(result.sources[0]).toMatchObject({ health: 'ready', accountCount: 1, healthyAccountCount: 1 });
    expect(result.sources[1]).toMatchObject({
      health: 'attention', accountCount: 1, healthyAccountCount: 0,
      engine: { installed: false, running: false },
      actions: { canAddAccount: true, canEditProvider: false, canManageEngine: true },
    });
    expect(result.sources[2]).toMatchObject({
      health: 'ready', accountCount: 1, healthyAccountCount: 1,
      engine: { installed: true, running: true, version: '1.2.3' },
    });
    expect(JSON.stringify(result)).not.toContain('credential');
    expect(JSON.stringify(result)).not.toContain('private@example.com');
  });

  it('has deterministic ordering and marks providers with no listed models unconfigured', () => {
    const p1 = provider({ models: [] });
    const p2 = provider({ id: 'p2', name: 'another provider', models: ['model'] });
    const first = projectChannels({ providers: [p1, p2], upstream: upstream() });
    const second = projectChannels({ providers: [p2, p1], upstream: upstream() });

    expect(first.sources.map((source) => source.id)).toEqual(second.sources.map((source) => source.id));
    expect(first.sources.map((source) => source.id)).toEqual([
      'upstream:claude', 'upstream:gemini', 'upstream:workbuddy', 'provider:p2', 'provider:p1',
    ]);
    expect(first.sources.find((source) => source.id === 'provider:p1')?.health).toBe('unconfigured');
  });

  it('handles disabled and empty accounts, model deduplication, names, and free suffixes', () => {
    const warnings = ['family warning'];
    const result = projectChannels({
      providers: [provider({
        models: ['qwen/free:free:free', 'qwen/free:free:free', 'paid-model'],
        defaultModel: 'qwen/free:free:free',
        modelNames: { 'qwen/free:free:free': 'Qwen Free', 'paid-model': 'Paid Model' },
        modelContext: { 'qwen/free:free:free': 131072, 'paid-model': 8192 },
      })],
      upstream: upstream([
        account('claude', 'c1', { enabled: false, health: 'disabled' }),
        account('claude', 'c2', { enabled: false, health: 'ok' }),
      ], { warnings }),
    });

    expect(result.sources.find((source) => source.id === 'upstream:claude')).toMatchObject({
      health: 'disabled', accountCount: 2, healthyAccountCount: 0,
    });
    expect(result.sources.find((source) => source.id === 'upstream:gemini')?.health).toBe('unconfigured');
    const models = result.sources.find((source) => source.id === 'provider:p1')?.models;
    expect(models).toEqual([
      { id: 'qwen/free:free:free', name: 'Qwen Free', contextWindow: 131072, capabilities: {}, free: true },
      { id: 'paid-model', name: 'Paid Model', contextWindow: 8192, capabilities: {}, free: false },
    ]);
    expect(result.warnings).toEqual(warnings);
  });
});
