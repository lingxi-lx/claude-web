// Remote sync: config stays encrypted + masked, push takes the lock and writes conditionally, pull hands the
// remote bundle to the ordinary preview/apply path, and a lost race is worded as a conflict.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MetaStore } from '../meta/store.js';
import { SyncService } from './service.js';
import {
  RemoteSyncService, SYNC_REMOTE_BUNDLE_KEY, SYNC_REMOTE_MASK, maskSyncRemoteSettings, type RemoteSyncSecrets,
} from './remote.js';
import type { GetResult, LockHandle, PutOptions, PutResult, SyncBackend } from './backends/types.js';
import { SyncConflictError } from './backends/types.js';
import type { SyncRemoteConfig } from './types.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const fakeSecrets: RemoteSyncSecrets = {
  async protect(plain, id) { return `enc:test:${id}:${Buffer.from(plain, 'utf8').toString('base64')}`; },
  async reveal(v) {
    if (!v) return '';
    const m = /^enc:test:([^:]+):(.*)$/.exec(v);
    return m ? Buffer.from(m[2], 'base64').toString('utf8') : v;
  },
};

class FakeBackend implements SyncBackend {
  readonly kind = 'webdav' as const;
  files = new Map<string, { data: Uint8Array; etag: string }>();
  locks = new Map<string, string>();
  puts: PutOptions[] = [];
  unlocks = 0;
  /** the next put fails with this (a race another machine won) */
  failPut: Error | null = null;
  private n = 0;

  async put(key: string, data: Uint8Array | string, opts: PutOptions = {}): Promise<PutResult> {
    this.puts.push(opts);
    if (this.failPut) { const e = this.failPut; this.failPut = null; throw e; }
    if (opts.ifNoneMatch && this.files.has(key)) throw new SyncConflictError('already there');
    if (opts.ifMatch && this.files.get(key)?.etag !== opts.ifMatch) throw new SyncConflictError();
    const etag = `"e${++this.n}"`;
    this.files.set(key, { data: typeof data === 'string' ? new TextEncoder().encode(data) : data, etag });
    return { etag, version: etag };
  }

  async get(key: string): Promise<GetResult | null> {
    const f = this.files.get(key);
    return f ? { data: f.data, etag: f.etag, version: f.etag } : null;
  }

  async lock(key: string, owner = 'claude-web'): Promise<LockHandle | null> {
    if (this.locks.has(key)) return null;
    const token = `t${++this.n}`;
    this.locks.set(key, token);
    return { key, token, owner, expiresAt: Date.now() + 60_000 };
  }

  async unlock(key: string, lock: LockHandle | string): Promise<void> {
    this.unlocks += 1;
    const token = typeof lock === 'string' ? lock : lock.token;
    if (this.locks.get(key) !== token) throw new Error('not held');
    this.locks.delete(key);
  }
}

function make(backend = new FakeBackend()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sync-remote-'));
  dirs.push(dir);
  const meta = new MetaStore(path.join(dir, 'meta.json'));
  const sync = new SyncService({ meta });
  const remote = new RemoteSyncService({
    meta, sync, secrets: fakeSecrets, backendFactory: () => backend,
  });
  return { meta, sync, remote, backend };
}

const config = (over: Partial<SyncRemoteConfig> = {}): SyncRemoteConfig => ({
  backend: 'webdav',
  webdav: { url: 'https://dav.example.com/claude-web/', username: 'user', password: 'pw-secret' },
  s3: { endpoint: '', bucket: '', region: '', accessKeyId: '', secretAccessKey: '', prefix: '' },
  github: { repo: '', branch: '', path: '', token: '' },
  ...over,
});

describe('remote sync config', () => {
  it('stores secrets through SecretService and only ever returns the mask', async () => {
    const { meta, remote } = make();
    const st = await remote.set(config());
    expect(st.webdav.password).toBe(SYNC_REMOTE_MASK);
    expect(st.configured).toBe(true);
    expect(st.missing).toEqual([]);

    const stored = meta.settings()['sync.remote'] as any;
    expect(stored.webdav.password).toMatch(/^enc:test:/);
    expect(JSON.stringify(stored)).not.toContain('pw-secret');
    expect(JSON.stringify(maskSyncRemoteSettings(meta.settings()))).not.toContain('pw-secret');
    expect((maskSyncRemoteSettings(meta.settings())['sync.remote'] as any).webdav.password).toBe(SYNC_REMOTE_MASK);

    // the mask sent back keeps the stored ciphertext (typing dots does not replace the password)
    const before = stored.webdav.password;
    await remote.set(config({ webdav: { ...config().webdav, password: SYNC_REMOTE_MASK } }));
    expect((meta.settings()['sync.remote'] as any).webdav.password).toBe(before);

    // empty removes it
    await remote.set(config({ webdav: { ...config().webdav, password: '' } }));
    expect((meta.settings()['sync.remote'] as any).webdav.password).toBeUndefined();
    expect(remote.status().webdav.password).toBe('');
  });

  it('names what a backend still misses, and keeps the other backends when switching', async () => {
    const { remote } = make();
    const s3 = await remote.set(config({
      backend: 's3',
      s3: { endpoint: '', bucket: 'bucket', region: '', accessKeyId: 'AK', secretAccessKey: '', prefix: 'cw' },
      github: { repo: 'owner/repo', branch: 'main', path: 'cw', token: 'gh-token' },
    }));
    expect(s3.configured).toBe(false);
    expect(s3.missing).toContain('S3 Secret Key');
    expect(s3.github.repo).toBe('owner/repo');
    expect(s3.github.token).toBe(SYNC_REMOTE_MASK);
    // switching back keeps the WebDAV password set earlier in this same store? (it was empty in this call)
    expect(s3.webdav.url).toBe('https://dav.example.com/claude-web/');
  });
});

describe('remote sync push', () => {
  it('locks, conditionally puts the exported bundle and always unlocks', async () => {
    const { meta, remote, backend } = make();
    await meta.upsertProvider({ name: 'Relay', type: 'anthropic', baseUrl: 'https://r.example', apiKey: 'sk-local' });
    await remote.set(config());

    const first = await remote.push();
    expect(first.ok).toBe(true);
    expect(backend.puts[0].ifNoneMatch).toBe(true);
    expect(backend.puts[0].ifMatch).toBeUndefined();
    expect(backend.locks.size).toBe(0);
    expect(backend.unlocks).toBe(1);

    const text = new TextDecoder().decode(backend.files.get(SYNC_REMOTE_BUNDLE_KEY)!.data);
    const bundle = JSON.parse(text);
    expect(bundle.format).toBe('claude-web-sync');
    expect(bundle.public.providers).toHaveLength(1);
    expect(text).not.toContain('sk-local'); // no passphrase → the secret part is absent
    const firstEtag = backend.files.get(SYNC_REMOTE_BUNDLE_KEY)!.etag;

    await remote.push();
    expect(backend.puts[1].ifMatch).toBe(firstEtag); // conditional against the version just read
    expect(backend.locks.size).toBe(0);
  });

  it('seals credentials when a passphrase is given', async () => {
    const { meta, remote, backend } = make();
    await meta.upsertProvider({ name: 'Relay', type: 'anthropic', baseUrl: 'https://r.example', apiKey: 'sk-secret' });
    await remote.set(config());
    await remote.push('pass phrase');
    const text = new TextDecoder().decode(backend.files.get(SYNC_REMOTE_BUNDLE_KEY)!.data);
    expect(text).not.toContain('sk-secret');
    expect(JSON.parse(text).secret).toBeTruthy();
  });

  it('does not write while another machine holds the lock', async () => {
    const { remote, backend } = make();
    await remote.set(config());
    backend.locks.set(SYNC_REMOTE_BUNDLE_KEY, 'other-owner');
    await expect(remote.push()).rejects.toThrow('另一台电脑正在同步');
    expect(backend.puts).toHaveLength(0);
    expect(backend.locks.get(SYNC_REMOTE_BUNDLE_KEY)).toBe('other-owner');
  });

  it('words a lost conditional write as a conflict and still unlocks', async () => {
    const { remote, backend } = make();
    await remote.set(config());
    backend.failPut = new SyncConflictError();
    await expect(remote.push()).rejects.toThrow('同步文件在远端已经变了');
    expect(backend.unlocks).toBe(1);
    expect(backend.locks.size).toBe(0);
    expect(remote.status().lastError).toContain('同步文件在远端已经变了');
  });

  it('cancel stops the operation in flight and words it as 已取消', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sync-remote-'));
    dirs.push(dir);
    const meta = new MetaStore(path.join(dir, 'meta.json'));
    const sync = new SyncService({ meta });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const remote = new RemoteSyncService({
      meta, sync, secrets: fakeSecrets,
      backendFactory: (_config, signal) => {
        const backend = new FakeBackend();
        backend.get = () => new Promise<GetResult | null>((_resolve, reject) => {
          started();
          signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          }, { once: true });
        });
        return backend;
      },
    });
    await remote.set(config());
    const p = remote.test();
    await ready;
    remote.cancel();
    await expect(p).rejects.toThrow('已取消');
  });
});

describe('remote sync pull', () => {
  it('turns the remote bundle into the ordinary preview, which applies like an imported file', async () => {
    const backend = new FakeBackend();
    const src = make(backend);
    const dst = make(backend);
    await src.meta.upsertProvider({ name: 'Relay', type: 'anthropic', baseUrl: 'https://r.example', apiKey: 'sk-from-source' });
    await src.remote.set(config());
    await src.remote.push('pass phrase');
    await dst.remote.set(config());

    await expect(dst.remote.pull()).rejects.toThrow('要输入导出时的口令');
    const pulled = await dst.remote.pull('pass phrase');
    expect(pulled.encrypted).toBe(true);
    expect(pulled.items.find((i) => i.collection === 'provider')!.action).toBe('add');

    const applied = await dst.sync.apply(pulled.token);
    expect(applied.applied).toBe(1);
    expect(dst.meta.providers()).toHaveLength(1);
    expect(dst.meta.providers()[0].apiKey).toBe('sk-from-source');
  });

  it('says the remote has no bundle yet, instead of pretending it pulled something', async () => {
    const { remote } = make();
    await remote.set(config());
    await expect(remote.pull()).rejects.toThrow('远端还没有同步文件');
  });

  it('cancel forgets the preview token it was given', async () => {
    const backend = new FakeBackend();
    const src = make(backend);
    const dst = make(backend);
    await src.meta.upsertProvider({ name: 'Relay', type: 'anthropic', baseUrl: 'https://r.example', apiKey: 'sk-1' });
    await src.remote.set(config());
    await src.remote.push('pass phrase');
    await dst.remote.set(config());
    const pulled = await dst.remote.pull('pass phrase');
    dst.remote.cancel(pulled.token);
    await expect(dst.sync.apply(pulled.token)).rejects.toThrow('预览过期了');
  });
});

describe('remote sync test', () => {
  it('reports whether the remote already has a bundle, without writing', async () => {
    const { remote, backend } = make();
    await remote.set(config());
    const empty = await remote.test();
    expect(empty.remoteExists).toBe(false);
    expect(empty.message).toContain('连接成功');
    backend.files.set(SYNC_REMOTE_BUNDLE_KEY, { data: new TextEncoder().encode('{}'), etag: '"x"' });
    const exists = await remote.test();
    expect(exists.remoteExists).toBe(true);
    expect(backend.puts).toHaveLength(0);
  });
});

describe('remote sync egress guard', () => {
  const run = async (url: string, answers: string[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sync-guard-'));
    dirs.push(dir);
    const meta = new MetaStore(path.join(dir, 'meta.json'));
    const sync = new SyncService({ meta });
    const seen: string[] = [];
    const remote = new RemoteSyncService({
      meta, sync, secrets: fakeSecrets,
      fetch: async (u) => { seen.push(String(u)); return new Response(null, { status: 404 }); },
      lookup: async () => answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    });
    await remote.set(config({ webdav: { url, username: 'user', password: 'pw' } }));
    return { result: remote.test(), seen };
  };

  it('a NAS on the LAN or this machine is fine; a cloud-metadata / link-local address never gets a request', async () => {
    const lan = await run('https://nas.home/dav/', ['192.168.1.20']);
    await expect(lan.result).resolves.toMatchObject({ ok: true, remoteExists: false });
    expect(lan.seen.length).toBeGreaterThan(0);

    const meta = await run('http://metadata.test/latest/', ['169.254.169.254']);
    await expect(meta.result).rejects.toThrow();
    expect(meta.seen).toEqual([]);

    const literal = await run('http://[fe80::1]/dav/', []);
    await expect(literal.result).rejects.toThrow();
    expect(literal.seen).toEqual([]);
  });
});
