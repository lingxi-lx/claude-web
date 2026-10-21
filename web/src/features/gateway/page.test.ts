import { describe, expect, it } from 'vitest';
import { GATEWAY_TABS, gatewayTabLabel, gatewayTabsFor, isAdvancedTab } from './page';

describe('gateway page', () => {
  it('has the full set of tabs in order', () => {
    expect(GATEWAY_TABS.map((t) => t.id)).toEqual(['overview', 'accounts', 'tasks', 'routes', 'keys', 'logs', 'settings']);
  });
  it('keeps account routing in the ordinary workflow', () => {
    expect(gatewayTabsFor(false).map((t) => t.id)).toEqual(['overview', 'accounts', 'tasks', 'routes']);
    expect(gatewayTabsFor(true).map((t) => t.id)).toEqual(GATEWAY_TABS.map((t) => t.id));
    for (const id of ['keys', 'logs', 'settings'] as const) expect(isAdvancedTab(id)).toBe(true);
    for (const id of ['overview', 'accounts', 'tasks', 'routes'] as const) expect(isAdvancedTab(id)).toBe(false);
  });
  it('labels every tab', () => {
    for (const t of GATEWAY_TABS) expect(gatewayTabLabel(t.id)).toBeTruthy();
  });
});
