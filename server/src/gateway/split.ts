/**
 * The gateway's subagent split route as the session runner reaches it (index.ts wires it to the one GatewayService):
 * the base URL (its key inside) a conversation's engine is given when its subagents run on another provider's model.
 */
import type { ProviderType } from '../protocol.js';

/** Where the conversation's own requests go: the base URL the engine would have used, its request as it sent it. */
export interface SplitMain {
  base: string;
  /** the engine runs on this machine's login (its subagents use it): main requests get this key instead */
  rekey?: string;
}
/** Where the subagents' requests go: a provider profile (translated, its key), or Anthropic with an account's login. */
export type SplitSub = { kind: 'provider'; providerId: string } | { kind: 'account'; token?: string /* absent: the engine's own login */ };

interface SplitHook {
  endpoint(main: SplitMain, sub: SplitSub, model: string): string | null;
  /** a provider profile a subagent pick names: its kind, and for another account the token it logs in with */
  target(providerId: string): { type: ProviderType; token?: string } | null;
}
let hook: SplitHook | null = null;
export function setSplitHook(f: SplitHook | null) { hook = f; }
export function splitEndpoint(main: SplitMain, sub: SplitSub, model: string): string | null {
  return hook?.endpoint(main, sub, model) ?? null;
}
export function splitTarget(providerId: string): { type: ProviderType; token?: string } | null {
  return hook?.target(providerId) ?? null;
}
