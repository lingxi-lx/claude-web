// Wire types of share.* (pure: the web client imports them through @shared).
import type { GatewayKeyView, GatewayLanStatus, ShareRules } from '../gateway/types.js';

export interface ShareKeyView extends GatewayKeyView {
  usage: { todayRequests: number; todayTokens: number; weekRequests: number; weekTokens: number; monthRequests: number; monthTokens: number };
}
export interface ShareStatus {
  gatewayEnabled: boolean;
  lan: GatewayLanStatus;
  /** what to give the other machine: `http://<address>:<port>` (+ /v1 for OpenAI-style clients) */
  endpoints: string[];
  /** who may connect from outside this machine (the share group's IP allow-list) */
  ipAllowlist: string[];
  keys: ShareKeyView[];
  routeGroups: { id: string; name: string }[];
}

export type ShareRequest =
  | { kind: 'share.status' }
  | { kind: 'share.lan.set'; enabled?: boolean; bind?: string; port?: number; ipAllowlist?: string[]; confirmAny?: boolean }
  | { kind: 'share.keys.create'; name: string; rules?: ShareRules; expiresAt?: number }
  | { kind: 'share.keys.update'; id: string; patch: { name?: string; enabled?: boolean; rules?: ShareRules; expiresAt?: number | null } }
  | { kind: 'share.keys.delete'; id: string };

