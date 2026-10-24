import { fmtMs, fmtTok } from '@/util';
import { fmtCost, sumCosts } from '@/model/cost';
import { hitRate, pct } from '@/model/tokens';
import { tr } from '@/i18n';
import type { ContextUsage, Item as ConvItem } from '@/model/conversation';
import { contextWindowFor, ENGINE_DEFAULT_WINDOW, ONE_M } from '../../../../server/src/models/context-window';
import type { Provider } from '@shared';

/**
 * The composer's old stats bar (「1 轮 ↑253K ↓1.8K 缓存 100%」) — spec §4.2: the context ring in the composer's
 * bottom-right corner, the numbers on hover. Pure.
 */

/** `inp` = uncached input, `cache` = read from the cache, `write` = written to the cache. */
export interface Totals { turns: number; inp: number; out: number; cache: number; write: number; cost: number; costUnknown: number }

type Item = { kind: string; meta?: unknown; usage?: unknown; costUsd?: number; costUnknown?: boolean };
type Usage = { input: number; output: number; cacheRead: number; cacheWrite?: number };

export function sessionTotals(items: readonly Item[]): Totals {
  let inp = 0, out = 0, cache = 0, write = 0, turns = 0;
  for (const it of items) {
    if (it.kind === 'assistant' && it.usage) { const u = it.usage as Usage; inp += u.input; out += u.output; cache += u.cacheRead; write += u.cacheWrite ?? 0; }
    if (it.kind === 'user' && !it.meta) turns++;
  }
  const { cost, unknown } = sumCosts(items);
  return { turns, inp, out, cache, write, cost, costUnknown: unknown };
}

export type RingLevel = 'quiet' | 'note' | 'strong' | 'err';

/**
 * null = no occupancy reported (ACP agents…): no ring at all — an empty circle reads as a radio button or a spinner.
 * quiet < 60 % (a faint ring), note ≥ 60 % (the spec's threshold: the percentage shows), strong ≥ 80 % (ink, bold),
 * err ≥ 95 %. No yellow: spec §6.4 keeps it for 「需要你」.
 */
export function ringLevel(pct: number | undefined): RingLevel | null {
  if (pct === undefined || !Number.isFinite(pct)) return null;
  if (pct < 60) return 'quiet';
  return pct >= 95 ? 'err' : pct >= 80 ? 'strong' : 'note';
}

/**
 * What sits in the composer's corner of a conversation: the ring whenever the occupancy is known — a faint one without
 * a number below 60 %, the percentage from there (2026-10-15, a user's friend found it in one conversation and missed
 * it in the others: it only appeared at 60 %). The welcome page has none (final review I3: one control too many there).
 */
export function meterMode(pct: number | undefined): 'ring' | null {
  return ringLevel(pct) !== null ? 'ring' : null;
}

/**
 * The context of a conversation not running here, read off its last top-level answer (input + cache + output of that
 * call is what the next one starts from) against the model's window: the provider's (what the user set, the list's,
 * the name's), the account's 1M for a `[1m]` pick, else 200K — 1M when it already holds more. `compactWindow`: the
 * conversation's autocompact cap (`SessionInfoSnapshot.compactWindow`); the engine caps the window at it, so this does
 * too — the card's body (the engine's own count) and this agree (2026-10-24 review I3). Still not asked of the engine.
 */
export function estimateContext(items: readonly ConvItem[], o: { provider?: Pick<Provider, 'contextWindows' | 'modelContext'>; model?: string; compactWindow?: number }): ContextUsage | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== 'assistant' || it.parentToolUseId || !it.usage) continue;
    const u = it.usage;
    const total = u.input + u.cacheRead + u.cacheWrite + u.output;
    if (!total) return undefined;
    const model = o.model || it.model || '';
    let max = o.provider ? contextWindowFor(o.provider, model) : /\[1m\]$/i.test(model) ? ONE_M : undefined;
    max ??= ENGINE_DEFAULT_WINDOW;
    if (total > max && max < ONE_M) max = ONE_M;
    if (o.compactWindow && o.compactWindow > 0) max = Math.min(max, o.compactWindow);
    return { percentage: Math.min(100, Math.round((total / max) * 100)), totalTokens: total, maxTokens: max, estimated: true };
  }
  return undefined;
}

export function usageLines(t: Totals, o: { lastMs?: number; context?: { percentage: number; totalTokens: number; maxTokens: number; model?: string; estimated?: boolean }; tasks?: number }): [string, string][] {
  const lines: [string, string][] = [
    [tr('轮数'), String(t.turns)],
    [tr('输入 / 输出'), `↑${fmtTok(t.inp + t.cache + t.write)} ↓${fmtTok(t.out)}`],
  ];
  // same formula as the line under each answer and the ledger (cache writes count as input)
  if (t.cache > 0) lines.push([tr('缓存命中'), pct(hitRate({ input: t.inp, cacheRead: t.cache, cacheWrite: t.write }))]);
  if (t.cost > 0 || t.costUnknown > 0) lines.push([tr('费用'), fmtCost(t.cost, t.costUnknown)]);
  if (o.lastMs) lines.push([tr('上一轮用时'), fmtMs(o.lastMs)]);
  if (o.context) lines.push([o.context.estimated ? tr('上下文（按上一轮估）') : tr('上下文'), `${o.context.percentage}% · ${fmtTok(o.context.totalTokens)} / ${fmtTok(o.context.maxTokens)}`]);
  if (o.tasks) lines.push([tr('后台任务'), tr('{tasks} 个运行中', { tasks: o.tasks })]);
  return lines;
}
