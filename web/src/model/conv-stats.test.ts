import { describe, expect, it } from 'vitest';
import type { Item, ResultItem } from './conversation';
import { convStats } from './conv-stats';

const result = (o: Partial<ResultItem>): ResultItem => ({ kind: 'result', id: Math.random().toString(36), subtype: 'success', durationMs: 1000, apiMs: 0, costUsd: 0, numTurns: 1, isError: false, ...o });

describe('convStats', () => {
  it('sums turns, steps, tokens; tok/s over the model time; cache hit over all the input', () => {
    const items: Item[] = [
      { kind: 'user', id: 'u1', text: 'hi' } as Item,
      result({ numTurns: 4, apiMs: 2000, usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 400 } }),
      result({ numTurns: 6, apiMs: 2000, usage: { input_tokens: 0, cache_read_input_tokens: 800, cache_creation_input_tokens: 200, output_tokens: 600 } }),
    ];
    expect(convStats(items)).toEqual({ turns: 2, steps: 10, tokens: 3000, tokPerSec: 250, cacheHit: 0.85 });
  });
  it('a turn from history (no model time) counts but does not make up a speed; no cache fields → no rate; no turn → null', () => {
    const s = convStats([result({ numTurns: 3, usage: { input_tokens: 50, output_tokens: 10 } })]);
    expect(s).toEqual({ turns: 1, steps: 3, tokens: 60, tokPerSec: null, cacheHit: null });
    expect(convStats([{ kind: 'user', id: 'u', text: 'x' } as Item])).toBeNull();
  });
});
