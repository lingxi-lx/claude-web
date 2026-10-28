// Error envelopes of the three client protocols. Every compatibility refusal / failure goes through
// `errorEnvelope`, so the same status reads naturally to each SDK: OpenAI's `{ error }`, Anthropic's
// `{ type: 'error', error }`, Gemini's `{ error: { code, message, status } }`.

export type CompatProtocol = 'openai' | 'anthropic' | 'gemini';
/** `responses` shares OpenAI's envelope (same SDK family). */
export type ErrorProtocol = CompatProtocol | 'responses';

export type ErrorCode = string | number | null;

export interface OpenAIErrorOptions {
  /** override the type derived from the status */
  type?: string;
  /** override the derived code (defaults to the HTTP status) */
  code?: ErrorCode;
  param?: string | null;
}

export interface OpenAIErrorBody {
  error: { message: string; type: string; param: string | null; code: string | number | null };
}

export interface AnthropicErrorBody {
  type: 'error';
  error: { type: string; message: string };
}

export interface GeminiErrorBody {
  error: { code: number; message: string; status: string };
}

function openaiType(status: number): string {
  if (status === 401) return 'authentication_error';
  if (status === 403) return 'permission_error';
  if (status === 404) return 'not_found_error';
  if (status === 429) return 'rate_limit_error';
  if (status >= 500) return 'server_error';
  return 'invalid_request_error';
}

function anthropicType(status: number): string {
  if (status === 400) return 'invalid_request_error';
  if (status === 401) return 'authentication_error';
  if (status === 403) return 'permission_error';
  if (status === 404) return 'not_found_error';
  if (status === 413) return 'request_too_large';
  if (status === 429) return 'rate_limit_error';
  if (status === 529) return 'overloaded_error';
  return 'api_error';
}

function geminiStatus(status: number): string {
  if (status === 400) return 'INVALID_ARGUMENT';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'ABORTED';
  if (status === 429) return 'RESOURCE_EXHAUSTED';
  if (status === 499) return 'CANCELLED';
  if (status === 501) return 'UNIMPLEMENTED';
  if (status === 503 || status === 529) return 'UNAVAILABLE';
  if (status === 504) return 'DEADLINE_EXCEEDED';
  if (status < 500) return 'INVALID_ARGUMENT';
  return 'INTERNAL';
}

/** OpenAI Chat / Responses error: `{ error: { message, type, param, code } }`. */
export function openaiError(status: number, message: string, opts: OpenAIErrorOptions = {}): OpenAIErrorBody {
  return {
    error: {
      message,
      type: opts.type ?? openaiType(status),
      param: opts.param ?? null,
      code: opts.code === undefined ? status : opts.code,
    },
  };
}

/** Anthropic Messages error: `{ type: 'error', error: { type, message } }`. */
export function anthropicError(status: number, message: string): AnthropicErrorBody {
  return { type: 'error', error: { type: anthropicType(status), message } };
}

/** Gemini error: `{ error: { code, message, status } }`. */
export function geminiError(status: number, message: string): GeminiErrorBody {
  return { error: { code: status, message, status: geminiStatus(status) } };
}

/** The envelope of the protocol the client speaks (Responses uses OpenAI's shape). */
export function errorEnvelope(protocol: ErrorProtocol, status: number, message: string): OpenAIErrorBody | AnthropicErrorBody | GeminiErrorBody {
  if (protocol === 'anthropic') return anthropicError(status, message);
  if (protocol === 'gemini') return geminiError(status, message);
  return openaiError(status, message);
}
