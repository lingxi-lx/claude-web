// Where a provider's traffic goes while 隐私保护 is on (spec 2026-10-26 §4.1): every base URL a conversation, an agent
// or a connection test would use is swapped for the local privacy relay (`/gateway/~v/…`, privacy/relay.ts), which
// carries the real upstream in its path and runs the pipeline. Off → `null` everywhere: no extra hop, nothing changes.
// A hook (set by the server once the gateway listens) so providers/service.ts stays free of the gateway.

type RouteFn = (target: string) => string | null;
let hook: RouteFn | null = null;

export function setPrivacyRoute(f: RouteFn | null) { hook = f; }

/** The relay base for `target` (a base URL the client appends its own path to), or null = go direct. */
export function privacyRoute(target: string | undefined): string | null {
  if (!hook || !target) return null;
  try { return hook(target); } catch { return null; }
}

/** `target` through the relay when privacy is on, else `target` itself. */
export const viaPrivacy = (target: string) => privacyRoute(target) ?? target;
