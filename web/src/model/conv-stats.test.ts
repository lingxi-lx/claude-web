import { describe, expect, it } from 'vitest';
import type { Item, ResultItem } from './conversation';
import { convStats } from './conv-stats';

const result = (o: Partial<ResultItem>): ResultItem => ({ kind: 'result', id: Math.random().toString(36), subtype: 'success', durationMs: 5000, apiMs: 0, costUsd: 0, numTurns: 1, isError: false, ...o });

describe('convStats', () => {
  it('sums turns and steps; tok/s is all the output over the model time; cache hit over all the input', () => {
    const items: Item[] = [
      { kind: 'user', id: 'u1', text: 'hi' } as Item,
      result({ numTurns: 4, apiMs: 2000, usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 400 } }),
      result({ numTurns: 6, apiMs: 2000, usage: { input_tokens: 0, cache_read_input_tokens: 800, cache_creation_input_tokens: 200, output_tokens: 600 } }),
    ];
    expect(convStats(items)).toEqual({ turns: 2, steps: 10, tokPerSec: 250, cacheHit: 0.85 });
  });
  it('a turn without model time (history from another agent) or with an old running total (more than the turn took) counts its whole time', () => {
    const u = { input_tokens: 10, output_tokens: 100 };
    expect(convStats([result({ durationMs: 4000, apiMs: 0, usage: u })])!.tokPerSec).toBe(25);
    expect(convStats([result({ durationMs: 4000, apiMs: 90_000, usage: u })])!.tokPerSec).toBe(25);
    expect(convStats([result({ durationMs: 4000, apiMs: 2000, usage: u })])!.tokPerSec).toBe(50);
  });
  it('no output or no time → no speed; no cache fields → no rate; no turn → null', () => {
    expect(convStats([result({ numTurns: 3, durationMs: 0, usage: { input_tokens: 50, output_tokens: 10 } })])).toEqual({ turns: 1, steps: 3, tokPerSec: null, cacheHit: null });
    expect(convStats([{ kind: 'user', id: 'u', text: 'x' } as Item])).toBeNull();
  });
});
