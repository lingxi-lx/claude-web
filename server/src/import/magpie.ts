// P8 导入: Magpie's providers.json. Magpie stores every upstream as one Provider row:
//   { id, name, key, keys: [{ name, key, off }], chat / responses / anthropic / gemini base URLs,
//     models: [picked ids], noModels, off, preset }
// We read only that file (no Magpie process, no network). Keys stay server-side; `redactMagpie` is what a UI may
// show or log — it drops every key while keeping the counts.
import fs from 'node:fs/promises';
import path from 'node:path';
import * as jsonc from 'jsonc-parser';
import { tr } from '../i18n/index.js';

export interface MagpieKey {
  name: string;
  apiKey: string;
  off: boolean;
}

export interface MagpieEndpoints {
  chat: string;
  responses: string;
  anthropic: string;
  gemini: string;
}

export interface MagpieProvider {
  id: string;
  name: string;
  preset: string;
  off: boolean;
  endpoints: MagpieEndpoints;
  /** every named key, including disabled ones, in Magpie's own shape */
  keys: MagpieKey[];
  /** enabled, non-empty keys (server-side import data — never send as-is) */
  apiKeys: string[];
  /** every named key, including disabled ones */
  keyCount: number;
  models: string[];
  noModels: boolean;
}

export interface MagpieImport {
  providers: MagpieProvider[];
  /** how many routing groups the file carries (not imported yet, only reported) */
  groups: number;
  /** entries that were not objects / had no id or name */
  skipped: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

function endpointsOf(p: Record<string, any>): MagpieEndpoints {
  const chat = str(p.chat) || str(p.baseUrl) || str(p.base_url) || str(p.baseURL);
  return { chat, responses: str(p.responses), anthropic: str(p.anthropic), gemini: str(p.gemini) };
}

function keysOf(p: Record<string, any>): MagpieKey[] {
  const out: MagpieKey[] = [];
  const seen = new Set<string>();
  const add = (key: unknown, name: unknown, off: unknown) => {
    const k = str(key);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ apiKey: k, name: str(name), off: off === true });
  };
  add(p.key, p.keyName, false);
  for (const raw of arr(p.keys)) {
    if (typeof raw === 'string') add(raw, '', false);
    else { const k = rec(raw); add(k.key, k.name, k.off); }
  }
  return out;
}

function providerOf(v: unknown): MagpieProvider | null {
  const p = rec(v);
  const id = str(p.id);
  const name = str(p.name) || id;
  if (!id && !name) return null;
  const endpoints = endpointsOf(p);
  const keys = keysOf(p);
  const models = arr(p.models).map(str).filter(Boolean);
  return {
    id: id || name,
    name,
    preset: str(p.preset),
    off: p.off === true,
    endpoints,
    keys,
    apiKeys: keys.filter((k) => !k.off).map((k) => k.apiKey),
    keyCount: keys.length,
    models,
    noModels: p.noModels === true,
  };
}

/** Parse the JSON text of a providers.json. Accepts the file's `{providers:[…]}` shape, a bare array, or an id map. */
export function parseMagpieProviders(text: string): MagpieImport {
  const errors: jsonc.ParseError[] = [];
  const doc: unknown = jsonc.parse(text.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    // the parse error names an error code and offset — never quote the file's content (it holds keys)
    throw new Error(tr('Magpie 的 providers.json 无法解析：{message}', { message: `${jsonc.printParseErrorCode(errors[0].error)} @${errors[0].offset}` }));
  }
  let rows: unknown[];
  let groups = 0;
  if (Array.isArray(doc)) rows = doc;
  else {
    const d = rec(doc);
    groups = arr(d.groups).length;
    const entry = (id: string, p: unknown) => ({ id, ...(typeof p === 'string' ? { key: p } : rec(p)) });
    if (Array.isArray(d.providers)) rows = d.providers;
    else if (d.providers && typeof d.providers === 'object') rows = Object.entries(rec(d.providers)).map(([id, p]) => entry(id, p));
    // a single provider object written without the {providers: […]} wrapper
    else if (d.id || d.name) rows = [d];
    else if (Object.keys(d).length && !('groups' in d)) rows = Object.entries(d).map(([id, p]) => entry(id, p));
    else rows = [];
  }
  const providers: MagpieProvider[] = [];
  let skipped = 0;
  for (const row of rows) {
    const p = providerOf(row);
    if (p) providers.push(p); else skipped++;
  }
  return { providers, groups, skipped };
}

/** The endpoint an OpenAI / Anthropic / Gemini client can use for this provider, in Magpie's own preference order. */
export function preferredEndpoint(p: MagpieProvider): { protocol: 'openai' | 'anthropic' | 'gemini'; baseUrl: string } | null {
  if (p.endpoints.anthropic) return { protocol: 'anthropic', baseUrl: p.endpoints.anthropic };
  if (p.endpoints.responses) return { protocol: 'openai', baseUrl: p.endpoints.responses };
  if (p.endpoints.chat) return { protocol: 'openai', baseUrl: p.endpoints.chat };
  if (p.endpoints.gemini) return { protocol: 'gemini', baseUrl: p.endpoints.gemini };
  return null;
}

/** Drop every key so the result is safe to render or log. Key counts stay, values never do. */
export function redactMagpie(m: MagpieImport): MagpieImport {
  return {
    ...m,
    providers: m.providers.map((p) => ({ ...p, keys: [], apiKeys: [], endpoints: { ...p.endpoints } })),
  };
}

/** Read a providers.json (a directory is taken to contain one). ENOENT is an error; a malformed file throws without echoing content. */
export async function readMagpieProviders(file: string): Promise<MagpieImport> {
  let target = file;
  try { if ((await fs.stat(target)).isDirectory()) target = path.join(target, 'providers.json'); } catch { /* let readFile give the error */ }
  let text: string;
  try { text = await fs.readFile(target, 'utf8'); } catch (e: any) {
    if (e?.code === 'ENOENT') throw new Error(tr('找不到 Magpie 的 providers.json：{file}', { file: target }));
    throw e;
  }
  return parseMagpieProviders(text);
}

// names other callers may expect
export const parseProviders = parseMagpieProviders;
export const parseMagpie = parseMagpieProviders;
