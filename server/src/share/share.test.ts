// 远程共享 (spec §8): a share key's rules only ever narrow its group's; its daily / weekly / monthly quotas stop it.
import { describe, expect, it } from 'vitest';
import { GatewayKeyStore, effectiveGroup, routeAccess } from '../upstreams/keys.js';
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

describe('share keys and routing (S1)', () => {
  it('a share key with nothing ticked reaches no route group; ticked ones only', async () => {
    const s = store();
    const none = await s.create('share', 'a', { share: {} });
    expect(s.verify(none.plaintext)!.group.routeGroupIds).toEqual(['~none~']);
    const some = await s.create('share', 'b', { share: { routeGroupIds: ['routing'] } });
    expect(s.verify(some.plaintext)!.group.routeGroupIds).toEqual(['routing']);
    // other key groups keep "empty = all"
    expect(effectiveGroup(group({ id: 'default' }), {}).routeGroupIds).toEqual([]);
  });

  it('routeAccess: share keys get no subscription and no paid by default; opt-ins and the own budget pass through', async () => {
    const s = store();
    const plain = await s.create('share', 'a', { share: {} });
    expect(routeAccess(plain.key, s.verify(plain.plaintext)!.group)).toMatchObject({ subscription: false, paid: false });
    const opted = await s.create('share', 'b', { share: cleanRules({ subscription: true, paidBudgetUsd: 3, sources: ['p:x'], models: ['m*'] }) });
    opted.key.stats.costUsd = 1;
    expect(routeAccess(opted.key, s.verify(opted.plaintext)!.group)).toEqual({ modelAllowlist: ['m*'], modelDeny: undefined, subscription: true, paid: { budgetUsd: 3, spentTodayUsd: 1 }, sources: ['p:x'] });
    // the owner's own keys are only held to their model lists
    const own = { id: 'k', keyGroupId: 'default', stats: { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, day: '' } } as any;
    expect(routeAccess(own, group({ id: 'default' }))).toEqual({ modelAllowlist: undefined, modelDeny: undefined });
  });
});
