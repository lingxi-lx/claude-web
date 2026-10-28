// Thinking-signature validation and cleaning per provider (ported from CLIProxyAPI's
// internal/signature, MIT). A conversation that crossed providers carries reasoning signed by
// someone else — Claude's `thinking.signature`, Gemini's `thoughtSignature`, OpenAI / xAI
// `reasoning.encrypted_content`, Kimi's base64 blob, or an empty one (another format's reasoning
// relayed through the gateway). Sent to the wrong upstream they are a hard 400 ("Invalid signature
// in thinking block"), so before a pass-through request leaves, every signed block is checked against
// the target's own format: a compatible one stays (normalized), an incompatible one is dropped, given
// Gemini's bypass sentinel, or loses just its signature (Kimi does not check it).
//
// Only the self-describing structure is checked (prefixes, base64 alphabets, protobuf envelopes,
// lengths, entropy) — nothing here can verify a signature cryptographically.

export type SigProvider = 'unknown' | 'claude' | 'gemini' | 'gemini_bypass' | 'gpt' | 'kimi' | 'grok' | 'swe';
export type SigBlockKind = 'unknown' | 'claude_thinking' | 'gemini_model_part' | 'gemini_function_call' | 'gpt_reasoning';
export type SigAction = 'preserve' | 'drop_block' | 'drop_signature' | 'replace_with_gemini_bypass' | 'no_compatible_replacement';

export interface SigDecision {
  target: SigProvider;
  detected: SigProvider;
  kind: SigBlockKind;
  compatible: boolean;
  action: SigAction;
  /** the signature to send when `preserve` (may differ from the input: a provider prefix / double layer removed) */
  normalized?: string;
  /** the signature to send when `replace_with_gemini_bypass` */
  replacement?: string;
}

export const GEMINI_SKIP_VALIDATOR = 'skip_thought_signature_validator';
export const GEMINI_CONTEXT_BYPASS = 'context_engineering_is_the_way_to_go';
const MAX_SIG_LEN = 32 * 1024 * 1024;
const MAX_ROUTER_SUFFIX = 128;

// ------------------------------------------------------------------ provider from a model / target

function providerFromName(lower: string): SigProvider {
  if (lower.includes('claude')) return 'claude';
  if (lower.includes('gemini')) return 'gemini';
  if (lower.includes('gpt') || lower.includes('openai') || lower.includes('codex') || /^o[134]/.test(lower)) return 'gpt';
  if (lower.includes('kimi') || lower.includes('moonshot') || /^k[23]/.test(lower)) return 'kimi';
  if (lower.includes('grok')) return 'grok';
  if (lower.includes('swe-')) return 'swe';
  return 'unknown';
}

/** Whose signatures a model accepts, from its name (`vendor/model` and `group:model` look at the last segment first). */
export function providerFromModel(model: string | undefined): SigProvider {
  const lower = String(model ?? '').trim().toLowerCase();
  if (!lower) return 'unknown';
  const idx = Math.max(lower.lastIndexOf('/'), lower.lastIndexOf(':'));
  const last = idx >= 0 && idx < lower.length - 1 ? lower.slice(idx + 1) : lower;
  const p = providerFromName(last);
  if (p !== 'unknown' || last === lower) return p;
  return providerFromName(lower);
}

/**
 * The provider a pass-through attempt reaches: the model name first (a relay serving `claude-*` checks
 * Claude signatures), then the endpoint (first-party hosts only — an unknown relay stays `unknown`, and
 * an unknown target is left exactly as the client sent it).
 */
export function signatureTargetOf(target: { type?: string; baseUrl?: string } | undefined, model: string | undefined): SigProvider {
  const byModel = providerFromModel(model);
  if (byModel !== 'unknown') return byModel;
  const host = (() => {
    try { return new URL(String(target?.baseUrl ?? '')).hostname.toLowerCase(); } catch { return ''; }
  })();
  if (host) {
    if (host.endsWith('anthropic.com')) return 'claude';
    if (host.endsWith('googleapis.com')) return 'gemini';
    if (host.endsWith('openai.com') || host.endsWith('chatgpt.com')) return 'gpt';
    if (host.endsWith('x.ai')) return 'grok';
    if (host.includes('moonshot') || host.includes('kimi')) return 'kimi';
    return 'unknown';
  }
  // no base URL: the type's default endpoint
  if (target?.type === 'anthropic' || target?.type === 'claude-account') return 'claude';
  if (target?.type === 'gemini') return 'gemini';
  if (target?.type === 'grok') return 'grok';
  if (target?.type === 'openai') return 'gpt';
  return 'unknown';
}

// ------------------------------------------------------------------ base64 / protobuf primitives

const STD = /^[A-Za-z0-9+/]*$/;
const URLSAFE = /^[A-Za-z0-9_-]*$/;

/** Strict base64: `std` (padded), `raw` (unpadded std), `url` (padded url-safe), `rawurl`. */
function b64(s: string, mode: 'std' | 'raw' | 'url' | 'rawurl'): Buffer | null {
  const url = mode === 'url' || mode === 'rawurl';
  const padded = mode === 'std' || mode === 'url';
  let body = s;
  if (padded) {
    if (s.length % 4 !== 0) return null;
    body = s.replace(/={1,2}$/, '');
  } else if (s.length % 4 === 1 || s.includes('=')) return null;
  if (!(url ? URLSAFE : STD).test(body)) return null;
  return Buffer.from(body, url ? 'base64url' : 'base64');
}

/** Go's StdEncoding first, then RawStdEncoding. */
const b64StdOrRaw = (s: string) => b64(s, 'std') ?? b64(s, 'raw');

interface PbField { num: number; type: number; /** varint value (type 0) */ v?: bigint; /** bytes payload (type 2) */ bytes?: Buffer }

function readVarint(buf: Buffer, off: number): { v: bigint; n: number } | null {
  let v = 0n;
  for (let i = 0; i < 10; i++) {
    if (off + i >= buf.length) return null;
    const b = buf[off + i];
    v |= BigInt(b & 0x7f) << BigInt(7 * i);
    if (!(b & 0x80)) return { v, n: i + 1 };
  }
  return null;
}

/** Every top-level field of a protobuf message, or null when it does not parse to the end. */
function pbFields(buf: Buffer): PbField[] | null {
  const out: PbField[] = [];
  let off = 0;
  while (off < buf.length) {
    const tag = readVarint(buf, off);
    if (!tag || tag.v === 0n) return null;
    off += tag.n;
    const num = Number(tag.v >> 3n);
    const type = Number(tag.v & 7n);
    if (num < 1) return null;
    if (type === 0) {
      const v = readVarint(buf, off);
      if (!v) return null;
      off += v.n;
      out.push({ num, type, v: v.v });
    } else if (type === 1) {
      if (off + 8 > buf.length) return null;
      off += 8;
      out.push({ num, type });
    } else if (type === 2) {
      const len = readVarint(buf, off);
      if (!len) return null;
      off += len.n;
      const l = Number(len.v);
      if (off + l > buf.length) return null;
      out.push({ num, type, bytes: buf.subarray(off, off + l) });
      off += l;
    } else if (type === 5) {
      if (off + 4 > buf.length) return null;
      off += 4;
      out.push({ num, type });
    } else return null; // groups (3/4) and reserved types do not appear in these envelopes
  }
  return out;
}

function utf8Valid(b: Buffer): boolean {
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch { return false; }
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Shannon entropy over the byte histogram, normalized by log2(min(len, 256)). */
export function byteEntropyRatio(buf: Buffer): number {
  if (!buf.length) return 0;
  const counts = new Array<number>(256).fill(0);
  for (const b of buf) counts[b]++;
  let h = 0;
  for (const c of counts) if (c) { const p = c / buf.length; h -= p * Math.log2(p); }
  const max = Math.min(buf.length, 256);
  return max <= 1 ? 0 : h / Math.log2(max);
}

const routerSuffixOk = (s: string) => s.length > 0 && s.length <= MAX_ROUTER_SUFFIX && /^[A-Za-z0-9]+$/.test(s);
const selfDescribing = (s: string) => s.length > 0 && 'ACEQRg'.includes(s[0]);

// ------------------------------------------------------------------ provider prefixes (`claude#…`)

function providerFromCachePrefix(prefix: string): SigProvider {
  switch (prefix.trim().toLowerCase()) {
    case 'claude': case 'anthropic': case 'cais': case 'claude-cais': case 'claude_cais': case 'ccmax': case 'claude-code-max': case 'claude_code_max':
      return 'claude';
    case 'gemini': case 'google': return 'gemini';
    case 'openai': case 'gpt': case 'codex': return 'gpt';
    case 'swe': case 'sealed': return 'swe';
    default: return 'unknown';
  }
}

/** `claude#E…` → ['claude', 'E…']; a signature without a known prefix → null. */
export function splitProviderPrefix(raw: string): { provider: SigProvider; rest: string } | null {
  const s = raw.trim();
  const i = s.indexOf('#');
  if (i < 0) return null;
  const provider = providerFromCachePrefix(s.slice(0, i));
  return provider === 'unknown' ? null : { provider, rest: s.slice(i + 1).trim() };
}

export function payloadWithoutPrefix(raw: string): string {
  return splitProviderPrefix(raw)?.rest ?? raw.trim();
}

// ------------------------------------------------------------------ Claude

function stripClaudePrefix(raw: string): string {
  let s = raw.trim();
  const i = s.indexOf('#');
  if (i >= 0) s = s.slice(i + 1).trim();
  return s;
}

/** Claude's thinking signature payload: 0x12 · field 2 { field 1 { channel_id varint, … } }. */
function claudePayloadOk(payload: Buffer): boolean {
  if (!payload.length || payload[0] !== 0x12) return false;
  const top = pbFields(payload);
  const container = top?.filter((f) => f.num === 2);
  if (!container?.length || container.some((f) => f.type !== 2)) return false;
  const inner = pbFields(container[container.length - 1].bytes!);
  const channel = inner?.filter((f) => f.num === 1);
  if (!channel?.length || channel.some((f) => f.type !== 2)) return false;
  const fields = pbFields(channel[channel.length - 1].bytes!);
  if (!fields) return false;
  let haveChannelId = false;
  for (const f of fields) {
    if (f.num === 1) { if (f.type !== 0) return false; haveChannelId = true; }
    else if (f.num === 2 || f.num === 7) { if (f.type !== 0) return false; }
    else if (f.num === 6) { if (f.type !== 2 || !utf8Valid(f.bytes!)) return false; }
  }
  return haveChannelId;
}

/** `E…` (single layer: base64 of the protobuf) or `R…` (base64 of an `E…` string). */
function claudeLayerPayload(sig: string): Buffer | null {
  if (sig[0] === 'E') return b64(sig, 'std');
  if (sig[0] === 'R') {
    const outer = b64(sig, 'std');
    if (!outer?.length || outer[0] !== 0x45 /* E */) return null;
    return b64(outer.toString('latin1'), 'std');
  }
  return null;
}

/** A Claude thinking signature (`E…` / `R…`) whose envelope parses (CPA's Strict mode). */
export function isValidClaudeThinkingSignature(raw: string): boolean {
  const sig = stripClaudePrefix(raw);
  if (!sig || sig.length > MAX_SIG_LEN) return false;
  const payload = claudeLayerPayload(sig);
  return !!payload && claudePayloadOk(payload);
}

/** The form a native Claude upstream accepts: a double-layer `R…` becomes its inner `E…`. */
export function normalizeClaudeNativeSignature(raw: string): string | null {
  const sig = stripClaudePrefix(raw);
  if (!isValidClaudeThinkingSignature(sig)) return null;
  return sig[0] === 'R' ? b64(sig, 'std')!.toString('latin1') : sig;
}

/** Claude's newer `C…` (CAIS) envelope: 0x08 version · field 2 { field 1 { channel, signature bytes, model_text "claude-…" } }. */
export function isValidClaudeCaisSignature(raw: string): boolean {
  const sig = stripClaudePrefix(raw);
  if (!sig || sig.length > MAX_SIG_LEN || sig[0] !== 'C') return false;
  const decoded = b64(sig, 'std');
  if (!decoded?.length || decoded[0] !== 0x08) return false;
  const top = pbFields(decoded);
  if (!top) return false;
  let version = 0n;
  let container: Buffer | undefined;
  for (const f of top) {
    if (f.num === 1) { if (f.type !== 0) return false; version = f.v!; }
    else if (f.num === 2) { if (f.type !== 2) return false; container = f.bytes; }
    else if (f.num === 3 && f.type !== 0) return false;
  }
  if (!container) return false;
  const cf = pbFields(container);
  if (!cf) return false;
  let channel: Buffer | undefined;
  let containerSig: Buffer | undefined;
  for (const f of cf) {
    if (f.num === 1) { if (f.type !== 2) return false; channel = f.bytes; }
    else if (f.num === 5) { if (f.type !== 2) return false; containerSig = f.bytes; }
  }
  if (!channel) return false;
  const ch = pbFields(channel);
  if (!ch) return false;
  let haveId = false, haveSig = false, haveModel = false, kind = '';
  for (const f of ch) {
    switch (f.num) {
      case 1: if (f.type !== 0) return false; haveId = true; break;
      case 2: case 3: case 7: if (f.type !== 0) return false; break;
      case 5: if (f.type !== 2 || !f.bytes!.length) return false; haveSig = true; break;
      case 6: if (f.type !== 2 || !utf8Valid(f.bytes!) || !f.bytes!.toString('utf8').startsWith('claude-')) return false; haveModel = true; break;
      case 8: if (f.type !== 2 || !utf8Valid(f.bytes!)) return false; kind = f.bytes!.toString('utf8'); break;
      case 11: if (f.type !== 2 || !UUID_RE.test(f.bytes!.toString('utf8'))) return false; break;
    }
  }
  if (!haveSig && version >= 4n && containerSig?.length) haveSig = true;
  if (!haveId || !haveSig) return false;
  if (!haveModel && version < 4n) return false;
  if (version >= 4n && kind !== 'thinking' && kind !== 'narration') return false;
  return true;
}

// ------------------------------------------------------------------ Gemini

export const isGeminiBypass = (raw: string) => {
  const s = raw.trim();
  return s === GEMINI_SKIP_VALIDATOR || s === GEMINI_CONTEXT_BYPASS;
};

const isAsciiUuid = (b: Buffer) => b.length === 36 && UUID_RE.test(b.toString('latin1'));
const geminiOpaque = (b: Buffer | undefined) => !!b?.length && b[0] === 0x01;

function geminiToolInvocation(value: Buffer): boolean {
  const fields = pbFields(value);
  return !!fields?.length && fields.some((f) => f.type === 2 && geminiOpaque(f.bytes));
}

/** field 2 { field 1 { 0x01 tink payload | uuid | tool invocation } } — exactly one of each. */
function geminiField2Envelope(d: Buffer): boolean {
  const top = pbFields(d);
  if (!top || top.length !== 1 || top[0].num !== 2 || top[0].type !== 2) return false;
  const inner = pbFields(top[0].bytes!);
  if (!inner || inner.length !== 1 || inner[0].num !== 1 || inner[0].type !== 2) return false;
  const v = inner[0].bytes!;
  return v.length > 0 && (geminiOpaque(v) || isAsciiUuid(v) || geminiToolInvocation(v));
}

const VERTEX_TINK_KEY_IDS = ['8f3d6b5f'];
const geminiBareTink = (d: Buffer) => d.length >= 21 && d[0] === 0x01 && VERTEX_TINK_KEY_IDS.includes(d.subarray(1, 5).toString('hex'));

/** A Gemini `thoughtSignature` with a known envelope (the bypass sentinels are not signatures). */
export function isValidGeminiThoughtSignature(raw: string): boolean {
  const sig = raw.trim();
  if (!sig || sig.length > MAX_SIG_LEN || isValidClaudeCaisSignature(sig) || isGeminiBypass(sig)) return false;
  const d = b64StdOrRaw(sig);
  if (!d?.length || isAsciiUuid(d)) return false;
  return geminiField2Envelope(d) || geminiBareTink(d);
}

// ------------------------------------------------------------------ OpenAI / xAI / Kimi

/** OpenAI reasoning `encrypted_content`: Fernet (`gAAAA…`, version 0x80, AES-block ciphertext), optional `.router` suffix. */
export function isValidGptReasoning(raw: string): boolean {
  const sig = raw.trim();
  if (!sig || sig.length > MAX_SIG_LEN || !sig.startsWith('gAAAA')) return false;
  let native = sig;
  const dot = sig.indexOf('.');
  if (dot >= 0) {
    if (!routerSuffixOk(sig.slice(dot + 1))) return false;
    native = sig.slice(0, dot);
  }
  if (!/^[A-Za-z0-9_=-]*$/.test(native)) return false;
  const d = b64(native, 'rawurl') ?? b64(native, 'url');
  if (!d || d.length < 73 || d[0] !== 0x80) return false;
  const ct = d.length - 1 - 8 - 16 - 32;
  return ct > 0 && ct % 16 === 0;
}

const KIMI_LENGTHS = new Set([12946, 4340]);

/** Kimi's thinking signature: unpadded std base64 of a fixed length, high entropy, not anyone else's envelope. */
export function isValidKimiSignature(raw: string): boolean {
  const sig = raw;
  if (!sig || sig.trim() !== sig || !KIMI_LENGTHS.has(sig.length) || sig.includes('=')) return false;
  if (!STD.test(sig) || splitProviderPrefix(sig)) return false;
  if (selfDescribing(sig)) {
    if (sig.startsWith('gAAAA') || isValidClaudeCaisSignature(sig) || isValidClaudeThinkingSignature(sig) || isValidGeminiThoughtSignature(sig)) return false;
  }
  const d = b64(sig, 'raw');
  return !!d && byteEntropyRatio(d) >= 0.85;
}

/** xAI reasoning `encrypted_content`: unpadded std base64, ≥ 32 high-entropy bytes, not anyone else's envelope. */
export function isValidGrokReasoning(raw: string): boolean {
  const sig = raw;
  if (!sig || sig.length > 8 * 1024 * 1024 || sig.trim() !== sig || sig.includes('=') || splitProviderPrefix(sig)) return false;
  let native = sig;
  const dot = sig.indexOf('.');
  if (dot >= 0) {
    if (!routerSuffixOk(sig.slice(dot + 1))) return false;
    native = sig.slice(0, dot);
  }
  if (!STD.test(native)) return false;
  if (selfDescribing(native)) {
    if (native.startsWith('gAAAA') || isValidClaudeThinkingSignature(native) || isValidClaudeCaisSignature(native) || isValidGeminiThoughtSignature(native)) return false;
  }
  if (isValidKimiSignature(native)) return false;
  const d = b64(native, 'raw');
  if (!d || d.toString('latin1').startsWith('cpa-codex-gemini-carrier-v1:')) return false;
  return d.length >= 32 && byteEntropyRatio(d) >= 0.85;
}

// ------------------------------------------------------------------ detection and the decision table

/** Whose signature this is (by structure); `unknown` for empty / unrecognized / foreign-prefixed. */
export function detectSignatureProvider(raw: string | undefined): SigProvider {
  const sig = String(raw ?? '').trim();
  if (!sig) return 'unknown';
  const pre = splitProviderPrefix(sig);
  if (pre) {
    const rest = pre.rest;
    if (rest.includes('#')) return 'unknown';
    switch (pre.provider) {
      case 'gemini': return isGeminiBypass(rest) ? 'gemini_bypass' : isValidGeminiThoughtSignature(rest) ? 'gemini' : 'unknown';
      case 'claude': return isValidClaudeThinkingSignature(rest) || isValidClaudeCaisSignature(rest) ? 'claude' : 'unknown';
      case 'gpt': return isValidGptReasoning(rest) ? 'gpt' : 'unknown';
      case 'swe': return rest.startsWith('sealed.v1.') ? 'swe' : 'unknown';
      default: return 'unknown';
    }
  }
  if (sig.includes('#')) return 'unknown';
  if (isGeminiBypass(sig)) return 'gemini_bypass';
  if (sig.startsWith('sealed.v1.')) return 'swe';
  if (selfDescribing(sig)) {
    if (isValidGptReasoning(sig)) return 'gpt';
    if (isValidClaudeCaisSignature(sig) || isValidClaudeThinkingSignature(sig)) return 'claude';
    if (isValidGeminiThoughtSignature(sig)) return 'gemini';
  }
  if (isValidKimiSignature(sig)) return 'kimi';
  if (isValidGrokReasoning(sig)) return 'grok';
  return 'unknown';
}

function normalizeFor(target: SigProvider, raw: string): string | null {
  const payload = payloadWithoutPrefix(raw);
  switch (target) {
    case 'claude': return isValidClaudeCaisSignature(payload) ? payload : normalizeClaudeNativeSignature(payload);
    case 'gemini': return isGeminiBypass(payload) || isValidGeminiThoughtSignature(payload) ? payload : null;
    case 'gpt': return isValidGptReasoning(payload) ? payload : null;
    case 'grok': return isValidGrokReasoning(raw) ? raw : null;
    case 'kimi': return isValidKimiSignature(payload) ? payload : null;
    case 'swe': return payload.startsWith('sealed.v1.') ? payload : null;
    default: return null;
  }
}

function matches(target: SigProvider, detected: SigProvider): boolean {
  if (target === 'gemini') return detected === 'gemini' || detected === 'gemini_bypass';
  return target !== 'unknown' && target === detected;
}

/** What to do with one signed block when the request goes to `target`. */
export function decideSignature(target: SigProvider, raw: string | undefined, kind: SigBlockKind = 'unknown'): SigDecision {
  const t: SigProvider = target === 'gemini_bypass' ? 'gemini' : target;
  const sig = String(raw ?? '');
  const detected = detectSignatureProvider(sig);
  const base = { target: t, detected, kind };
  // Antigravity's CAQS wrapper (`Q…`) replays only through Antigravity
  if (t === 'claude' && detected === 'claude' && payloadWithoutPrefix(sig).startsWith('Q')) return { ...base, compatible: false, action: 'drop_block' };
  if (matches(t, detected)) {
    const normalized = normalizeFor(t, sig);
    if (normalized) return { ...base, compatible: true, action: 'preserve', normalized };
  }
  switch (t) {
    case 'gemini':
      return kind === 'claude_thinking' || kind === 'gpt_reasoning'
        ? { ...base, compatible: false, action: 'drop_block' }
        : { ...base, compatible: false, action: 'replace_with_gemini_bypass', replacement: GEMINI_SKIP_VALIDATOR };
    case 'kimi': return { ...base, compatible: false, action: 'drop_signature' };
    case 'claude': case 'gpt': case 'grok': case 'swe': return { ...base, compatible: false, action: 'drop_block' };
    default: return { ...base, compatible: false, action: 'no_compatible_replacement' };
  }
}

// ------------------------------------------------------------------ request sanitizers (pass-through bodies)

export interface SanitizeReport {
  target: SigProvider;
  preserved: number;
  droppedBlocks: number;
  droppedSignatures: number;
  replaced: number;
  /** kept, but rewritten into the target's canonical form (prefix removed, double layer unwrapped, field moved) */
  rewritten: number;
}

const report = (target: SigProvider): SanitizeReport => ({ target, preserved: 0, droppedBlocks: 0, droppedSignatures: 0, replaced: 0, rewritten: 0 });
export const sanitizeChanged = (r: SanitizeReport) => r.droppedBlocks + r.droppedSignatures + r.replaced + r.rewritten > 0;

const thinkingText = (b: any): string =>
  typeof b?.text === 'string' ? b.text : typeof b?.thinking === 'string' ? b.thinking : typeof b?.thinking?.text === 'string' ? b.thinking.text : '';

const TOOL_SIG_PATHS: string[][] = [['signature'], ['thoughtSignature'], ['thought_signature'], ['extra_content', 'google', 'thought_signature']];

/**
 * Anthropic Messages body (mutated in place): every `thinking` block is checked against `target`;
 * `redacted_thinking` (Claude-encrypted) only survives on Claude; signatures some clients carry on
 * `tool_use` are checked too. A message left with no content is removed. An `unknown` target is not touched.
 */
export function sanitizeAnthropicMessages(body: any, target: SigProvider): SanitizeReport {
  const r = report(target);
  if (target === 'unknown' || !Array.isArray(body?.messages)) return r;
  const kept: any[] = [];
  for (const m of body.messages) {
    if (!Array.isArray(m?.content)) { kept.push(m); continue; }
    const parts: any[] = [];
    let changed = false;
    for (const b of m.content) {
      if (b?.type === 'redacted_thinking') {
        if (target === 'claude') { r.preserved++; parts.push(b); } else { r.droppedBlocks++; changed = true; }
        continue;
      }
      if (b?.type === 'tool_use') {
        let nb = b;
        for (const path of TOOL_SIG_PATHS) {
          const v = path.reduce((o: any, k) => (o == null ? undefined : o[k]), b);
          if (v === undefined) continue;
          const kind: SigBlockKind = target === 'claude' ? 'claude_thinking' : target === 'gpt' ? 'gpt_reasoning' : 'gemini_function_call';
          const d = decideSignature(target, String(v), kind);
          if (nb === b) nb = structuredClone(b);
          const parent = path.slice(0, -1).reduce((o: any, k) => o?.[k], nb);
          const leaf = path[path.length - 1];
          if (d.action === 'preserve') { r.preserved++; if (d.normalized !== v) { parent[leaf] = d.normalized; r.rewritten++; changed = true; } }
          else if (d.action === 'replace_with_gemini_bypass') { r.replaced++; parent[leaf] = d.replacement; changed = true; }
          else { r.droppedSignatures++; delete parent[leaf]; changed = true; }
        }
        if (nb !== b) {
          if (nb.extra_content?.google && !Object.keys(nb.extra_content.google).length) delete nb.extra_content.google;
          if (nb.extra_content && !Object.keys(nb.extra_content).length) delete nb.extra_content;
        }
        parts.push(nb);
        continue;
      }
      if (b?.type !== 'thinking') { parts.push(b); continue; }
      const sig = typeof b.signature === 'string' ? b.signature : '';
      // an empty placeholder (no text, no signature) is Claude's own shape for omitted thinking
      if (target === 'claude' && !sig.trim() && !thinkingText(b).trim()) { parts.push(b); continue; }
      const d = decideSignature(target, sig, 'claude_thinking');
      if (d.action === 'preserve') {
        r.preserved++;
        if (d.normalized !== sig) { parts.push({ ...b, signature: d.normalized }); r.rewritten++; changed = true; } else parts.push(b);
      } else if (d.action === 'replace_with_gemini_bypass') {
        r.replaced++;
        parts.push({ ...b, signature: d.replacement });
        changed = true;
      } else if (d.action === 'drop_signature') {
        r.droppedSignatures++;
        const { signature: _drop, ...rest } = b;
        parts.push(rest);
        changed = true;
      } else {
        r.droppedBlocks++;
        changed = true;
      }
    }
    if (!changed) { kept.push(m); continue; }
    if (parts.length) kept.push({ ...m, content: parts });
  }
  if (sanitizeChanged(r)) body.messages = kept;
  return r;
}

const GEMINI_PART_SIG_PATHS: string[][] = [['thoughtSignature'], ['thought_signature'], ['functionCall', 'thoughtSignature'], ['functionCall', 'thought_signature']];

function geminiPartSignature(part: any): { sig: string; has: boolean } {
  for (const path of GEMINI_PART_SIG_PATHS) {
    const v = path.reduce((o: any, k) => (o == null ? undefined : o[k]), part);
    if (v !== undefined) return { sig: String(v ?? ''), has: true };
  }
  return { sig: '', has: false };
}

function deleteGeminiPartSignatures(part: any): any {
  const p = structuredClone(part);
  delete p.thoughtSignature;
  delete p.thought_signature;
  if (p.functionCall) { delete p.functionCall.thoughtSignature; delete p.functionCall.thought_signature; }
  return p;
}

/**
 * Gemini `contents` (mutated in place; `request.contents` for the CLI wrapper too), target Gemini:
 * the first `functionCall` of a model turn must carry a signature (an incompatible / missing one gets
 * the bypass sentinel), sibling calls and text parts carry only a compatible one, a `functionResponse`
 * carries none. Signatures move to the canonical top-level `thoughtSignature`.
 */
export function sanitizeGeminiContents(body: any, target: SigProvider = 'gemini'): SanitizeReport {
  const r = report(target);
  if (target !== 'gemini') return r;
  const contents = Array.isArray(body?.contents) ? body.contents : Array.isArray(body?.request?.contents) ? body.request.contents : null;
  if (!contents) return r;
  for (const c of contents) {
    if (!Array.isArray(c?.parts)) continue;
    const model = c.role === 'model';
    let firstCallSeen = false;
    c.parts = c.parts.map((part: any) => {
      const { sig, has } = geminiPartSignature(part);
      if (part?.functionResponse) {
        if (!has) return part;
        r.droppedSignatures++;
        return deleteGeminiPartSignatures(part);
      }
      if (!model || part?.toolCall || part?.tool_call || part?.toolResponse || part?.tool_response) return part;
      const isCall = !!part?.functionCall;
      const isFirstCall = isCall && !firstCallSeen;
      if (isCall || !part?.thought) firstCallSeen = isCall;
      if (!isCall && !has) return part;
      const d = decideSignature('gemini', sig, isCall ? 'gemini_function_call' : 'gemini_model_part');
      let replay = '';
      if (isFirstCall) {
        replay = d.action === 'preserve' ? d.normalized! : GEMINI_SKIP_VALIDATOR;
        if (d.action === 'preserve') r.preserved++; else r.replaced++;
      } else if (has && d.action === 'preserve' && !isGeminiBypass(payloadWithoutPrefix(sig))) {
        replay = d.normalized!;
        r.preserved++;
      } else if (has) r.droppedSignatures++;
      const canonical = typeof part.thoughtSignature === 'string' && part.thoughtSignature === replay
        && part.thought_signature === undefined && part.functionCall?.thoughtSignature === undefined && part.functionCall?.thought_signature === undefined;
      if (replay) {
        if (canonical) return part;
        if (d.action === 'preserve') r.rewritten++;
        return { ...deleteGeminiPartSignatures(part), thoughtSignature: replay };
      }
      return has ? deleteGeminiPartSignatures(part) : part;
    });
  }
  return r;
}

/**
 * OpenAI Responses `input` (mutated in place): a `reasoning` item's `encrypted_content` is checked
 * against the target (GPT / xAI verify it on replay); an incompatible item is removed. An unknown
 * target is left alone.
 */
export function sanitizeResponsesInput(body: any, target: SigProvider): SanitizeReport {
  const r = report(target);
  if (target === 'unknown' || !Array.isArray(body?.input)) return r;
  const kept: any[] = [];
  for (const item of body.input) {
    if (item?.type !== 'reasoning' || typeof item.encrypted_content !== 'string') { kept.push(item); continue; }
    if (target === 'grok') {
      if (isValidGrokReasoning(item.encrypted_content)) { r.preserved++; kept.push(item); } else r.droppedBlocks++;
      continue;
    }
    const d = decideSignature(target, item.encrypted_content, 'gpt_reasoning');
    if (d.action === 'preserve') {
      r.preserved++;
      kept.push(d.normalized === item.encrypted_content ? item : { ...item, encrypted_content: d.normalized });
      if (d.normalized !== item.encrypted_content) r.rewritten++;
    } else if (d.action === 'drop_signature') {
      r.droppedSignatures++;
      const { encrypted_content: _drop, ...rest } = item;
      kept.push(rest);
    } else r.droppedBlocks++;
  }
  if (sanitizeChanged(r)) body.input = kept;
  return r;
}
