// Minimal Server-Sent Events writing for the compatibility endpoints: the stream head, one event,
// and the closing `[DONE]` line OpenAI clients wait for. Formatting comes from the gateway's SSE
// writer so named events / multi-line data stay identical to the rest of the gateway.

import { sse as formatSse } from '../sse.js';

/** The slice of `http.ServerResponse` these helpers need (a fake with the same methods works in tests). */
export interface SseResponse {
  readonly headersSent?: boolean;
  writeHead(status: number, headers?: Record<string, string>): unknown;
  write(chunk: string): unknown;
  end(chunk?: string): unknown;
  flushHeaders?: () => void;
}

export const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

/** Write the 200 + event-stream headers (once; extra headers win over the defaults). */
export function sseHead(res: SseResponse, extra: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(200, { ...SSE_HEADERS, ...extra });
  res.flushHeaders?.();
}

/** Write one SSE event (`event:` prefix when named; objects are JSON-encoded). */
export function sseSend(res: SseResponse, data: unknown, event?: string): void {
  res.write(formatSse(data, event));
}

/**
 * Send a final payload and end the stream. OpenAI uses the `[DONE]` sentinel; protocols that just
 * close (Gemini) pass `null`.
 */
export function sseDone(res: SseResponse, data: unknown = '[DONE]'): void {
  if (data !== null && data !== undefined) sseSend(res, data);
  res.end();
}
