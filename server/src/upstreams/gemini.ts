// Gemini web sidecar (zexadev/gemini-web2api-go, MIT): its cookie pool is the account pool; the gateway talks to
// its OpenAI-compatible /v1. Everything here is the sidecar's own admin API (admin token, never its data key).
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import type { SidecarManager } from './sidecar.js';
import type { SidecarDriver, SidecarReadOptions } from './drivers.js';
import type {
  MaintenanceKind, SidecarAccount, SidecarAccountInput, SidecarAccountPatch, SidecarId,
  SidecarProxy, SidecarProxyInput, SidecarProxyPatch, TaskResult,
} from './types.js';
import { maskProxyUrl } from './proxy.js';
import { tr } from '../i18n/index.js';

interface CookieItem {
  id: number;
  label?: string;
  status?: string;
  health?: string;
  last_error?: string;
  note?: string;
  fail_count?: number;
  proxy_id?: number;
  proxy_name?: string;
}

interface ProxyItem {
  id: number;
  name?: string;
  url?: string;
  enabled?: boolean;
  weight?: number;
  fail_count?: number;
  last_used?: number;
  last_error?: string;
  created_at?: number;
}

const asProxy = (p: ProxyItem): SidecarProxy => ({
  id: p.id,
  name: p.name?.trim() || `#${p.id}`,
  url: maskProxyUrl(p.url ?? ''),
  enabled: !!p.enabled,
  weight: p.weight ?? 1,
  failCount: p.fail_count ?? 0,
  lastUsed: p.last_used ?? 0,
  lastError: p.last_error ?? '',
  createdAt: p.created_at ?? 0,
});

const cookieString = (credential: unknown): string => {
  if (typeof credential === 'string') return credential.trim();
  const c = credential as any;
  if (Array.isArray(c?.cookies)) return c.cookies.map((x: any) => `${x.name}=${x.value}`).join('; ');
  if (typeof c?.cookie === 'string') return c.cookie;
  return '';
};

export class GeminiAdapter implements SidecarDriver {
  readonly id: SidecarId = 'gemini';
  readonly apiKey = `gwk-${crypto.randomBytes(24).toString('hex')}`;
  private readonly adminToken = crypto.randomBytes(24).toString('hex');

  private fixed?: string;

  constructor(private manager: SidecarManager | null, private doFetch: typeof fetch = fetch, opts: { baseUrl?: string } = {}) {
    this.fixed = opts.baseUrl?.replace(/\/+$/, '');
  }

  private base(): string {
    if (this.fixed) return this.fixed;
    const port = this.manager?.status('gemini').port;
    if (!port) throw new Error(tr('Gemini 组件没有在运行'));
    return `http://127.0.0.1:${port}`;
  }

  private async admin<T>(pathName: string, init: RequestInit = {}): Promise<T> {
    const res = await this.doFetch(`${this.base()}${pathName}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.adminToken}`, ...(init.headers as any) },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Gemini sidecar ${pathName}: HTTP ${res.status} ${text.slice(0, 200)}`.trim());
    return (text ? JSON.parse(text) : {}) as T;
  }

  async ensureReady(): Promise<void> {
    if (this.fixed) return;
    await this.manager!.start('gemini', {
      args: ({ port, dir }) => ['--port', String(port), '--db', path.join(dir, 'gemini.db'), '--config', path.join(dir, 'gemini.json')],
      // it listens on 0.0.0.0 unless its config says otherwise, and has no flag for it (internal/app/config.go):
      // only this computer talks to it
      prepare: async ({ dir }) => {
        await fs.writeFile(path.join(dir, 'gemini.json'), JSON.stringify({ host: '127.0.0.1' }), 'utf8');
      },
      env: () => ({ ADMIN_TOKEN: this.adminToken, API_KEY: this.apiKey }),
      health: async (port) => {
        try {
          const r = await this.doFetch(`http://127.0.0.1:${port}/admin/api/config`, { headers: { authorization: `Bearer ${this.adminToken}` }, signal: AbortSignal.timeout(2000) });
          return r.ok;
        } catch { return false; }
      },
    });
  }

  private async prepareRead(options?: SidecarReadOptions): Promise<void> {
    if (options?.start !== false) return this.ensureReady();
    if (!this.fixed && this.manager?.status('gemini').health !== 'ok') throw new Error(tr('组件未运行，请先启动'));
  }

  async health(): Promise<{ ok: boolean; version?: string; detail?: string }> {
    try {
      await this.ensureReady();
      const j = await this.admin<{ models?: string[] }>('/admin/api/config');
      return { ok: true, detail: `${j.models?.length ?? 0} models` };
    } catch (e: any) {
      return { ok: false, detail: e?.message ?? String(e) };
    }
  }

  async models(options?: SidecarReadOptions): Promise<string[]> {
    await this.prepareRead(options);
    const j = await this.admin<{ models?: string[] }>('/admin/api/config');
    return j.models ?? [];
  }

  async listAccounts(options?: SidecarReadOptions): Promise<SidecarAccount[]> {
    await this.prepareRead(options);
    const j = await this.admin<{ items?: CookieItem[] }>('/admin/api/cookies');
    return (j.items ?? []).map((it) => ({
      remoteId: String(it.id),
      name: it.label?.trim() || `Gemini ${it.id}`,
      enabled: it.status === 'enabled',
      health: it.health === 'dead' ? 'expired' : it.status !== 'enabled' || it.health === 'disabled' ? 'disabled' : it.health === 'ok' ? 'ok' : 'unknown',
      lastError: it.last_error || undefined,
      identity: it.label ? { email: it.label } : undefined,
      proxyId: it.proxy_id || undefined,
      proxyName: it.proxy_name || undefined,
      failCount: it.fail_count ?? undefined,
    }));
  }

  async addAccount(input: SidecarAccountInput): Promise<SidecarAccount> {
    const cookie = cookieString(input.credential);
    if (!cookie) throw new Error(tr('Gemini 凭据需要 cookie'));
    await this.ensureReady();
    const r = await this.admin<{ id: number }>('/admin/api/cookies', { method: 'POST', body: JSON.stringify({ label: input.name ?? '', cookie, note: 'claude-web' }) });
    if (input.proxyId) await this.bindProxy(String(r.id), input.proxyId);
    return (await this.listAccounts()).find((a) => a.remoteId === String(r.id)) ?? { remoteId: String(r.id), name: input.name ?? `Gemini ${r.id}`, enabled: true, health: 'unknown' };
  }

  async updateAccount(remoteId: string, patch: SidecarAccountPatch): Promise<SidecarAccount> {
    await this.ensureReady();
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.label = patch.name;
    if (patch.enabled !== undefined) body.status = patch.enabled ? 'enabled' : 'disabled';
    if (Object.keys(body).length) await this.admin(`/admin/api/cookies/${encodeURIComponent(remoteId)}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (patch.proxyId !== undefined) await this.bindProxy(remoteId, patch.proxyId ?? 0);
    const a = (await this.listAccounts()).find((x) => x.remoteId === remoteId);
    if (!a) throw new Error(tr('组件里没有这个账号'));
    return a;
  }

  /**
   * Pin one account to one exit. The sidecar has no admin endpoint for this (its PATCH takes label / note /
   * status only; binding happens by itself on the first request), so this writes `accounts.proxy_id` in its
   * SQLite — the same column its own `bindAccountProxy` writes, and the table it reads on every pick.
   */
  private async bindProxy(remoteId: string, proxyId: number): Promise<void> {
    const id = Number(remoteId);
    if (!Number.isFinite(id)) throw new Error(tr('组件里没有这个账号'));
    if (proxyId) {
      const pool = await this.listProxies();
      if (!pool.some((p) => p.id === proxyId)) throw new Error(tr('出口不在池子里'));
    }
    if (!this.manager) throw new Error(tr('Gemini 组件没有在运行'));
    const file = path.join(this.manager.dir('gemini'), 'gemini.db');
    await fs.access(file).catch(() => { throw new Error(tr('Gemini 组件还没有建好账号库')); });
    const db = new DatabaseSync(file);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      db.prepare('UPDATE accounts SET proxy_id=? WHERE id=?').run(proxyId, id);
    } finally {
      db.close();
    }
  }

  private async rawProxies(): Promise<ProxyItem[]> {
    await this.ensureReady();
    const j = await this.admin<{ items?: ProxyItem[] }>('/admin/api/proxies');
    return j.items ?? [];
  }

  async listProxies(): Promise<SidecarProxy[]> { return (await this.rawProxies()).map(asProxy); }

  /**
   * The plaintext URL of one exit (or the first enabled one), for the sign-in window's local tunnel. Never
   * handed to the web client: it can carry a user and password.
   */
  async exitUrl(proxyId?: number): Promise<string | null> {
    const pool = await this.rawProxies();
    const hit = proxyId ? pool.find((p) => p.id === proxyId) : pool.find((p) => p.enabled);
    return hit?.url?.trim() || null;
  }

  async addProxy(input: SidecarProxyInput): Promise<SidecarProxy[]> {
    await this.ensureReady();
    await this.admin('/admin/api/proxies', {
      method: 'POST',
      body: JSON.stringify({ name: input.name ?? '', url: input.url, weight: input.weight ?? 1 }),
    });
    return this.listProxies();
  }

  async updateProxy(id: number, patch: SidecarProxyPatch): Promise<SidecarProxy[]> {
    await this.ensureReady();
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.url !== undefined) body.url = patch.url;
    if (patch.enabled !== undefined) body.enabled = patch.enabled;
    if (patch.weight !== undefined) body.weight = patch.weight;
    if (Object.keys(body).length) {
      await this.admin(`/admin/api/proxies/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    }
    return this.listProxies();
  }

  async removeProxy(id: number): Promise<SidecarProxy[]> {
    await this.ensureReady();
    await this.admin(`/admin/api/proxies/${id}`, { method: 'DELETE' });
    return this.listProxies();
  }

  async resetProxy(id: number): Promise<SidecarProxy[]> {
    await this.ensureReady();
    await this.admin(`/admin/api/proxies/${id}/reset`, { method: 'POST' });
    return this.listProxies();
  }

  /** The component's runtime settings (rate limits, breaker cooldown, fallbacks) — live, no restart needed. */
  async settings(): Promise<Record<string, unknown>> {
    await this.ensureReady();
    const j = await this.admin<{ config?: Record<string, unknown> }>('/admin/api/config');
    return j.config ?? {};
  }

  async saveSettings(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const next = { ...(await this.settings()), ...patch };
    const j = await this.admin<{ config?: Record<string, unknown> }>('/admin/api/config', { method: 'PUT', body: JSON.stringify(next) });
    return j.config ?? {};
  }

  async removeAccount(remoteId: string): Promise<void> {
    await this.ensureReady();
    await this.admin(`/admin/api/cookies/${encodeURIComponent(remoteId)}`, { method: 'DELETE' });
  }

  async checkAccount(remoteId: string): Promise<SidecarAccount> {
    await this.ensureReady();
    const r = await this.admin<{ ok?: boolean; detail?: string }>(`/admin/api/cookies/${encodeURIComponent(remoteId)}/check`, { method: 'POST' });
    const a = (await this.listAccounts()).find((x) => x.remoteId === remoteId);
    return { ...(a ?? { remoteId, name: `Gemini ${remoteId}`, enabled: true }), health: r.ok ? 'ok' : 'expired', lastError: r.ok ? undefined : r.detail } as SidecarAccount;
  }

  async runTask(remoteId: string, task: MaintenanceKind): Promise<TaskResult> {
    await this.ensureReady();
    if (task === 'keepalive') {
      const r = await this.admin<{ ok?: boolean; detail?: string }>(`/admin/api/cookies/${encodeURIComponent(remoteId)}/rotate`, { method: 'POST' });
      return { ok: !!r.ok, detail: r.detail };
    }
    if (task === 'account-check' || task === 'quota-refresh') {
      const a = await this.checkAccount(remoteId);
      return { ok: a.health === 'ok', detail: a.lastError, quota: a.quota };
    }
    return { ok: false, detail: tr('Gemini 没有这项任务') };
  }

  async endpoint(): Promise<{ baseUrl: string; apiKey: string } | null> {
    try {
      await this.ensureReady();
      return { baseUrl: `${this.base()}/v1`, apiKey: this.apiKey };
    } catch { return null; }
  }

  async logs(lines: number): Promise<string> { return this.manager?.logs('gemini', lines) ?? ''; }
}
