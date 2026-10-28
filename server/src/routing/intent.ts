// 智能路由: 意图判断 (spec 2026-10-27 §7.5) — a small model reads the user's message and answers the number of the
// matching intent rule. It is optional: 0, a timeout, a failure or an unparseable answer all mean "leave the group's
// normal order alone". The caller injects the model call, so this module is deterministic and testable offline.
//
// Rules from the spec: only the first user message of a turn is classified; the prompt is trimmed to 4,000 chars
// (first 3,000 + last 1,000), answers are cached for 10 minutes per model + intent list + message, and after a failed
// call the classifier stays quiet for 30 seconds instead of paying for the same broken endpoint again.
import { tr } from '../i18n/index.js';

/** Defaults from §7.5 / §6.5 (判断模型超时 8s、10 分钟缓存). */
export const INTENT_TIMEOUT_MS = 8_000;
export const INTENT_CACHE_MS = 10 * 60_000;
export const INTENT_FAILURE_COOLDOWN_MS = 30_000;
export const INTENT_MESSAGE_MAX = 4_000;
export const INTENT_MESSAGE_HEAD = 3_000;
export const INTENT_MESSAGE_TAIL = 1_000;

export interface IntentClassifyOptions {
  /** the latest user message of the turn */
  message: string;
  /** intent rule labels, in rule order; the model answers 1..intents.length */
  intents: string[];
  /** overrides the classifier's default (spec: 8s) */
  timeoutMs?: number;
  /** overrides the classifier's cache (10-minute TTL by default) */
  cache?: IntentCache;
  /** overrides the classifier's failure gate (30s by default) */
  cooldown?: IntentCooldown;
}

/** The seam the router depends on; `createIntentClassifier` is the shipped implementation. */
export interface IntentClassifier {
  /** 1..n = the matching intent, 0 = none / timeout / failure. Never rejects. */
  classify(o: IntentClassifyOptions): Promise<number>;
}

/** Key-value cache with a timestamp policy owned by the implementation. */
export interface IntentCache {
  get(key: string): number | undefined;
  set(key: string, value: number): void;
}

/** Stops calling the model for a while after a failed call. */
export interface IntentCooldown {
  active(): boolean;
  fail(): void;
  succeed(): void;
}

/** How the small model is actually asked; injected so tests never need the network. */
export type IntentAsk = (prompt: string, o: { model: string; signal: AbortSignal }) => Promise<string>;

export interface IntentClassifierConfig {
  /** the judge model id — part of the cache key */
  model: string;
  ask: IntentAsk;
  /** default per-call timeout (8s) */
  timeoutMs?: number;
  /** shared stores; by default each classifier keeps its own */
  cache?: IntentCache;
  cooldown?: IntentCooldown;
  /** clock for the cache / cooldown (tests); defaults to Date.now */
  now?: () => number;
}

const finite = (n: number | undefined, fallback: number): number => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);

/** 4,000-char prompt body: the first 3,000 and the last 1,000 chars (the middle is dropped). */
export function trimIntentMessage(message: string): string {
  if (message.length <= INTENT_MESSAGE_MAX) return message;
  return message.slice(0, INTENT_MESSAGE_HEAD) + message.slice(-INTENT_MESSAGE_TAIL);
}

/** Cache identity: the judge model, the intent list (order matters) and the message the model will see. */
export function intentCacheKey(model: string, intents: readonly string[], message: string): string {
  return JSON.stringify([model, intents, trimIntentMessage(message)]);
}

/**
 * The answer's first integer that is a valid intent number (1..count). "2" → 2; "10 然后 3" with 3 intents → 3;
 * no integer in range → 0. Anything that is not a string counts as no answer.
 */
export function firstIntentInRange(answer: unknown, count: number): number {
  if (typeof answer !== 'string' || !Number.isFinite(count) || count < 1) return 0;
  for (const m of answer.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    if (Number.isInteger(n) && n >= 1 && n <= count) return n;
  }
  return 0;
}

/** The prompt sent to the judge model: the numbered intents, then the (already trimmed) user message. */
export function buildIntentPrompt(intents: readonly string[], message: string): string {
  const list = intents.map((label, i) => `${i + 1}. ${label}`).join('\n');
  return [
    tr('你是意图分类器。阅读用户消息，判断它属于下面哪一个意图。'),
    tr('只回答一个数字，不要解释：0 表示都不属于。'),
    list,
    '',
    tr('用户消息：'),
    message,
  ].join('\n');
}

/** In-memory cache: 10-minute TTL, lazy pruning, and an upper bound so a long-running gateway cannot grow forever. */
export class MemoryIntentCache implements IntentCache {
  private map = new Map<string, { value: number; at: number }>();
  constructor(private readonly now: () => number = Date.now, private readonly ttlMs: number = INTENT_CACHE_MS, private readonly max = 1_000) {}

  get(key: string): number | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: number): void {
    const now = this.now();
    this.map.delete(key);
    this.map.set(key, { value, at: now });
    if (this.map.size <= this.max) return;
    for (const [k, v] of this.map) {
      if (now - v.at >= this.ttlMs) this.map.delete(k);
    }
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/** Failure gate: after a throw / timeout, `active()` is true for 30 seconds. A good answer clears it. */
export class IntentFailureCooldown implements IntentCooldown {
  private until = 0;
  constructor(private readonly now: () => number = Date.now, private readonly ms: number = INTENT_FAILURE_COOLDOWN_MS) {}

  active(): boolean {
    return this.now() < this.until;
  }

  fail(): void {
    this.until = this.now() + this.ms;
  }

  succeed(): void {
    this.until = 0;
  }
}

/** Race the model call against the timeout, aborting the request; clears the timer in every outcome. */
async function askWithTimeout(ask: () => Promise<string>, timeoutMs: number, controller: AbortController): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('intent classifier timeout'));
    }, timeoutMs);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([Promise.resolve().then(ask), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The shipped classifier. `classify` never throws: an empty intent list / message → 0, a cached decision is returned
 * without a call, a recent failure short-circuits to 0, and a timeout / thrown model call starts the 30-second gate.
 */
export function createIntentClassifier(cfg: IntentClassifierConfig): IntentClassifier {
  const now = cfg.now ?? Date.now;
  const defaultCache = cfg.cache ?? new MemoryIntentCache(now);
  const defaultCooldown = cfg.cooldown ?? new IntentFailureCooldown(now);

  return {
    async classify(o: IntentClassifyOptions): Promise<number> {
      let cooldown = defaultCooldown;
      try {
        const intents = Array.isArray(o?.intents) ? o.intents : [];
        const message = typeof o?.message === 'string' ? o.message : '';
        if (!intents.length || !message.trim()) return 0;

        cooldown = o?.cooldown ?? defaultCooldown;
        const cache = o?.cache ?? defaultCache;
        const key = intentCacheKey(cfg.model, intents, message);
        const cached = cache.get(key);
        if (cached !== undefined && Number.isInteger(cached) && cached >= 0 && cached <= intents.length) return cached;
        if (cooldown.active()) return 0;

        const timeoutMs = Math.max(1, Math.min(120_000, Math.floor(finite(o?.timeoutMs ?? cfg.timeoutMs, INTENT_TIMEOUT_MS))));
        const prompt = buildIntentPrompt(intents, trimIntentMessage(message));
        const controller = new AbortController();
        const answer = await askWithTimeout(() => cfg.ask(prompt, { model: cfg.model, signal: controller.signal }), timeoutMs, controller);
        const n = firstIntentInRange(answer, intents.length);
        cache.set(key, n);
        cooldown.succeed();
        return n;
      } catch {
        try { cooldown.fail(); } catch { /* never throw */ }
        return 0;
      }
    },
  };
}
