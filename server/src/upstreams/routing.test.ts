import { describe, expect, it } from 'vitest';
import { globMatch, ipInList, modelAllowed, pickRouteGroup } from './routing.js';
import { RateLimiter } from './ratelimit.js';

const groups: any[] = [
  { id: 'main', name: 'Main', members: [{ providerId: 'a' }] },
  { id: 'alt', name: 'Alt', members: [{ providerId: 'b' }] },
];

describe('routing', () => {
  it('matches IPv4 and IPv6 CIDRs', () => {
    expect(ipInList('192.168.1.5', ['192.168.1.0/24'])).toBe(true);
    expect(ipInList('10.0.0.1', ['192.168.1.0/24'])).toBe(false);
    expect(ipInList('::1', ['::1/128'])).toBe(true);
    expect(ipInList('127.0.0.1', [])).toBe(false);
  });

  it('matches model globs with deny winning', () => {
    expect(globMatch('claude-*', 'claude-sonnet-4-6')).toBe(true);
    expect(modelAllowed('claude-sonnet-4-6', ['claude-*'], [])).toBe(true);
    expect(modelAllowed('claude-opus-4-7', ['claude-*'], ['claude-opus-*'])).toBe(false);
    expect(modelAllowed('gpt-4.1', ['claude-*'], [])).toBe(false);
  });

  it('resolves an explicit group, a group/model prefix and the single allowed group', () => {
    expect(pickRouteGroup({ pathGroupId: 'main', model: 'x', groups, allowed: [] })).toMatchObject({ group: { id: 'main' } });
    expect(pickRouteGroup({ model: 'alt/gpt-4.1', groups, allowed: [] })).toMatchObject({ group: { id: 'alt' }, model: 'gpt-4.1' });
    expect(pickRouteGroup({ model: 'x', groups: [groups[0]], allowed: [] })).toMatchObject({ group: { id: 'main' } });
    expect(pickRouteGroup({ model: 'x', groups, allowed: [] })).toEqual({ error: 'ambiguous', groups: ['main', 'alt'] });
    expect(pickRouteGroup({ pathGroupId: 'nope', model: 'x', groups, allowed: [] })).toEqual({ error: 'no-group', groups: [] });
  });

  it('limits the key group route groups', () => {
    expect(pickRouteGroup({ model: 'x', groups, allowed: ['alt'] })).toMatchObject({ group: { id: 'alt' } });
    expect(pickRouteGroup({ model: 'x', groups, allowed: ['gone'] })).toEqual({ error: 'ambiguous', groups: [] });
  });

  it('limits rpm and concurrency', () => {
    const r = new RateLimiter();
    const a = r.take('k', { rpm: 1, concurrent: 1 }, 0);
    expect(a.ok).toBe(true);
    expect(r.take('k', { rpm: 1, concurrent: 1 }, 10)).toMatchObject({ ok: false, reason: 'concurrent' });
    if (a.ok) a.release();
    expect(r.take('k', { rpm: 1, concurrent: 1 }, 20)).toMatchObject({ ok: false, reason: 'rpm' });
    expect(r.take('k', { rpm: 1, concurrent: 1 }, 61_000).ok).toBe(true);
  });
});
