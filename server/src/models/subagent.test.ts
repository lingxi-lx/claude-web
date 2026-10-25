import { describe, expect, it } from 'vitest';
import { crossPick, crossValue, fullPick, isSubAlias, providerKey, splitSupport, subAlias, subagentModelFor, subagentTarget, unalias, withSubagentDefault } from './subagent.js';

describe('subagent model', () => {
  it('a pick is kept whatever the conversation moves to; a plain one is made full with the provider it was made for', () => {
    const settings = { subagentModels: { p1: 'cheap', claude: 'haiku' } };
    expect(subagentModelFor({ recorded: { providerId: 'p1', model: 'mid' }, settings, providerId: 'p1' })).toBe(crossValue('p1', 'mid'));
    // moved to another provider: still the same model of p1
    expect(subagentModelFor({ recorded: { providerId: 'p1', model: 'mid' }, settings, providerId: 'claude' })).toBe(crossValue('p1', 'mid'));
    expect(subagentModelFor({ recorded: { providerId: 'claude', model: crossValue('p2', 'x') }, settings, providerId: 'p9' })).toBe(crossValue('p2', 'x'));
    // '' is a pick too: the same as the main model, over any default
    expect(subagentModelFor({ recorded: { providerId: 'p1', model: '' }, settings, providerId: 'p1' })).toBe('');
  });
  it('new conversations: the one global default, else the old per-provider one made full', () => {
    expect(subagentModelFor({ settings: { subagentModel: crossValue('p2', 'x'), subagentModels: { p1: 'cheap' } }, providerId: 'p1' })).toBe(crossValue('p2', 'x'));
    expect(subagentModelFor({ settings: { subagentModel: '', subagentModels: { p1: 'cheap' } }, providerId: 'p1' })).toBe('');
    expect(subagentModelFor({ settings: { subagentModels: { p1: 'cheap', claude: 'haiku' } }, providerId: 'p1' })).toBe(crossValue('p1', 'cheap'));
    expect(subagentModelFor({ settings: { subagentModels: { claude: 'haiku' } }, providerId: undefined })).toBe(crossValue('claude', 'haiku'));
    expect(subagentModelFor({ settings: {}, providerId: 'p9' })).toBe('');
  });
  it('fullPick / subagentTarget', () => {
    expect(fullPick('', 'p1')).toBe('');
    expect(fullPick('m', undefined)).toBe(crossValue('claude', 'm'));
    expect(fullPick(crossValue('p2', 'm'), 'p1')).toBe(crossValue('p2', 'm'));
    expect(subagentTarget('', 'p1')).toBeNull();
    expect(subagentTarget(crossValue('p1', 'm'), 'p1')).toEqual({ kind: 'same', model: 'm' });
    expect(subagentTarget(crossValue('claude', 'haiku'), undefined)).toEqual({ kind: 'same', model: 'haiku' });
    expect(subagentTarget('haiku', 'p1')).toEqual({ kind: 'same', model: 'haiku' }); // an old plain value: the conversation's own
    expect(subagentTarget(crossValue('p2', 'm'), 'p1')).toEqual({ kind: 'cross', pick: { providerId: 'p2', model: 'm' } });
    expect(subagentTarget(crossValue('p2', 'm'), undefined)).toEqual({ kind: 'cross', pick: { providerId: 'p2', model: 'm' } });
  });
  it('defaults (old map): set and removed per provider; junk ignored', () => {
    expect(providerKey(undefined)).toBe('claude');
    expect(withSubagentDefault({ a: 'x', b: 3 }, 'p1', 'm')).toEqual({ a: 'x', p1: 'm' });
    expect(withSubagentDefault({ a: 'x', p1: 'm' }, 'p1', '')).toEqual({ a: 'x' });
  });
});

describe('a subagent model of another provider', () => {
  it('round-trips provider and model (a model id may hold colons); plain picks are not one', () => {
    expect(crossPick(crossValue('p:1', 'org/model:free'))).toEqual({ providerId: 'p:1', model: 'org/model:free' });
    expect(crossPick('claude-haiku-4-5')).toBeNull();
    expect(crossPick('')).toBeNull();
    expect(crossPick('cw-x:p:')).toBeNull();
    // a hand-edited value with a broken escape: not a pick, not a throw
    expect(crossPick('cw-x:%E0:m')).toBeNull();
  });
  it('aliases: Anthropic wire keeps the name, other wires hide family words', () => {
    expect(subAlias('claude-haiku-4-5')).toBe('cw-sub/claude-haiku-4-5');
    const other = subAlias('claude-haiku-4-5', 'other');
    expect(other).toMatch(/^cw-sub-[0-9a-f]+$/);
    expect(other).not.toMatch(/haiku|sonnet|opus/i);
    expect(isSubAlias(other, 'claude-haiku-4-5')).toBe(true);
    expect(isSubAlias('cw-sub/claude-haiku-4-5', 'claude-haiku-4-5')).toBe(true);
    expect(isSubAlias('claude-haiku-4-5', 'claude-haiku-4-5')).toBe(false);
    expect(unalias(subAlias('org/模型:free'))).toBe('org/模型:free');
    expect(unalias(subAlias('org/模型:free', 'other'))).toBe('org/模型:free');
    expect(unalias('claude-opus-5-5[1m]')).toBe('claude-opus-5-5[1m]');
    expect(unalias('cw-sub-zz')).toBe('cw-sub-zz');
  });
  it('which main / subagent pairs the split route can do', () => {
    for (const sub of ['anthropic', 'openai', 'gemini', 'grok'] as const) {
      for (const main of ['anthropic', 'openai', 'gemini', 'grok', 'gateway', 'claude', 'claude-account'] as const) expect(splitSupport({ mainType: main, subType: sub })).toBe(true);
    }
    // a gateway profile: its group serves the subagents, whatever the conversation runs on
    for (const main of ['anthropic', 'openai', 'gemini', 'grok', 'gateway', 'claude', 'claude-account'] as const) expect(splitSupport({ mainType: main, subType: 'gateway' })).toBe(true);
    // another account's token: any Anthropic-wire main
    for (const main of ['anthropic', 'gateway', 'claude', 'claude-account'] as const) expect(splitSupport({ mainType: main, subType: 'claude-account' })).toBe(true);
    for (const main of ['openai', 'gemini', 'grok'] as const) expect(splitSupport({ mainType: main, subType: 'claude-account' })).toBe(false);
    // this machine's login: only under an Anthropic-format provider (the engine keeps the login, the provider gets its key)
    for (const main of ['anthropic', 'gateway'] as const) expect(splitSupport({ mainType: main, subType: 'claude' })).toBe(true);
    for (const main of ['openai', 'gemini', 'grok', 'claude-account'] as const) expect(splitSupport({ mainType: main, subType: 'claude' })).toBe(false);
  });
});
