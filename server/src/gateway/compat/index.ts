// Compatibility layer: the paths a CPA / Magpie / OpenAI / Gemini client hits first. `handleCompat`
// is the whole public surface — model catalogs in the client's shape and CORS preflight. The gateway
// (`gateway/service.ts`) calls it before routing a request; authentication and body handling stay
// with the caller, and the chat endpoints themselves are the gateway's own routes.

import type { HeaderBag } from './auth.js';
import { buildGeminiModelList, buildOpenAIModelList, normalizeModels, type CompatModel, type CompatModelInput } from './models.js';

export * from './auth.js';
export * from './errors.js';
export * from './models.js';
export * from './sse.js';

export interface CompatRequest {
  method?: string;
  headers?: HeaderBag;
}

export interface CompatResponse {
  readonly headersSent?: boolean;
  writeHead(status: number, headers?: Record<string, string>): unknown;
  write(chunk: string): unknown;
  end(chunk?: string): unknown;
}

export interface CompatContext {
  /** what the authenticated key may use; a function defers building the list until a catalog request */
  models?: readonly CompatModelInput[] | (() => readonly CompatModelInput[]);
  /** OpenAI list's `created` (epoch seconds); defaults to the current time */
  created?: number;
  /** OpenAI list's `owned_by` fallback */
  ownedBy?: string;
  /** `/v1/models` also carries Anthropic's list fields (one path serves both SDKs) */
  anthropicFields?: boolean;
  /**
   * `access-control-allow-origin` to send: `undefined` → `*`, a string → that origin (plus
   * `vary: origin`), `null` → no CORS headers at all (a surface that does not do CORS).
   */
  corsOrigin?: string | null;
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers':
    'authorization, content-type, x-api-key, x-goog-api-key, anthropic-version, anthropic-beta, openai-beta, x-cw-session',
  'access-control-max-age': '86400',
};

function corsHeaders(ctx: CompatContext): Record<string, string> {
  if (ctx.corsOrigin === null) return {};
  if (ctx.corsOrigin === undefined) return { 'access-control-allow-origin': '*', ...CORS_HEADERS };
  return { 'access-control-allow-origin': ctx.corsOrigin, vary: 'origin', ...CORS_HEADERS };
}

/**
 * `/gateway/<group>/v1/models` and `/v1/models` both become `/v1/models`; anything else is left as
 * it came (so unrelated requests are not claimed).
 */
export function compatiblePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, '') || '/';
  const m = /(?:^|\/)(v1beta|v1)(\/.*)?$/.exec(p);
  return m ? `/${m[1]}${m[2] ?? ''}` : p;
}

const onApiSurface = (path: string): boolean =>
  path === '/v1' || path === '/v1beta' || path.startsWith('/v1/') || path.startsWith('/v1beta/');

function modelsOf(ctx: CompatContext): CompatModel[] {
  return normalizeModels(typeof ctx.models === 'function' ? ctx.models() : ctx.models);
}

function writeJson(res: CompatResponse, status: number, body: unknown, ctx: CompatContext): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { ...corsHeaders(ctx), 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function writeOptions(res: CompatResponse, ctx: CompatContext): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(204, corsHeaders(ctx));
  res.end();
}

/** `OPTIONS` under `/v1` / `/v1beta` (a CORS preflight carries no credentials, so it is answered before auth). */
export function isCompatPreflight(req: CompatRequest, url: URL): boolean {
  return String(req.method ?? '').toUpperCase() === 'OPTIONS' && onApiSurface(compatiblePath(url.pathname));
}

/**
 * Answer one compatibility request; `true` means it was handled and the caller must not route it
 * any further.
 *
 * - `GET /v1/models` → OpenAI list (optionally with Anthropic's fields)
 * - `GET /v1beta/models` → Gemini list
 * - `OPTIONS` under `/v1` / `/v1beta` → CORS preflight
 */
export function handleCompat(req: CompatRequest, res: CompatResponse, url: URL, ctx: CompatContext = {}): boolean {
  const method = String(req.method ?? 'GET').toUpperCase();
  const path = compatiblePath(url.pathname);

  if (method === 'OPTIONS') {
    if (!onApiSurface(path)) return false;
    writeOptions(res, ctx);
    return true;
  }

  if (method === 'GET' && path === '/v1/models') {
    writeJson(res, 200, buildOpenAIModelList(modelsOf(ctx), { created: ctx.created, ownedBy: ctx.ownedBy, anthropic: ctx.anthropicFields }), ctx);
    return true;
  }

  if (method === 'GET' && path === '/v1beta/models') {
    writeJson(res, 200, buildGeminiModelList(modelsOf(ctx)), ctx);
    return true;
  }

  return false;
}
