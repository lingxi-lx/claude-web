// Plugins (spec 2026-10-26 §4.3): two kinds, never mixed.
//  - declarative: a JSON file of data (endpoint, protocol, auth, models, capabilities); never executed.
//  - executable: a folder with plugin.json + an entry file, run in its own Node child process with declared
//    permissions (network hosts, file read paths, secrets), a per-call timeout and output caps.
// The wire types (plugins.* requests) live here too; the child <-> host message protocol is at the bottom.

export type PluginProtocol = 'anthropic' | 'openai' | 'openai-responses' | 'gemini';
export type PluginAuth = 'bearer' | 'x-api-key' | 'both' | 'none';

export interface DeclarativeModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxOutput?: number;
  capabilities?: { tools?: boolean; images?: boolean; reasoning?: boolean; stream?: boolean };
  free?: boolean;
  mayTrain?: boolean;
}

/** One source a declarative file (or an executable plugin's `sources` hook) describes. Data only. */
export interface DeclarativeSource {
  id: string;
  name: string;
  /** https URL; http only for loopback / private hosts */
  endpoint: string;
  protocol: PluginProtocol;
  auth: PluginAuth;
  /** the name of the secret the user fills in (shown as a field; never stored in the file) */
  secretName?: string;
  category?: 'free' | 'subscription' | 'api' | 'local-engine';
  models: DeclarativeModel[];
  docs?: string;
}

export type PluginHook = 'request-before' | 'response-after' | 'source-provider';

export interface PluginPermissions {
  /** host names (exact, or `*.example.com`) the plugin may reach through the host's fetch */
  network?: string[];
  /** paths (relative to the plugin folder, or absolute) it may read; its own folder is always readable */
  fileRead?: string[];
  /** secret names it asks for; each one must be approved by the user */
  secrets?: string[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** entry file relative to the plugin folder (CommonJS) */
  main: string;
  hooks: PluginHook[];
  permissions: PluginPermissions;
  /** per call, ms (default 10 s, capped at 60 s) */
  timeoutMs?: number;
  /** stdout + stderr kept per call, bytes (default 64 KB, capped at 1 MB) */
  maxOutputBytes?: number;
}

export interface PluginView {
  id: string;
  kind: 'declarative' | 'executable';
  name: string;
  version?: string;
  description?: string;
  /** file or folder name under the plugins directory (never an absolute path on the wire) */
  file: string;
  enabled: boolean;
  /** executable: the permissions were approved for this exact manifest */
  approved: boolean;
  hooks: PluginHook[];
  permissions: PluginPermissions;
  /** declarative: how many sources / models it adds */
  sources: number;
  models: number;
  /** 'permission' = Node's permission model limits the child's file access; 'process' = a separate process only */
  isolation?: 'permission' | 'process';
  running?: boolean;
  error?: string;
  /** stderr / stdout of the last call, capped */
  lastOutput?: string;
}

export type PluginRequest =
  | { kind: 'plugins.list' }
  | { kind: 'plugins.enable'; id: string; approve?: boolean }
  | { kind: 'plugins.disable'; id: string }
  | { kind: 'plugins.remove'; id: string }
  | { kind: 'plugins.reload' };

export interface PluginListResult { plugins: PluginView[]; dir: string; warnings: string[] }

// ---- child process protocol (Node IPC channel, JSON messages) ----

export type HostToChild =
  | { t: 'call'; id: number; hook: PluginHook; payload: unknown }
  | { t: 'fetchResult'; id: number; ok: boolean; status?: number; headers?: Record<string, string>; body?: string; error?: string }
  | { t: 'secretResult'; id: number; ok: boolean; value?: string; error?: string };

export type ChildToHost =
  | { t: 'ready'; hooks: string[] }
  | { t: 'result'; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: 'fetch'; id: number; url: string; method?: string; headers?: Record<string, string>; body?: string }
  | { t: 'secret'; id: number; name: string };
