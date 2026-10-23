// Model gateway (sub-project 4): wire types shared with the web client through protocol.ts (`export *`).
import type { Provider } from '../protocol.js';

/** Which API shape a request arrives in / a member speaks. `responses` = OpenAI Responses API (Codex). */
export type GatewayProtocol = 'anthropic' | 'openai' | 'responses' | 'gemini';

/**
 * One member of a failover group: exactly one of the three references. `providerId` is a supplier profile;
 * `accountId` a single upstream account (Claude subscription); `upstreamGroupId` a whole account pool.
 */
export interface GatewayMember {
  providerId?: string;
  accountId?: string;
  upstreamGroupId?: string;
  /** Pin this member to one upstream model (overrides the group's modelMap). */
  model?: string;
  /** Round-robin weight (default 1). */
  weight?: number;
}

/** The state-table key of a member reference: `p:` provider, `a:` account, `u:` pool. */
export const memberKey = (m: GatewayMember): string =>
  m.accountId ? `a:${m.accountId}` : m.upstreamGroupId ? `u:${m.upstreamGroupId}` : `p:${m.providerId ?? ''}`;

/** What the gateway actually sends to: a provider profile, or an account resolved from the pool. */
export type GatewayTarget = Provider & {
  /** a Claude subscription login: Bearer + anthropic-beta, never x-api-key */
  auth?: 'oauth';
  /** account members always go through the IR renderers (the login needs Claude Code's request shape) */
  forceTranslate?: boolean;
  /** a pool's modelMap result; wins over the group's mapping */
  model?: string;
  /** this account's own proxy (http(s):// / socks5://), used instead of the process-wide one */
  proxy?: string;
  /** picked while cooling (the pool had nobody healthy): the reply carries `x-cw-degraded: 1` */
  degraded?: boolean;
  /** resolved from the account store (the state key is `a:<id>`, not the group member's ref) */
  account?: boolean;
};

export interface GatewayGroup {
  id: string;
  name: string;
  members: GatewayMember[];
  strategy: 'failover' | 'round-robin';
  /** Inbound model → outbound model. Keys may use `*` wildcards; exact keys win. */
  modelMap?: Record<string, string>;
  /** 1-hour prompt-cache TTL on requests translated to Anthropic members (2x base write price vs 1.25x for 5 min). */
  cache1h?: boolean;
}

export type GatewayMemberHealth = 'ok' | 'cooling' | 'disabled' | 'unknown';
export interface GatewayMemberState {
  /** the id inside the ref (display / back-compat) */
  providerId: string;
  /** `p:…` / `a:…` / `u:…` — the state table's key */
  key: string;
  name: string;
  type: string;
  health: GatewayMemberHealth;
  cooldownUntil?: number;
  /** Consecutive rate-limit hits (exponential backoff step). */
  strikes: number;
  lastError?: string;
  lastStatus?: number;
  lastOkAt?: number;
  lastUsedAt?: number;
}

export interface GatewayStatus {
  enabled: boolean;
  /** `http://127.0.0.1:<port>/gateway` — main app listener for internal profiles, shims and subagent routes. */
  baseUrl: string;
  /** Stable, dedicated loopback data-plane address copied into other applications. */
  localBaseUrl?: string;
  localPort?: number;
  localRunning?: boolean;
  localError?: string;
  /** Masked (`cwg-…abcd`); the plaintext only comes from `gateway.revealKey`. */
  keyMasked: string;
  groups: GatewayGroup[];
  states: Record<string, GatewayMemberState[]>; // groupId → member states (same order as members)
  /**
   * member key (`a:<accountId>` / `u:<upstreamGroupId>`) → the models its sidecar family reported. A single
   * account or a whole pool brings them to the model menu (serveModels reads the same family cache).
   */
  poolModels?: Record<string, string[]>;
}

export interface GatewayTestResult {
  ok: boolean;
  status: number;
  ms: number;
  member?: string;
  switches?: number;
  text?: string;
  error?: string;
  /** Caveat to show next to the result (e.g. the test request carries no Claude Code fingerprint). */
  note?: string;
}

/** Extra fields on a ledger line written by the gateway (`kind: 'gateway'`). */
export interface GatewayLedgerInfo {
  group: string;
  /** 'shim' = a call through a profile's cache shim (/gateway/~p/…), not a gateway group */
  via?: 'shim';
  inbound: GatewayProtocol;
  member?: string; // provider name that answered (or last tried)
  memberId?: string;
  outbound?: GatewayProtocol;
  upstreamStatus?: number;
  switches: number;
  firstByteMs?: number;
  stream: boolean;
}

// ---- keys, LAN, audit (embedded gateway phase A) ----

export interface GatewayKeyGroup {
  id: string;
  name: string;
  /** empty = every route group (the migrated default key group) */
  routeGroupIds: string[];
  modelAllowlist?: string[];
  modelDeny?: string[];
  allowLan: boolean;
  ipAllowlist: string[];
  rateLimit?: { rpm?: number; concurrent?: number; dailyTokens?: number; dailyCostUsd?: number };
  createdAt: number;
}

export interface GatewayKey {
  id: string;
  name: string;
  keyGroupId: string;
  prefix: string;
  hash: string;
  salt: string;
  /** enc:…; only the migrated legacy key keeps it, for 「显示密钥」 */
  secret?: string;
  enabled: boolean;
  expiresAt?: number;
  createdAt: number;
  lastUsedAt?: number;
  stats: { requests: number; tokensIn: number; tokensOut: number; costUsd: number; day: string };
}

export type GatewayKeyView = Omit<GatewayKey, 'hash' | 'salt' | 'secret'>;

export interface GatewayLanConfig {
  enabled: boolean;
  /** a private IPv4 address of this machine, or 0.0.0.0 (needs a second confirmation) */
  bind: string;
  port: number;
  ipAllowlist: string[];
  corsOrigins: string[];
  maxBodyBytes: number;
}

export interface GatewayAuditConfig {
  enabled: boolean;
  maxBytes: number;
  keepFiles: number;
}

/** One audit line. Never prompt / response body / key / cookie / Authorization. */
export interface GatewayAuditLine {
  ts: number;
  keyId: string;
  ip: string;
  protocol: GatewayProtocol;
  model: string;
  routeGroupId: string;
  member: string;
  status: number;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  errorCode: string;
}

export interface GatewayKeyStatus { groups: GatewayKeyGroup[]; keys: GatewayKeyView[]; defaultKeyId: string }
export interface GatewayLanStatus extends GatewayLanConfig { running: boolean; port: number; addresses: string[]; audit: GatewayAuditConfig }

export type GatewayRequest =
  | { kind: 'gateway.status' }
  | { kind: 'gateway.set'; enabled: boolean }
  | { kind: 'gateway.revealKey' }
  | { kind: 'gateway.regenerateKey' }
  | { kind: 'gateway.groups.upsert'; group: Partial<GatewayGroup> & { id?: string } }
  | { kind: 'gateway.groups.remove'; id: string }
  | { kind: 'gateway.reset'; groupId: string; providerId?: string }
  | { kind: 'gateway.test'; groupId: string; protocol?: GatewayProtocol }
  | { kind: 'gateway.keys.status' }
  | { kind: 'gateway.keys.create'; groupId: string; name: string; expiresAt?: number }
  | { kind: 'gateway.keys.update'; id: string; patch: { name?: string; enabled?: boolean; keyGroupId?: string; expiresAt?: number | null } }
  | { kind: 'gateway.keys.remove'; id: string }
  | { kind: 'gateway.keys.reveal'; id: string }
  | { kind: 'gateway.keyGroups.upsert'; group: Partial<GatewayKeyGroup> & { id?: string } }
  | { kind: 'gateway.keyGroups.remove'; id: string }
  | { kind: 'gateway.local.set'; port: number }
  | { kind: 'gateway.lan.status' }
  | { kind: 'gateway.lan.set'; config: Partial<GatewayLanConfig> & { confirmAny?: boolean } }
  | { kind: 'gateway.audit.list'; limit?: number; since?: number; keyId?: string }
  | { kind: 'gateway.audit.clear' }
  | { kind: 'gateway.audit.export' }
  | { kind: 'gateway.settings.set'; patch: { audit?: Partial<GatewayAuditConfig>; allowQueryKey?: boolean } };

export type GatewayEvent =
  | { kind: 'gateway.changed' }
  | { kind: 'upstreams.changed' }
  | { kind: 'gateway.log'; lines: GatewayAuditLine[] }
  /** a conversation's outbound prompt grew past the sidecar's inline limit (Gemini web: 128 KB) — advise /compact */
  | { kind: 'gateway.promptHeavy'; sessionId: string; bytes: number; via: string };
