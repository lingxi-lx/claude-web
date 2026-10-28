// 账号池 (embedded gateway, phase A): one upstream login of any family, and the pools they are grouped into.
// Shared with the web client through protocol.ts.
import type { ProviderLoginInfo } from './oauth-registry.js';
export type { ProviderLoginInfo } from './oauth-registry.js';
export type { LoginSessionView, LoginSessionState } from './provider-login.js';

/** `provider` = a generic provider login (codex / copilot / opencode …); its providerId says which registry entry. */
export type UpstreamKind = 'claude' | 'gemini' | 'workbuddy' | 'provider';
export type SidecarId = 'gemini' | 'workbuddy';

export interface QuotaWindow {
  id: string;
  label: string;
  used?: number;
  limit?: number;
  usedPct?: number;
  resetAt?: number;
}

export interface QuotaSnapshot {
  checkedAt: number;
  windows: QuotaWindow[];
  credits?: { remaining?: number; total?: number; unit?: string };
  note?: string;
}

export interface UpstreamAccount {
  id: string;
  kind: UpstreamKind;
  /** kind 'provider': which provider-login registry entry this account came from */
  providerId?: string;
  name: string;
  enabled: boolean;
  /** enc:…; the plaintext is a JSON envelope (see normalizeCredential) */
  credential: string;
  credentialKind: 'oauth' | 'setup-token' | 'cookie' | 'token' | 'password';
  /** sha256(kind + '\0' + normalized credential): dedupe without decrypting everything */
  fingerprint?: string;
  /** enc:…; one account's proxy, empty = direct */
  proxy?: string;
  maxConcurrent?: number;
  dailyRequestLimit?: number;
  identity?: { email?: string; plan?: string; org?: string; expiresAt?: number };
  /** the models the last probe listed (provider accounts; the gateway menu reads this) */
  models?: string[];
  source: 'oauth' | 'paste' | 'file' | 'qr' | 'desktop';
  createdAt: number;
  updatedAt: number;
  health: 'unknown' | 'ok' | 'cooling' | 'expired' | 'disabled' | 'error';
  cooldownUntil?: number;
  lastOkAt?: number;
  lastUsedAt?: number;
  lastError?: string;
  quota?: QuotaSnapshot;
  sidecar?: { id: 'gemini' | 'workbuddy'; remoteId: string; syncedAt: number };
  /** the exit the sidecar last reported this account pinned to (shown, and editable as `proxyId`) */
  sidecarProxy?: { id: number; name?: string; failCount?: number };
  /** the sidecar stopped this account by itself (consecutive auth failures); a passing check re-enables it */
  autoDisabledAt?: number;
  /** today's counters (local midnight), for dailyRequestLimit */
  stats?: { day: string; requests: number; tokensIn: number; tokensOut: number };
}

export interface UpstreamAccountInput {
  kind: UpstreamKind;
  /** kind 'provider': registry id (codex / copilot / anthropic / …) */
  providerId?: string;
  name?: string;
  credential: unknown;
  credentialKind?: UpstreamAccount['credentialKind'];
  source?: UpstreamAccount['source'];
  proxy?: string;
  /** a sidecar account's exit, from the family's proxy pool */
  proxyId?: number;
  maxConcurrent?: number;
  dailyRequestLimit?: number;
  identity?: UpstreamAccount['identity'];
  /** false = do not probe after adding (tests, bulk import) */
  probe?: boolean;
}

export interface UpstreamAccountPatch {
  name?: string;
  enabled?: boolean;
  credential?: unknown;
  credentialKind?: UpstreamAccount['credentialKind'];
  proxy?: string | null;
  /** a sidecar account's exit; null = let the sidecar pick */
  proxyId?: number | null;
  maxConcurrent?: number | null;
  dailyRequestLimit?: number | null;
  identity?: UpstreamAccount['identity'];
}

export type UpstreamAccountView = Omit<UpstreamAccount, 'credential' | 'proxy' | 'fingerprint'> & {
  credentialMasked: string;
  hasProxy: boolean;
};

export interface UpstreamGroup {
  id: string;
  kind: UpstreamKind;
  name: string;
  strategy: 'failover' | 'round-robin' | 'least-used' | 'most-quota';
  members: string[];
  modelMap?: Record<string, string>;
  /** session affinity (default: session / 60 minutes) */
  affinity?: { mode: 'none' | 'session'; ttlMinutes: number };
  enabled: boolean;
  createdAt: number;
}

export interface UpstreamStatus {
  accounts: UpstreamAccountView[];
  groups: UpstreamGroup[];
  /** one line per family: can it be used yet (Claude now; Gemini / WorkBuddy need a sidecar) */
  families: { kind: UpstreamKind; ready: boolean; detail?: string }[];
  /** every provider-login definition the add wizard can offer (available or with an honest reason) */
  logins?: ProviderLoginInfo[];
  /** the Gemini / WorkBuddy processes: installed, running, port */
  sidecars?: SidecarStatus[];
  /** things the user should look at (a family with no healthy account, stopped accounts) */
  warnings?: string[];
}

// ---- sidecars (phase B/C) ----

/** One account as the sidecar sees it (its own id, health and quota). */
export interface SidecarAccount {
  remoteId: string;
  name: string;
  enabled: boolean;
  health: UpstreamAccount['health'];
  lastError?: string;
  quota?: QuotaSnapshot;
  identity?: UpstreamAccount['identity'];
  /** the exit this account is pinned to in the sidecar's proxy pool (absent = none yet) */
  proxyId?: number;
  proxyName?: string;
  /** consecutive auth failures the sidecar counted (it disables an account at 3) */
  failCount?: number;
}

/** One exit of a sidecar's proxy pool, with its own breaker state. */
export interface SidecarProxy {
  id: number;
  name: string;
  /** masked — a proxy URL can carry a user and password */
  url: string;
  enabled: boolean;
  weight: number;
  failCount: number;
  lastUsed: number;
  lastError: string;
  createdAt: number;
}

export interface SidecarProxyInput {
  name?: string;
  url: string;
  weight?: number;
}

export interface SidecarProxyPatch {
  name?: string;
  url?: string;
  enabled?: boolean;
  weight?: number;
}

/**
 * The anti-ban knobs a sidecar family exposes (its own rate limits per exit, breaker cooldown, fallbacks).
 * The component applies them live; the web client only edits them.
 */
export interface SidecarGuard {
  perIpConcurrent: number;
  perIpRpm: number;
  perIpRph: number;
  proxyCooldownMin: number;
  fallbackDirect: boolean;
  fallbackAnon: boolean;
  /** native conversation_id continuation: later turns send only the delta instead of the whole prompt */
  multiTurn: boolean;
  /** prompt bytes above this are uploaded as an attachment; 0 = never */
  maxPromptBytes: number;
  /** false when the family has no such settings (WorkBuddy) */
  supported: boolean;
}

/** A loopback proxy the sign-in window can use (Chrome cannot carry proxy credentials itself). */
export interface LoginTunnel {
  tunnelId: string;
  /** 127.0.0.1:<port> to hand Chrome as --proxy-server */
  server: string;
  /** the exit it tunnels to, masked */
  exit: string;
}

export interface SidecarAccountInput {
  credential: unknown;
  credentialKind?: UpstreamAccount['credentialKind'];
  name?: string;
  proxy?: string;
  /** pin this account to one exit of the sidecar's proxy pool */
  proxyId?: number;
}

export interface SidecarAccountPatch {
  name?: string;
  enabled?: boolean;
  proxy?: string | null;
  proxyId?: number | null;
}

export interface SidecarStatus {
  id: SidecarId;
  /** a binary exists (dev override or installed) */
  installed: boolean;
  running: boolean;
  version?: string;
  port?: number;
  health?: 'ok' | 'starting' | 'error' | 'stopped';
  detail?: string;
}

/** The task center's kinds. Phase B runs the first three for Gemini; phase C adds the WorkBuddy ones. */
export type MaintenanceKind =
  | 'checkin' | 'keepalive' | 'growth' | 'travel' | 'lottery' | 'activity'
  | 'quota-refresh' | 'account-check';

export interface MaintenanceTask {
  id: string;
  name?: string;
  kind: MaintenanceKind;
  target: { kind: 'account'; accountId: string } | { kind: 'group'; groupId: string };
  schedule: { cron?: string; everyMinutes?: number };
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  lastError?: string;
}

export interface MaintenanceRun {
  id: string;
  taskId: string;
  accountId?: string;
  at: number;
  ok: boolean;
  durationMs: number;
  result?: string;
  error?: string;
  idempotencyKey: string;
}

export interface TaskResult { ok: boolean; detail?: string; quota?: QuotaSnapshot }

/** The task center's requests; the scheduler (upstreams/tasks.ts) answers them. */
export type TaskRequest =
  | { kind: 'tasks.list' }
  | { kind: 'tasks.upsert'; task: Partial<MaintenanceTask> & { id?: string } }
  | { kind: 'tasks.remove'; id: string }
  | { kind: 'tasks.run'; id: string }
  | { kind: 'tasks.runs'; limit?: number };

export type UpstreamRequest =
  | { kind: 'upstreams.status' }
  | { kind: 'upstreams.login.providers' }
  | { kind: 'upstreams.login.begin'; providerId: string; mode?: 'oauth' | 'device' | 'paste' | 'local'; credential?: string; name?: string }
  | { kind: 'upstreams.login.status'; loginId: string }
  | { kind: 'upstreams.login.cancel'; loginId: string }
  | { kind: 'upstreams.sidecars.status' }
  | { kind: 'upstreams.sidecars.install'; id: SidecarId }
  | { kind: 'upstreams.sidecars.start'; id: SidecarId }
  | { kind: 'upstreams.sidecars.stop'; id: SidecarId }
  | { kind: 'upstreams.sidecars.logs'; id: SidecarId; lines?: number }
  | { kind: 'upstreams.sync'; id: SidecarId }
  | { kind: 'upstreams.oauth.start'; id: 'workbuddy'; realm?: string }
  | { kind: 'upstreams.oauth.poll'; state: string }
  | TaskRequest
  | { kind: 'upstreams.add'; input: UpstreamAccountInput }
  | { kind: 'upstreams.update'; id: string; patch: UpstreamAccountPatch }
  | { kind: 'upstreams.remove'; id: string }
  | { kind: 'upstreams.probe'; id: string }
  | { kind: 'upstreams.reset'; id: string }
  | { kind: 'upstreams.groups.upsert'; group: Partial<UpstreamGroup> & { id?: string } }
  | { kind: 'upstreams.groups.remove'; id: string }
  | { kind: 'upstreams.attachDefault'; id: string }
  | { kind: 'upstreams.models.refresh'; id: SidecarId }
  | { kind: 'upstreams.proxies'; id: SidecarId }
  | { kind: 'upstreams.proxies.add'; id: SidecarId; input: SidecarProxyInput }
  | { kind: 'upstreams.proxies.update'; id: SidecarId; proxyId: number; patch: SidecarProxyPatch }
  | { kind: 'upstreams.proxies.remove'; id: SidecarId; proxyId: number }
  | { kind: 'upstreams.proxies.reset'; id: SidecarId; proxyId: number }
  | { kind: 'upstreams.loginTunnel.open'; id: SidecarId; proxyId?: number }
  | { kind: 'upstreams.loginTunnel.close'; tunnelId: string }
  | { kind: 'upstreams.guard.get'; id: SidecarId }
  | { kind: 'upstreams.guard.set'; id: SidecarId; patch: Partial<Omit<SidecarGuard, 'supported'>> };
