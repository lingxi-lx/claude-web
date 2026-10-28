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
  /** the build ships inside the desktop installer (vendor/engines): nothing is downloaded on first use */
  bundled?: boolean;
  /** how the installed build was checked: the release's own SHA-256, or a hash we recorded at first install */
  verified?: 'release' | 'recorded';
  /** SHA-256 of the installed build (the release's, or the one recorded when the user confirmed an unverified build) */
  sha256?: string;
  /**
   * Only in an install / upgrade answer: the release publishes no SHA-256, so nothing was installed. The UI shows
   * the downloaded file's hash and, if the user agrees, sends engines.install again with `allowUnverified` (and
   * this `sha256`, so a different file is not installed under that consent).
   */
  confirm?: { version: string; asset: string; sha256: string };
  port?: number;
  /** Magpie's own web/management page, when we started it with `--web` (provider sign-in lives there) */
  webPort?: number;
  health: 'stopped' | 'starting' | 'ok' | 'error';
  detail?: string;
  /** running on its default port, not connected yet */
  detected?: { port: number; version?: string };
  providerId?: string;
  warnings: string[];
}

/** One subscription the engine can sign in to (its own account store, not claude-web's). */
export interface EngineLoginProvider {
  engine: EngineId;
  /** the id the engine's sign-in endpoint takes (Magpie: qoder / trae-cn / mimo-app …; CPA: anthropic / xai …) */
  provider: string;
  /** the provider id the hub's catalog uses (qoder / trae / mimo …) */
  catalogId: string;
  name: string;
  /** browser, device code, or a local client's existing sign-in */
  method: 'browser' | 'device' | 'local';
  /** why it cannot be offered (an unknown engine version, a plugin that is not installed …) */
  reason?: string;
}

export type EngineLoginState = 'pending' | 'done' | 'error' | 'cancelled';

export interface EngineLoginSession {
  id: string;
  engine: EngineId;
  provider: string;
  catalogId: string;
  state: EngineLoginState;
  /** browser page to open (OAuth or device verification) */
  url?: string;
  /** device-code user code */
  userCode?: string;
  message?: string;
  /** the engine's own id for this sign-in (status/cancel use it internally) */
  at?: number;
}

/** A file (Sub2API / CLIProxyAPI / Codex / Claude export) imported into the engine's account store. */
export interface EngineLoginImportResult {
  imported: number;
  results: { status?: string; error?: string; user?: string }[];
}

/** What a long engine action is doing now (the wizard / source card shows it in words). */
export type EngineStep = 'release' | 'download' | 'verify' | 'unpack' | 'start' | 'connect';

/** engines.* pushes: a step began, the state changed (step absent), or it stopped by itself (crash = why). */
export type EngineEvent = { kind: 'engines.changed'; id: EngineId; step?: EngineStep; crash?: string };

export type EngineRequest =
  | { kind: 'engines.status' }
  /**
   * download + verify (version = a release tag; absent = latest). A release without a published SHA-256 installs
   * only with allowUnverified (the user confirmed; sha256 = the hash they were shown, which must still match).
   */
  | { kind: 'engines.install'; id: EngineId; version?: string; allowUnverified?: boolean; sha256?: string }
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
  | { kind: 'engines.logs'; id: EngineId; lines?: number }
  /** subscriptions each engine can sign in to (Magpie's plugin list / CLIProxyAPI's management endpoints) */
  | { kind: 'engines.login.providers' }
  /** open a vendor sign-in in the engine; the engine keeps the account, its gateway serves the models */
  | { kind: 'engines.login.begin'; id: EngineId; provider: string }
  | { kind: 'engines.login.status'; id: EngineId; loginId: string }
  | { kind: 'engines.login.cancel'; id: EngineId; loginId: string }
  /** import an export file's text (Sub2API, CLIProxyAPI, Codex / Claude auth.json) into Magpie's accounts */
  | { kind: 'engines.login.import'; id: EngineId; provider: string; text: string };
