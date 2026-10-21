// The contract every sidecar family implements. The gateway only needs the data-plane endpoint; the account
// tab and the task center use the rest.
import type {
  MaintenanceKind, SidecarAccount, SidecarAccountInput, SidecarAccountPatch, SidecarId,
  SidecarProxy, SidecarProxyInput, SidecarProxyPatch, TaskResult,
} from './types.js';

export interface SidecarDriver {
  readonly id: SidecarId;
  /** install + start if needed; resolves when its health check answers */
  ensureReady(): Promise<void>;
  health(): Promise<{ ok: boolean; version?: string; detail?: string }>;
  models(): Promise<string[]>;
  listAccounts(): Promise<SidecarAccount[]>;
  addAccount(input: SidecarAccountInput): Promise<SidecarAccount>;
  updateAccount(remoteId: string, patch: SidecarAccountPatch): Promise<SidecarAccount>;
  removeAccount(remoteId: string): Promise<void>;
  checkAccount(remoteId: string): Promise<SidecarAccount>;
  runTask(remoteId: string, task: MaintenanceKind): Promise<TaskResult>;
  /** the OpenAI-compatible base the gateway sends to, with its key */
  endpoint(): Promise<{ baseUrl: string; apiKey: string } | null>;
  logs?(lines: number): Promise<string>;
  /** OAuth / QR login, for the sidecars that have one */
  startLogin?(realm: 'cn' | 'global'): Promise<{ url: string; state: string }>;
  pollLogin?(state: string): Promise<{ done: boolean; message?: string; uid?: string }>;
  /** exits (residential IPs) a family can route through; each answers the whole pool after the change */
  listProxies?(): Promise<SidecarProxy[]>;
  addProxy?(input: SidecarProxyInput): Promise<SidecarProxy[]>;
  updateProxy?(id: number, patch: SidecarProxyPatch): Promise<SidecarProxy[]>;
  removeProxy?(id: number): Promise<SidecarProxy[]>;
  /** clear a proxy's breaker (fail count) and put it back in the pool */
  resetProxy?(id: number): Promise<SidecarProxy[]>;
  /** the plaintext URL of one exit (or the first enabled one) — server-side only, for the sign-in tunnel */
  exitUrl?(proxyId?: number): Promise<string | null>;
  /** the family's runtime guard settings (rate limits, breaker cooldown, fallbacks) */
  settings?(): Promise<Record<string, unknown>>;
  saveSettings?(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
}
