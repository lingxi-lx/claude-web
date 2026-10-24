import { describe, expect, it } from 'vitest';
import { estimateContext, meterMode, ringLevel, sessionTotals, usageLines } from './stats';

const items = [
  { kind: 'user' },
  { kind: 'assistant', usage: { input: 100, output: 20, cacheRead: 900, cacheWrite: 0 } },
  { kind: 'result', costUsd: 0.5 },
  { kind: 'user', meta: true }, // a meta line (compact summary…) is not a turn
  { kind: 'user' },
  { kind: 'assistant', usage: { input: 50, output: 30, cacheRead: 950, cacheWrite: 0 } },
  { kind: 'result', costUnknown: true },
];

describe('the old stats bar, now behind the usage ring', () => {
  it('turns, tokens in / out, cache share, cost (unknown counted, not zero)', () => {
    expect(sessionTotals(items)).toEqual({ turns: 2, inp: 150, out: 50, cache: 1850, write: 0, cost: 0.5, costUnknown: 1 });
  });
  it('cache writes count as input — the same hit rate as the ledger and the line under each answer', () => {
    const t = sessionTotals([{ kind: 'user' }, { kind: 'assistant', usage: { input: 100, output: 10, cacheRead: 600, cacheWrite: 300 } }]);
    expect(t.write).toBe(300);
    const lines = usageLines(t, {});
    expect(lines.find((l) => l[0] === '输入 / 输出')?.[1]).toBe('↑1.0K ↓10');
    expect(lines.find((l) => l[0] === '缓存命中')?.[1]).toBe('60%'); // 600 of 1000, not 600 of 700
  });
  it('the ring: none without an occupancy, quiet under 60 %, noted from 60 %, strong from 80 %, error from 95 % (no yellow level)', () => {
    expect(ringLevel(undefined)).toBeNull();
    expect(ringLevel(Number.NaN)).toBeNull();
    expect(ringLevel(0)).toBe('quiet');
    expect(ringLevel(59)).toBe('quiet');
    expect(ringLevel(60)).toBe('note');
    expect(ringLevel(80)).toBe('strong');
    expect(ringLevel(94)).toBe('strong');
    expect(ringLevel(95)).toBe('err');
  });
  it('the corner: the ring whenever the occupancy is known (a faint one under 60 %) — desktop and phone alike', () => {
    expect(meterMode(undefined)).toBeNull(); // nothing known (ACP, a conversation with no answer yet): the card is ··· 本对话用量
    expect(meterMode(0)).toBe('ring');
    expect(meterMode(40)).toBe('ring');
    expect(meterMode(60)).toBe('ring');
    expect(meterMode(97)).toBe('ring');
  });
  it('a conversation not running here: the context read off its last top-level answer, against the model window', () => {
    const answer = (usage: any, model = 'claude-sonnet-5-5', parentToolUseId: string | null = null) => ({ kind: 'assistant', id: Math.random().toString(), model, parentToolUseId, blocks: [], usage }) as any;
    const u = { input: 3, cacheRead: 600_000, cacheWrite: 99_000, output: 1000 };
    // the account: 200K unless the pick is [1m] — or it already holds more
    expect(estimateContext([answer(u)], { model: 'claude-sonnet-5-5[1m]' })).toEqual({ percentage: 70, totalTokens: 700_003, maxTokens: 1_000_000, estimated: true });
    expect(estimateContext([answer({ input: 1, cacheRead: 99_999, cacheWrite: 0, output: 0 })], {})).toMatchObject({ percentage: 50, maxTokens: 200_000 });
    expect(estimateContext([answer(u)], {})).toMatchObject({ maxTokens: 1_000_000 });
    // under 200K: only a `[1m]` pick is measured against 1M — not an id that merely ends in 1 or m
    const tenth = answer({ input: 1, cacheRead: 99_999, cacheWrite: 0, output: 0 });
    expect(estimateContext([tenth], { model: 'sonnet[1m]' })).toMatchObject({ percentage: 10, maxTokens: 1_000_000 });
    expect(estimateContext([tenth], { model: 'claude-opus-4-1' })).toMatchObject({ percentage: 50, maxTokens: 200_000 });
    expect(estimateContext([tenth], { model: 'opusplan' })).toMatchObject({ percentage: 50, maxTokens: 200_000 });
    // a provider: its own window for the model (what the user set wins)
    expect(estimateContext([answer({ input: 1, cacheRead: 135_999, cacheWrite: 0, output: 0 }, 'gpt-6')], { provider: { contextWindows: { 'gpt-6': 272_000 } } })).toMatchObject({ percentage: 50, maxTokens: 272_000 });
    // a subagent's answer is not the conversation's context; nothing answered yet = unknown
    expect(estimateContext([answer(u), answer({ input: 1, cacheRead: 0, cacheWrite: 0, output: 0 }, 'm', 'toolu_1')], { model: 'x[1m]' })).toMatchObject({ totalTokens: 700_003 });
    expect(estimateContext([], {})).toBeUndefined();
  });
  // 2026-10-24 review I3: the engine caps the window at CLAUDE_CODE_AUTO_COMPACT_WINDOW (700k in a user's settings.json);
  // the ring and the folded card divided by 1M — 58 % where the card's body said 82 %, 80 / 95 % never reached
  it('the autocompact cap lowers the window it divides by (never raises it)', () => {
    const answer = (usage: any, model = 'claude-opus-5-5') => ({ kind: 'assistant', id: Math.random().toString(), model, parentToolUseId: null, blocks: [], usage }) as any;
    const at577k = answer({ input: 1, cacheRead: 576_999, cacheWrite: 0, output: 0 });
    expect(estimateContext([at577k], { model: 'claude-opus-5-5[1m]' })).toMatchObject({ percentage: 58, maxTokens: 1_000_000 });
    expect(estimateContext([at577k], { model: 'claude-opus-5-5[1m]', compactWindow: 700_000 })).toEqual({ percentage: 82, totalTokens: 577_000, maxTokens: 700_000, estimated: true });
    // the account's 200K bumped to 1M by what it holds, then capped
    expect(estimateContext([at577k], { compactWindow: 700_000 })).toMatchObject({ percentage: 82, maxTokens: 700_000 });
    // a provider's window, capped
    expect(estimateContext([answer({ input: 1, cacheRead: 135_999, cacheWrite: 0, output: 0 }, 'gpt-6')], { provider: { contextWindows: { 'gpt-6': 272_000 } }, compactWindow: 200_000 })).toMatchObject({ percentage: 68, maxTokens: 200_000 });
    // a cap above the window changes nothing
    const tenth = answer({ input: 1, cacheRead: 99_999, cacheWrite: 0, output: 0 });
    expect(estimateContext([tenth], { model: 'claude-opus-4-1', compactWindow: 700_000 })).toMatchObject({ percentage: 50, maxTokens: 200_000 });
    // past the cap (it compacts below it): full, not over 100
    expect(estimateContext([at577k], { model: 'x[1m]', compactWindow: 500_000 })).toMatchObject({ percentage: 100, maxTokens: 500_000 });
  });
  it('the lines the hover card shows (every field of the old bar)', () => {
    const lines = usageLines(sessionTotals(items), { lastMs: 4200, context: { percentage: 72, totalTokens: 145_000, maxTokens: 200_000 }, tasks: 2 });
    expect(lines.map((l) => l[0])).toEqual(['轮数', '输入 / 输出', '缓存命中', '费用', '上一轮用时', '上下文', '后台任务']);
    expect(lines.find((l) => l[0] === '轮数')?.[1]).toBe('2');
    expect(lines.find((l) => l[0] === '缓存命中')?.[1]).toBe('93%'); // 1850 of 2000 input tokens
    expect(lines.find((l) => l[0] === '费用')?.[1]).toBe('≥ $0.50');
    expect(lines.find((l) => l[0] === '上下文')?.[1]).toMatch(/^72% · 145/);
  });
  it('fields without data are left out', () => {
    expect(usageLines({ turns: 0, inp: 0, out: 0, cache: 0, write: 0, cost: 0, costUnknown: 0 }, {}).map((l) => l[0])).toEqual(['轮数', '输入 / 输出']);
  });
});
