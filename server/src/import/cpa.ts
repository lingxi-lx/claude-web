// P8 导入: CLIProxyAPI (CPA) config.yaml + its auths/*.json files.
//
// CPA v8 keeps upstream groups under `api-keys.<kind>` (each group = one base URL, models and a `keys` list);
// older files keep `<kind>-api-key` arrays and a top-level `auth-dir`. OAuth accounts are one JSON file per
// account under `auths/` (or `oauth.auth-dir`). We parse both layouts, tolerate missing files, and never write a
// key or token into a message: errors and warnings name the file, never its contents. Callers that show or log the
// result must use `redactCpa`.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseConfig } from '../agent-config/edit.js';
import { tr } from '../i18n/index.js';

export type CpaProtocol = 'openai' | 'anthropic' | 'gemini' | 'vertex';

export interface CpaProviderGroup {
  /** stable id made from the section + group name / position */
  id: string;
  name: string;
  protocol: CpaProtocol;
  /** '' for a group that only names keys (e.g. Vertex Application Default Credentials) */
  baseUrl: string;
  /** server-side only — never send as-is */
  apiKeys: string[];
  keyCount: number;
  /** alias of keyCount, for callers that speak of the group's API keys */
  apiKeyCount: number;
  models: string[];
  excludedModels: string[];
}

export interface CpaAuth {
  /** file name only, never its full path */
  file: string;
  /** provider kind from the file's `type` (falling back to the file-name prefix) */
  kind: string;
  /** alias of kind, matching the field name CPA uses */
  type: string;
  email: string;
  accountId: string;
  projectId: string;
  /** the provider's own expiry string, as written */
  expired: string;
  disabled: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasApiKey: boolean;
  /** server-side import data, omitted by redactCpa() */
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
}

export interface CpaImport {
  port?: number;
  /** absolute path the accounts were read from (after ~ / relative expansion) */
  authDir: string;
  /** client keys in `access.api-keys` (or the legacy top-level list); values are never kept */
  clientKeyCount: number;
  /** alias of clientKeyCount */
  apiKeyCount: number;
  providers: CpaProviderGroup[];
  auths: CpaAuth[];
  warnings: string[];
}

export interface CpaAuthInput { file: string; text: string }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

function kindProtocol(kind: string): CpaProtocol {
  const k = kind.toLowerCase();
  if (k === 'claude' || k === 'anthropic') return 'anthropic';
  if (k === 'gemini' || k === 'gemini-cli') return 'gemini';
  if (k === 'vertex' || k === 'vertex-ai') return 'vertex';
  return 'openai';
}

const KIND_NAMES: Record<string, string> = {
  claude: 'Claude', anthropic: 'Anthropic', gemini: 'Gemini', codex: 'Codex', xai: 'xAI',
  vertex: 'Vertex', 'openai-compatibility': 'OpenAI-compatible', 'gemini-cli': 'Gemini CLI',
  openrouter: 'OpenRouter', meta: 'Meta', qwen: 'Qwen', kimi: 'Kimi', iflow: 'iFlow',
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function apiKeysOf(group: Record<string, any>): string[] {
  const out: string[] = [];
  const add = (v: unknown) => { const k = str(v); if (k && !out.includes(k)) out.push(k); };
  add(group['api-key']);
  add(group.apiKey);
  add(group['api_key']);
  for (const raw of arr(group.keys)) {
    if (typeof raw === 'string') add(raw);
    else { const k = rec(raw); add(k['api-key'] ?? k.apiKey ?? k.key); }
  }
  return out;
}

function modelsOf(v: unknown): string[] {
  return arr(v).map((m) => (typeof m === 'string' ? m.trim() : str(rec(m).id) || str(rec(m).name))).filter(Boolean);
}

/** Parse the YAML text; provider groups from the v8 and legacy layouts are both collected. */
export function parseCpaConfig(text: string): CpaImport {
  let raw: unknown;
  try { raw = parseYaml(text); } catch (e: any) {
    // yaml's message can quote source lines (and those may hold keys): only pass the position along
    const line = e?.linePos?.[0]?.line;
    throw new Error(line ? tr('CPA 的 config.yaml 无法解析（第 {line} 行）', { line }) : tr('CPA 的 config.yaml 无法解析'));
  }
  const conf = rec(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(tr('CPA 的 config.yaml 顶层不是对象'));

  const server = rec(conf.server);
  const portRaw = server.port ?? conf.port;
  const port = typeof portRaw === 'number' && Number.isFinite(portRaw) ? portRaw : typeof portRaw === 'string' && /^\d+$/.test(portRaw) ? Number(portRaw) : undefined;

  const oauth = rec(conf.oauth);
  const authDir = str(oauth['auth-dir']) || str(conf['auth-dir']) || '~/.cli-proxy-api';

  const access = rec(conf.access);
  let clientKeyCount = arr(access['api-keys']).filter((k) => typeof k === 'string' && k.trim()).length;

  const providers: CpaProviderGroup[] = [];
  const seen = new Set<string>();
  const addGroup = (section: string, rawGroup: unknown, index: number) => {
    const group = rec(rawGroup);
    const keys = apiKeysOf(group);
    const baseUrl = str(group['base-url']) || str(group.baseUrl) || str(group.base_url);
    const name = str(group.name) || `${KIND_NAMES[section] ?? section}${index >= 0 ? ` #${index + 1}` : ''}`;
    let id = `${section}:${slug(name) || index + 1}`;
    for (let n = 2; seen.has(id); n++) id = `${section}:${slug(name) || index + 1}-${n}`;
    seen.add(id);
    providers.push({
      id, name, protocol: kindProtocol(section), baseUrl, apiKeys: keys, keyCount: keys.length, apiKeyCount: keys.length,
      models: modelsOf(group.models), excludedModels: modelsOf(group['excluded-models'] ?? group.excludedModels),
    });
  };
  const addGroups = (section: string, groups: unknown) => {
    arr(groups).forEach((g, i) => addGroup(section, g, i));
  };

  const topApi = conf['api-keys'];
  if (Array.isArray(topApi)) {
    // legacy: a plain list of client keys; or (rare) a list of provider groups
    if (topApi.every((x) => typeof x === 'string')) clientKeyCount = topApi.filter((x) => typeof x === 'string' && x.trim()).length;
    else topApi.forEach((g, i) => addGroup(str(rec(g).name) || 'custom', g, i));
  } else if (topApi && typeof topApi === 'object') {
    for (const [kind, groups] of Object.entries(rec(topApi))) addGroups(kind, groups);
  }

  // Legacy top-level provider arrays: gemini-api-key, codex-api-key, claude-api-key, vertex-api-key, xai-api-key…
  for (const [key, value] of Object.entries(conf)) {
    if (!/-api-key$/i.test(key) || key === 'api-keys') continue;
    addGroups(key.replace(/-api-key$/i, ''), value);
  }
  // A bare openai-compatibility list may sit at the top level in old files.
  if (!('api-keys' in conf) && Array.isArray(conf['openai-compatibility'])) addGroups('openai-compatibility', conf['openai-compatibility']);

  return { ...(port !== undefined ? { port } : {}), authDir, clientKeyCount, apiKeyCount: clientKeyCount, providers, auths: [], warnings: [] };
}

function basename(file: string): string {
  return path.basename(file).replace(/[\\/]+$/, '');
}

function authKind(name: string, v: Record<string, any>): string {
  return str(v.type) || str(v.provider) || basename(name).replace(/\.json$/i, '').split(/[-_.]/)[0] || 'unknown';
}

/** One auth file → metadata (plus the tokens, server-side). Bad JSON is skipped with a file-name-only warning. */
function parseAuthFile(input: CpaAuthInput): { auth?: CpaAuth; warning?: string } {
  const file = basename(input.file);
  let doc: Record<string, unknown>;
  try {
    doc = parseConfig(input.text, 'json');
  } catch {
    return { warning: tr('{file} 不是有效的 JSON，已跳过', { file }) };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { warning: tr('{file} 不是对象，已跳过', { file }) };
  const v = doc as Record<string, any>;
  const token = rec(v.token_data);
  const accessToken = str(v.access_token) || str(token.access_token);
  const refreshToken = str(v.refresh_token) || str(token.refresh_token);
  const apiKey = str(v.api_key) || str(v.apiKey) || str(token.api_key);
  const kind = authKind(file, v);
  return {
    auth: {
      file,
      kind,
      type: kind,
      email: str(v.email) || str(token.email),
      accountId: str(v.account_id) || str(v.accountId) || str(token.account_id),
      projectId: str(v.project_id) || str(v.projectId) || str(token.project_id),
      expired: str(v.expired) || str(v.expires_at) || str(token.expired),
      disabled: v.disabled === true || v.enabled === false || v.off === true,
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      hasApiKey: !!apiKey,
      ...(accessToken ? { accessToken } : {}),
      ...(refreshToken ? { refreshToken } : {}),
      ...(apiKey ? { apiKey } : {}),
    },
  };
}

export function parseCpaAuthFiles(files: CpaAuthInput[]): { auths: CpaAuth[]; warnings: string[] } {
  const auths: CpaAuth[] = [];
  const warnings: string[] = [];
  for (const input of files) {
    const r = parseAuthFile(input);
    if (r.auth) auths.push(r.auth);
    if (r.warning) warnings.push(r.warning);
  }
  return { auths, warnings };
}

/** Parse config text plus already-read auth files. */
export function parseCpa(configText: string, authFiles: CpaAuthInput[] = []): CpaImport {
  const conf = parseCpaConfig(configText);
  const { auths, warnings } = parseCpaAuthFiles(authFiles);
  return { ...conf, auths, warnings };
}

function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

/** Absolute auth directory: explicit option first, else the config's auth-dir, else ~/.cli-proxy-api. */
export function cpaAuthDir(config: Pick<CpaImport, 'authDir'>, configFile: string, home = os.homedir()): string {
  const raw = expandHome(config.authDir || '~/.cli-proxy-api', home);
  return path.isAbsolute(raw) ? raw : path.resolve(path.dirname(configFile), raw);
}

async function readAuthInputs(dir: string): Promise<CpaAuthInput[]> {
  const out: CpaAuthInput[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile() || !/\.json$/i.test(e.name)) continue;
    try { out.push({ file: e.name, text: await fs.readFile(path.join(dir, e.name), 'utf8') }); } catch { /* unreadable: skip it */ }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Read `<root>/config.yaml` (or a config file path) and the auth JSON files from its auth dir. */
export async function readCpa(root: string, opts: { home?: string; authDir?: string } = {}): Promise<CpaImport> {
  const home = opts.home ?? os.homedir();
  let file = root;
  try { if ((await fs.stat(root)).isDirectory()) file = path.join(root, 'config.yaml'); } catch { /* readFile will report it */ }
  let text: string;
  try { text = await fs.readFile(file, 'utf8'); } catch (e: any) {
    if (e?.code === 'ENOENT') throw new Error(tr('找不到 CPA 的 config.yaml：{file}', { file }));
    throw e;
  }
  const conf = parseCpaConfig(text);
  const dir = opts.authDir ? cpaAuthDir({ authDir: opts.authDir }, file, home) : cpaAuthDir(conf, file, home);
  const { auths, warnings } = parseCpaAuthFiles(await readAuthInputs(dir));
  return { ...conf, authDir: dir, auths, warnings };
}

/** Drop every API key and OAuth token — safe for a UI payload or a log line. */
export function redactCpa(c: CpaImport): CpaImport {
  return {
    ...c,
    providers: c.providers.map((p) => ({ ...p, apiKeys: [] })),
    auths: c.auths.map((a) => {
      const { accessToken, refreshToken, apiKey, ...rest } = a;
      return rest;
    }),
  };
}

// names other callers may expect
export const parseCpaConfigYaml = parseCpaConfig;
export const parseCpaFile = readCpa;
