// Reasoning replay for pass-through requests (ported from CLIProxyAPI's internal/cache, MIT).
//
// A provider that signs its reasoning wants it back: Claude refuses a tool-use turn whose thinking
// block went missing or lost its signature while thinking is on, OpenAI's Responses API keeps reasoning
// only through `encrypted_content` items. Plenty of clients drop those on the way (an OpenAI-style
// client that keeps only text, an editor that strips "hidden" blocks, a client that re-serializes
// thinking without its signature). The gateway sees every answer it relays, so it remembers:
//
// - SignatureCache: thinking text → its signature (per signing provider), restoring a signature the
//   client lost from a block it kept.
// - ThinkingReplayCache: per conversation, the signed thinking that preceded each assistant turn
//   (keyed by that turn's first tool_use id, or its text), restoring blocks the client dropped.
// - ReasoningReplayCache: per conversation, Responses `reasoning` items keyed by the function call /
//   message that followed them.
//
// Everything lives in bounded LRUs (entry count, approximate bytes, TTL) in memory only — nothing is
// written to disk, and a restored signature still goes through signature.ts before it is sent.

import crypto from 'node:crypto';
import { decideSignature, detectSignatureProvider, sanitizeAnthropicMessages, sanitizeChanged, sanitizeGeminiContents, sanitizeResponsesInput, type SanitizeReport, type SigProvider } from './signature.js';

// ------------------------------------------------------------------ bounded LRU

export interface LruOpts<V> {
  maxEntries: number;
  /** approximate byte cap over all values (sizeOf) */
  maxBytes?: number;
  ttlMs?: number;
  sizeOf?: (v: V) => number;
  now?: () => number;
}

interface LruEntry<V> { v: V; size: number; at: number }

/** Map-ordered LRU: a hit moves to the back, the front is evicted; expired entries vanish on read. */
export class BoundedLru<K, V> {
  private m = new Map<K, LruEntry<V>>();
  private bytes = 0;
  constructor(private o: LruOpts<V>) {}
  private now() { return this.o.now?.() ?? Date.now(); }
  private expired(e: LruEntry<V>) { return !!this.o.ttlMs && this.now() - e.at > this.o.ttlMs; }
  get size() { return this.m.size; }
  get totalBytes() { return this.bytes; }
  get(k: K): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (this.expired(e)) { this.delete(k); return undefined; }
    this.m.delete(k);
    this.m.set(k, e);
    return e.v;
  }
  has(k: K): boolean { return this.get(k) !== undefined; }
  set(k: K, v: V): void {
    const size = Math.max(0, this.o.sizeOf?.(v) ?? 0);
    // a single value larger than the whole budget is not kept (it would evict everything else)
    if (this.o.maxBytes && size > this.o.maxBytes) { this.delete(k); return; }
    this.delete(k);
    this.m.set(k, { v, size, at: this.now() });
    this.bytes += size;
    this.evict();
  }
  delete(k: K): boolean {
    const e = this.m.get(k);
    if (!e) return false;
    this.bytes -= e.size;
    return this.m.delete(k);
  }
  clear() { this.m.clear(); this.bytes = 0; }
  private evict() {
    for (const [k, e] of this.m) {
      const over = this.m.size > this.o.maxEntries || (!!this.o.maxBytes && this.bytes > this.o.maxBytes);
      if (!over && !this.expired(e)) break;
      this.delete(k);
    }
  }
}

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('base64url').slice(0, 32);
const jsonBytes = (v: unknown) => { try { return JSON.stringify(v).length; } catch { return 0; } };

// ------------------------------------------------------------------ signature cache

/** Thinking text → signature, per the provider that signed it. */
export class SignatureCache {
  private lru: BoundedLru<string, string>;
  constructor(o: Partial<LruOpts<string>> = {}) {
    this.lru = new BoundedLru({ maxEntries: 4096, maxBytes: 64 * 1024 * 1024, ttlMs: 3 * 3600_000, sizeOf: (s) => s.length, ...o });
  }
  private key(provider: SigProvider, text: string) { return `${provider}:${hash(text)}`; }
  remember(text: string, signature: string): void {
    if (!text.trim() || !signature.trim()) return;
    const provider = detectSignatureProvider(signature);
    if (provider === 'unknown') return;
    this.lru.set(this.key(provider === 'gemini_bypass' ? 'gemini' : provider, text), signature);
  }
  /** A signature for this exact text that `target` accepts. */
  lookup(target: SigProvider, text: string): string | undefined {
    if (!text.trim() || target === 'unknown') return undefined;
    const sig = this.lru.get(this.key(target, text));
    if (!sig) return undefined;
    const d = decideSignature(target, sig, 'claude_thinking');
    return d.action === 'preserve' ? d.normalized : undefined;
  }
  get size() { return this.lru.size; }
}

// ------------------------------------------------------------------ Anthropic thinking replay

const isThinking = (b: any) => b?.type === 'thinking' || b?.type === 'redacted_thinking';

/** What identifies an assistant turn regardless of its thinking: its first tool_use id, else its text. */
export function anthropicTurnKey(content: any[]): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const tool = content.find((b) => b?.type === 'tool_use' && typeof b.id === 'string' && b.id);
  if (tool) return `tool:${tool.id}`;
  const text = content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
  return text.trim() ? `text:${hash(text)}` : undefined;
}

/** Per conversation: turn key → the signed thinking blocks that came before that turn's other content. */
export class ThinkingReplayCache {
  private lru: BoundedLru<string, any[]>;
  constructor(o: Partial<LruOpts<any[]>> = {}) {
    this.lru = new BoundedLru({ maxEntries: 8192, maxBytes: 128 * 1024 * 1024, ttlMs: 2 * 3600_000, sizeOf: jsonBytes, ...o });
  }
  remember(session: string, content: any[]): void {
    if (!session || !Array.isArray(content)) return;
    const blocks = content.filter((b) => (b?.type === 'thinking' && typeof b.signature === 'string' && b.signature.trim()) || (b?.type === 'redacted_thinking' && b.data));
    const key = anthropicTurnKey(content);
    if (!blocks.length || !key) return;
    this.lru.set(`${session}\n${key}`, blocks.map((b) => ({ ...b })));
  }
  lookup(session: string, content: any[]): any[] | undefined {
    const key = anthropicTurnKey(content);
    return session && key ? this.lru.get(`${session}\n${key}`) : undefined;
  }
  get size() { return this.lru.size; }
}

// ------------------------------------------------------------------ Responses reasoning replay

/** What follows a reasoning item: a function call's call_id, or a message's text. */
export function responsesItemKey(item: any): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  if ((item.type === 'function_call' || item.type === 'custom_tool_call' || item.type === 'local_shell_call') && item.call_id) return `call:${item.call_id}`;
  if (item.type === 'message' && item.role === 'assistant') {
    const parts = Array.isArray(item.content) ? item.content : [];
    const text = parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
    return text.trim() ? `text:${hash(text)}` : undefined;
  }
  return undefined;
}

export class ReasoningReplayCache {
  private lru: BoundedLru<string, any>;
  constructor(o: Partial<LruOpts<any>> = {}) {
    this.lru = new BoundedLru({ maxEntries: 8192, maxBytes: 128 * 1024 * 1024, ttlMs: 2 * 3600_000, sizeOf: jsonBytes, ...o });
  }
  /** Remember each `reasoning` item (with encrypted_content) under the item that follows it. */
  remember(session: string, output: any[]): void {
    if (!session || !Array.isArray(output)) return;
    for (let i = 0; i < output.length - 1; i++) {
      const r = output[i];
      if (r?.type !== 'reasoning' || typeof r.encrypted_content !== 'string' || !r.encrypted_content) continue;
      const key = responsesItemKey(output[i + 1]);
      if (key) this.lru.set(`${session}\n${key}`, { ...r });
    }
  }
  lookup(session: string, item: any): any | undefined {
    const key = responsesItemKey(item);
    return session && key ? this.lru.get(`${session}\n${key}`) : undefined;
  }
  get size() { return this.lru.size; }
}

// ------------------------------------------------------------------ the gateway-facing pair: restore + record

export interface RestoreReport { restoredBlocks: number; restoredSignatures: number }

export class ReplayCaches {
  readonly signatures = new SignatureCache();
  readonly thinking = new ThinkingReplayCache();
  readonly reasoning = new ReasoningReplayCache();

  /**
   * Anthropic Messages body (mutated): a thinking block that lost its signature gets it back from the
   * signature cache; an assistant turn with no thinking at all gets the blocks it was answered with —
   * only when `target` accepts them (a block for another provider would just be stripped again).
   */
  restoreAnthropic(body: any, session: string | undefined, target: SigProvider): RestoreReport {
    const r: RestoreReport = { restoredBlocks: 0, restoredSignatures: 0 };
    if (!Array.isArray(body?.messages) || target === 'unknown') return r;
    // whole blocks come back only when this request thinks (a thinking-off request never needed them)
    const thinks = body.thinking?.type === 'enabled' || body.thinking?.type === 'adaptive';
    for (const m of body.messages) {
      if (m?.role !== 'assistant' || !Array.isArray(m.content)) continue;
      for (let i = 0; i < m.content.length; i++) {
        const b = m.content[i];
        if (b?.type !== 'thinking' || typeof b.thinking !== 'string' || !b.thinking.trim()) continue;
        if (typeof b.signature === 'string' && decideSignature(target, b.signature, 'claude_thinking').action === 'preserve') continue;
        const sig = this.signatures.lookup(target, b.thinking);
        if (sig) { m.content[i] = { ...b, signature: sig }; r.restoredSignatures++; }
      }
      if (!session || !thinks || m.content.some(isThinking)) continue;
      const cached = this.thinking.lookup(session, m.content);
      if (!cached) continue;
      const usable = cached.filter((b) => b.type === 'redacted_thinking' ? target === 'claude' : decideSignature(target, b.signature, 'claude_thinking').action === 'preserve');
      if (!usable.length) continue;
      m.content = [...usable.map((b) => ({ ...b })), ...m.content];
      r.restoredBlocks += usable.length;
    }
    return r;
  }

  /** Responses body (mutated): a function call / assistant message whose reasoning item the client dropped gets it back. */
  restoreResponses(body: any, session: string | undefined, target: SigProvider): RestoreReport {
    const r: RestoreReport = { restoredBlocks: 0, restoredSignatures: 0 };
    if (!session || !Array.isArray(body?.input) || (target !== 'gpt' && target !== 'grok')) return r;
    // a stored conversation (previous_response_id) already has its reasoning on the server
    if (body.previous_response_id) return r;
    const have = new Set(body.input.filter((x: any) => x?.type === 'reasoning' && x.id).map((x: any) => x.id));
    const out: any[] = [];
    for (let i = 0; i < body.input.length; i++) {
      const item = body.input[i];
      const prev = out[out.length - 1];
      if (prev?.type !== 'reasoning') {
        const cached = this.reasoning.lookup(session, item);
        if (cached && !(cached.id && have.has(cached.id))) {
          const ok = target === 'grok' ? detectSignatureProvider(cached.encrypted_content) === 'grok' : decideSignature('gpt', cached.encrypted_content, 'gpt_reasoning').action === 'preserve';
          if (ok) { out.push({ ...cached }); r.restoredBlocks++; if (cached.id) have.add(cached.id); }
        }
      }
      out.push(item);
    }
    if (r.restoredBlocks) body.input = out;
    return r;
  }

  /** A recorder for one relayed answer (JSON body or SSE events, in the client's protocol). */
  recorder(protocol: string, session: string | undefined): ReplayRecorder {
    return new ReplayRecorder(this, protocol, session);
  }
}

/** Collects an answer's signed reasoning as it streams by (fed by the usage sniffer) and stores it at the end. */
export class ReplayRecorder {
  private blocks: any[] = []; // Anthropic content blocks by index
  private output: any[] = []; // Responses output items in order
  private done = false;
  constructor(private caches: ReplayCaches, private protocol: string, private session: string | undefined) {}

  /** One parsed SSE event's data, or the whole non-stream JSON body. */
  feed(j: any): void {
    if (this.done || !j || typeof j !== 'object') return;
    try {
      if (this.protocol === 'anthropic') this.anthropic(j);
      else if (this.protocol === 'responses') this.responses(j);
      else if (this.protocol === 'gemini') this.gemini(j);
    } catch { /* a malformed event is the client's problem, never ours */ }
  }

  private anthropic(j: any) {
    if (j.type === 'message' && Array.isArray(j.content)) { this.blocks = j.content.map((b: any) => ({ ...b })); return; }
    if (j.type === 'content_block_start' && typeof j.index === 'number') { this.blocks[j.index] = { ...j.content_block }; return; }
    if (j.type === 'content_block_delta' && typeof j.index === 'number') {
      const b = this.blocks[j.index];
      const d = j.delta;
      if (!b || !d) return;
      if (d.type === 'thinking_delta') b.thinking = (b.thinking ?? '') + (d.thinking ?? '');
      else if (d.type === 'signature_delta') b.signature = (b.signature ?? '') + (d.signature ?? '');
      else if (d.type === 'text_delta') b.text = (b.text ?? '') + (d.text ?? '');
    }
  }

  private responses(j: any) {
    if (j.object === 'response' && Array.isArray(j.output)) { this.output = j.output; return; }
    if ((j.type === 'response.completed' || j.type === 'response.done') && Array.isArray(j.response?.output)) { this.output = j.response.output; return; }
    if (j.type === 'response.output_item.done' && j.item) {
      const at = typeof j.output_index === 'number' ? j.output_index : this.output.length;
      this.output[at] = j.item;
    }
  }

  private gemini(j: any) {
    const chunks = Array.isArray(j) ? j : [j];
    for (const c of chunks) {
      for (const part of c?.candidates?.[0]?.content?.parts ?? []) {
        if (part?.thought && typeof part.text === 'string') this.blocks.push({ text: part.text, sig: part.thoughtSignature });
      }
    }
  }

  /** The answer finished: store what it signed. */
  finish(): void {
    if (this.done) return;
    this.done = true;
    if (this.protocol === 'anthropic') {
      const content = this.blocks.filter(Boolean);
      for (const b of content) if (b.type === 'thinking' && typeof b.thinking === 'string' && typeof b.signature === 'string') this.caches.signatures.remember(b.thinking, b.signature);
      if (this.session) this.caches.thinking.remember(this.session, content);
    } else if (this.protocol === 'responses') {
      if (this.session) this.caches.reasoning.remember(this.session, this.output.filter(Boolean));
    } else if (this.protocol === 'gemini') {
      // Gemini streams a thought's text and signature in pieces; the joined text is what a client replays
      const text = this.blocks.map((b) => b.text).join('');
      const sig = [...this.blocks].reverse().find((b) => typeof b.sig === 'string' && b.sig)?.sig;
      if (text && sig) this.caches.signatures.remember(text, sig);
    }
  }
}

// ------------------------------------------------------------------ one call for the request path

export interface PreparedReasoning {
  /** the body was changed (re-serialize it; otherwise send the client's bytes untouched) */
  changed: boolean;
  restore: RestoreReport;
  sanitize: SanitizeReport | null;
}

/**
 * A pass-through body on its way to `target` (mutated): first put back reasoning the client dropped
 * (from the caches), then clean every signature the target would refuse (signature.ts).
 */
export function prepareReasoning(protocol: string, body: any, o: { target: SigProvider; session?: string; caches?: ReplayCaches }): PreparedReasoning {
  const restore: RestoreReport = { restoredBlocks: 0, restoredSignatures: 0 };
  let sanitize: SanitizeReport | null = null;
  if (protocol === 'anthropic') {
    if (o.caches) Object.assign(restore, o.caches.restoreAnthropic(body, o.session, o.target));
    sanitize = sanitizeAnthropicMessages(body, o.target);
  } else if (protocol === 'responses') {
    if (o.caches) Object.assign(restore, o.caches.restoreResponses(body, o.session, o.target));
    sanitize = sanitizeResponsesInput(body, o.target);
  } else if (protocol === 'gemini') {
    sanitize = sanitizeGeminiContents(body, o.target);
  }
  const changed = restore.restoredBlocks + restore.restoredSignatures > 0 || (!!sanitize && sanitizeChanged(sanitize));
  return { changed, restore, sanitize };
}
