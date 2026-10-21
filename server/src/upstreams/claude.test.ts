import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { ClaudeAdapter } from './claude.js';

let srv: http.Server | null = null;
async function fake(handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void) {
  srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => handler(req, res, b)); });
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(srv!.address() as any).port}`;
}
afterEach(async () => {
  if (srv) {
    srv.closeAllConnections();
    await new Promise<void>((r) => srv!.close(() => r()));
    srv = null;
  }
});

describe('ClaudeAdapter', () => {
  it('probes with a Bearer token and the oauth beta, and reads quota headers', async () => {
    const base = await fake((req, res) => {
      expect(req.headers.authorization).toBe('Bearer at-1');
      expect(req.headers['anthropic-beta']).toBe('oauth-2025-04-20');
      res.writeHead(200, {
        'content-type': 'application/json',
        'anthropic-ratelimit-requests-limit': '100',
        'anthropic-ratelimit-requests-remaining': '80',
        'anthropic-ratelimit-requests-reset': new Date(Date.now() + 60_000).toISOString(),
      }).end(JSON.stringify({ id: 'msg_1', type: 'message', content: [] }));
    });
    const a = new ClaudeAdapter({ baseUrl: base });
    const r = await a.probe({ id: 'acct_1' } as any, JSON.stringify({ kind: 'oauth', accessToken: 'at-1' }));
    expect(r.health).toBe('ok');
    expect(r.quota?.windows[0]).toMatchObject({ id: 'requests', used: 20, limit: 100 });
  });

  it('maps 401 to expired and 429 to cooling', async () => {
    let status = 401;
    const base = await fake((_q, res) => res.writeHead(status, { 'content-type': 'application/json', ...(status === 429 ? { 'retry-after': '120' } : {}) }).end('{}'));
    const a = new ClaudeAdapter({ baseUrl: base });
    const cred = JSON.stringify({ kind: 'setup-token', token: 'sk-ant-oat01-x' });
    expect((await a.probe({ id: 'a' } as any, cred)).health).toBe('expired');
    status = 429;
    const cooling = await a.probe({ id: 'a' } as any, cred);
    expect(cooling.health).toBe('cooling');
    expect(cooling.cooldownUntil).toBeGreaterThan(Date.now() + 100_000);
  });

  it('refreshes an oauth token', async () => {
    const tokenUrl = await fake((req, res, body) => {
      expect(JSON.parse(body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 }));
    });
    const a = new ClaudeAdapter({ tokenUrl });
    const out = await a.refresh({ id: 'a' } as any, JSON.stringify({ kind: 'oauth', accessToken: 'at-1', refreshToken: 'rt-1' }));
    expect(JSON.parse(out!.credential)).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2' });
  });
});
