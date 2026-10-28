import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { sendUpstream } from '../upstream.js';
import { helperPreface } from './agent.js';
import { clientFingerprint, fingerprintAgent, fingerprintChoice, PROFILES, reorderTopLevel, resolveProfile, shapeBody, shapeHeaders, tlsMode } from './index.js';

const servers: net.Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null))))); });
const listen = (s: net.Server) => new Promise<number>((r) => { servers.push(s); s.listen(0, '127.0.0.1', () => r((s.address() as net.AddressInfo).port)); });

describe('opt-in', () => {
  it('is off by default: no setting, another source, "off" or junk → no fingerprint at all', () => {
    const ctx = { outbound: 'anthropic' as const, path: '/v1/messages' };
    expect(clientFingerprint({}, { id: 'p1' }, ctx)).toBeNull();
    expect(clientFingerprint({ 'gateway.fingerprint': { p2: 'auto' } }, { id: 'p1' }, ctx)).toBeNull();
    expect(clientFingerprint({ 'gateway.fingerprint': { p1: 'off' } }, { id: 'p1' }, ctx)).toBeNull();
    expect(clientFingerprint({ 'gateway.fingerprint': { p1: 'chrome' } }, { id: 'p1' }, ctx)).toBeNull();
    expect(clientFingerprint({ 'gateway.fingerprint': 'auto' }, { id: 'p1' }, ctx)).toBeNull();
    expect(fingerprintChoice({}, 'x')).toBe('off');
    expect(tlsMode({})).toBe('auto');
    expect(tlsMode({ 'gateway.fingerprint.tls': 'node' })).toBe('node');
  });

  it('a source id wins over the "*" entry', () => {
    const s = { 'gateway.fingerprint': { '*': 'auto', quiet: 'off' } };
    expect(fingerprintChoice(s, 'any')).toBe('auto');
    expect(fingerprintChoice(s, 'quiet')).toBe('off');
  });
});

describe('profile selection', () => {
  const on = (v: string) => ({ 'gateway.fingerprint': { p: v } });
  it('auto follows the wire protocol', () => {
    expect(resolveProfile(on('auto'), { id: 'p' }, 'anthropic')?.id).toBe('claude-code');
    expect(resolveProfile(on('auto'), { id: 'p' }, 'responses')?.id).toBe('codex');
    expect(resolveProfile(on('auto'), { id: 'p' }, 'gemini')?.id).toBe('gemini-cli');
    // plain chat/completions: no client to look like
    expect(resolveProfile(on('auto'), { id: 'p' }, 'openai')).toBeNull();
    // a Codex account speaking Responses through the openai renderer
    expect(resolveProfile(on('auto'), { id: 'p', protocol: 'responses' }, 'openai')?.id).toBe('codex');
    expect(resolveProfile(on('auto'), { id: 'p', chatPath: '/backend-api/codex/responses' }, 'openai')?.id).toBe('codex');
  });

  it('an explicit profile is used as is; headers / body are only shaped when it speaks the protocol', () => {
    expect(resolveProfile(on('codex'), { id: 'p' }, 'anthropic')?.id).toBe('codex');
    const fp = clientFingerprint(on('codex'), { id: 'p' }, { outbound: 'anthropic', path: '/v1/messages' })!;
    expect(fp.shapes).toBe(false);
    const h = { 'content-type': 'application/json', 'user-agent': 'x' };
    expect(fp.headers(h)).toBe(h);
    const b = Buffer.from('{"stream":true,"model":"m"}');
    expect(fp.body(b)).toBe(b);
  });
});

describe('header order', () => {
  it('Claude Code: identity headers, its UA, its order and casing (translated request)', () => {
    const out = shapeHeaders(PROFILES['claude-code'], {
      'content-type': 'application/json', accept: 'text/event-stream', 'accept-encoding': 'identity',
      'user-agent': 'claude-web-gateway/1', authorization: 'Bearer t', 'anthropic-version': '2023-06-01', 'anthropic-beta': 'oauth-2025-04-20',
    }, { path: '/v1/messages', stream: true });
    expect(Object.keys(out)).toEqual([
      'Accept', 'Authorization', 'Content-Type', 'User-Agent',
      'X-Stainless-Arch', 'X-Stainless-Lang', 'X-Stainless-OS', 'X-Stainless-Package-Version', 'X-Stainless-Retry-Count',
      'X-Stainless-Runtime', 'X-Stainless-Runtime-Version', 'X-Stainless-Timeout',
      'anthropic-beta', 'anthropic-dangerous-direct-browser-access', 'anthropic-version', 'x-app', 'Accept-Encoding',
    ]);
    expect(out['User-Agent']).toBe(PROFILES['claude-code'].userAgent);
    expect(out.Accept).toBe('text/event-stream'); // ensure: the request's own value stays
    expect(out.Authorization).toBe('Bearer t');
    expect(out['x-app']).toBe('cli');
    expect(out['Accept-Encoding']).toBe('identity');
  });

  it('Claude Code passthrough: keeps the client version and its own stainless values, drops the SDK tag; count_tokens has no timeout', () => {
    const out = shapeHeaders(PROFILES['claude-code'], {
      'User-Agent': 'claude-cli/2.1.300 (external, sdk-cli, agent-sdk/0.3.1)', 'X-Stainless-Package-Version': '0.200.0', 'x-api-key': 'k',
    }, { path: '/v1/messages/count_tokens', stream: false });
    expect(out['User-Agent']).toBe('claude-cli/2.1.300 (external, cli)');
    expect(out['X-Stainless-Package-Version']).toBe('0.200.0');
    expect(out['X-Api-Key']).toBe('k');
    expect('X-Stainless-Timeout' in out).toBe(false);
  });

  it('Codex: its UA and originator, lowercase names in its order', () => {
    const out = shapeHeaders(PROFILES.codex, { 'content-type': 'application/json', accept: 'text/event-stream', authorization: 'Bearer t', 'user-agent': 'node' }, { path: '/responses', stream: true });
    expect(Object.keys(out)).toEqual(['authorization', 'originator', 'user-agent', 'accept', 'content-type']);
    expect(out['user-agent']).toMatch(/^codex-tui\/\d/);
    expect(out.originator).toBe('codex-tui');
  });

  it('Gemini CLI: its UA and x-goog-api-client', () => {
    const out = shapeHeaders(PROFILES['gemini-cli'], { 'content-type': 'application/json', 'x-goog-api-key': 'k' }, { path: '/v1beta/models/x:streamGenerateContent', stream: true });
    expect(Object.keys(out).slice(0, 4)).toEqual(['content-type', 'user-agent', 'x-goog-api-client', 'x-goog-api-key']);
    expect(out['user-agent']).toMatch(/^GeminiCLI\//);
  });

  it('on the wire: Host, Connection and Content-Length land where the profile puts them, with its casing', async () => {
    let raw: string[] = [];
    const srv = http.createServer((req, res) => { raw = req.rawHeaders; req.resume(); req.on('end', () => res.end('{}')); });
    const port = await listen(srv);
    const settings = { 'gateway.fingerprint': { p: 'claude-code' } };
    const fp = clientFingerprint(settings, { id: 'p' }, { outbound: 'anthropic', path: '/v1/messages' })!;
    const headers = fp.headers({ 'content-type': 'application/json', accept: 'application/json', 'accept-encoding': 'gzip', 'x-api-key': 'k' });
    const body = fp.body(Buffer.from('{"stream":false,"messages":[],"model":"m"}'));
    const up = await sendUpstream(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', headers, body, headerTimeoutMs: 5000, agentFor: fp.agentFor() });
    up.body.resume();
    const names = raw.filter((_, i) => i % 2 === 0);
    expect(names.slice(-4)).toEqual(['Connection', 'Host', 'Accept-Encoding', 'Content-Length']);
    expect(names.slice(0, 5)).toEqual(['Accept', 'X-Api-Key', 'Content-Type', 'User-Agent', 'X-Stainless-Arch']);
    expect(names.filter((n) => n.toLowerCase() === 'content-length')).toHaveLength(1);
  });
});

describe('field order', () => {
  it('moves top-level members into the profile order without touching their bytes', () => {
    const src = '{"stream":true,"max_tokens":1.0,"system":"\\u00e9 \\"q\\"","messages":[{"role":"user","content":"a,b}"}],"extra":{"z":1,"a":2},"model":"m"}';
    const out = reorderTopLevel(src, PROFILES['claude-code'].bodyOrder);
    expect(out).toBe('{"model":"m","messages":[{"role":"user","content":"a,b}"}],"system":"\\u00e9 \\"q\\"","max_tokens":1.0,"stream":true,"extra":{"z":1,"a":2}}');
    expect(JSON.parse(out)).toEqual(JSON.parse(src));
  });

  it('Codex Responses order', () => {
    const out = reorderTopLevel('{"stream":true,"input":[],"instructions":"x","model":"gpt"}', PROFILES.codex.bodyOrder);
    expect(Object.keys(JSON.parse(out))).toEqual(['model', 'instructions', 'input', 'stream']);
  });

  it('leaves ordered, non-object and broken text alone', () => {
    const ordered = Buffer.from('{"model":"m","messages":[]}');
    expect(shapeBody(PROFILES['claude-code'], ordered)).toBe(ordered);
    expect(shapeBody(PROFILES['claude-code'], null)).toBeNull();
    expect(reorderTopLevel('[1,2]', ['a'])).toBe('[1,2]');
    expect(reorderTopLevel('{"b":1,"a":', ['a', 'b'])).toBe('{"b":1,"a":');
    expect(reorderTopLevel('{"b":1,"a":2} trailing', ['a', 'b'])).toBe('{"b":1,"a":2} trailing');
  });
});

// ---- TLS: read the ClientHello Node actually sends ----

function parseClientHello(buf: Buffer) {
  let o = 5 + 4 + 2 + 32; // record + handshake headers, version, random
  o += 1 + buf[o]; // session id
  const cl = buf.readUInt16BE(o); o += 2;
  const ciphers: number[] = [];
  for (let i = 0; i < cl; i += 2) ciphers.push(buf.readUInt16BE(o + i));
  o += cl;
  o += 1 + buf[o]; // compression
  const end = o + 2 + buf.readUInt16BE(o); o += 2;
  const ext: Record<number, Buffer> = {};
  while (o + 4 <= end) { const t = buf.readUInt16BE(o); const l = buf.readUInt16BE(o + 2); ext[t] = buf.subarray(o + 4, o + 4 + l); o += 4 + l; }
  const alpn: string[] = [];
  if (ext[16]) { let p = 2; while (p < ext[16].length) { const l = ext[16][p]; alpn.push(ext[16].subarray(p + 1, p + 1 + l).toString()); p += 1 + l; } }
  const groups: number[] = [];
  if (ext[10]) for (let p = 2; p < ext[10].length; p += 2) groups.push(ext[10].readUInt16BE(p));
  return { ciphers, alpn, groups, ext };
}

async function captureHello(agent: http.Agent, port: number): Promise<ReturnType<typeof parseClientHello>> {
  const got = new Promise<Buffer>((resolve) => {
    (servers[servers.length - 1] as net.Server).once('connection', (s: net.Socket) => {
      let b = Buffer.alloc(0);
      s.on('data', (d) => { b = Buffer.concat([b, d]); if (b.length >= 5 && b.length >= 5 + b.readUInt16BE(3)) { resolve(b); s.destroy(); } });
    });
  });
  const req = https.request({ host: '127.0.0.1', port, path: '/', method: 'GET', agent, servername: 'api.example.test' });
  req.on('error', () => { /* the fake server hangs up */ });
  req.end();
  return parseClientHello(await got);
}

describe('TLS shape (Node approximation)', () => {
  it('Claude Code: its cipher order, groups, ALPN http/1.1 and status_request', async () => {
    const port = await listen(net.createServer());
    const agent = fingerprintAgent(PROFILES['claude-code'], new URL(`https://127.0.0.1:${port}/`), { tls: 'node' });
    const h = await captureHello(agent, port);
    expect(h.ciphers.slice(0, 9)).toEqual([0x1301, 0x1302, 0x1303, 0xc02b, 0xc02f, 0xc02c, 0xc030, 0xcca9, 0xcca8]);
    expect(h.ciphers).toContain(0x002f); // AES128-SHA, as the real client offers
    expect(h.alpn).toEqual(['http/1.1']);
    expect(h.groups.slice(0, 3)).toEqual([0x001d, 0x0017, 0x0018]);
    expect(h.ext[5]).toBeDefined(); // status_request
  });

  it('Codex: rustls suite order', async () => {
    const port = await listen(net.createServer());
    const agent = fingerprintAgent(PROFILES.codex, new URL(`https://127.0.0.1:${port}/`), { tls: 'node' });
    const h = await captureHello(agent, port);
    expect(h.ciphers.filter((c) => c !== 0x00ff)).toEqual([0x1302, 0x1301, 0x1303, 0xc02c, 0xc02b, 0xcca9, 0xc030, 0xc02f, 0xcca8]);
  });

  it('tls "off" leaves Node defaults', async () => {
    const port = await listen(net.createServer());
    const agent = fingerprintAgent(PROFILES['claude-code'], new URL(`https://127.0.0.1:${port}/`), { tls: 'off' });
    const h = await captureHello(agent, port);
    expect(h.ciphers.slice(0, 3)).not.toEqual([0x1301, 0x1302, 0x1303]);
  });
});

describe('tlsfp helper path', () => {
  it('sends the preface, then the ordered plain request, to the helper', async () => {
    let seen = '';
    const srv = net.createServer((s) => {
      s.on('data', (d) => {
        seen += d.toString('latin1');
        if (seen.includes('\r\n\r\n')) s.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}');
      });
    });
    const port = await listen(srv);
    const token = 'a'.repeat(32);
    const agent = fingerprintAgent(PROFILES['claude-code'], new URL('https://api.anthropic.com/v1/messages'), { tls: 'auto', helperEndpoint: () => ({ port, token }) });
    const headers = shapeHeaders(PROFILES['claude-code'], { 'content-type': 'application/json', authorization: 'Bearer t' }, { path: '/v1/messages', stream: false });
    const up = await sendUpstream('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: Buffer.from('{}'), headerTimeoutMs: 5000, agentFor: () => agent });
    expect(up.status).toBe(200);
    up.body.resume();
    const [preface, ...rest] = seen.split('\n');
    expect(preface + '\n').toBe(helperPreface(token, 'claude-code', 'api.anthropic.com', 443, null));
    expect(rest.join('\n')).toMatch(/^POST \/v1\/messages HTTP\/1\.1\r\nAccept: application\/json\r\nAuthorization: Bearer t\r\nContent-Type: application\/json\r\nUser-Agent: claude-cli\//);
  });

  it('is not used when the helper is not running, nor for a client that is Node itself', async () => {
    const u = new URL('https://generativelanguage.googleapis.com/');
    const none = fingerprintAgent(PROFILES['claude-code'], u, { tls: 'auto', helperEndpoint: () => null }) as any;
    expect(none.tls).toBeTruthy();
    const gem = fingerprintAgent(PROFILES['gemini-cli'], u, { tls: 'auto', helperEndpoint: () => ({ port: 1, token: 'x'.repeat(32) }) }) as any;
    expect(gem.tls).toBeTruthy();
  });

  it('preface fields cannot smuggle a second line', () => {
    expect(helperPreface('t', 'codex', 'evil.test\nCWFP/1', 443, 'http://p:1')).toBe('CWFP/1 t codex evil.testCWFP/1 443 http://p:1\n');
  });
});
