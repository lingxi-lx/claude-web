import type { Item } from './conversation';
import { hitRate, inputTotal, sdkInput } from './tokens';

export interface ConvStats {
  turns: number;
  steps: number;
  /** input (cache reads and writes included) + output, every turn */
  tokens: number;
  /** output tokens per second of the model's own time (`duration_api_ms`); null when no turn reported that time */
  tokPerSec: number | null;
  /** share of all the input read from the cache; null when no turn reported cache fields */
  cacheHit: number | null;
}

/**
 * The whole conversation in one line (under the composer): how many turns and steps, how fast the model wrote, how
 * many tokens went through and how much of the input came from the cache. Summed over the turns' results — the
 * same numbers each turn's own line shows.
 */
export function convStats(items: readonly Item[]): ConvStats | null {
  let turns = 0, steps = 0, tokens = 0, apiMs = 0, outTimed = 0;
  // an engine process reports `duration_api_ms` as its running total (1.2 s, 2.2 s, 3.2 s over three 1 s turns) while
  // `usage` is the turn's own: a turn's model time is what the total grew by; a total that went down is a new process
  let lastTotal = 0;
  const cache = { input: 0, cacheRead: 0, cacheWrite: 0 };
  let cacheKnown = false;
  for (const it of items) {
    if (it.kind !== 'result') continue;
    turns++;
    steps += Number.isFinite(it.numTurns) ? it.numTurns : 0;
    const total = it.apiMs > 0 ? it.apiMs : 0;
    const turnMs = total > lastTotal ? total - lastTotal : total < lastTotal ? total : 0;
    if (total) lastTotal = total;
    const u = sdkInput(it.usage);
    if (!u) continue;
    tokens += inputTotal(u) + u.output;
    if (turnMs > 0 && u.output > 0) { apiMs += turnMs; outTimed += u.output; }
    if (u.cacheKnown) {
      cacheKnown = true;
      cache.input += u.input; cache.cacheRead += u.cacheRead; cache.cacheWrite += u.cacheWrite;
    }
  }
  if (!turns) return null;
  return {
    turns,
    steps,
    tokens,
    tokPerSec: apiMs > 0 ? outTimed / (apiMs / 1000) : null,
    cacheHit: cacheKnown && inputTotal(cache) > 0 ? hitRate(cache) : null,
  };
}
