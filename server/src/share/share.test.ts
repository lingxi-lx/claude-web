// 远程共享 (spec §8): a share key's rules only ever narrow its group's; its daily / weekly / monthly quotas stop it.
import { describe, expect, it } from 'vitest';
import { GatewayKeyStore, effectiveGroup } from '../upstreams/keys.js';
import type { GatewayKeyGroup } from '../gateway/types.js';
import { cleanRules } from './service.js';

const group = (o: Partial<GatewayKeyGroup> = {}): GatewayKeyGroup => ({ id: 'share', name: 'S', routeGroupIds: [], allowLan: true, ipAllowlist: [], createdAt: 0, ...o });

function store() {
  const data: any = { gatewayKeyGroups: [group()], gatewayKeys: [] };
  const meta: any = { data, gatewayKeyGroups: () => data.gatewayKeyGroups, gatewayKeys: () => data.gatewayKeys, saveGatewayKeys: async () => {} };
  return new GatewayKeyStore(meta);
}

describe('share rules', () => {
  it('cleanRules keeps known fields, positive integers and string lists only', () => {
    expect(cleanRules({ models: ['a', ' a ', '', 3 as any], concurrent: -1, daily: { requests: 2.7, tokens: 0 }, weekly: {}, note: ' hi ', routeGroupIds: [] } as any))
      .toEqual({ models: ['a'], daily: { requests: 2 }, note: 'hi' });
  });

  it('a key model allow-list narrows the group (never widens it); nothing left stays nothing', () => {
    expect(effectiveGroup(group(), { models: ['claude-*'] }).modelAllowlist).toEqual(['claude-*']);
    expect(effectiveGroup(group({ modelAllowlist: ['claude-sonnet-4-5', 'gpt-4.1'] }), { models: ['gpt-4.1', 'o3'] }).modelAllowlist).toEqual(['gpt-4.1']);
    expect(effectiveGroup(group({ modelAllowlist: ['gpt-4.1'] }), { models: ['o3'] }).modelAllowlist).toEqual(['~none~']);
    expect(effectiveGroup(group({ routeGroupIds: ['a'] }), { routeGroupIds: ['b'] }).routeGroupIds).toEqual(['~none~']);
    expect(effectiveGroup(group({ rateLimit: { concurrent: 4 } }), { concurrent: 2 }).rateLimit?.concurrent).toBe(2);
    expect(effectiveGroup(group({ rateLimit: { concurrent: 2 } }), { concurrent: 9 }).rateLimit?.concurrent).toBe(2);
  });

  it('verify gives the narrowed group; daily / weekly request and token quotas refuse once used up', async () => {
    const s = store();
    const { key, plaintext } = await s.create('share', 'friend', { share: { models: ['m1'], daily: { requests: 2 }, weekly: { tokens: 1000 } } });
    const v = s.verify(plaintext)!;
    expect(v.group.modelAllowlist).toEqual(['m1']);
    expect(s.canSpend(key, v.group)).toEqual({ ok: true });
    s.recordUsage(key.id, 10, 10);
    expect(s.canSpend(key, v.group).ok).toBe(true);
    s.recordUsage(key.id, 10, 10);
    expect(s.canSpend(key, v.group)).toMatchObject({ ok: false, message: expect.stringMatching(/今天|today/i) });
    // a new day: the daily count is back, the week's tokens still count
    key.stats.day = '2000-01-01';
    expect(s.canSpend(key, v.group).ok).toBe(true);
    s.recordUsage(key.id, 960, 0);
    expect(s.canSpend(key, v.group)).toMatchObject({ ok: false, message: expect.stringMatching(/本周|week/i) });
  });

  it('a disabled or expired key does not verify', async () => {
    const s = store();
    const { key, plaintext } = await s.create('share', 'x', { share: {} });
    await s.update(key.id, { enabled: false });
    expect(s.verify(plaintext)).toBeNull();
    await s.update(key.id, { enabled: true, expiresAt: Date.now() - 1 });
    expect(s.verify(plaintext)).toBeNull();
    expect(s.verify('cwg-wrong')).toBeNull();
  });
});
