// 智能路由 · 意图判断: how the judge model is actually asked. The judge is one of the routing group's provider
// candidates (`p:<providerId>#<model>`); the request is a tiny non-streamed chat call (a few output tokens) on that
// provider's own endpoint, through the privacy relay when 隐私保护 is on (the judge reads the user's message too).
// The provider lookup is injected once at startup (index.ts → setIntentMember), so this module holds no credentials.
import type { Provider } from '../protocol.js';
import { anthropicBase, authHeaders } from '../providers/endpoint.js';
import { openaiBase } from '../providers/service.js';
import { viaPrivacy } from '../privacy/route.js';
import { observeUpstream } from './quota.js';

/** The judge's answer for one prompt (the raw text; intent.ts parses the number). */
export type JudgeAsk = (judgeKey: string, prompt: string, signal: AbortSignal) => Promise<string>;

type MemberLookup = (providerId: string) => Provider | null | undefined;
let member: MemberLookup | null = null;

/** Startup: how a provider id becomes a profile with its plaintext key (ProviderService.member). */
export function setIntentMember(f: MemberLookup | null) { member = f; }

/** `p:<providerId>#<model>` → its parts; null for an account / pool (no direct endpoint to ask). */
export function parseJudgeKey(key: string): { providerId: string; model: string } | null {
  const m = /^p:([^#]+)#(.+)$/.exec(key ?? '');
  return m ? { providerId: m[1], model: m[2] } : null;
}

/** One small chat call on a provider (OpenAI-compatible or Anthropic); the answer's text. Throws on any failure. */
export async function askProvider(p: Provider, model: string, prompt: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<string> {
  // a login (claude-account), a gateway group or Gemini's own wire: not asked directly
  if (p.type === 'claude-account' || p.type === 'gateway' || p.type === 'gemini') throw new Error(`cannot ask a ${p.type} profile`);
  const anthropic = p.type === 'anthropic';
  const url = anthropic ? `${anthropicBase(p.baseUrl || 'https://api.anthropic.com')}/v1/messages` : `${openaiBase(p.baseUrl ?? '')}/chat/completions`;
  if (!p.baseUrl && !anthropic) throw new Error('no base url');
  const headers: Record<string, string> = { 'content-type': 'application/json', ...authHeaders(p.authStyle, p.apiKey, anthropic ? 'x-api-key' : 'bearer') };
  if (anthropic) headers['anthropic-version'] = '2023-06-01';
  const body = anthropic
    ? { model, max_tokens: 8, temperature: 0, messages: [{ role: 'user', content: prompt }] }
    : { model, max_tokens: 8, temperature: 0, stream: false, messages: [{ role: 'user', content: prompt }] };
  const r = await fetchImpl(viaPrivacy(url), { method: 'POST', headers, body: JSON.stringify(body), signal });
  // its quota headers count like any other answer from this source
  const h: Record<string, string> = {};
  r.headers?.forEach?.((v, k) => { h[k] = v; });
  observeUpstream({ id: p.id }, r.status, h);
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = JSON.parse(text);
  if (anthropic) return (Array.isArray(j?.content) ? j.content : []).filter((x: any) => x?.type === 'text').map((x: any) => String(x.text ?? '')).join('');
  const c = j?.choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => String(x?.text ?? '')).join('') : '';
}

/** The router's judge: the candidate's provider, asked directly. Throws (→ intent 0) when it cannot be asked. */
export const judgeAsk: JudgeAsk = async (judgeKey, prompt, signal) => {
  const k = parseJudgeKey(judgeKey);
  if (!k) throw new Error('judge must be a provider candidate');
  const p = member?.(k.providerId);
  if (!p) throw new Error('judge provider missing');
  return askProvider(p, k.model, prompt, signal);
};
