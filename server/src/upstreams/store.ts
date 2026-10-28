// Accounts of every upstream family, at rest: credentials encrypted, de-duplicated by fingerprint, and removed
// from every group that references them. The pool policy lives in service.ts.
import crypto from 'node:crypto';
import type { MetaStore } from '../meta/store.js';
import type { SecretService } from '../secrets/service.js';
import type { UpstreamAccount, UpstreamAccountInput, UpstreamAccountPatch, UpstreamKind } from './types.js';
import { tr } from '../i18n/index.js';
import { normalizeAccountProxy } from './proxy.js';
import { loginDef } from './oauth-registry.js';

export interface NormalizedCredential {
  credentialKind: UpstreamAccount['credentialKind'];
  credential: string; // JSON
  fingerprint: string;
}

const fp = (kind: UpstreamKind, credential: string) =>
  crypto.createHash('sha256').update(`${kind}\0${credential}`).digest('hex');

const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};

/** Turn whatever the user pasted (token, JSON, cookie) into the envelope the adapter reads, plus its fingerprint. */
export function normalizeCredential(kind: UpstreamKind, input: unknown, hint?: UpstreamAccount['credentialKind'], accountProviderId?: string): NormalizedCredential {
  const text = typeof input === 'string' ? input.trim() : '';
  if (kind === 'provider') {
    const o = typeof input === 'string' ? {} : obj(input);
    const providerId = String(o.providerId ?? accountProviderId ?? '').trim();
    if (!providerId) throw new Error(tr('第三方登录账号缺少 providerId'));
    const def = loginDef(providerId);
    const token = text || String(o.token ?? o.accessToken ?? o.apiKey ?? '').trim();
    if (!token) throw new Error(tr('第三方登录凭据为空'));
    const protocol = String(o.protocol ?? def?.account?.protocol ?? '');
    if (!['anthropic', 'openai', 'responses', 'gemini'].includes(protocol)) {
      throw new Error(tr('第三方登录账号缺少接口协议（anthropic / openai / responses / gemini）'));
    }
    const baseUrl = String(o.baseUrl ?? def?.account?.baseUrl ?? (protocol === 'anthropic' ? 'https://api.anthropic.com' : '')).trim();
    if (!baseUrl) throw new Error(tr('第三方登录账号缺少接口地址'));
    const authStyle: 'bearer' | 'x-api-key' | 'both' | undefined = ['bearer', 'x-api-key', 'both'].includes(String(o.authStyle))
      ? String(o.authStyle) as 'bearer' | 'x-api-key' | 'both'
      : def?.account?.authStyle;
    const headers = o.headers && typeof o.headers === 'object' && !Array.isArray(o.headers)
      ? Object.fromEntries(Object.entries(o.headers as Record<string, unknown>)
        .filter(([k, v]) => typeof v === 'string' && !/^(authorization|x-api-key|host|content-length)$/i.test(k))
        .map(([k, v]) => [k.toLowerCase(), v as string]))
      : undefined;
    const chatPath = typeof o.chatPath === 'string' && o.chatPath.startsWith('/') ? o.chatPath : def?.account?.chatPath;
    const oauth = o.kind === 'oauth' || hint === 'oauth' || o.accessToken !== undefined;
    const envelope = {
      kind: oauth ? 'oauth' : 'token',
      providerId,
      protocol,
      baseUrl,
      ...(authStyle ? { authStyle } : {}),
      ...(headers && Object.keys(headers).length ? { headers } : {}),
      ...(chatPath ? { chatPath } : {}),
      ...(oauth ? { accessToken: token } : { token }),
      ...(typeof o.refreshToken === 'string' ? { refreshToken: o.refreshToken } : {}),
      ...(Number.isFinite(Number(o.expiresAt)) && Number(o.expiresAt) > 0 ? { expiresAt: Number(o.expiresAt) } : {}),
      ...(typeof o.accountId === 'string' ? { accountId: o.accountId } : {}),
    };
    const credential = JSON.stringify(envelope);
    return { credentialKind: oauth ? 'oauth' : 'token', credential, fingerprint: fp(kind, `${providerId}\0${credential}`) };
  }
  if (kind === 'claude') {
    if (text.startsWith('sk-ant-oat')) {
      const credential = JSON.stringify({ kind: 'setup-token', token: text });
      return { credentialKind: 'setup-token', credential, fingerprint: fp(kind, credential) };
    }
    let j: Record<string, any> = {};
    if (text) {
      try { j = obj(JSON.parse(text)); } catch { j = {}; }
    } else j = obj(input);
    // a `claude setup-token` JSON import, or Claude Code's `~/.claude/.credentials.json` shape
    const oauth = obj(j.claudeAiOauth ?? j);
    const accessToken = oauth.accessToken ?? oauth.access_token;
    if (accessToken) {
      const credential = JSON.stringify({
        kind: 'oauth',
        accessToken,
        refreshToken: oauth.refreshToken ?? oauth.refresh_token,
        expiresAt: oauth.expiresAt ?? oauth.expires_at,
        scope: oauth.scope,
      });
      return { credentialKind: 'oauth', credential, fingerprint: fp(kind, credential) };
    }
    const token = j.token ?? j.tokenValue;
    if (typeof token === 'string' && token.trim()) {
      const credential = JSON.stringify({ kind: 'setup-token', token: token.trim() });
      return { credentialKind: 'setup-token', credential, fingerprint: fp(kind, credential) };
    }
    throw new Error(tr('无法识别的 Claude 凭据：需要 sk-ant-oat… 令牌或包含 accessToken 的 JSON'));
  }
  if (kind === 'gemini') {
    const o = obj(input);
    const cookies = Array.isArray(o.cookies)
      ? (o.cookies as any[]).map((x) => `${x?.name}=${x?.value}`).join('; ')
      : text || String(o.cookie ?? '').trim();
    if (!cookies) throw new Error(tr('Gemini 凭据需要 cookie'));
    const credential = JSON.stringify({ kind: 'cookie', cookie: cookies, ...(o.userAgent ? { userAgent: o.userAgent } : {}) });
    return { credentialKind: 'cookie', credential, fingerprint: fp(kind, credential) };
  }
  // WorkBuddy's real login is the cockpit export: one or more { uid, accessToken, refreshToken } objects
  const cockpit = (() => {
    if (typeof input !== 'string') return input;
    if (!text.startsWith('{') && !text.startsWith('[')) return undefined;
    try { return JSON.parse(text); } catch { return undefined; }
  })();
  if (cockpit !== undefined && looksCockpit(cockpit)) {
    const credential = JSON.stringify(cockpit);
    return { credentialKind: 'token', credential, fingerprint: fp(kind, credential) };
  }
  const token = text || String(obj(input).token ?? obj(input).password ?? '');
  if (!token) throw new Error(tr('WorkBuddy 凭据需要包含 uid / accessToken / refreshToken 的 JSON'));
  const credentialKind = obj(input).password ? 'password' : 'token';
  const credential = JSON.stringify({
    kind: credentialKind,
    ...(credentialKind === 'password' ? { username: obj(input).username, password: obj(input).password } : { token }),
  });
  return { credentialKind: hint ?? credentialKind, credential, fingerprint: fp(kind, credential) };
}

/** The shape the WorkBuddy sidecar imports (`accountsOf` in workbuddy.ts decides the same thing). */
function looksCockpit(v: unknown): boolean {
  const one = (x: any) => typeof x?.uid === 'string' && typeof (x?.accessToken ?? x?.access_token) === 'string';
  if (Array.isArray(v)) return v.length > 0 && v.every(one);
  const o = obj(v);
  if (Array.isArray(o.accounts)) return o.accounts.length > 0 && o.accounts.every(one);
  if (Array.isArray(o.data)) return o.data.length > 0 && o.data.every(one);
  return one(o);
}

export class AccountStore {
  constructor(private meta: MetaStore, private secrets: SecretService) {}

  list(): UpstreamAccount[] { return this.meta.upstreamAccounts(); }
  get(id: string): UpstreamAccount | undefined { return this.list().find((a) => a.id === id); }
  async revealCredential(a: UpstreamAccount): Promise<string> { return this.secrets.reveal(a.credential); }
  async revealProxy(a: UpstreamAccount): Promise<string | undefined> { return a.proxy ? this.secrets.reveal(a.proxy) : undefined; }

  async add(input: UpstreamAccountInput): Promise<{ account: UpstreamAccount; duplicate: boolean }> {
    const n = normalizeCredential(input.kind, input.credential, input.credentialKind, input.providerId);
    const dup = this.list().find((a) => a.kind === input.kind && a.fingerprint === n.fingerprint);
    if (dup) return { account: dup, duplicate: true };
    const id = `acct_${crypto.randomBytes(5).toString('hex')}`;
    const now = Date.now();
    const account: UpstreamAccount = {
      id,
      kind: input.kind,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      name: input.name?.trim() || `${input.providerId ?? input.kind} ${this.list().filter((a) => a.kind === input.kind).length + 1}`,
      enabled: true,
      credential: await this.secrets.protect(n.credential, id),
      credentialKind: n.credentialKind,
      fingerprint: n.fingerprint,
      source: input.source ?? 'paste',
      createdAt: now,
      updatedAt: now,
      health: 'unknown',
      ...(input.maxConcurrent ? { maxConcurrent: input.maxConcurrent } : {}),
      ...(input.dailyRequestLimit ? { dailyRequestLimit: input.dailyRequestLimit } : {}),
      ...(input.identity ? { identity: input.identity } : {}),
    };
    if (input.proxy) {
      const proxy = normalizeAccountProxy(input.proxy);
      if (!proxy) throw new Error(tr('代理地址需要 http(s):// 或 socks5://'));
      account.proxy = await this.secrets.protect(proxy, `${id}:proxy`);
    }
    this.list().push(account);
    await this.meta.saveUpstreams();
    return { account, duplicate: false };
  }

  /**
   * A login that lives only in a sidecar (added there by its own OAuth / QR flow): no local secret, just the link.
   * `sync` fills in health, identity and quota.
   */
  async addManaged(kind: UpstreamKind, name: string, remoteId: string): Promise<UpstreamAccount> {
    const fingerprint = fp(kind, `managed:${remoteId}`);
    const dup = this.list().find((a) => a.kind === kind && (a.fingerprint === fingerprint || a.sidecar?.remoteId === remoteId));
    if (dup) return dup;
    const id = `acct_${crypto.randomBytes(5).toString('hex')}`;
    const now = Date.now();
    const credential = JSON.stringify({ kind: 'managed', remoteId });
    const account: UpstreamAccount = {
      id,
      kind,
      name: name.trim() || `${kind} ${this.list().filter((a) => a.kind === kind).length + 1}`,
      enabled: true,
      credential: await this.secrets.protect(credential, id),
      credentialKind: 'token',
      fingerprint,
      source: 'oauth',
      createdAt: now,
      updatedAt: now,
      health: 'unknown',
      sidecar: { id: kind as 'gemini' | 'workbuddy', remoteId, syncedAt: now },
    };
    this.list().push(account);
    await this.meta.saveUpstreams();
    return account;
  }

  async update(id: string, patch: UpstreamAccountPatch): Promise<UpstreamAccount> {
    const a = this.get(id);
    if (!a) throw new Error(tr('没有这个账号'));
    if (patch.name !== undefined) a.name = patch.name.trim() || a.name;
    if (patch.enabled !== undefined) {
      a.enabled = patch.enabled;
      // the user decided: auto-recovery must never override a manual stop (or a manual start)
      delete a.autoDisabledAt;
      if (!patch.enabled) a.health = 'disabled';
      else if (a.health === 'disabled') a.health = 'unknown';
    }
    if (patch.credential !== undefined) {
      const n = normalizeCredential(a.kind, patch.credential, patch.credentialKind, a.providerId);
      a.credential = await this.secrets.protect(n.credential, id);
      a.credentialKind = n.credentialKind;
      a.fingerprint = n.fingerprint;
      a.health = 'unknown';
      delete a.lastError;
    }
    if (patch.proxy !== undefined) {
      if (patch.proxy === null || patch.proxy === '') delete a.proxy;
      else {
        const proxy = normalizeAccountProxy(patch.proxy);
        if (!proxy) throw new Error(tr('代理地址需要 http(s):// 或 socks5://'));
        a.proxy = await this.secrets.protect(proxy, `${id}:proxy`);
      }
    }
    if (patch.maxConcurrent !== undefined) {
      if (patch.maxConcurrent === null) delete a.maxConcurrent;
      else a.maxConcurrent = patch.maxConcurrent;
    }
    if (patch.dailyRequestLimit !== undefined) {
      if (patch.dailyRequestLimit === null) delete a.dailyRequestLimit;
      else a.dailyRequestLimit = patch.dailyRequestLimit;
    }
    if (patch.identity !== undefined) a.identity = patch.identity;
    a.updatedAt = Date.now();
    await this.meta.saveUpstreams();
    return a;
  }

  async remove(id: string): Promise<void> {
    this.meta.data.upstreamAccounts = this.list().filter((a) => a.id !== id);
    for (const g of this.meta.upstreamGroups()) g.members = g.members.filter((x) => x !== id);
    for (const g of this.meta.gatewayGroups()) g.members = g.members.filter((m) => m.accountId !== id);
    await this.meta.saveUpstreams();
  }

  async setHealth(id: string, patch: Partial<Pick<UpstreamAccount, 'health' | 'cooldownUntil' | 'lastOkAt' | 'lastUsedAt' | 'lastError' | 'quota' | 'identity' | 'autoDisabledAt' | 'models'>>): Promise<void> {
    const a = this.get(id);
    if (!a) return;
    Object.assign(a, patch);
    a.updatedAt = Date.now();
    await this.meta.saveUpstreams();
  }
}
