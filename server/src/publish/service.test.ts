import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PublishService } from './service.js';

let root: string, src: string, server: http.Server, base: string, now: number, lan: string | null;
let svc: PublishService;

function get(p: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    // a raw path (no URL normalising): what a hostile client can send
    const req = http.request({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path: p, method: 'GET', headers: { cookie: 'cw_token=secret' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-pubsvc-'));
  src = path.join(root, 'work');
  fs.mkdirSync(path.join(src, 'img'), { recursive: true });
  fs.writeFileSync(path.join(src, 'page.html'), '<link rel="stylesheet" href="style.css"><img src="img/a.png"><h1>v1</h1>');
  fs.writeFileSync(path.join(src, 'style.css'), 'h1{color:red}');
  fs.writeFileSync(path.join(src, 'img', 'a.png'), 'PNG');
  fs.writeFileSync(path.join(src, 'secret.txt'), 'not referenced');
  now = 1_000_000; lan = null;
  svc = new PublishService({ dir: path.join(root, 'published'), exportsDir: path.join(root, 'exports'), localBase: () => base, lanBase: () => lan, now: () => now });
  server = http.createServer((q, s) => { if (!svc.handle(q, s, new URL(q.url!, 'http://x'))) s.writeHead(418).end('app'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise((r) => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); });

describe('PublishService', () => {
  it('publishes a snapshot of the page and its files, served sandboxed without any token', async () => {
    const it = await svc.create(path.join(src, 'page.html'), '7d');
    expect(it.id).toMatch(/^[0-9a-f]{32}$/);
    expect(it.files).toBe(3);
    expect(it.localUrl).toBe(`${base}/p/${it.id}/`);
    expect(it.lanUrl).toBeNull();
    expect(fs.existsSync(path.join(root, 'published', it.id, 'secret.txt'))).toBe(false);
    const page = await get(`/p/${it.id}/`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('v1');
    expect(page.headers['content-security-policy']).toBe('sandbox allow-scripts allow-popups');
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['content-type']).toContain('text/html');
    expect((await get(`/p/${it.id}/style.css`)).body).toBe('h1{color:red}');
    expect((await get(`/p/${it.id}/img/a.png?token=whatever`)).status).toBe(200);
    expect((await get(`/p/${it.id}`)).status).toBe(301);
  });

  it('traversal, other snapshots and unknown ids are 404 — never the app', async () => {
    const it = await svc.create(path.join(src, 'page.html'), 'never');
    for (const p of [`/p/${it.id}/../index.json`, `/p/${it.id}/%2e%2e/index.json`, `/p/${it.id}/..%2findex.json`, `/p/${it.id}/..%5cindex.json`, `/p/${it.id}/secret.txt`, `/p/${'0'.repeat(32)}/`, '/p/../index.json', '/p/', `/p/${it.id}/%00`]) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
      expect(r.body, p).not.toContain('"source"');
    }
    expect((await get('/elsewhere')).status).toBe(418);
  });

  it('re-publishing updates the snapshot under the same id; expiry and revoke make it 404', async () => {
    const it = await svc.create(path.join(src, 'page.html'), '1d');
    fs.writeFileSync(path.join(src, 'page.html'), '<h1>v2</h1>');
    const again = await svc.create(path.join(src, 'page.html'), '1d', it.id);
    expect(again.id).toBe(it.id);
    expect((await get(`/p/${it.id}/`)).body).toContain('v2');
    now += 86_400_000 + 1;
    expect((await get(`/p/${it.id}/`)).status).toBe(404);
    expect(svc.list().items).toEqual([]);
    const other = await svc.create(path.join(src, 'page.html'), 'never');
    expect((await get(`/p/${other.id}/`)).status).toBe(200);
    await svc.revoke(other.id);
    expect((await get(`/p/${other.id}/`)).status).toBe(404);
    expect(fs.existsSync(path.join(root, 'published', other.id))).toBe(false);
  });

  it('the LAN link only while remote listening is on', async () => {
    await svc.create(path.join(src, 'page.html'), 'never');
    expect(svc.list().lan).toBeNull();
    lan = 'http://192.168.1.5:3091';
    const l = svc.list();
    expect(l.lan).toBe(lan);
    expect(l.items[0].lanUrl).toBe(`${lan}/p/${l.items[0].id}/`);
  });

  it('receive (the always-on machine) refuses paths that leave the snapshot', async () => {
    await expect(svc.receive({ kind: 'publish.receive', name: 'x', entry: '../x.html', source: '', expiry: 'never', files: [{ rel: '../x.html', data: '' }] })).rejects.toThrow();
    const ok = await svc.receive({ kind: 'publish.receive', name: 'x', entry: 'x.html', source: '/a/x.html', expiry: 'never', files: [{ rel: 'x.html', data: Buffer.from('<p>hi</p>').toString('base64') }] });
    expect((await get(`/p/${ok.id}/`)).body).toBe('<p>hi</p>');
  });

  it('exports one self-contained HTML file', async () => {
    const r = await svc.inline(path.join(src, 'page.html'));
    const html = fs.readFileSync(r.path, 'utf8');
    expect(html).toContain('<style>h1{color:red}</style>');
    expect(html).toContain('data:image/png;base64,');
    expect(path.dirname(r.path)).toBe(path.join(root, 'exports'));
  });
});
