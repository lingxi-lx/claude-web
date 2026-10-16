import { describe, expect, it } from 'vitest';
import { connectorSummary, contextBreakdown, fmtTokens, moveCard, normInfoLayout, nudgeCard, toggleCard } from './info-model';

describe('信息栏 layout', () => {
  it('a stored layout is repaired: unknown dropped, duplicates gone, new cards appended; context folded by default', () => {
    expect(normInfoLayout(undefined)).toEqual({ order: ['env', 'context', 'connectors', 'changes', 'background'], collapsed: ['context'] });
    expect(normInfoLayout({ order: ['changes', 'bogus', 'changes', 'env'], collapsed: ['env', 'x'] })).toEqual({ order: ['changes', 'env', 'context', 'connectors', 'background'], collapsed: ['env'] });
  });
  it('drag to before another card, or to the end; Alt+arrows swap neighbours', () => {
    const l = normInfoLayout(undefined);
    expect(moveCard(l, 'background', 'env').order).toEqual(['background', 'env', 'context', 'connectors', 'changes']);
    expect(moveCard(l, 'env', null).order).toEqual(['context', 'connectors', 'changes', 'background', 'env']);
    expect(nudgeCard(l, 'context', -1).order.slice(0, 2)).toEqual(['context', 'env']);
    expect(nudgeCard(l, 'env', -1)).toBe(l);
    expect(toggleCard(toggleCard(l, 'env'), 'env').collapsed).toEqual(['context']);
  });
});

describe('上下文 breakdown', () => {
  it('rows by kind with their share of the window; the deferred ones apart', () => {
    const b = contextBreakdown({
      totalTokens: 89_000, rawMaxTokens: 700_000, percentage: 13,
      categories: [
        { name: 'Messages', tokens: 19_600, color: 'x', kind: 'used' },
        { name: 'System tools', tokens: 16_100, color: 'y', kind: 'used' },
        { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
        { name: 'Free space', tokens: 578_000, kind: 'free' },
        { name: 'MCP tools (deferred)', tokens: 102_900, isDeferred: true },
      ],
      mcpTools: [{ name: 'mcp__web__search', serverName: 'web', tokens: 900 }],
      memoryFiles: [{ path: 'CLAUDE.md', type: 'Project', tokens: 2200 }],
      agents: [{ agentType: 'Explore', source: 'built-in', tokens: 300 }],
    })!;
    expect(b.percentage).toBe(13);
    expect(b.used.map((c) => [c.name, c.swatch])).toEqual([['Messages', 0], ['System tools', 1]]);
    expect(b.used[0].pct).toBeCloseTo(2.8, 1);
    expect(b.buffer[0].name).toBe('Autocompact buffer');
    expect(b.free[0].pct).toBeCloseTo(82.6, 1);
    expect(b.deferred.map((c) => c.name)).toEqual(['MCP tools (deferred)']);
    expect(b.mcpTools[0]).toEqual({ name: 'mcp__web__search', server: 'web', tokens: 900 });
    expect(b.agents[0].name).toBe('Explore');
    expect(contextBreakdown(null)).toBeNull();
  });
  it('token counts read short', () => {
    expect(fmtTokens(300)).toBe('300');
    expect(fmtTokens(19_600)).toBe('19.6k');
    expect(fmtTokens(578_000)).toBe('578k');
    expect(fmtTokens(1_000_000)).toBe('1.0M');
  });
  it('connectors: failed or waiting for a login need a hand', () => {
    expect(connectorSummary([{ name: 'a', status: 'connected' }, { name: 'b', status: 'failed' }, { name: 'c', status: 'needs-auth' }, { name: 'd' }]).broken).toBe(2);
    expect(connectorSummary(undefined).rows).toEqual([]);
  });
});
