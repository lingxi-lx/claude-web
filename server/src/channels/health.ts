// 来源健康 (free sources' real health): a cheap probe — the models endpoint, and optionally one request for a single
// output token — plus what the gateway's answers said about the source's quota (routing/quota.ts: rate-limit headers,
// 429s and their cooldown). The models list alone proves little (ModelScope's /models takes any key), so a free source
// can be asked once for real. Probes are rate-limited per source and skipped while the source is cooling down, so a
// card left open never hammers an upstream that already said 429. No sessionId → no federation routing entry.
import type { Provider } from '../protocol.js';
import { tr } from '../i18n/index.js';
import { anthropicBase, authHeaders } from '../providers/endpoint.js';
import { geminiBase, openaiBase } from '../providers/service.js';
import { viaPrivacy } from '../privacy/route.js';
import { quotaTracker, type QuotaTracker } from '../routing/quota.js';
import type { ProbeOutcome, SourceHealthRequest, SourceHealthState, SourceHealthStatus, SourceHealthView } from './health-types.js';

export type { ProbeOutcome, SourceHealthRequest, SourceHealthState, SourceHealthStatus, SourceHealthView } from './health-types.js';

/** Models-list probe at most this often per source. */
export const PROBE_MIN_MS = 60_000;
/** The one-token call at most this often per source (it spends a request of a free quota). */
export const CHAT_MIN_MS = 10 * 60_000;
const TIMEOUT_MS = 20_000;
/** Below this share left the card says 额度快用完. */
export const LOW_QUOTA = 0.1;

export interface HealthDeps {
  providers: { list(): Provider[]; member(id: string): Provider | null };
  quota?: QuotaTracker;
  fetch?: typeof fetch;
  clock?: () => number;
}

const SKIP = new Set(['gateway', 'claude-account']);

const headersOf = (r: Response): Record<string, string> => {
  const h: Record<string, string> = {};
  r.headers?.forEach?.((v, k) => { h[k] = v; });
  return h;
};

/** The models URL and credential headers the session itself would use (mirrors providers/service.ts). */
export function modelsRequest(p: Provider): { url: string; headers: Record<string, string> } {
  const b = (p.baseUrl ?? '').trim().replace(/\/+$/, '');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (p.type === 'gemini') {
    headers['x-goog-api-key'] = p.apiKey;
    return { url: `${geminiBase(b || 'https://generativelanguage.googleapis.com')}/models`, headers };
  }
  if (p.type === 'anthropic') {
    Object.assign(headers, authHeaders(p.authStyle, p.apiKey, 'both'));
    headers['anthropic-version'] = '2023-06-01';
    return { url: `${anthropicBase(b || 'https://api.anthropic.com')}/v1/models`, headers };
  }
  Object.assign(headers, authHeaders(p.authStyle, p.apiKey, 'bearer'));
  if (p.type === 'grok') return { url: `${openaiBase(b || 'https://api.x.ai')}/models`, headers };
  return { url: /\/v\d+$/.test(b) ? `${b}/models` : `${b}/v1/models`, headers };
}

/** One request for a single output token (OpenAI-compatible / Anthropic); null for a wire it does not cover. */
export function chatRequest(p: Provider, model: string): { url: string; headers: Record<string, string>; body: string } | null {
  if (p.type === 'anthropic') {
    const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...authHeaders(p.authStyle, p.apiKey, 'both') };
    return { url: `${anthropicBase(p.baseUrl || 'https://api.anthropic.com')}/v1/messages`, headers, body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }) };
  }
  if (p.type === 'openai' || p.type === 'grok') {
    if (!p.baseUrl && p.type === 'openai') return null;
    const headers = { 'content-type': 'application/json', ...authHeaders(p.authStyle, p.apiKey, 'bearer') };
    return { url: `${openaiBase(p.baseUrl || 'https://api.x.ai')}/chat/completions`, headers, body: JSON.stringify({ model, max_tokens: 1, stream: false, messages: [{ role: 'user', content: 'ok' }] }) };
  }
  return null;
}

const errorText = (status: number, text: string): string => {
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* not json */ }
  const m = j?.error?.message ?? j?.message ?? (typeof j?.error === 'string' ? j.error : '') ?? '';
  return `HTTP ${status}${m ? ` ${String(m).replace(/\s+/g, ' ').trim().slice(0, 200)}` : ''}`;
};

export class SourceHealth {
  private probes = new Map<string, ProbeOutcome>();
  private chats = new Map<string, ProbeOutcome>();
  private running = new Map<string, Promise<SourceHealthView>>();
  private readonly quota: QuotaTracker;
  private readonly fetch: typeof fetch;
  private readonly clock: () => number;

  constructor(private deps: HealthDeps) {
    this.quota = deps.quota ?? quotaTracker;
    this.fetch = deps.fetch ?? ((...a) => fetch(...a));
    this.clock = deps.clock ?? Date.now;
  }

  view(providerId: string, now = this.clock()): SourceHealthView {
    const probe = this.probes.get(providerId);
    const chat = this.chats.get(providerId);
    const quota = this.quota.view(`p:${providerId}`, now);
    const last = [probe, chat].filter((x): x is ProbeOutcome => !!x).sort((a, b) => b.at - a.at)[0];
    const state: SourceHealthState = quota?.cooldownUntil && quota.cooldownUntil > now ? 'cooling'
      : quota?.remaining !== undefined && quota.remaining < LOW_QUOTA ? 'limited'
        : last ? (last.ok ? 'ok' : 'error')
          : quota?.lastStatus !== undefined ? (quota.lastStatus >= 200 && quota.lastStatus < 300 ? 'ok' : 'unknown') : 'unknown';
    const next = probe ? probe.at + PROBE_MIN_MS : undefined;
    return {
      providerId, state,
      ...(probe ? { probe } : {}), ...(chat ? { chat } : {}), ...(quota ? { quota } : {}),
      ...(next && next > now ? { nextProbeAt: next } : {}),
    };
  }

  status(): SourceHealthStatus {
    const now = this.clock();
    return { sources: this.deps.providers.list().filter((p) => !SKIP.has(p.type)).map((p) => this.view(p.id, now)) };
  }

  /** Probe one source (the same probe already running is shared; inside the rate limit the last result answers). */
  probe(providerId: string, chat = false): Promise<SourceHealthView> {
    const k = `${providerId}\u0000${chat ? 1 : 0}`;
    const cur = this.running.get(k);
    if (cur) return cur;
    const p = this.run(providerId, chat).finally(() => this.running.delete(k));
    this.running.set(k, p);
    return p;
  }

  private async run(providerId: string, chat: boolean): Promise<SourceHealthView> {
    const now = this.clock();
    const p = this.deps.providers.member(providerId);
    if (!p || SKIP.has(p.type)) throw new Error(tr('没有这个来源'));
    // the upstream said 429: wait out its cooldown instead of asking again
    if (this.quota.cooling(`p:${providerId}`, now)) return this.view(providerId, now);
    const last = this.probes.get(providerId);
    if (!last || now - last.at >= PROBE_MIN_MS) this.probes.set(providerId, await this.models(p));
    const lastChat = this.chats.get(providerId);
    const listOk = this.probes.get(providerId)?.ok;
    if (chat && listOk && (!lastChat || now - lastChat.at >= CHAT_MIN_MS) && !this.quota.cooling(`p:${providerId}`, this.clock())) {
      const model = p.defaultModel || p.models?.[0];
      const c = model ? await this.chat(p, model) : undefined;
      if (c) this.chats.set(providerId, c);
    }
    return this.view(providerId);
  }

  private async send(url: string, init: RequestInit): Promise<{ r: Response; text: string }> {
    const r = await this.fetch(viaPrivacy(url), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await r.text();
    return { r, text };
  }

  private async models(p: Provider): Promise<ProbeOutcome> {
    const t0 = this.clock();
    try {
      const q = modelsRequest(p);
      const { r, text } = await this.send(q.url, { headers: q.headers });
      this.quota.observe(`p:${p.id}`, r.status, headersOf(r));
      const at = this.clock();
      if (!r.ok) return { ok: false, status: r.status, ms: at - t0, at, error: errorText(r.status, text) };
      let j: any = null;
      try { j = JSON.parse(text); } catch { /* not json */ }
      const list = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : Array.isArray(j) ? j : null;
      if (!list) return { ok: false, status: r.status, ms: at - t0, at, error: tr('返回不是 JSON 模型列表') };
      return { ok: true, status: r.status, ms: at - t0, at, models: list.length };
    } catch (e: any) {
      const at = this.clock();
      return { ok: false, ms: at - t0, at, error: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? tr('连接超时（20s）') : String(e?.cause?.message ?? e?.message ?? e).slice(0, 200) };
    }
  }

  private async chat(p: Provider, model: string): Promise<ProbeOutcome | undefined> {
    const q = chatRequest(p, model);
    if (!q) return undefined;
    const t0 = this.clock();
    try {
      const { r, text } = await this.send(q.url, { method: 'POST', headers: q.headers, body: q.body });
      this.quota.observe(`p:${p.id}`, r.status, headersOf(r));
      const at = this.clock();
      return r.ok ? { ok: true, status: r.status, ms: at - t0, at } : { ok: false, status: r.status, ms: at - t0, at, error: errorText(r.status, text) };
    } catch (e: any) {
      const at = this.clock();
      return { ok: false, ms: at - t0, at, error: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? tr('连接超时（20s）') : String(e?.cause?.message ?? e?.message ?? e).slice(0, 200) };
    }
  }
}

// ---- hub dispatch ----

const KINDS = new Set(['channels.health.status', 'channels.health.probe']);
export const isSourceHealthRequest = (req: { kind: string }): req is SourceHealthRequest => KINDS.has(req.kind);

let shared: SourceHealth | null = null;
/** The process-wide health service (made on first use from the hub's ProviderService). */
export function sourceHealth(deps: HealthDeps): SourceHealth {
  return (shared ??= new SourceHealth(deps));
}

export async function handleSourceHealthRequest(svc: SourceHealth, req: SourceHealthRequest): Promise<SourceHealthStatus | SourceHealthView> {
  switch (req.kind) {
    case 'channels.health.status': return svc.status();
    case 'channels.health.probe':
      if (typeof req.providerId !== 'string' || !req.providerId) throw new Error(tr('缺少来源'));
      return svc.probe(req.providerId, req.chat === true);
  }
  throw new Error(`unknown health request ${(req as { kind: string }).kind}`);
}
