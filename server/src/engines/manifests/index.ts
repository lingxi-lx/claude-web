// What we know about each engine, from research_notes/可反代的模型上游调研 (cliproxyapi.md, magpie.md and their _raw/
// copies of the official docs). Asset names of the releases are not in the notes, so the build is picked from the
// GitHub releases API by OS / CPU words in the file name, not from a hard-coded URL.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EngineId } from '../types.js';

export interface EngineContext { port: number; dir: string; clientKey: string; managementKey: string }

export interface EngineManifest {
  id: EngineId;
  name: string;
  /** owner/repo whose GitHub releases carry the builds */
  repo: string;
  /** a release tag to install instead of the latest (none pinned yet: the notes give no tested tag) */
  pin?: string;
  /** the executable's name inside the asset (without .exe) */
  entry: string;
  /** where an already-running copy listens by default */
  defaultPort: number;
  /** prefer assets whose name matches this (e.g. a terminal-only build over the desktop app) */
  prefer?: RegExp;
  /** the provider's base URL for a gateway on this port (Anthropic format, no /v1) */
  baseUrl(port: number): string;
  /** a fixed client key when the engine accepts any key on loopback; else one is generated */
  fixedClientKey?: string;
  /** it needs a management key of its own (generated, kept encrypted) */
  managementKey: boolean;
  args(ctx: EngineContext): string[];
  /** secrets go here, never into argv */
  env(ctx: EngineContext): Record<string, string>;
  prepare?(ctx: EngineContext): Promise<void>;
  /** is our started copy answering? */
  health(ctx: { port: number; clientKey: string }): Promise<boolean>;
  /** is something of this kind answering on this port (detection of a copy the user runs)? */
  detect(port: number): Promise<{ version?: string } | null>;
  /** known caveats shown with the engine */
  warnings: string[];
}

const get = async (url: string, headers: Record<string, string> = {}, ms = 1500) =>
  fetch(url, { headers, signal: AbortSignal.timeout(ms) });

const yamlStr = (s: string) => JSON.stringify(s);

/**
 * CLIProxyAPI (router-for-me/CLIProxyAPI): `cli-proxy-api --config <file>`; v8 config layout — `server.host/port`,
 * `management.secret-key` (hashed at start) with `allow-remote: false`, `access.api-keys` (the client keys; NOT the
 * top-level `api-keys`, which are upstream keys), `oauth.auth-dir`. Default port 8317. Logins (`--login`,
 * `--codex-login`, …) are run by the user against the same config.
 */
const cliproxyapi: EngineManifest = {
  id: 'cliproxyapi',
  name: 'CLIProxyAPI',
  repo: 'router-for-me/CLIProxyAPI',
  entry: 'cli-proxy-api',
  defaultPort: 8317,
  baseUrl: (port) => `http://127.0.0.1:${port}`,
  managementKey: true,
  args: (ctx) => ['--config', path.join(ctx.dir, 'config.yaml')],
  env: () => ({}),
  async prepare(ctx) {
    const authDir = path.join(ctx.dir, 'auths');
    await fs.mkdir(authDir, { recursive: true });
    const yaml = [
      '# written by claude-web; edits to these keys are replaced at the next start',
      'server:',
      '  host: "127.0.0.1"',
      `  port: ${ctx.port}`,
      'management:',
      `  secret-key: ${yamlStr(ctx.managementKey)}`,
      '  allow-remote: false',
      'access:',
      '  api-keys:',
      `    - ${yamlStr(ctx.clientKey)}`,
      'oauth:',
      `  auth-dir: ${yamlStr(authDir)}`,
      '',
    ].join('\n');
    await fs.writeFile(path.join(ctx.dir, 'config.yaml'), yaml, { mode: 0o600 });
  },
  async health({ port, clientKey }) {
    const r = await get(`http://127.0.0.1:${port}/v1/models`, { authorization: `Bearer ${clientKey}` });
    return r.ok;
  },
  async detect(port) {
    // without its client key the list answers 401; any HTTP answer with JSON from /v1/models is taken as "something
    // OpenAI-shaped is here" — the user confirms by connecting with the key
    try {
      const r = await get(`http://127.0.0.1:${port}/v1/models`);
      if (r.status !== 200 && r.status !== 401 && r.status !== 403) return null;
      const t = await r.text();
      return t.trim().startsWith('{') ? {} : null;
    } catch {
      return null;
    }
  },
  warnings: [],
};

/**
 * Magpie (builds on yetone/magpie-releases): `magpie serve` runs the gateway alone; `MAGPIE_ADDR` sets the address
 * (default 127.0.0.1:3425); `GET /api/hello` → {"name":"magpie","version":…}; on loopback any key is accepted (the
 * notes suggest `magpie-claudeweb` so its usage pages tell our calls apart). Anthropic base without /v1.
 */
const magpie: EngineManifest = {
  id: 'magpie',
  name: 'Magpie',
  repo: 'yetone/magpie-releases',
  entry: 'magpie',
  defaultPort: 3425,
  // the terminal build (`make cli`: no cgo, no webview) when the release has one
  prefer: /cli/i,
  baseUrl: (port) => `http://127.0.0.1:${port}`,
  fixedClientKey: 'magpie-claudeweb',
  managementKey: false,
  args: () => ['serve'],
  env: (ctx) => ({ MAGPIE_ADDR: `127.0.0.1:${ctx.port}` }),
  async health({ port }) {
    return !!(await magpie.detect(port));
  },
  async detect(port) {
    try {
      const r = await get(`http://127.0.0.1:${port}/api/hello`);
      if (!r.ok) return null;
      const j = await r.json() as { name?: string; version?: string };
      return j?.name === 'magpie' ? { ...(j.version ? { version: String(j.version) } : {}) } : null;
    } catch {
      return null;
    }
  },
  // magpie keeps itself current in the background (`magpie update`); the version we installed can drift
  warnings: ['self-update'],
};

export const MANIFESTS: Record<EngineId, EngineManifest> = { cliproxyapi, magpie };
