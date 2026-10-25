import { describe, expect, it } from 'vitest';
import type { Provider } from '@shared';
import { crossProviders, subagentLabel } from './subagent-label';
import { crossValue } from '../../../../server/src/models/subagent';

const P = (id: string, type: Provider['type'], extra: Partial<Provider> = {}) => ({ id, name: `N-${id}`, type, baseUrl: 'https://x.invalid', models: [], ...extra }) as Provider;

describe('subagents on any model', () => {
  const providers = [P('relay', 'anthropic'), P('ds', 'openai'), P('gem', 'gemini'), P('gw', 'gateway'), P('other', 'anthropic'), P('acct', 'claude-account')];
  it('every provider the split route can reach, whatever the conversation runs on (the account included where it can be)', () => {
    // the gateway profile too: account pools such as WorkBuddy only exist in it
    expect(crossProviders(providers, 'relay')).toEqual(['ds', 'gem', 'gw', 'other', 'acct', 'claude']);
    // the account: every provider, another account too
    expect(crossProviders(providers, 'claude')).toEqual(['relay', 'ds', 'gem', 'gw', 'other', 'acct']);
    // an OpenAI-format conversation: providers only (no account login can be passed on from it)
    expect(crossProviders(providers, 'ds')).toEqual(['relay', 'gem', 'gw', 'other']);
    // another account: providers and other accounts, not this machine's login
    expect(crossProviders(providers, 'acct')).toEqual(['relay', 'ds', 'gem', 'gw', 'other']);
    // a gateway conversation: the other providers
    expect(crossProviders(providers, 'gw')).toEqual(['relay', 'ds', 'gem', 'other', 'acct', 'claude']);
  });
  it('the chip names the provider when it is not the conversation’s own', () => {
    expect(subagentLabel({ providers, providerId: 'relay', model: crossValue('ds', 'deepseek-chat') })).toBe('N-ds / deepseek-chat');
    expect(subagentLabel({ providers, providerId: 'ds', model: crossValue('ds', 'deepseek-chat') })).toBe('deepseek-chat');
    // a value from before (a plain id): the conversation's own provider
    expect(subagentLabel({ providers, providerId: 'ds', model: 'deepseek-chat' })).toBe('deepseek-chat');
    expect(subagentLabel({ providers, providerId: 'relay', model: crossValue('claude', 'claude-haiku-4-5'), builtin: [{ value: 'claude-haiku-4-5', displayName: 'Haiku' }] })).toBe('Claude 账号 / Haiku');
    expect(subagentLabel({ providers, providerId: 'claude', model: crossValue('claude', 'claude-haiku-4-5'), builtin: [{ value: 'claude-haiku-4-5', displayName: 'Haiku' }] })).toBe('Haiku');
  });
});
