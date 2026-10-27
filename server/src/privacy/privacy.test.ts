// Privacy pipeline (spec 2026-10-26 §4): detectors (true and false positives), redact → restore round trips through
// JSON and SSE (a placeholder cut across two deltas, one inside streamed tool-argument JSON), and fail closed.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { compile, partialTail, redactText, restoreText } from './detect.js';
import { redactBody, restoreBody, SseRestorer } from './pipeline.js';
import { PrivacyRelay } from './relay.js';
import { PrivacyService } from './service.js';
import { DEFAULT_PRIVACY, type PrivacyCategory, type PrivacySettings } from './types.js';

const SECRET = Buffer.alloc(32, 7);
const ALL_REDACT: PrivacySettings = {
  ...DEFAULT_PRIVACY,
  enabled: true,
  actions: { api_key: 'redact', private_key: 'redact', jwt: 'redact', password: 'redact', email: 'redact', phone: 'redact', id_card: 'redact', bank_card: 'redact', custom: 'redact' },
};
const c = compile(ALL_REDACT);
const cats = (text: string, s = c): PrivacyCategory[] => redactText(text, s, SECRET, new Map()).hits.map((h) => h.category);

const ANT_KEY = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const PRIV = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nYWJjZGVm\n-----END PRIVATE KEY-----';

describe('detectors: true positives', () => {
  it.each([
    ['an Anthropic key', `key is ${ANT_KEY} ok`, 'api_key'],
    ['an OpenAI project key', 'OPENAI sk-proj-abcdefghijklmnopqrstuvwxyz012345', 'api_key'],
    ['an AWS access key id', 'AKIAIOSFODNN7EXAMPLE', 'api_key'],
    ['a GitHub token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'api_key'],
    ['a PEM private key', `x\n${PRIV}\ny`, 'private_key'],
    ['a JWT', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', 'jwt'],
    ['a config password value', 'db_password = hunter2hunter', 'password'],
    ['a Chinese password key', '数据库密码: abc12345', 'password'],
    ['a Chinese password key with a full-width colon', '口令：abc12345', 'password'],
    ['an email', '写信给 zhang.san@example.com 吧', 'email'],
    ['a Chinese mobile', '电话13812345678，谢谢', 'phone'],
    ['a Chinese mobile with +86 and spaces', '+86 138 1234 5678', 'phone'],
    ['an international number with its + code', 'call +1 415 555 2671', 'phone'],
    ['a Chinese ID (valid check digit, X)', '身份证 11010519491231002X 号', 'id_card'],
    ['a bank card (Luhn)', '卡号 4111 1111 1111 1111', 'bank_card'],
  ])('%s', (_, text, cat) => {
    expect(cats(text)).toEqual([cat]);
  });
});

describe('detectors: false positives stay out', () => {
  it.each([
    ['prose with sk- inside a word', 'the task-abcdefghijklmnopqrstuvwxyz is done'],
    ['a short sk- word', 'use sk-learn for this'],
    ['an 11-digit number that is no mobile (12…)', 'id 12345678901'],
    ['a mobile-looking run inside a longer number', '订单号 2138123456789000'],
    ['a Chinese ID with a wrong check digit', '身份证 110105194912310021 号'],
    ['a 16-digit number failing Luhn', 'ref 4111111111111112'],
    ['a version / date', 'v2026.10.26 build 20261026'],
    ['password placeholders and references', 'password = ******** ; token: ${TOKEN} ; secret=true ; api_key=process.env.KEY'],
    ['a placeholder already in the text', 'see {{API_KEY_0123abcd}} above'],
  ])('%s', (_, text) => {
    expect(cats(text)).toEqual([]);
  });

  it('allow-listed values go out as they are; off categories are not looked for', () => {
    const allow = compile({ ...ALL_REDACT, allow: ['13812345678'] });
    expect(cats('13812345678', allow)).toEqual([]);
    const off = compile({ ...ALL_REDACT, actions: { ...ALL_REDACT.actions, phone: 'off' } });
    expect(cats('13812345678', off)).toEqual([]);
  });

  it('custom words are matched case-insensitively; a pattern matching the empty string is reported, not used', () => {
    const s = compile({ ...ALL_REDACT, words: ['Project Falcon'], patterns: ['x*', 'INT-\\d{4}'] });
    expect(s.bad).toEqual(['x*']);
    expect(cats('about project falcon and INT-1234', s)).toEqual(['custom', 'custom']);
  });
});

describe('placeholders', () => {
  it('are deterministic per value (prompt caching survives) and differ per value', () => {
    const a = redactText(`k ${ANT_KEY}`, c, SECRET, new Map()).text;
    const b = redactText(`k ${ANT_KEY}`, c, SECRET, new Map()).text;
    expect(a).toBe(b);
    expect(a).toMatch(/^k \{\{API_KEY_[a-f0-9]{8}\}\}$/);
    expect(redactText('k sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ', c, SECRET, new Map()).text).not.toBe(a);
  });
  it('warn sends as is, block only reports', () => {
    const s = compile({ ...ALL_REDACT, actions: { ...ALL_REDACT.actions, phone: 'warn', email: 'block' } });
    const r = redactText('13812345678 a@b.cn', s, SECRET, new Map());
    expect(r.text).toBe('13812345678 a@b.cn');
    expect(r.hits.map((h) => h.action)).toEqual(['warn', 'block']);
  });
  it('partialTail finds a cut placeholder and leaves a complete one alone', () => {
    expect(partialTail('hello {{API_K')).toBe(6);
    expect(partialTail('hello {{API_KEY_ab')).toBe(6);
    expect(partialTail('hello {')).toBe(6);
    expect(partialTail('hello {{API_KEY_0123abcd}}')).toBe(-1);
    expect(partialTail('hello world')).toBe(-1);
  });
});

/** An Anthropic messages body with secrets in a text block, a tool's input and a tool result. */
function anthropicBody() {
  return {
    model: 'claude-sonnet-4-5',
    stream: true,
    messages: [
      { role: 'user', content: [{ type: 'text', text: `my key ${ANT_KEY}, phone 13812345678` }] },
      { role: 'assistant', content: [
        { type: 'thinking', thinking: `raw ${ANT_KEY}`, signature: 'sig' },
        { type: 'tool_use', id: 'toolu_1', name: 'Write', input: { path: 'k.pem', content: PRIV } },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: `wrote ${PRIV}` }] },
    ],
  };
}

const sse = (events: object[]) => events.map((e) => `event: ${(e as any).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const parseSse = (text: string) => text.split(/\n\n/).map((b) => b.split('\n').find((l) => l.startsWith('data: '))).filter(Boolean).map((l) => JSON.parse(l!.slice(6)));

describe('redact → restore round trip', () => {
  it('redacts text, tool input and tool results; leaves signed thinking, ids and the model alone', () => {
    const map = new Map<string, string>();
    const r = redactBody(Buffer.from(JSON.stringify(anthropicBody())), c, SECRET, map);
    const out = JSON.parse(r.body.toString());
    expect(out.messages[0].content[0].text).not.toContain(ANT_KEY);
    expect(out.messages[0].content[0].text).not.toContain('13812345678');
    expect(out.messages[1].content[1].input.content).toMatch(/^\{\{PRIVATE_KEY_[a-f0-9]{8}\}\}$/);
    expect(out.messages[2].content[0].content).not.toContain('BEGIN PRIVATE KEY');
    expect(out.messages[1].content[0]).toEqual({ type: 'thinking', thinking: `raw ${ANT_KEY}`, signature: 'sig' });
    expect(out.messages[1].content[1].id).toBe('toolu_1');
    expect(out.model).toBe('claude-sonnet-4-5');
    expect(r.hits.map((h) => h.category).sort()).toEqual(['api_key', 'phone', 'private_key', 'private_key']);
    // and back: a non-stream answer echoing every placeholder
    const echoed = JSON.stringify({ content: [{ type: 'text', text: out.messages[0].content[0].text }, { type: 'tool_use', input: out.messages[1].content[1].input }] });
    const back = JSON.parse(restoreBody(echoed, map));
    expect(back.content[0].text).toBe(`my key ${ANT_KEY}, phone 13812345678`);
    expect(back.content[1].input.content).toBe(PRIV);
  });

  it('a body with nothing to replace goes out as the very same bytes', () => {
    const raw = Buffer.from('{"model":"x",  "messages":[{"role":"user","content":"hi"}]}');
    expect(redactBody(raw, c, SECRET, new Map()).body).toBe(raw);
  });

  it('OpenAI tool-call arguments stay valid JSON after redaction', () => {
    const map = new Map<string, string>();
    const body = { model: 'gpt', messages: [{ role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: JSON.stringify({ key: ANT_KEY }) } }] }] };
    const out = JSON.parse(redactBody(Buffer.from(JSON.stringify(body)), c, SECRET, map).body.toString());
    const args = JSON.parse(out.messages[0].tool_calls[0].function.arguments);
    expect(args.key).toMatch(/^\{\{API_KEY_[a-f0-9]{8}\}\}$/);
    expect(restoreText(args.key, map)).toBe(ANT_KEY);
  });

  it('SSE: a placeholder split across two text deltas comes back whole', () => {
    const map = new Map<string, string>();
    const ph = redactText(ANT_KEY, c, SECRET, map).text;
    const cut = 9; // inside `{{API_KEY_…`
    const stream = sse([
      { type: 'message_start', message: { id: 'm', content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `your key is ${ph.slice(0, cut)}` } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `${ph.slice(cut)} — keep it safe` } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ]);
    // fed in awkward network chunks too
    const r = new SseRestorer(map);
    let out = '';
    for (let i = 0; i < stream.length; i += 37) out += r.feed(stream.slice(i, i + 37));
    out += r.end();
    const evs = parseSse(out);
    const text = evs.filter((e) => e.type === 'content_block_delta').map((e) => e.delta.text).join('');
    expect(text).toBe(`your key is ${ANT_KEY} — keep it safe`);
    expect(out).not.toContain('{{');
    expect(evs.map((e) => e.type)).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_stop']);
  });

  it('SSE: a placeholder inside streamed tool_use input (input_json_delta) is restored JSON-escaped', () => {
    const map = new Map<string, string>();
    const ph = redactText(PRIV, c, SECRET, map).text;
    const json = JSON.stringify({ path: 'k.pem', content: ph });
    const at = json.indexOf(ph) + 5;
    const stream = sse([
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_2', name: 'Write', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(0, at) } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(at) } },
      { type: 'content_block_stop', index: 1 },
    ]);
    const r = new SseRestorer(map);
    const out = r.feed(stream) + r.end();
    const partial = parseSse(out).filter((e) => e.type === 'content_block_delta').map((e) => e.delta.partial_json).join('');
    expect(JSON.parse(partial)).toEqual({ path: 'k.pem', content: PRIV });
  });

  it('a cut placeholder followed by another slot is flushed as it was (never a wrong value)', () => {
    const map = new Map<string, string>();
    const ph = redactText(ANT_KEY, c, SECRET, map).text;
    const stream = sse([
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `a ${ph.slice(0, 6)}` } },
      { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'other block' } },
    ]);
    const r = new SseRestorer(map);
    const evs = parseSse(r.feed(stream) + r.end());
    expect(evs.map((e) => e.delta.text)).toEqual([`a ${ph.slice(0, 6)}`, 'other block']);
  });
});

/** The relay with a fake upstream: what reaches the upstream, and what the client gets. */
describe('relay: fail closed', () => {
  const servers: http.Server[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))); });
  const listen = async (h: http.RequestListener) => {
    const s = http.createServer(h);
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  };
  type Reply = (j: any, res: http.ServerResponse) => void;
  const echo: Reply = (j, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'text', text: `echo: ${j.messages[0].content}` }] }));
  const setup = async (settings: Partial<PrivacySettings>, reply: Reply = echo) => {
    const cfg: any = { ...ALL_REDACT, skipLocal: false, ...settings };
    const meta: any = { privacyConfig: () => cfg, savePrivacy: async () => {} };
    const privacy = new PrivacyService(meta);
    const seen: string[] = [];
    const upstream = await listen((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        seen.push(b);
        reply(JSON.parse(b), res);
      });
    });
    let relayBase = '';
    const relay: PrivacyRelay = new PrivacyRelay(privacy, () => relayBase);
    const root = await listen((req, res) => void relay.serve(req, res, new URL(req.url!, 'http://x')));
    relayBase = `${root}/gateway`;
    const base = relay.base(upstream)!;
    const post = async (content: string) => {
      const r = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content }] }) });
      return { status: r.status, text: await r.text() };
    };
    return { privacy, seen, post, root };
  };

  it('redacts on the way out and restores on the way back', async () => {
    const { seen, post } = await setup({});
    const r = await post(`key ${ANT_KEY}`);
    expect(r.status).toBe(200);
    expect(seen[0]).not.toContain(ANT_KEY);
    expect(seen[0]).toMatch(/\{\{API_KEY_[a-f0-9]{8}\}\}/);
    expect(JSON.parse(r.text).content[0].text).toBe(`echo: key ${ANT_KEY}`);
  });

  it('an answer only gets back what its own request redacted, never an earlier request\'s secret', async () => {
    const GH = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    // the upstream (or a prompt injection) emits whatever placeholder it has learned, in every answer
    let learned = '';
    const { seen, post } = await setup({}, (j, res) => {
      const own = /\{\{API_KEY_[a-f0-9]{8}\}\}/.exec(String(j.messages[0].content))?.[0] ?? '';
      learned ||= own;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'text', text: `own=${own} learned=${learned}` }] }));
    });
    // request A (another conversation / a LAN share-key caller) redacts ANT_KEY
    const a = await post(`key ${ANT_KEY}`);
    const phA = /\{\{API_KEY_[a-f0-9]{8}\}\}/.exec(seen[0])![0];
    expect(JSON.parse(a.text).content[0].text).toBe(`own=${ANT_KEY} learned=${ANT_KEY}`);
    // request B redacts a different secret: its own comes back, A's placeholder stays a placeholder
    const b = await post(`token ${GH}`);
    expect(seen[1]).not.toContain(GH);
    const tb = JSON.parse(b.text).content[0].text;
    expect(tb).toBe(`own=${GH} learned=${phA}`);
    expect(tb).not.toContain(ANT_KEY);
  });

  it('a placeholder cut across two SSE deltas of the same request is still restored', async () => {
    const { post } = await setup({}, (j, res) => {
      const ph = /\{\{API_KEY_[a-f0-9]{8}\}\}/.exec(String(j.messages[0].content))![0];
      const ev = (text: string) => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(ev(`a ${ph.slice(0, 7)}`));
      setTimeout(() => res.end(ev(`${ph.slice(7)} b`)), 10);
    });
    const r = await post(`key ${ANT_KEY}`);
    const texts = r.text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)).delta.text);
    expect(texts.join('')).toBe(`a ${ANT_KEY} b`);
  });

  it('a pipeline failure refuses the request (500) and nothing reaches the upstream', async () => {
    const { privacy, seen, post } = await setup({});
    privacy.secret = () => { throw new Error('boom'); };
    const r = await post(`key ${ANT_KEY}`);
    expect(r.status).toBe(500);
    expect(seen).toEqual([]);
    expect(r.text).not.toContain(ANT_KEY);
  });

  it('a block rule refuses with 403, counts it, and nothing is sent', async () => {
    const { privacy, seen, post } = await setup({ actions: { ...ALL_REDACT.actions, phone: 'block' } });
    const r = await post('call 13812345678');
    expect(r.status).toBe(403);
    expect(seen).toEqual([]);
    expect(privacy.status().stats.blocked).toBe(1);
  });

  it('a forged relay address is refused (not an open proxy)', async () => {
    const { root, seen } = await setup({});
    const r = await fetch(`${root}/gateway/~v/${'0'.repeat(32)}/${Buffer.from('http://127.0.0.1:1').toString('base64url')}/v1/messages`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(403);
    expect(seen).toEqual([]);
  });
});
