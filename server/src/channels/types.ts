export type SourceCategory = 'free' | 'subscription' | 'api' | 'local-engine';
export type SourceHealth = 'ready' | 'attention' | 'disabled' | 'unconfigured';
export type SourceKind = 'provider' | 'claude-account' | 'gemini-web' | 'workbuddy';

export interface SourceModel {
  id: string;
  name: string;
  contextWindow?: number;
  capabilities: { tools?: boolean; images?: boolean; reasoning?: boolean };
  free: boolean;
  mayTrain?: boolean;
}

export interface SourceSummary {
  id: string;
  kind: SourceKind;
  name: string;
  category: SourceCategory;
  health: SourceHealth;
  detail?: string;
  models: SourceModel[];
  accountCount?: number;
  healthyAccountCount?: number;
  providerId?: string;
  upstreamKind?: 'claude' | 'gemini' | 'workbuddy';
  engine?: { installed: boolean; running: boolean; version?: string };
  actions: { canAddAccount: boolean; canEditProvider: boolean; canManageEngine: boolean };
}

export interface ChannelStatus { sources: SourceSummary[]; warnings: string[] }
export type ChannelRequest = { kind: 'channels.status' } | { kind: 'channels.refresh'; id: string };
