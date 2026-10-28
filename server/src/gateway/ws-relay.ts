// Responses over a WebSocket (Codex's "responses websockets"; ported in spirit from CLIProxyAPI's
// wsrelay + openai_responses_websocket, MIT). The client opens `GET /v1/responses` (or `/v1/ws`) as a
// WebSocket on the gateway's own port with the gateway key, then sends `response.create` /
// `response.append` text frames; every Responses stream event comes back as one text frame.
//
// Each turn is relayed as an ordinary `POST /v1/responses` (stream) through the gateway itself, so
// routing, failover, translation to any member, keys, limits, budgets, privacy and the ledger all apply
// unchanged. Members are stateless HTTP upstreams, so the socket keeps the conversation: a follow-up
// that names the previous response (or just appends input) is expanded to the full transcript —
// previous input + previous output + new input — exactly like CPA's HTTP fallback. `generate: false`
// (Codex's prewarm) is answered locally without an upstream call.

import crypto from 'node:crypto';
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { SseParser } from './sse.js';
import { openaiError } from './compat/errors.js';
import { tr } from '../i18n/index.js';

export const WS_MAX_PAYLOAD = 32 * 1024 * 1024;

/** What the socket remembers between turns. */
export interface WsTurnState {
  lastRequest?: any;
  lastOutput: any[];
  lastResponseId?: string;
}

export type WsNormalized = { ok: true; body: any; prewarm: boolean } | { ok: false; status: number; message: string };

const omit = (o: any, ...keys: string[]) => { const c = { ...o }; for (const k of keys) delete c[k]; return c; };

/** A follow-up that carries its own transcript (calls / assistant turns) replaces the remembered one. */
function replacesTranscript(msg: any): boolean {
  if (typeof msg.previous_response_id === 'string' && msg.previous_response_id.trim()) return false;
  return (msg.input as any[]).some((it) => it?.type === 'function_call' || it?.type === 'custom_tool_call' || (it?.type === 'message' && it?.role === 'assistant'));
}

function carryFrom(last: any, body: any): any {
  if (body.model === undefined && last?.model !== undefined) body.model = last.model;
  if (body.instructions === undefined && last?.instructions !== undefined) body.instructions = last.instructions;
  return body;
}

/** One client frame → the HTTP Responses request to relay (pure; the state is updated by the caller). */
export function normalizeWsRequest(msg: any, state: WsTurnState): WsNormalized {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { ok: false, status: 400, message: tr('WebSocket 消息不是 JSON 对象') };
  const type = String(msg.type ?? '').trim();
  if (type !== 'response.create' && type !== 'response.append') return { ok: false, status: 400, message: tr('不支持的 WebSocket 请求类型：{type}', { type: type || '-' }) };
  if (msg.input !== undefined && !Array.isArray(msg.input)) return { ok: false, status: 400, message: tr('WebSocket 请求的 input 必须是数组') };
  const prewarm = type === 'response.create' && msg.generate === false;
  if (type === 'response.create' && !state.lastRequest) {
    const body = { ...omit(msg, 'type', 'generate'), stream: true, input: msg.input ?? [] };
    if (typeof body.model !== 'string' || !body.model.trim()) return { ok: false, status: 400, message: tr('response.create 缺少 model') };
    return { ok: true, body, prewarm };
  }
  if (!state.lastRequest) return { ok: false, status: 400, message: tr('先发 response.create，再发 response.append') };
  if (!Array.isArray(msg.input)) return { ok: false, status: 400, message: tr('WebSocket 请求的 input 必须是数组') };
  if (replacesTranscript(msg)) {
    return { ok: true, body: carryFrom(state.lastRequest, { ...omit(msg, 'type', 'generate', 'previous_response_id'), stream: true }), prewarm };
  }
  // incremental: the member is stateless, so the whole conversation goes again
  const prevInput = Array.isArray(state.lastRequest.input) ? state.lastRequest.input : [];
  const output = state.lastOutput.filter((it) => it && typeof it === 'object');
  const base = type === 'response.append' ? omit(state.lastRequest, 'previous_response_id') : {};
  const body = carryFrom(state.lastRequest, { ...base, ...omit(msg, 'type', 'generate', 'previous_response_id'), stream: true, input: [...prevInput, ...output, ...msg.input] });
  return { ok: true, body, prewarm };
}

/** Codex's prewarm: a created + completed pair with no output, never sent upstream. */
export function prewarmEvents(model: string | undefined): any[] {
  const id = `resp_prewarm_${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const base = { id, object: 'response', created_at: created, background: false, error: null, output: [], ...(model ? { model } : {}) };
  return [
    { type: 'response.created', sequence_number: 0, response: { ...base, status: 'in_progress' } },
    {
      type: 'response.completed', sequence_number: 1,
      response: { ...base, status: 'completed', usage: { input_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens: 0, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 0 } },
    },
  ];
}

/** The error frame a Responses websocket client reads. */
export function wsErrorFrame(status: number, message: string): any {
  return { type: 'error', status, error: openaiError(status, message).error };
}

export interface WsForward {
  /** relay one Responses request (stream) through the gateway; resolves to the HTTP answer */
  (body: any, signal: AbortSignal): Promise<Response>;
}

/** One socket: frames in order, one turn at a time. */
export class ResponsesWsConnection {
  readonly state: WsTurnState = { lastOutput: [] };
  private chain: Promise<void> = Promise.resolve();
  private ac = new AbortController();

  constructor(private ws: Pick<WebSocket, 'send' | 'readyState' | 'close'> & { on: WebSocket['on'] }, private forward: WsForward) {
    ws.on('message', (data: RawData, isBinary: boolean) => {
      const text = isBinary ? null : Buffer.isBuffer(data) ? data.toString('utf8') : Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
      this.chain = this.chain.then(() => this.turn(text)).catch((e) => console.error('[gateway ws]', e));
    });
    ws.on('close', () => this.ac.abort());
    ws.on('error', () => this.ac.abort());
  }

  /** Resolves when every frame received so far has been answered (tests). */
  idle(): Promise<void> { return this.chain; }

  private send(obj: any) {
    if (this.ws.readyState === 1 /* OPEN */) this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  private async turn(text: string | null) {
    if (this.ac.signal.aborted) return;
    if (text === null) return this.send(wsErrorFrame(400, tr('WebSocket 只接受文本消息')));
    let msg: any;
    try { msg = JSON.parse(text); } catch { return this.send(wsErrorFrame(400, tr('WebSocket 消息不是 JSON 对象'))); }
    const n = normalizeWsRequest(msg, this.state);
    if (!n.ok) return this.send(wsErrorFrame(n.status, n.message));
    if (n.prewarm) {
      const evs = prewarmEvents(n.body.model);
      for (const e of evs) this.send(e);
      this.state.lastRequest = n.body;
      this.state.lastOutput = [];
      this.state.lastResponseId = evs[0].response.id;
      return;
    }
    let res: Response;
    try { res = await this.forward(n.body, this.ac.signal); } catch (e: any) {
      if (!this.ac.signal.aborted) this.send(wsErrorFrame(502, e?.message ?? String(e)));
      return;
    }
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '');
      let message = t.slice(0, 2000) || `HTTP ${res.status}`;
      try { const j = JSON.parse(t); message = j?.error?.message ?? j?.message ?? message; } catch { /* plain text */ }
      return this.send(wsErrorFrame(res.status || 502, message));
    }
    const output: any[] = [];
    let completed: any = null;
    const sse = new SseParser();
    const dec = new StringDecoder('utf8');
    const onEvent = (data: string) => {
      if (!data || data === '[DONE]') return;
      let j: any;
      try { j = JSON.parse(data); } catch { return; }
      if (j?.type === 'response.output_item.done' && j.item) output[typeof j.output_index === 'number' ? j.output_index : output.length] = j.item;
      if ((j?.type === 'response.completed' || j?.type === 'response.done' || j?.type === 'response.incomplete') && j.response) completed = j.response;
      this.send(data);
    };
    try {
      for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
        if (this.ac.signal.aborted) return;
        for (const e of sse.feed(dec.write(Buffer.from(chunk)))) onEvent(e.data);
      }
      for (const e of sse.feed(dec.end())) onEvent(e.data);
      for (const e of sse.end()) onEvent(e.data);
    } catch (e: any) {
      if (!this.ac.signal.aborted) this.send(wsErrorFrame(502, e?.message ?? String(e)));
      return;
    }
    // the next incremental turn replays this one
    this.state.lastRequest = n.body;
    this.state.lastOutput = Array.isArray(completed?.output) && completed.output.length ? completed.output : output.filter(Boolean);
    this.state.lastResponseId = typeof completed?.id === 'string' ? completed.id : undefined;
  }
}

/** Accepts upgraded sockets (authorization is the caller's: it ran before `upgrade`). */
export class ResponsesWsRelay {
  private wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });
  private live = new Set<WebSocket>();

  upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, forward: WsForward): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.live.add(ws);
      ws.on('close', () => this.live.delete(ws));
      new ResponsesWsConnection(ws, forward);
    });
  }

  get connections() { return this.live.size; }

  close(): void {
    for (const ws of this.live) ws.close(1001);
    this.live.clear();
  }
}

/** Refuse an upgrade with a plain HTTP answer (the socket never became a WebSocket). */
export function rejectUpgrade(socket: Duplex, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  const reason = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : status === 503 ? 'Service Unavailable' : 'Bad Request';
  try {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(text)}\r\nconnection: close\r\n\r\n${text}`);
  } catch { /* already gone */ }
  socket.destroy();
}
