import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocket } from 'ws';
import { MetaStore } from '../meta/store.js';
import { GatewayService } from './service.js';
import { normalizeWsRequest, prewarmEvents, wsErrorFrame, type WsTurnState } from './ws-relay.js';

describe('normalizeWsRequest', () => {
  const fresh = (): WsTurnState => ({ lastOutput: [] });
  it('a first response.create becomes a streaming Responses request', () => {
    const n = normalizeWsRequest({ type: 'response.create', model: 'gpt-5', input: [{ type: 'message', role: 'user', content: 'hi' }] }, fresh());
    expect(n).toMatchObject({ ok: true, prewarm: false, body: { model: 'gpt-5', stream: true } });
    expect((n as any).body.type).toBeUndefined();
  });
  it('refuses unknown types, a non-array input, a missing model and an append before create', () => {
    expect(normalizeWsRequest({ type: 'session.update' }, fresh())).toMatchObject({ ok: false, status: 400 });
    expect(normalizeWsRequest({ type: 'response.create', model: 'm', input: 'x' }, fresh())).toMatchObject({ ok: false });
    expect(normalizeWsRequest({ type: 'response.create', input: [] }, fresh())).toMatchObject({ ok: false });
    expect(normalizeWsRequest({ type: 'response.append', input: [] }, fresh())).toMatchObject({ ok: false });
  });
  it('a follow-up naming the previous response is expanded to the whole transcript', () => {
    const state: WsTurnState = {
      lastRequest: { model: 'gpt-5', instructions: 'be brief', input: [{ type: 'message', role: 'user', content: 'a' }] },
      lastOutput: [{ type: 'function_call', call_id: 'c1', name: 'x', arguments: '{}' }],
      lastResponseId: 'resp_1',
    };
    const n = normalizeWsRequest({ type: 'response.create', previous_response_id: 'resp_1', input: [{ type: 'function_call_output', call_id: 'c1', output: 'ok' }] }, state) as any;
    expect(n.ok).toBe(true);
    expect(n.body.previous_response_id).toBeUndefined();
    expect(n.body.model).toBe('gpt-5');
    expect(n.body.instructions).toBe('be brief');
    expect(n.body.input.map((x: any) => x.type)).toEqual(['message', 'function_call', 'function_call_output']);
  });
  it('a follow-up carrying its own transcript replaces it', () => {
    const state: WsTurnState = { lastRequest: { model: 'gpt-5', input: [{ type: 'message', role: 'user', content: 'old' }] }, lastOutput: [] };
    const input = [{ type: 'message', role: 'user', content: 'a' }, { type: 'message', role: 'assistant', content: 'b' }, { type: 'message', role: 'user', content: 'c' }];
    const n = normalizeWsRequest({ type: 'response.create', input }, state) as any;
    expect(n.body.input).toEqual(input);
    expect(n.body.model).toBe('gpt-5');
  });
  it('prewarm and error frames', () => {
    expect(normalizeWsRequest({ type: 'response.create', model: 'm', generate: false }, fresh())).toMatchObject({ ok: true, prewarm: true });
    const evs = prewarmEvents('m');
    expect(evs.map((e) => e.type)).toEqual(['response.created', 'response.completed']);
    expect(evs[0].response.id).toBe(evs[1].response.id);
    expect(wsErrorFrame(429, 'slow')).toEqual({ type: 'error', status: 429, error: { message: 'slow', type: 'rate_limit_error', param: null, code: 429 } });
  });
});

// ---- through the real gateway: upgrade auth, one turn translated to an Anthropic member, a follow-up

let up: http.Server;
let gwSrv: http.Server;
let gw: GatewayService;
let key: string;
const bodies: any[] = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-gw-ws-'));

beforeAll(async () => {
  up = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      bodies.push(JSON.parse(b));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (o: any) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
      res.end([
        ev({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-x', content: [], usage: { input_tokens: 5, output_tokens: 1 } } }),
        ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
        ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `turn ${bodies.length}` } }),
        ev({ type: 'content_block_stop', index: 0 }),
        ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }),
        ev({ type: 'message_stop' }),
      ].join(''));
    });
  });
  await new Promise<void>((r) => up.listen(0, '127.0.0.1', () => r()));
  const meta = new MetaStore(path.join(dir, 'meta.json'));
  const p = await meta.upsertProvider({ name: 'P-a', type: 'anthropic', baseUrl: `http://127.0.0.1:${(up.address() as any).port}`, apiKey: 'sk-a' });
  p.id = 'a';
  gw = new GatewayService({ meta, member: (id) => meta.provider(id) ?? null, ledger: { record: () => {} }, firstByteMs: 2000, nonStreamMs: 3000 });
  gwSrv = http.createServer((req, res) => { if (!gw.handle(req, res, new URL(req.url ?? '/', 'http://127.0.0.1'))) res.writeHead(418).end(); });
  gwSrv.on('upgrade', (req, socket, head) => { if (!gw.handleUpgrade(req, socket, head, new URL(req.url ?? '/', 'http://127.0.0.1'))) socket.destroy(); });
  await new Promise<void>((r) => gwSrv.listen(0, '127.0.0.1', () => r()));
  gw.port = (gwSrv.address() as any).port;
  await gw.setEnabled(true);
  key = gw.revealKey();
  await gw.upsertGroup({ id: 'main', name: 'Main', strategy: 'failover', members: [{ providerId: 'a', model: 'claude-x' }] });
});
afterAll(async () => {
  await gw.stop().catch(() => {});
  for (const s of [gwSrv, up]) { s.closeAllConnections(); await new Promise((r) => s.close(r)); }
  fs.rmSync(dir, { recursive: true, force: true });
});

function open(p: string, headers: Record<string, string>): Promise<{ ws: WebSocket; frames: any[] } | { status: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${gw.port}${p}`, { headers });
    const frames: any[] = [];
    ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ ws, frames }));
    ws.on('unexpected-response', (_q, res) => resolve({ status: res.statusCode ?? 0 }));
    ws.on('error', () => resolve({ status: -1 }));
  });
}
const until = async (f: () => boolean, ms = 5000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } };

describe('gateway /v1/responses websocket', () => {
  it('refuses an upgrade without the gateway key', async () => {
    expect(await open('/main/v1/responses', {})).toEqual({ status: 401 });
    expect(await open('/v1/ws', { authorization: 'Bearer cwg-wrong' })).toEqual({ status: 401 });
  });

  it('relays turns as Responses events and replays the transcript on a follow-up', async () => {
    const c = await open('/main/v1/ws', { authorization: `Bearer ${key}` });
    if (!('ws' in c)) throw new Error(`upgrade failed: ${JSON.stringify(c)}`);
    const { ws, frames } = c;
    ws.send(JSON.stringify({ type: 'response.create', model: 'claude-x', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }] }));
    await until(() => frames.some((f) => f.type === 'response.completed'));
    const done = frames.find((f) => f.type === 'response.completed');
    expect(JSON.stringify(done.response.output)).toContain('turn 1');
    expect(bodies[0].messages).toHaveLength(1);

    frames.length = 0;
    ws.send(JSON.stringify({ type: 'response.create', previous_response_id: done.response.id, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'again' }] }] }));
    await until(() => frames.some((f) => f.type === 'response.completed'));
    // user, assistant (turn 1), user — the stateless member got the whole conversation
    expect(bodies[1].messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);

    frames.length = 0;
    ws.send('not json');
    await until(() => frames.length > 0);
    expect(frames[0]).toMatchObject({ type: 'error', status: 400 });
    ws.close();
  });
});
