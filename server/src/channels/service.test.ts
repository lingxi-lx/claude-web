import { describe, expect, it, vi } from 'vitest';
import type { ModelRefreshResult, Provider } from '../protocol';
import type { UpstreamAccountView, UpstreamKind, UpstreamStatus } from '../upstreams/types';
import { ChannelService, type ChannelDeps } from './service';

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    name: 'OpenRouter',
    type: 'openai',
    baseUrl: 'https://user:password@example.com/v1',
    apiKey: 'sk-plaintext-secret',
    models: ['model-1'],
    createdAt: 0,
    ...overrides,
  };
}

function account(kind: UpstreamKind, id: string): UpstreamAccountView {
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
    credentialMasked: 'enc:masked-credential-material',
    hasProxy: false,
    identity: { email: 'private@example.com' },
  };
}

function upstream(accounts: UpstreamAccountView[] = []): UpstreamStatus {
  return { accounts, groups: [], families: [], warnings: ['warning'] };
}

function refreshResult(overrides: Partial<ModelRefreshResult> = {}): ModelRefreshResult {
  return { id: 'p1', name: 'OpenRouter', ok: true, count: 1, ms: 1, ...overrides };
}

function fixture(options: {
  providers?: Provider[];
  upstream?: UpstreamStatus;
  refreshModels?: ChannelDeps['providers']['refreshModels'];
} = {}) {
  const providers = options.providers ?? [provider()];
  let currentUpstream = options.upstream ?? upstream();
  const calls: string[] = [];
  const deps: ChannelDeps = {
    providers: {
      list: vi.fn(() => providers),
      refreshModels: options.refreshModels ?? vi.fn(async () => [refreshResult()]),
    },
    upstreams: {
      status: vi.fn(() => currentUpstream),
      syncFamily: vi.fn(async (kind: 'gemini' | 'workbuddy') => {
        calls.push(`sync:${kind}`);
        return [];
      }),
      probe: vi.fn(async (id: string) => {
        calls.push(`probe:${id}`);
        return currentUpstream.accounts.find((item) => item.id === id)!;
      }),
    },
  };
  return {
    service: new ChannelService(deps),
    deps,
    calls,
    setUpstream: (value: UpstreamStatus) => { currentUpstream = value; },
  };
}

describe('ChannelService', () => {
  it('projects live providers and upstream status without key material', async () => {
    const { service, deps } = fixture({
      providers: [provider(), provider({ id: 'p2', apiKey: 'enc:encrypted-secret' })],
      upstream: upstream([account('claude', 'c1')]),
    });

    const result = await service.status();
    const json = JSON.stringify(result);
    expect(result.sources.map((source) => source.id)).toContain('provider:p1');
    expect(result.sources.find((source) => source.id === 'upstream:claude')).toMatchObject({ accountCount: 1 });
    expect(result.warnings).toEqual(['warning']);
    for (const secret of ['sk-plaintext-secret', 'enc:encrypted-secret', 'encrypted-secret', 'password@example.com', 'masked-credential-material', 'private@example.com']) {
      expect(json).not.toContain(secret);
    }
    expect(deps.providers.list).toHaveBeenCalledOnce();
    expect(deps.upstreams.status).toHaveBeenCalledOnce();
  });

  it('refreshes only the selected provider and returns fresh status', async () => {
    const { service, deps } = fixture();

    const result = await service.refresh('provider:p1');

    expect(deps.providers.refreshModels).toHaveBeenCalledWith(['p1']);
    expect(deps.upstreams.syncFamily).not.toHaveBeenCalled();
    expect(deps.upstreams.probe).not.toHaveBeenCalled();
    expect(result.sources.some((source) => source.id === 'provider:p1')).toBe(true);
  });

  it('throws the model refresh error instead of reporting success', async () => {
    const { service, deps } = fixture({
      refreshModels: vi.fn(async () => [refreshResult({ ok: false, error: 'refresh failed' })]),
    });

    await expect(service.refresh('provider:p1')).rejects.toThrow('refresh failed');
    expect(deps.upstreams.status).not.toHaveBeenCalled();
  });

  it.each([
    ['', '来源地址无效'],
    ['provider:', '来源地址无效'],
    ['provider:p.1', '来源地址无效'],
    ['provider:p1:extra', '来源地址无效'],
    ['upstream:claude:extra', '来源地址无效'],
    ['upstream:unknown', '没有这个来源'],
    ['other:p1', '来源地址无效'],
    ['provider:missing', '没有这个来源'],
  ])('rejects malformed or unknown source id %j', async (id, message) => {
    const { service, deps } = fixture();

    await expect(service.refresh(id)).rejects.toThrow(message);
    expect(deps.providers.refreshModels).not.toHaveBeenCalled();
    expect(deps.upstreams.syncFamily).not.toHaveBeenCalled();
    expect(deps.upstreams.probe).not.toHaveBeenCalled();
  });

  it('probes existing Claude accounts sequentially in account order', async () => {
    const { service, deps, calls } = fixture({
      upstream: upstream([
        account('claude', 'c1'), account('gemini', 'g1'), account('claude', 'c2'),
      ]),
    });
    let active = 0;
    let concurrent = false;
    deps.upstreams.probe = vi.fn(async (id: string) => {
      active += 1;
      if (active > 1) concurrent = true;
      await Promise.resolve();
      calls.push(`probe:${id}`);
      active -= 1;
      return account('claude', id);
    });

    await service.refresh('upstream:claude');

    expect(calls).toEqual(['probe:c1', 'probe:c2']);
    expect(concurrent).toBe(false);
    expect(deps.upstreams.syncFamily).not.toHaveBeenCalled();
    expect(deps.providers.refreshModels).not.toHaveBeenCalled();
  });

  it.each(['error', 'expired', 'cooling', 'disabled', 'unknown'] as const)('fails a Claude refresh for %s health', async (health) => {
    const { service, deps } = fixture({ upstream: upstream([account('claude', 'c1')]) });
    deps.upstreams.probe = vi.fn(async () => ({ ...account('claude', 'c1'), health, lastError: 'sanitized health failure' }));

    await expect(service.refresh('upstream:claude')).rejects.toThrow('sanitized health failure');
    expect(deps.upstreams.status).toHaveBeenCalledExactlyOnceWith();
  });

  it('uses a generic translated error for a failed Claude probe without detail', async () => {
    const { service, deps } = fixture({ upstream: upstream([account('claude', 'c1')]) });
    deps.upstreams.probe = vi.fn(async () => ({ ...account('claude', 'c1'), health: 'error' }));

    await expect(service.refresh('upstream:claude')).rejects.toThrow('账号健康检查失败');
    expect(deps.upstreams.status).toHaveBeenCalledExactlyOnceWith();
  });

  it('stops Claude probing at the first failed account', async () => {
    const { service, deps } = fixture({
      upstream: upstream([account('claude', 'c1'), account('claude', 'c2'), account('claude', 'c3')]),
    });
    deps.upstreams.probe = vi.fn(async (id) => ({ ...account('claude', id), health: id === 'c2' ? 'expired' : 'ok' }));

    await expect(service.refresh('upstream:claude')).rejects.toThrow('账号健康检查失败');
    expect(deps.upstreams.probe).toHaveBeenCalledTimes(2);
    expect(deps.upstreams.probe).not.toHaveBeenCalledWith('c3');
    expect(deps.upstreams.status).toHaveBeenCalledExactlyOnceWith();
  });

  it('does nothing when there are no Claude accounts', async () => {
    const { service, deps } = fixture({ upstream: upstream([account('gemini', 'g1')]) });

    await service.refresh('upstream:claude');

    expect(deps.upstreams.probe).not.toHaveBeenCalled();
    expect(deps.upstreams.syncFamily).not.toHaveBeenCalled();
  });

  it.each(['gemini', 'workbuddy'] as const)('refreshes only the %s family', async (kind) => {
    const { service, deps } = fixture();

    await service.refresh(`upstream:${kind}`);

    expect(deps.upstreams.syncFamily).toHaveBeenCalledExactlyOnceWith(kind, { start: false });
    expect(deps.providers.refreshModels).not.toHaveBeenCalled();
    expect(deps.upstreams.probe).not.toHaveBeenCalled();
  });

  it('reads and projects current stores on every status call', async () => {
    const { service, deps, setUpstream } = fixture();
    let currentProviders = [provider()];
    deps.providers.list = vi.fn(() => currentProviders);

    const first = await service.status();
    currentProviders = [provider({ id: 'p2', name: 'New provider' })];
    setUpstream(upstream([account('workbuddy', 'w1')]));
    const second = await service.status();

    expect(first.sources.some((source) => source.id === 'provider:p1')).toBe(true);
    expect(second.sources.some((source) => source.id === 'provider:p1')).toBe(false);
    expect(second.sources.some((source) => source.id === 'provider:p2')).toBe(true);
    expect(second.sources.find((source) => source.id === 'upstream:workbuddy')).toMatchObject({ accountCount: 1 });
    expect(deps.providers.list).toHaveBeenCalledTimes(2);
    expect(deps.upstreams.status).toHaveBeenCalledTimes(2);
  });
});
