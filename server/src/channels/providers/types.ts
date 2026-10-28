// P2 upstream descriptors (spec 2026-10-27 §6.2 / §6.3): one record per provider the add-source wizard can offer.
// A descriptor is data only — it never holds a credential and never makes a network request. Configured accounts
// (OAuth tokens, API keys, quota windows) live in the existing stores and are projected by channels/registry.ts.
import type { SourceCategory, SourceModel, SourceNeeds, SourceSummary } from '../types.js';

/** How the upstream page groups a provider (the left filter in spec §6.2). */
export type ProviderKind = 'subscription' | 'api-key' | 'local' | 'custom' | 'remote';

/**
 * The sign-in shape the wizard picks on its own (spec §6.3): a loopback OAuth callback, a device code, a pasted
 * token / cookie, the login an installed CLI or IDE already has, a daily check-in account, a plain API key, or
 * nothing at all for a local / keyless endpoint.
 */
export type ProviderAuth =
  | 'oauth-loopback'
  | 'device-code'
  | 'paste-token'
  | 'local-credential'
  | 'checkin'
  | 'api-key'
  | 'none';

/**
 * Where model ids come from. `account` = the models the signed-in plan exposes, `live` = the endpoint's /models,
 * `local` = ask the local program, `upstream` = read another gateway's catalogue, `static` = a built-in list,
 * `none` = nothing is known before configuring.
 */
export type ProviderModelSource = 'account' | 'live' | 'local' | 'upstream' | 'static' | 'none';

/** One provider the wizard can add. Names and hints are user-visible; hints are already passed through `tr()`. */
export interface ProviderDescriptor {
  /** Stable id; the same value is used in URLs, settings and account rows. */
  readonly id: string;
  readonly name: string;
  readonly kind: ProviderKind;
  readonly auth: ProviderAuth;
  /** One sentence the wizard shows under the provider's name. */
  readonly loginHint?: string;
  /** Vendor documentation / sign-in page. */
  readonly docsUrl?: string;
  /** `true` = a free tier exists, `'some'` = only some models are free. */
  readonly free?: boolean | 'some';
  readonly modelSource: ProviderModelSource;
}

/**
 * A descriptor as the channels layer sees it before anything is configured. `health` is always `unconfigured`:
 * these rows advertise what can be added, not a live account. `models` stays empty until a real refresh happens.
 */
export interface ProviderChannel extends ProviderDescriptor {
  /** The descriptor id (same as `id`); kept explicit so it can sit next to provider-profile rows. */
  readonly providerId: string;
  readonly health: 'unconfigured';
  readonly category: SourceCategory;
  readonly needs: SourceNeeds;
  readonly models: readonly SourceModel[];
  readonly actions: SourceSummary['actions'];
}
