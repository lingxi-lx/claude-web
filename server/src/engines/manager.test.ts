// 引擎安装 (spec §9): a download whose SHA-256 differs from the one the release published is thrown away —
// nothing is installed, nothing is recorded.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineManager } from './manager.js';

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const assetName = () => {
  const os_ = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  return `cli-proxy-api_9.9.9_${os_}_${arch}${process.platform === 'win32' ? '.exe' : ''}`;
};

function setup(release: (name: string, body: Buffer) => object, extra: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-engines-'));
  dirs.push(root);
  const body = Buffer.from('#!/bin/sh\necho fake engine\n');
  const name = assetName();
  const rel = release(name, body);
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    if (url.includes('api.github.com')) return new Response(JSON.stringify(rel), { status: 200 });
    if (extra[url] !== undefined) return new Response(extra[url], { status: 200 });
    if (url.endsWith(name)) return new Response(body, { status: 200 });
    return new Response('nope', { status: 404 });
  });
  const state: any = {};
  let saves = 0;
  const meta: any = { engineState: () => state, saveChannels: async () => { saves++; } };
  const providers: any = { upsert: async () => ({}), remove: async () => {}, refreshModels: async () => {}, list: () => [] };
  const mgr = new EngineManager({ meta, providers, root });
  return { mgr, root, state, urls, body, name, saves: () => saves };
}

const wrong = 'sha256:' + '0'.repeat(64);
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

describe('EngineManager login catalog', () => {
  it('maps engine sign-in ids to the hub catalog ids, for both engines', () => {
    const s = setup((name, body) => ({ tag_name: 'v9.9.9', assets: [{ name, browser_download_url: `https://dl.example/${name}`, size: body.length }] }));
    const list = s.mgr.loginProviders();
    expect(list).toEqual(expect.arrayContaining([
      expect.objectContaining({ engine: 'cliproxyapi', provider: 'anthropic', catalogId: 'claude' }),
      expect.objectContaining({ engine: 'cliproxyapi', provider: 'xai', catalogId: 'grok' }),
      expect.objectContaining({ engine: 'magpie', provider: 'mimo-app', catalogId: 'mimo' }),
      expect.objectContaining({ engine: 'magpie', provider: 'trae-cn', catalogId: 'trae' }),
      expect.objectContaining({ engine: 'magpie', provider: 'qoder', catalogId: 'qoder' }),
    ]));
  });
});

describe('EngineManager bundled builds', () => {
  it('reports the build carried by the installer as installed, with its version, and never asks GitHub', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-engines-data-'));
    const bundled = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-engines-bundled-'));
    dirs.push(root, bundled);
    const dir = path.join(bundled, `${process.platform}-${process.arch}`, 'magpie');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `magpie${process.platform === 'win32' ? '.exe' : ''}`), 'fake');
    fs.writeFileSync(path.join(dir, 'version.txt'), 'v0.1.1803\n');
    vi.stubGlobal('fetch', async () => { throw new Error('no network'); });
    const state: any = {};
    const meta: any = { engineState: () => state, saveChannels: async () => {} };
    const providers: any = { upsert: async () => ({}), remove: async () => {}, refreshModels: async () => {}, list: () => [] };
    const mgr = new EngineManager({ meta, providers, root, bundledDir: bundled });
    const st = await mgr.status('magpie');
    expect(st).toMatchObject({ id: 'magpie', installed: true, bundled: true, version: 'v0.1.1803', health: 'stopped' });
    expect(st.verified).toBeUndefined();
  });
});

describe('EngineManager install verification', () => {
  it('a GitHub asset digest that does not match refuses the install and leaves nothing behind', async () => {
    const s = setup((name, body) => ({ tag_name: 'v9.9.9', assets: [{ name, browser_download_url: `https://dl.example/${name}`, size: body.length, digest: wrong }] }));
    await expect(s.mgr.install('cliproxyapi')).rejects.toThrow(/SHA-256|校验/);
    expect(s.urls.some((u) => u.startsWith('https://dl.example/'))).toBe(true);
    expect(s.state.cliproxyapi?.version).toBeUndefined();
    const left = fs.existsSync(path.join(s.root, 'cliproxyapi')) ? fs.readdirSync(path.join(s.root, 'cliproxyapi')) : [];
    expect(left).toEqual([]); // no version folder, no leftover temp folder
  });

  it('a checksums.txt that does not match refuses too; a matching one is not the reason a refusal happens', async () => {
    const s = setup((name) => ({ tag_name: 'v9.9.9', assets: [
      { name, browser_download_url: `https://dl.example/${name}` },
      { name: 'checksums.txt', browser_download_url: 'https://dl.example/checksums.txt' },
    ] }), { 'https://dl.example/checksums.txt': `${'a'.repeat(64)}  ${assetName()}\n` });
    await expect(s.mgr.install('cliproxyapi')).rejects.toThrow(/SHA-256|校验/);
    expect(s.state.cliproxyapi?.version).toBeUndefined();
  });

  it('a release with no published SHA-256 installs nothing until the user confirms that file (review E2)', async () => {
    const s = setup((name, body) => ({ tag_name: 'v9.9.9', assets: [{ name, browser_download_url: `https://dl.example/${name}`, size: body.length }] }));
    const asked = await s.mgr.install('cliproxyapi');
    expect(asked.confirm).toEqual({ version: 'v9.9.9', asset: s.name, sha256: sha(s.body) });
    expect(asked.installed).toBe(false);
    expect(s.state.cliproxyapi?.version).toBeUndefined();
    expect(fs.existsSync(path.join(s.root, 'cliproxyapi', 'v9.9.9'))).toBe(false);
    // consent to another file's hash is not consent to this one
    const other = await s.mgr.install('cliproxyapi', undefined, { allowUnverified: true, sha256: 'f'.repeat(64) });
    expect(other.confirm?.sha256).toBe(sha(s.body));
    expect(s.state.cliproxyapi?.version).toBeUndefined();
    const done = await s.mgr.install('cliproxyapi', undefined, { allowUnverified: true, sha256: sha(s.body) });
    expect(done.confirm).toBeUndefined();
    expect(done).toMatchObject({ installed: true, version: 'v9.9.9', verified: 'recorded', sha256: sha(s.body) });
  });

  it('an incomplete download (size differs) is refused before hashing', async () => {
    const s = setup((name, body) => ({ tag_name: 'v9.9.9', assets: [{ name, browser_download_url: `https://dl.example/${name}`, size: body.length + 1, digest: `sha256:${sha(body)}` }] }));
    await expect(s.mgr.install('cliproxyapi')).rejects.toThrow();
    expect(s.state.cliproxyapi?.version).toBeUndefined();
  });
});
