import { describe, expect, it } from 'vitest';
import type { Provider } from '@shared';
import { crossProviders, subagentLabel } from './subagent-label';
import { crossValue } from '../../../../server/src/models/subagent';

const P = (id: string, type: Provider['type'], extra: Partial<Provider> = {}) => ({ id, name: `N-${id}`, type, baseUrl: 'https://x.invalid', models: [], ...extra }) as Provider;

describe('subagents on another provider', () => {
  const providers = [P('relay', 'anthropic'), P('ds', 'openai'), P('gem', 'gemini'), P('gw', 'gateway' as Provider['type']), P('other', 'anthropic')];
  it('listed only for a conversation on an Anthropic-format provider: every other one the split route can reach', () => {
    expect(crossProviders(providers, 'relay')).toEqual(['ds', 'gem', 'other']);
    expect(crossProviders(providers, 'ds')).toEqual([]);
    expect(crossProviders(providers, 'claude')).toEqual([]);
  });
  it('the chip names the provider and the model', () => {
    expect(subagentLabel({ providers, providerId: 'relay', model: crossValue('ds', 'deepseek-chat') })).toBe('N-ds / deepseek-chat');
  });
});
