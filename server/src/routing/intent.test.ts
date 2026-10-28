// 智能路由: 意图判断 — prompt trimming (3,000 + 1,000), 10-minute cache, 30-second failure cooldown, answer parsing and
// the "never throws" contract. The model call is injected, so this runs offline.
import { describe, expect, it } from 'vitest';
import {
  buildIntentPrompt,
  createIntentClassifier,
  firstIntentInRange,
  INTENT_CACHE_MS,
  INTENT_FAILURE_COOLDOWN_MS,
  IntentFailureCooldown,
  intentCacheKey,
  MemoryIntentCache,
  trimIntentMessage,
  type IntentAsk,
} from './intent.js';

const intents = ['简单问题', '写或修测试', '长文档'];

describe('prompt shaping', () => {
  it('trims over 4,000 chars to the first 3,000 and the last 1,000', () => {
    const message = 'H'.repeat(3_000) + 'M'.repeat(1_000) + 'T'.repeat(1_000);
    const trimmed = trimIntentMessage(message);
    expect(trimmed).toHaveLength(4_000);
    expect(trimmed.slice(0, 3_000)).toBe('H'.repeat(3_000));
    expect(trimmed.slice(-1_000)).toBe('T'.repeat(1_000));
    expect(trimmed.includes('M'.repeat(1_000))).toBe(false);
    expect(trimIntentMessage('short')).toBe('short');
  });

  it('the prompt numbers the intents and carries only the trimmed message', () => {
    const prompt = buildIntentPrompt(intents, 'hello');
    expect(prompt).toContain('1. 简单问题');
    expect(prompt).toContain('2. 写或修测试');
    expect(prompt).toContain('3. 长文档');
    expect(prompt).toContain('0 表示都不属于');
    expect(prompt.endsWith('hello')).toBe(true);
  });

  it('the cache key includes the model, the intent list and the trimmed message', () => {
    const long = 'A'.repeat(5_000);
    expect(intentCacheKey('m1', intents, 'hello')).not.toBe(intentCacheKey('m2', intents, 'hello'));
    expect(intentCacheKey('m1', ['a'], 'hello')).not.toBe(intentCacheKey('m1', ['b'], 'hello'));
    expect(intentCacheKey('m1', intents, long)).toBe(intentCacheKey('m1', intents, 'A'.repeat(3_000) + 'A'.repeat(1_000)));
  });
});

describe('answer parsing', () => {
  it('takes the first integer in range', () => {
    expect(firstIntentInRange('2', 3)).toBe(2);
    expect(firstIntentInRange('答案：10，然后 3', 3)).toBe(3);
    expect(firstIntentInRange('0', 3)).toBe(0);
    expect(firstIntentInRange('3', 2)).toBe(0);
    expect(firstIntentInRange('banana', 3)).toBe(0);
    expect(firstIntentInRange('', 3)).toBe(0);
    expect(firstIntentInRange(undefined, 3)).toBe(0);
  });

  it('classify returns that number, and 0 for no intents without calling the model', async () => {
    let calls = 0;
    const c = createIntentClassifier({ model: 'judge', ask: async () => { calls++; return '2'; } });
    expect(await c.classify({ message: 'hello', intents })).toBe(2);
    expect(await c.classify({ message: 'anything', intents: [] })).toBe(0);
    expect(await c.classify({ message: '   ', intents })).toBe(0);
    expect(calls).toBe(1);
  });
});

describe('cache (10 minutes)', () => {
  it('reuses an answer for the same model + intents + message', async () => {
    let now = 0;
    let calls = 0;
    const c = createIntentClassifier({ model: 'judge', now: () => now, ask: async () => { calls++; return '2'; } });
    expect(await c.classify({ message: 'hello', intents })).toBe(2);
    expect(await c.classify({ message: 'hello', intents })).toBe(2);
    expect(calls).toBe(1);
    now = INTENT_CACHE_MS - 1;
    expect(await c.classify({ message: 'hello', intents })).toBe(2);
    expect(calls).toBe(1);
    now = INTENT_CACHE_MS;
    expect(await c.classify({ message: 'hello', intents })).toBe(2);
    expect(calls).toBe(2);
  });

  it('a different model or intent list asks again', async () => {
    let calls = 0;
    let now = 0;
    const cache = new MemoryIntentCache(() => now);
    const ask: IntentAsk = async () => { calls++; return '1'; };
    const a = createIntentClassifier({ model: 'a', ask, cache, now: () => now });
    const b = createIntentClassifier({ model: 'b', ask, cache, now: () => now });
    await a.classify({ message: 'hello', intents });
    await b.classify({ message: 'hello', intents });
    await a.classify({ message: 'hello', intents: ['other'] });
    expect(calls).toBe(3);
  });

  it('a hit is returned even while the failure gate is closed', async () => {
    let now = 0;
    let calls = 0;
    const cache = new MemoryIntentCache(() => now);
    const cooldown = new IntentFailureCooldown(() => now);
    const c = createIntentClassifier({ model: 'judge', now: () => now, cache, cooldown, ask: async () => { calls++; return '3'; } });
    expect(await c.classify({ message: 'hello', intents })).toBe(3);
    cooldown.fail();
    expect(await c.classify({ message: 'hello', intents })).toBe(3);
    expect(calls).toBe(1);
  });
});

describe('failure cooldown (30 seconds)', () => {
  it('a thrown call returns 0 and suppresses further calls for 30s', async () => {
    let now = 0;
    let calls = 0;
    const c = createIntentClassifier({
      model: 'judge',
      now: () => now,
      ask: async () => { calls++; throw new Error('down'); },
    });
    expect(await c.classify({ message: 'hello', intents })).toBe(0);
    expect(calls).toBe(1);
    expect(await c.classify({ message: 'hello', intents })).toBe(0);
    expect(calls).toBe(1);
    now = INTENT_FAILURE_COOLDOWN_MS - 1;
    expect(await c.classify({ message: 'hello', intents })).toBe(0);
    expect(calls).toBe(1);
    now = INTENT_FAILURE_COOLDOWN_MS;
    expect(await c.classify({ message: 'hello', intents })).toBe(0);
    expect(calls).toBe(2);
  });

  it('a timeout returns 0, aborts the request and closes the gate', async () => {
    let signal: AbortSignal | undefined;
    let calls = 0;
    const c = createIntentClassifier({
      model: 'judge',
      timeoutMs: 5,
      ask: (_prompt, o) => { calls++; signal = o.signal; return new Promise<string>(() => { /* never answers */ }); },
    });
    expect(await c.classify({ message: 'hello', intents })).toBe(0);
    expect(calls).toBe(1);
    expect(signal?.aborted).toBe(true);
    expect(await c.classify({ message: 'hello', intents })).toBe(0);
    expect(calls).toBe(1);
  });

  it('never throws, even when the model throws synchronously', async () => {
    const c = createIntentClassifier({
      model: 'judge',
      ask: (() => { throw new Error('boom'); }) as unknown as IntentAsk,
    });
    await expect(c.classify({ message: 'hello', intents })).resolves.toBe(0);
  });

  it('a good answer clears an earlier failure latch', async () => {
    let now = 0;
    let fail = true;
    const c = createIntentClassifier({
      model: 'judge',
      now: () => now,
      ask: async () => { if (fail) throw new Error('down'); return '1'; },
    });
    expect(await c.classify({ message: 'hello', intents })).toBe(0);
    now = INTENT_FAILURE_COOLDOWN_MS;
    fail = false;
    expect(await c.classify({ message: 'hello', intents })).toBe(1);
    expect(await c.classify({ message: 'again', intents })).toBe(1);
  });
});
