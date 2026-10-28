// 来源健康: wire types (protocol.ts re-exports them for the web client). The service is in health.ts.

/** One probe's result: the models endpoint, or the one-token call. */
export interface ProbeOutcome { ok: boolean; status?: number; ms: number; at: number; error?: string; models?: number }

/** cooling = the upstream said 429 and its cooldown runs; limited = under 10 % of a quota window left. */
export type SourceHealthState = 'ok' | 'cooling' | 'limited' | 'error' | 'unknown';

/** What the upstream's answers said about a source's quota (routing/quota.ts). */
export interface SourceQuotaView {
  key: string;
  /** smallest known share left, 0–1 (absent = the upstream never said) */
  remaining?: number;
  /** when the tightest window refills */
  resetAt?: number;
  cooldownUntil?: number;
  /** 429s in a row */
  streak: number;
  last429At?: number;
  lastStatus?: number;
  updatedAt: number;
}

export interface SourceHealthView {
  providerId: string;
  state: SourceHealthState;
  /** the last models-endpoint probe */
  probe?: ProbeOutcome;
  /** the last one-token call */
  chat?: ProbeOutcome;
  /** what the upstream's answers said (headers, 429 cooldown) */
  quota?: SourceQuotaView;
  /** a probe asked before this is answered from the last result */
  nextProbeAt?: number;
}

export interface SourceHealthStatus { sources: SourceHealthView[] }

export type SourceHealthRequest =
  /** → SourceHealthStatus: every provider source's last probe and quota state */
  | { kind: 'channels.health.status' }
  /** → SourceHealthView: probe one provider source now (rate-limited); `chat` adds the one-token call */
  | { kind: 'channels.health.probe'; providerId: string; chat?: boolean };
