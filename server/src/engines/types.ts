// 托管程序 (spec 2026-10-26 §3.2): local gateways we download, verify, run on loopback and register as a provider.
// These requests carry no sessionId, so they have no entry in the federation routing table.

export type EngineId = 'cliproxyapi' | 'magpie';

export interface EngineStatus {
  id: EngineId;
  name: string;
  /** GitHub repository the builds come from */
  repo: string;
  /** a build for this OS / CPU is published (unknown until a release is read: true) */
  platform: string;
  installed: boolean;
  running: boolean;
  /** managed = we started it; connected = it was already running on this computer and we only point a provider at it */
  mode?: 'managed' | 'connected';
  version?: string;
  /** the version an upgrade replaced (rollback goes back to it) */
  previousVersion?: string;
  /** how the installed build was checked: the release's own SHA-256, or a hash we recorded at first install */
  verified?: 'release' | 'recorded';
  port?: number;
  health: 'stopped' | 'starting' | 'ok' | 'error';
  detail?: string;
  /** running on its default port, not connected yet */
  detected?: { port: number; version?: string };
  providerId?: string;
  warnings: string[];
}

/** What a long engine action is doing now (the wizard / source card shows it in words). */
export type EngineStep = 'release' | 'download' | 'verify' | 'unpack' | 'start' | 'connect';

/** engines.* pushes: a step began, the state changed (step absent), or it stopped by itself (crash = why). */
export type EngineEvent = { kind: 'engines.changed'; id: EngineId; step?: EngineStep; crash?: string };

export type EngineRequest =
  | { kind: 'engines.status' }
  /** download + verify (version = a release tag; absent = latest) */
  | { kind: 'engines.install'; id: EngineId; version?: string }
  /** install the latest release next to the current one and switch; a failed start rolls back */
  | { kind: 'engines.upgrade'; id: EngineId }
  | { kind: 'engines.rollback'; id: EngineId }
  /** start on 127.0.0.1 (installs first when needed) and register it as an Anthropic-compatible provider */
  | { kind: 'engines.start'; id: EngineId }
  | { kind: 'engines.stop'; id: EngineId }
  /** stop, remove its provider and every installed build */
  | { kind: 'engines.uninstall'; id: EngineId }
  /** use the copy already running on this computer (port: default port; key: its client key when it needs one) */
  | { kind: 'engines.connect'; id: EngineId; port?: number; key?: string }
  | { kind: 'engines.logs'; id: EngineId; lines?: number };
