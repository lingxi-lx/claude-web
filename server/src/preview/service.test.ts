import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PreviewService, portFree } from './service.js';

const SERVER_JS = `const http = require('http');
const port = Number(process.env.PORT);
http.createServer((q, s) => s.end('hello ' + process.env.GREETING)).listen(port, '127.0.0.1', () => console.log('listening on ' + port));`;

const roots: string[] = [];
const svc = new PreviewService({ waitMs: 15_000 });
afterAll(async () => { await svc.stopAll(); for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const project = (configs: unknown[]) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-preview-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'server.js'), SERVER_JS);
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude', 'launch.json'), JSON.stringify({ configurations: configs }));
  return root;
};
const freePort = () => new Promise<number>((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });

describe('preview servers', () => {
  it('starts a configuration, waits for its port, keeps its output, stops it', async () => {
    const port = await freePort();
    const root = project([{ name: 'web', program: 'server.js', port, env: { GREETING: 'preview' } }]);
    const r = await svc.start(root);
    expect(r).toMatchObject({ name: 'web', port, url: `http://localhost:${port}` });
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('hello preview');
    expect((await svc.start(root, 'web')).already).toBe(true);
    expect(svc.logs(root)).toContain(`listening on ${port}`);
    expect(await svc.stop(root, 'web')).toBe(true);
    await expect.poll(() => portFree(port), { timeout: 5000 }).toBe(true);
  }, 30_000);

  it('a taken port: autoPort picks another (as PORT); unset says how to fix it; false refuses', async () => {
    const port = await freePort();
    const holder = net.createServer().listen(port, '127.0.0.1');
    await new Promise((res) => holder.once('listening', res));
    try {
      const auto = project([{ name: 'a', program: 'server.js', port, autoPort: true }]);
      const r = await svc.start(auto);
      expect(r.port).not.toBe(port);
      await svc.stop(auto);
      await expect(svc.start(project([{ name: 'u', program: 'server.js', port }]))).rejects.toThrow(/autoPort": true/);
      await expect(svc.start(project([{ name: 'f', program: 'server.js', port, autoPort: false }]))).rejects.toThrow(/autoPort: false/);
    } finally { holder.close(); }
  }, 30_000);

  it('no launch.json, an unknown name, a server that dies: each says so', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-preview-'));
    roots.push(bare);
    await expect(svc.start(bare)).rejects.toThrow(/No \.claude\/launch\.json/);
    const root = project([{ name: 'web', program: 'server.js', port: await freePort() }]);
    await expect(svc.start(root, 'api')).rejects.toThrow(/No configuration "api"/);
    fs.writeFileSync(path.join(root, 'boom.js'), "console.error('cannot start'); process.exit(3);");
    const dies = project([{ name: 'boom', program: 'boom.js', port: await freePort() }]);
    fs.copyFileSync(path.join(root, 'boom.js'), path.join(dies, 'boom.js'));
    await expect(svc.start(dies)).rejects.toThrow(/exited \(code 3\)[\s\S]*cannot start/);
  }, 30_000);
});
