import type { Item } from './conversation';
import { hitRate, inputTotal, sdkInput } from './tokens';

export interface ConvStats {
  turns: number;
  steps: number;
  /** output tokens per second of the model's time; null when no turn has output and a time */
  tokPerSec: number | null;
  /** share of all the input read from the cache; null when no turn reported cache fields */
  cacheHit: number | null;
}

/**
 * The whole conversation in one line (under the composer): how many turns and steps, how fast the model wrote and how
 * much of the input came from the cache. The tokens themselves are not repeated here: the context ring at the end of
 * the row has them. Summed over the turns' results — the same numbers each turn's own line shows.
 */
export function convStats(items: readonly Item[]): ConvStats | null {
  let turns = 0, steps = 0, ms = 0, out = 0;
  const cache = { input: 0, cacheRead: 0, cacheWrite: 0 };
  let cacheKnown = false;
  for (const it of items) {
    if (it.kind !== 'result') continue;
    turns++;
    steps += Number.isFinite(it.numTurns) ? it.numTurns : 0;
    // the model's own time (the server turns the engine's running total into each turn's share, usage/turn-cost.ts);
    // a turn without it — another agent, an older ledger row whose number was the running total (more than the whole
    // turn took) — counts the whole turn
    const turnMs = it.apiMs > 0 && it.apiMs <= it.durationMs * 1.05 ? it.apiMs : it.durationMs > 0 ? it.durationMs : 0;
    const u = sdkInput(it.usage);
    if (!u) continue;
    if (turnMs > 0 && u.output > 0) { ms += turnMs; out += u.output; }
    if (u.cacheKnown) {
      cacheKnown = true;
      cache.input += u.input; cache.cacheRead += u.cacheRead; cache.cacheWrite += u.cacheWrite;
    }
  }
  if (!turns) return null;
  return {
    turns,
    steps,
    tokPerSec: ms > 0 ? out / (ms / 1000) : null,
    cacheHit: cacheKnown && inputTotal(cache) > 0 ? hitRate(cache) : null,
  };
}
