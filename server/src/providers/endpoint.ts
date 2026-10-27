// Endpoint helpers shared by every path that talks to a provider (session env, model-list probe, gateway):
// one base-URL rule and one credential-header rule, so a profile behaves the same everywhere (spec 2026-10-26 §5.1).
import type { Provider } from '../protocol.js';

export type AuthStyle = NonNullable<Provider['authStyle']>;

/** Trim and drop trailing slashes. */
export const trimBase = (url: string | undefined) => (url ?? '').trim().replace(/\/+$/, '');

/**
 * An Anthropic base is the part before `/v1`: the CLI (and the gateway's own join) appends `/v1/messages`, so a
 * pasted `https://relay/v1` must not become `/v1/v1/messages`. Endpoint suffixes pasted from a doc go too.
 */
export function anthropicBase(url: string | undefined): string {
  return trimBase(url).replace(/\/(?:messages|models)$/i, '').replace(/\/+$/, '').replace(/\/v1$/i, '');
}

/**
 * Credential headers in the profile's style. `fallback` is what the path did before the field existed
 * (Anthropic: both headers; OpenAI-compatible: Bearer only), so profiles without `authStyle` keep working as they did.
 */
export function authHeaders(style: AuthStyle | undefined, key: string, fallback: AuthStyle): Record<string, string> {
  const s = style ?? fallback;
  const h: Record<string, string> = {};
  if (s === 'x-api-key' || s === 'both') h['x-api-key'] = key;
  if (s === 'bearer' || s === 'both') h.authorization = `Bearer ${key}`;
  return h;
}
