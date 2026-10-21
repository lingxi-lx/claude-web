import { describe, expect, it } from 'vitest';
import { AffinityTable } from './affinity.js';

describe('AffinityTable', () => {
  it('binds within the TTL and forgets after it', () => {
    const t = new AffinityTable();
    t.bind('pool', 's1', 'acct_1', 60, 1000);
    expect(t.get('pool', 's1', 1000 + 59 * 60_000)).toBe('acct_1');
    expect(t.get('pool', 's1', 1000 + 61 * 60_000)).toBeUndefined();
  });

  it('drops one key or every key of an account', () => {
    const t = new AffinityTable();
    t.bind('pool', 's1', 'acct_1', 60);
    t.bind('pool', 's2', 'acct_1', 60);
    t.bind('pool', 's3', 'acct_2', 60);
    t.drop('pool', 's1');
    expect(t.get('pool', 's1')).toBeUndefined();
    t.dropAccount('acct_1');
    expect(t.get('pool', 's2')).toBeUndefined();
    expect(t.get('pool', 's3')).toBe('acct_2');
  });
});
