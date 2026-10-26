import { describe, expect, it } from 'vitest';
import type { SourceSummary, UpstreamAccountView } from '@shared';
import { FILTERS, filterCounts, isListed, matchesQuery, quotaLeft } from './page';

const src = (p: Partial<SourceSummary>): SourceSummary => ({
  id: 'x', kind: 'provider', name: 'X', category: 'api', health: 'ready', models: [],
  actions: { canAddAccount: false, canEditProvider: true, canManageEngine: false }, ...p,
});

describe('gateway page', () => {
  it('filters by category, free models and attention', () => {
    const list = [
      src({ id: 'a', models: [{ id: 'm:free', name: 'm', capabilities: {}, free: true }] }),
      src({ id: 'b', category: 'subscription', kind: 'claude-account', health: 'attention' }),
    ];
    const n = filterCounts(list);
    expect(FILTERS.map((f) => f.id)).toEqual(['all', 'free', 'subscription', 'api', 'local-engine', 'attention']);
    expect(n).toMatchObject({ all: 2, free: 1, subscription: 1, api: 1, 'local-engine': 0, attention: 1 });
  });
  it('hides a family with no account and searches models', () => {
    expect(isListed(src({ kind: 'gemini-web', health: 'unconfigured' }))).toBe(false);
    expect(matchesQuery(src({ models: [{ id: 'deepseek-chat', name: 'DeepSeek', capabilities: {}, free: false }] }), 'deep')).toBe(true);
  });
  it('never makes up a quota', () => {
    const a = { enabled: true, quota: { checkedAt: 0, windows: [{ id: 'w', label: '5h' }] } } as unknown as UpstreamAccountView;
    expect(quotaLeft([a])).toBeUndefined();
    const b = { enabled: true, quota: { checkedAt: 0, windows: [{ id: 'w', label: '5h', usedPct: 30 }] } } as unknown as UpstreamAccountView;
    expect(quotaLeft([a, b])).toEqual({ pct: 70 });
  });
});
