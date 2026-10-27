// Wire types of sync.* (pure: the web client imports them through @shared).

export type SyncCollection = 'provider' | 'account' | 'gatewayGroup' | 'keyGroup' | 'setting';
export interface SyncPlanItem {
  /** `<collection>:<id>`; what the preview sends back to skip an item */
  key: string;
  collection: SyncCollection;
  id: string;
  name: string;
  action: 'add' | 'update' | 'same' | 'conflict' | 'skip';
  /** fields that change (update) */
  fields?: string[];
  /** with a credential from the encrypted part */
  withSecret?: boolean;
  note?: string;
}

export type SyncRequest =
  | { kind: 'sync.export'; passphrase?: string }
  | { kind: 'sync.import'; text: string; passphrase?: string }
  | { kind: 'sync.apply'; token: string; skip?: string[] }
  | { kind: 'sync.cancel'; token: string };

export interface SyncExportResult { filename: string; text: string; encrypted: boolean }
export interface SyncPreview { token: string; createdAt: number; from: string; encrypted: boolean; items: SyncPlanItem[] }
export interface SyncApplyResult { applied: number; conflicts: number }

