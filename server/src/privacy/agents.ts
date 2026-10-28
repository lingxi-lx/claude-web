// Agents on their own login (no provider profile picked) and 隐私保护 (2026-10-28): Codex signed in with ChatGPT and
// Gemini CLI signed in with Google talk to their vendor themselves, not through a profile's base URL, so the privacy
// relay never saw them. Both CLIs take an endpoint override from the environment, so on their own login they get the
// relay as that endpoint (`privacyRoute`, null while privacy is neither on nor armed — then nothing changes):
//   · Codex: the built-in `openai` provider's base (`OPENAI_BASE_URL`, and `openai_base_url` in its config) — with a
//     ChatGPT login its default is https://chatgpt.com/backend-api/codex, with an API key https://api.openai.com/v1.
//     The ChatGPT token and account header go on as Codex sent them. A config.toml whose `model_provider` is another
//     provider is that provider's business: not covered (said so on the page).
//   · Gemini CLI: `CODE_ASSIST_ENDPOINT` (Google login → cloudcode-pa), `GOOGLE_GEMINI_BASE_URL` (own API key),
//     `GOOGLE_VERTEX_BASE_URL` (Vertex AI).
// Qwen Code (its OAuth endpoint comes from the login itself), Kimi, OpenCode and the rest have no such override: they
// are listed as not covered unless a provider profile is picked for the conversation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tr } from '../i18n/index.js';
import type { PrivacyCoverage } from './types.js';

type Env = Record<string, string | undefined>;
type Route = (target: string) => string | null;

export const CHATGPT_CODEX_BASE = 'https://chatgpt.com/backend-api/codex';
export const OPENAI_V1 = 'https://api.openai.com/v1';
export const CODE_ASSIST_BASE = 'https://cloudcode-pa.googleapis.com';
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com';

const readJson = (f: string): any => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } };
const readText = (f: string): string => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

export interface CodexLogin { mode: 'chatgpt' | 'apikey' | 'none'; /** config.toml's top-level model_provider, when set */ provider?: string }

/** How the Codex CLI on this machine signs in (its auth.json / config.toml; nothing is written). */
export function codexLogin(env: Env = process.env, home = os.homedir()): CodexLogin {
  const dir = env.CODEX_HOME || path.join(home, '.codex');
  const auth = readJson(path.join(dir, 'auth.json'));
  const toml = readText(path.join(dir, 'config.toml'));
  // only the top level (before the first [table]) names the provider in use
  const top = toml.split(/^\s*\[/m)[0] ?? '';
  const provider = /^\s*model_provider\s*=\s*["']([^"']+)["']/m.exec(top)?.[1];
  let mode: CodexLogin['mode'] = 'none';
  if (auth?.tokens && String(auth.auth_mode ?? '').toLowerCase() !== 'apikey') mode = 'chatgpt';
  else if (auth?.OPENAI_API_KEY || env.OPENAI_API_KEY) mode = 'apikey';
  return { mode, ...(provider ? { provider } : {}) };
}

export type GeminiLogin = 'oauth-personal' | 'gemini-api-key' | 'vertex-ai' | 'compute-default-credentials' | 'cloud-shell' | '';

/** How Gemini CLI on this machine signs in (~/.gemini/settings.json; the environment wins for Vertex). */
export function geminiLogin(env: Env = process.env, home = os.homedir()): GeminiLogin {
  if (/^(1|true)$/i.test(env.GOOGLE_GENAI_USE_VERTEXAI ?? '')) return 'vertex-ai';
  const s = readJson(path.join(env.GEMINI_CLI_HOME || home, '.gemini', 'settings.json'));
  const t = String(s?.security?.auth?.selectedType ?? s?.selectedAuthType ?? '');
  if (t) return t as GeminiLogin;
  return env.GEMINI_API_KEY ? 'gemini-api-key' : '';
}

const vertexBase = (env: Env) => {
  const loc = (env.GOOGLE_CLOUD_LOCATION || 'us-central1').trim();
  return loc === 'global' ? 'https://aiplatform.googleapis.com' : `https://${loc}-aiplatform.googleapis.com`;
};

/**
 * Extra env + global args for an agent on its own login while the privacy relay is in use (`route` gives the relay
 * base for an upstream base, or null). Empty = nothing to change (privacy off and not armed, or no override exists).
 */
export function ownLoginLaunch(kind: string | undefined, route: Route, env: Env = process.env, home = os.homedir()): { env: Record<string, string>; args: string[] } {
  const none = { env: {}, args: [] };
  if (kind === 'codex') {
    const login = codexLogin(env, home);
    if (login.provider && login.provider !== 'openai') return none;
    const target = env.OPENAI_BASE_URL?.trim() || (login.mode === 'chatgpt' ? CHATGPT_CODEX_BASE : OPENAI_V1);
    const r = route(target);
    if (!r) return none;
    // both spellings: the environment variable older Codex reads, the config key newer Codex prefers
    return { env: { OPENAI_BASE_URL: r }, args: ['-c', `openai_base_url=${JSON.stringify(r)}`] };
  }
  if (kind === 'gemini') {
    const out: Record<string, string> = {};
    const ca = route(env.CODE_ASSIST_ENDPOINT?.trim() || CODE_ASSIST_BASE);
    const gb = route(env.GOOGLE_GEMINI_BASE_URL?.trim() || GEMINI_API_BASE);
    const vb = route(env.GOOGLE_VERTEX_BASE_URL?.trim() || vertexBase(env));
    if (ca) out.CODE_ASSIST_ENDPOINT = ca;
    if (gb) out.GOOGLE_GEMINI_BASE_URL = gb;
    if (vb) out.GOOGLE_VERTEX_BASE_URL = vb;
    return { env: out, args: [] };
  }
  return none;
}

/** What the privacy page says about each agent on its own login. */
export function ownLoginCoverage(env: Env = process.env, home = os.homedir()): PrivacyCoverage[] {
  const out: PrivacyCoverage[] = [];
  const cx = codexLogin(env, home);
  const cxName = cx.mode === 'chatgpt' ? tr('ChatGPT 登录') : cx.mode === 'apikey' ? 'API Key' : '';
  if (cx.provider && cx.provider !== 'openai') {
    out.push({ agent: 'codex', name: 'Codex', login: cxName, covered: false, note: tr('config.toml 里用的是别的供应商（{p}），没经过隐私保护；在对话里选一个供应商就会经过', { p: cx.provider }) });
  } else {
    out.push({ agent: 'codex', name: 'Codex', login: cxName, covered: true, note: tr('经本机隐私中转') });
  }
  const gm = geminiLogin(env, home);
  const gmName = gm === 'oauth-personal' ? tr('Google 登录') : gm === 'gemini-api-key' ? 'API Key' : gm === 'vertex-ai' ? 'Vertex AI' : gm;
  if (gm === 'compute-default-credentials' || gm === 'cloud-shell') out.push({ agent: 'gemini', name: 'Gemini CLI', login: gmName, covered: false, note: tr('这种登录方式没有可改的地址，没经过隐私保护') });
  else out.push({ agent: 'gemini', name: 'Gemini CLI', login: gmName, covered: true, note: tr('经本机隐私中转') });
  const not = tr('用自己的登录时没有可改的地址，没经过隐私保护；在对话里选一个供应商就会经过');
  for (const [agent, name] of [['qwen', 'Qwen Code'], ['kimi', 'Kimi CLI'], ['opencode', 'OpenCode'], ['other', tr('其它 Agent')]] as const) out.push({ agent, name, login: '', covered: false, note: not });
  return out;
}
