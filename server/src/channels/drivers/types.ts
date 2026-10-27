// ChannelDriver (spec 2026-10-26 §3.1): one adapter per kind of source. A driver projects its configured sources,
// adds one from a catalog entry, refreshes (model list / health) and removes. Credentials always go through the
// existing stores (ProviderService for keys, UpstreamService for logins, SecretService for engine keys) — drivers
// never keep a credential of their own. Conversations never see drivers; they keep using providers / upstreams.
import type { Provider } from '../../protocol.js';
import type { EngineStatus } from '../../engines/types.js';
import type { UpstreamStatus } from '../../upstreams/types.js';
import type { CatalogDriverId, CatalogEntry, SourceKind, SourceNeeds, SourceSummary } from '../types.js';

export interface DriverContext {
  providers: Provider[];
  upstream: UpstreamStatus;
  engines: EngineStatus[];
  /** provider id → the catalog entry it was added from */
  links: Record<string, { catalogId: string; keyless?: boolean; engine?: string }>;
  catalog: CatalogEntry[];
}

export interface AddInput { key?: string; name?: string }

export interface ChannelDriver {
  id: CatalogDriverId;
  kind: SourceKind;
  needs: SourceNeeds;
  /** the sources of this driver that are configured now */
  list(ctx: DriverContext): SourceSummary[];
  /** is this source id one of ours? */
  owns(sourceId: string): boolean;
  /** create the source from a catalog entry; resolves to its source id */
  add?(entry: CatalogEntry, input: AddInput): Promise<string>;
  /** pull its model list / check its health (throws the reason when it fails) */
  refresh?(sourceId: string): Promise<void>;
  remove?(sourceId: string): Promise<void>;
  /** engines only */
  install?(): Promise<void>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}
