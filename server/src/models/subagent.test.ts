import { describe, expect, it } from 'vitest';
import { providerKey, subagentDefault, subagentModelFor, withSubagentDefault } from './subagent.js';

describe('subagent model', () => {
  it('the conversation pick wins when it was made for its provider, else the provider default', () => {
    const defaults = { p1: 'cheap', claude: 'haiku' };
    expect(subagentModelFor({ recorded: { providerId: 'p1', model: 'mid' }, defaults, providerId: 'p1' })).toBe('mid');
    // '' is a pick too: the same as the main model, over the default
    expect(subagentModelFor({ recorded: { providerId: 'p1', model: '' }, defaults, providerId: 'p1' })).toBe('');
    // moved to another provider: that one's default
    expect(subagentModelFor({ recorded: { providerId: 'p1', model: 'mid' }, defaults, providerId: 'claude' })).toBe('haiku');
    expect(subagentModelFor({ defaults, providerId: undefined })).toBe('haiku');
    expect(subagentModelFor({ defaults: undefined, providerId: 'p9' })).toBe('');
  });
  it('defaults: set and removed per provider; junk ignored', () => {
    expect(providerKey(undefined)).toBe('claude');
    expect(withSubagentDefault({ a: 'x', b: 3 }, 'p1', 'm')).toEqual({ a: 'x', p1: 'm' });
    expect(withSubagentDefault({ a: 'x', p1: 'm' }, 'p1', '')).toEqual({ a: 'x' });
    expect(subagentDefault('nope', 'p1')).toBe('');
  });
});
