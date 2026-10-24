import { describe, expect, it } from 'vitest';
import { accountFamily, accountModel, accountWindowOf, compactAtOk, effectiveCompact, familyWindows, parseTokens } from './account-window.js';

describe('accountFamily', () => {
  it('aliases and full ids', () => {
    expect(accountFamily('opus')).toBe('opus');
    expect(accountFamily('opus[1m]')).toBe('opus');
    expect(accountFamily('claude-opus-5-5')).toBe('opus');
    expect(accountFamily('claude-sonnet-5[1m]')).toBe('sonnet');
    expect(accountFamily('fable')).toBe('fable');
    expect(accountFamily('claude-fable-5-1')).toBe('fable');
  });
  it('haiku, default and others have none', () => {
    expect(accountFamily('haiku')).toBeUndefined();
    expect(accountFamily('claude-haiku-4-5-20251001')).toBeUndefined();
    expect(accountFamily('default')).toBeUndefined();
    expect(accountFamily(undefined)).toBeUndefined();
    expect(accountFamily('gpt-5')).toBeUndefined();
  });
});

describe('familyWindows', () => {
  it('keeps only the three families and the two sizes', () => {
    expect(familyWindows({ opus: 200000, sonnet: 1000000, fable: 5, haiku: 1000000, x: 1 })).toEqual({ opus: 200000, sonnet: 1000000 });
    expect(familyWindows(undefined)).toEqual({});
    expect(familyWindows('nope')).toEqual({});
  });
});

describe('accountModel', () => {
  it('1M by default: a plain pick gets [1m]', () => {
    expect(accountModel('claude-opus-5-5', {})).toBe('claude-opus-5-5[1m]');
    expect(accountModel('opus', {})).toBe('opus[1m]');
    expect(accountModel('opus[1m]', {})).toBe('opus[1m]');
  });
  it('200K picked: [1m] comes off', () => {
    expect(accountModel('opus[1m]', { opus: 200000 })).toBe('opus');
    expect(accountModel('claude-sonnet-5', { sonnet: 200000 })).toBe('claude-sonnet-5');
  });
  it('haiku, default and unknown pass unchanged', () => {
    expect(accountModel('haiku', {})).toBe('haiku');
    expect(accountModel('default', {})).toBe('default');
    expect(accountModel(undefined, {})).toBeUndefined();
  });
  it('window follows the same rule', () => {
    expect(accountWindowOf('claude-opus-5-5', {})).toBe(1_000_000);
    expect(accountWindowOf('opus[1m]', { opus: 200000 })).toBe(200_000);
    expect(accountWindowOf('haiku', {})).toBe(200_000);
    expect(accountWindowOf('default', {})).toBeUndefined();
  });
});

describe('parseTokens / compactAtOk / effectiveCompact', () => {
  it('parses K-style input', () => {
    expect(parseTokens('700')).toBe(700_000);
    expect(parseTokens('700k')).toBe(700_000);
    expect(parseTokens('700K')).toBe(700_000);
    expect(parseTokens('700000')).toBe(700_000);
    expect(parseTokens('700,000')).toBe(700_000);
    expect(parseTokens('1m')).toBe(1_000_000);
    expect(parseTokens('')).toBeUndefined();
    expect(parseTokens('abc')).toBeUndefined();
    expect(parseTokens('-5')).toBeUndefined();
  });
  it('a compaction point is 50K up to the window', () => {
    expect(compactAtOk(700_000, 1_000_000)).toBe(true);
    expect(compactAtOk(49_999, 1_000_000)).toBe(false);
    expect(compactAtOk(1_200_000, 1_000_000)).toBe(false);
    expect(compactAtOk(700_000, undefined)).toBe(true);
    expect(compactAtOk(undefined, 1_000_000)).toBe(false);
  });
  it('the smallest valid cap wins', () => {
    expect(effectiveCompact(700_000, 500_000, undefined)).toBe(500_000);
    expect(effectiveCompact(undefined, 0, NaN)).toBeUndefined();
  });
});
