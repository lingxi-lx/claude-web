// Claude subscription logins: what the credential envelope means, how a login is probed without spending tokens,
// and how an OAuth login is refreshed. The request shape a login needs (Bearer + oauth beta + the Claude Code
// system prefix) is applied by the gateway, not here.
import type { QuotaSnapshot, UpstreamAccount } from './types.js';
import { tr } from '../i18n/index.js';

export const OAUTH_BETA = 'oauth-2025-04-20';
export const CLAUDE_CODE_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI tool for Claude.";
/** Claude Code's public OAuth client id (token refresh). */
export const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export interface ClaudeProbe {
  health: UpstreamAccount['health'];
  identity?: UpstreamAccount['identity'];
  quota?: QuotaSnapshot;
  error?: string;
  cooldownUntil?: number;
}

interface OauthCredential { kind: 'oauth'; accessToken: string; refreshToken?: string; expiresAt?: number; scope?: string }
interface TokenCredential { kind: 'setup-token'; token: string }
type Credential = OauthCredential | TokenCredential;

const parse = (credential: string): Credential => {
  const j = JSON.parse(credential);
  return j.kind === 'oauth' ? j : { kind: 'setup-token', token: j.token };
};

/** The one credential a probe or a request presents: both login forms are Claude Code logins. */
export const claudeToken = (c: Credential): string => (c.kind === 'oauth' ? c.accessToken : c.token);

export class ClaudeAdapter {
  private baseUrl: string;
  private tokenUrl: string;
  private doFetch: typeof fetch;
  private now: () => number;

  constructor(opts: { baseUrl?: string; tokenUrl?: string; fetch?: typeof fetch; now?: () => number } = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    this.tokenUrl = opts.tokenUrl ?? 'https://console.anthropic.com/v1/oauth/token';
    this.doFetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  async probe(_a: UpstreamAccount, credential: string): Promise<ClaudeProbe> {
    const c = parse(credential);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      authorization: `Bearer ${claudeToken(c)}`,
      'anthropic-beta': OAUTH_BETA,
    };
    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers,
        // one token out: the cheapest request that still tells 200 from 401 / 429
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e: any) {
      return { health: 'error', error: tr('探测失败：{message}', { message: e?.message ?? String(e) }) };
    }
    if (res.ok) return { health: 'ok', quota: quotaFromHeaders(res.headers, this.now()) };
    const text = await res.text().catch(() => '');
    const error = `HTTP ${res.status} ${text.slice(0, 200)}`.trim();
    if (res.status === 401 || res.status === 403) return { health: 'expired', error };
    if (res.status === 429 || res.status === 402) {
      const retry = Number(res.headers.get('retry-after') ?? '');
      return { health: 'cooling', error, cooldownUntil: this.now() + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : 60_000) };
    }
    // some endpoints have no /v1/messages but do have /v1/models
    if (res.status === 404 || res.status === 405) {
      try {
        const m = await this.doFetch(`${this.baseUrl}/v1/models`, { headers });
        if (m.ok) return { health: 'ok' };
      } catch { /* fall through */ }
    }
    return { health: 'error', error };
  }

  /** A new access token from a refresh token; null when the envelope has none or the endpoint refused. */
  async refresh(_a: UpstreamAccount, credential: string): Promise<{ credential: string; expiresAt?: number } | null> {
    const c = parse(credential);
    if (c.kind !== 'oauth' || !c.refreshToken) return null;
    let res: Response;
    try {
      res = await this.doFetch(this.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: CLAUDE_OAUTH_CLIENT_ID }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const j: any = await res.json().catch(() => null);
    if (!j?.access_token) return null;
    const expiresAt = j.expires_in ? this.now() + Number(j.expires_in) * 1000 : undefined;
    return {
      credential: JSON.stringify({ kind: 'oauth', accessToken: j.access_token, refreshToken: j.refresh_token ?? c.refreshToken, expiresAt, scope: j.scope ?? c.scope }),
      expiresAt,
    };
  }
}

/** Normalize the rate-limit headers of a probe into the same quota snapshot the UI draws. */
export function quotaFromHeaders(h: Headers, now: number): QuotaSnapshot {
  const windows: QuotaSnapshot['windows'] = [];
  for (const id of ['requests', 'tokens', 'input-tokens', 'output-tokens']) {
    const limit = Number(h.get(`anthropic-ratelimit-${id}-limit`) ?? '');
    const remaining = Number(h.get(`anthropic-ratelimit-${id}-remaining`) ?? '');
    const reset = h.get(`anthropic-ratelimit-${id}-reset`);
    if (!Number.isFinite(limit) || limit <= 0) continue;
    const used = Number.isFinite(remaining) ? Math.max(0, limit - remaining) : undefined;
    windows.push({
      id,
      label: id,
      limit,
      used,
      usedPct: used === undefined ? undefined : Math.round((used / limit) * 100),
      resetAt: reset ? Date.parse(reset) || undefined : undefined,
    });
  }
  return { checkedAt: now, windows };
}
