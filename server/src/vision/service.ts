/**
 * The seer: a small vision model that turns a screenshot (or one region of it) into words, for models that cannot
 * see pictures and for cheap fallback when UI Automation has nothing to offer.
 *
 * Fail-closed by design: this module never calls the network itself. A caller is handed in (the gateway / a local
 * model, wired by the host later); without one, or on timeout / error / empty answer, `describe` returns an error
 * and nothing is cached. Successes are cached by image sha256 + question for the life of the process.
 */
import { LruCache, VISION_CACHE_SIZE, sha256Image } from './cache.js';
import { tr } from '../i18n/index.js';

export interface VisionDescribeRequest {
  /** base64 image bytes, with or without a data: URL prefix */
  image: string;
  /** default image/jpeg */
  mimeType?: string;
  /** what to look at / ask about the picture */
  question: string;
}

export interface VisionCallRequest {
  image: string;
  mimeType: string;
  question: string;
  signal: AbortSignal;
}

/** One call to the actual vision model. Must stop when `signal` aborts. May throw. */
export type VisionCaller = (request: VisionCallRequest) => Promise<string>;

export interface VisionCacheEntry { text: string; sha256: string; mimeType: string }

export interface VisionServiceOptions {
  /** absent: no vision model configured — every call fails closed */
  call?: VisionCaller;
  cache?: LruCache<string, VisionCacheEntry>;
  /** default 20000 ms */
  timeoutMs?: number;
  now?: () => number;
}

export type VisionErrorCode = 'invalid' | 'unavailable' | 'timeout' | 'aborted' | 'empty' | 'failed';

export type VisionResult =
  | { ok: true; text: string; cached: boolean; sha256: string; ms: number }
  | { ok: false; code: VisionErrorCode; error: string; sha256?: string; ms: number };

export class VisionTimeoutError extends Error {
  constructor() { super('vision timeout'); this.name = 'VisionTimeoutError'; }
}
export class VisionAbortError extends Error {
  constructor() { super('vision aborted'); this.name = 'AbortError'; }
}

const MAX_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 100;

const clampTimeout = (n: number): number => Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(n)));

function mimeOf(request: VisionDescribeRequest): string | null {
  if (typeof request.mimeType === 'string' && request.mimeType.trim()) return request.mimeType.trim();
  const m = /^data:([^;,]+)[;,]/.exec(request.image);
  return m ? m[1] : 'image/jpeg';
}

const cacheKey = (sha: string, question: string): string => `${sha}\u0000${question.trim().toLowerCase()}`;

export class VisionService {
  private readonly cache: LruCache<string, VisionCacheEntry>;
  private readonly call: VisionCaller | undefined;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(opts: VisionServiceOptions = {}) {
    this.call = opts.call;
    this.cache = opts.cache ?? new LruCache<string, VisionCacheEntry>(VISION_CACHE_SIZE);
    this.timeoutMs = clampTimeout(opts.timeoutMs ?? 20_000);
    this.now = opts.now ?? Date.now;
  }

  get cacheSize(): number { return this.cache.size; }
  clearCache(): void { this.cache.clear(); }
  get configured(): boolean { return !!this.call; }

  /**
   * Describe / answer a question about one image. The same image and question hit the cache; failures never do.
   */
  async describe(request: VisionDescribeRequest, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<VisionResult> {
    const started = this.now();
    const fail = (code: VisionErrorCode, error: string, sha?: string): VisionResult =>
      ({ ok: false, code, error, ...(sha ? { sha256: sha } : {}), ms: Math.max(0, this.now() - started) });
    if (!request || typeof request.image !== 'string' || !request.image.trim()) return fail('invalid', tr('要看的图片是空的。'));
    if (typeof request.question !== 'string' || !request.question.trim()) return fail('invalid', tr('"question" 必须说明要看什么。'));
    const mimeType = mimeOf(request);
    if (!mimeType || !/^image\//i.test(mimeType)) return fail('invalid', tr('图片类型不对：{mimeType}', { mimeType: mimeType ?? '' }));
    const image = request.image;
    const sha = sha256Image(image);
    const key = cacheKey(sha, request.question);
    const cached = this.cache.get(key);
    if (cached) return { ok: true, text: cached.text, cached: true, sha256: sha, ms: Math.max(0, this.now() - started) };
    if (!this.call) return fail('unavailable', tr('没有配置看图模型，无法描述这张图。'), sha);
    if (opts.signal?.aborted) return fail('aborted', tr('看图已停止。'), sha);

    const timeout = clampTimeout(opts.timeoutMs ?? this.timeoutMs);
    const ctrl = new AbortController();
    const outer = opts.signal;
    let byTimeout = false;
    const onOuterAbort = () => ctrl.abort(outer?.reason);
    if (outer?.aborted) ctrl.abort(outer.reason);
    else outer?.addEventListener('abort', onOuterAbort, { once: true });

    let timer: NodeJS.Timeout | undefined;
    const timeoutP = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { byTimeout = true; ctrl.abort(); reject(new VisionTimeoutError()); }, timeout);
      timer.unref?.();
    });
    const abortedP = new Promise<never>((_, reject) => {
      if (!outer) return;
      const onAbort = () => reject(new VisionAbortError());
      if (outer.aborted) onAbort();
      else outer.addEventListener('abort', onAbort, { once: true });
    });
    // the abort promise is only interesting while the call is running
    abortedP.catch(() => { /* raced, or no outer signal */ });
    try {
      const text = await Promise.race([
        Promise.resolve().then(() => this.call!({ image, mimeType, question: request.question.trim(), signal: ctrl.signal })),
        timeoutP,
        abortedP,
      ]);
      const clean = typeof text === 'string' ? text.trim() : '';
      if (!clean) return fail('empty', tr('看图模型没有给出内容。'), sha);
      this.cache.set(key, { text: clean, sha256: sha, mimeType });
      return { ok: true, text: clean, cached: false, sha256: sha, ms: Math.max(0, this.now() - started) };
    } catch (e) {
      if (byTimeout || e instanceof VisionTimeoutError) return fail('timeout', tr('看图超时（{ms} 毫秒），没有结果。', { ms: timeout }), sha);
      if (outer?.aborted || e instanceof VisionAbortError) return fail('aborted', tr('看图已停止。'), sha);
      return fail('failed', tr('看图失败：{message}', { message: (e as Error)?.message ?? String(e) }), sha);
    } finally {
      if (timer) clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    }
  }
}

/** A service with no model: useful as a default so every `look` fails with the same clear message. */
export function unavailableVision(): VisionService {
  return new VisionService();
}
