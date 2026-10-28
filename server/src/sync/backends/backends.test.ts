// Fake-fetch tests for the three sync backends: put/get round-trips, conditional writes, lock/unlock, and the
// safety rule that a key can never escape the remote prefix. No real network is touched.
import { describe, expect, it } from 'vitest';
import type { FetchLike } from './types.js';
import { SyncConflictError } from './types.js';
import { WebDavBackend } from './webdav.js';
import { S3Backend } from './s3.js';
import { GitHubBackend } from './github.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body === undefined || body === null) return new Uint8Array();
  if (typeof body === 'string') return enc.encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return enc.encode(String(body));
}

const json = (v: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...extra } });

const text = (s: string, status = 200, extra: Record<string, string> = {}) => new Response(status === 204 ? null : s, { status, headers: extra });

function webdavFake() {
  const files = new Map<string, { data: Uint8Array; etag: string }>();
  const locks = new Map<string, string>();
  let n = 0;
  let lastAuth = '';
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/dav\//, '');
    const method = String(init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    lastAuth = headers.get('authorization') ?? '';
    if (method === 'PUT') {
      if (headers.get('if-none-match') === '*' && files.has(path)) return text('exists', 412);
      const match = headers.get('if-match');
      if (match && files.get(path)?.etag !== match) return text('changed', 412);
      const etag = `"v${++n}"`;
      files.set(path, { data: await bodyBytes(init.body), etag });
      return text('', 201, { etag });
    }
    if (method === 'GET') {
      const f = files.get(path);
      return f ? new Response(Buffer.from(f.data), { status: 200, headers: { etag: f.etag } }) : text('missing', 404);
    }
    if (method === 'LOCK') {
      if (locks.has(path)) return text('locked', 423);
      const token = `opaquelocktoken:${++n}`;
      locks.set(path, token);
      return text('', 200, { 'lock-token': `<${token}>` });
    }
    if (method === 'UNLOCK') {
      const token = (headers.get('lock-token') ?? '').replace(/^<|>$/g, '');
      if (locks.get(path) !== token) return text('not held', 409);
      locks.delete(path);
      return text('', 204);
    }
    return text('bad method', 405);
  };
  return { fetch, files, locks, auth: () => lastAuth };
}

function s3Fake() {
  const files = new Map<string, { data: Uint8Array; etag: string }>();
  let n = 0;
  const seen: Record<string, string>[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    const key = url.pathname.replace(/^\/bucket\//, '');
    const method = String(init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    seen.push(Object.fromEntries(headers.entries()));
    if (method === 'PUT') {
      if (headers.get('if-none-match') === '*' && files.has(key)) return text('exists', 412);
      const match = headers.get('if-match');
      if (match && files.get(key)?.etag !== match) return text('changed', 412);
      const etag = `"s${++n}"`;
      files.set(key, { data: await bodyBytes(init.body), etag });
      return text('', 200, { etag });
    }
    if (method === 'GET') {
      const f = files.get(key);
      return f ? new Response(Buffer.from(f.data), { status: 200, headers: { etag: f.etag } }) : text('missing', 404);
    }
    if (method === 'DELETE') {
      const f = files.get(key);
      if (!f) return text('missing', 404);
      const match = headers.get('if-match');
      if (match && f.etag !== match) return text('changed', 412);
      files.delete(key);
      return text('', 204);
    }
    return text('bad method', 405);
  };
  return { fetch, files, seen };
}

function githubFake() {
  const files = new Map<string, { data: Uint8Array; sha: string }>();
  let n = 0;
  const seen: Record<string, string>[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    const prefix = '/repos/o/r/contents/';
    if (!url.pathname.startsWith(prefix)) return text('bad path', 404);
    const key = url.pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
    const method = String(init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    seen.push(Object.fromEntries(headers.entries()));
    if (method === 'GET') {
      const f = files.get(key);
      return f
        ? json({ type: 'file', sha: f.sha, encoding: 'base64', content: Buffer.from(f.data).toString('base64') })
        : json({ message: 'Not Found' }, 404);
    }
    if (method === 'PUT') {
      const body = JSON.parse(dec.decode(await bodyBytes(init.body))) as { content: string; sha?: string };
      const cur = files.get(key);
      if (cur) {
        if (!body.sha) return json({ message: 'sha was not supplied' }, 422);
        if (body.sha !== cur.sha) return json({ message: 'sha does not match' }, 409);
      } else if (body.sha) {
        return json({ message: 'sha does not match' }, 409);
      }
      const sha = `sha${++n}`;
      files.set(key, { data: new Uint8Array(Buffer.from(body.content, 'base64')), sha });
      return json({ content: { sha } }, cur ? 200 : 201);
    }
    if (method === 'DELETE') {
      const body = JSON.parse(dec.decode(await bodyBytes(init.body))) as { sha: string };
      const cur = files.get(key);
      if (!cur) return json({ message: 'Not Found' }, 404);
      if (body.sha !== cur.sha) return json({ message: 'sha does not match' }, 409);
      files.delete(key);
      return text('', 200);
    }
    return json({ message: 'bad method' }, 405);
  };
  return { fetch, files, seen };
}

describe('WebDAV sync backend', () => {
  it('puts / gets / conditionally writes through the injected fetch, with Basic auth', async () => {
    const f = webdavFake();
    const b = new WebDavBackend({ baseUrl: 'https://dav.test/dav', username: 'u', password: 'p', fetch: f.fetch });
    expect(await b.get('state/bundle.json')).toBeNull();
    const put = await b.put('state/bundle.json', enc.encode('hello'), { ifNoneMatch: true });
    expect(put.etag).toBeTruthy();
    expect(dec.decode((await b.get('state/bundle.json'))!.data)).toBe('hello');
    expect(f.auth()).toMatch(/^Basic /);
    await expect(b.put('state/bundle.json', enc.encode('x'), { ifNoneMatch: true })).rejects.toBeInstanceOf(SyncConflictError);
    await expect(b.put('state/bundle.json', enc.encode('x'), { ifMatch: '"wrong"' })).rejects.toBeInstanceOf(SyncConflictError);
    await b.put('state/bundle.json', enc.encode('new'), { ifMatch: put.etag });
    expect(dec.decode((await b.get('state/bundle.json'))!.data)).toBe('new');
  });

  it('locks once, refuses a second owner, and unlocks', async () => {
    const f = webdavFake();
    const b = new WebDavBackend({ baseUrl: 'https://dav.test/dav', fetch: f.fetch });
    await b.put('state/bundle.json', enc.encode('x'));
    const first = await b.lock('state/bundle.json', 'laptop');
    expect(first?.token).toBeTruthy();
    expect(await b.lock('state/bundle.json', 'desktop')).toBeNull();
    await b.unlock('state/bundle.json', first!);
    expect(await b.lock('state/bundle.json', 'desktop')).not.toBeNull();
  });

  it('refuses keys that escape the prefix', async () => {
    const b = new WebDavBackend({ baseUrl: 'https://dav.test/dav', fetch: webdavFake().fetch });
    await expect(b.get('../secret')).rejects.toThrow();
    await expect(b.put('/etc/passwd', enc.encode('x'))).rejects.toThrow();
    await expect(b.lock('a/../../b', 'x')).rejects.toThrow();
  });
});

describe('S3 sync backend', () => {
  it('signs every request with SigV4 and round-trips objects', async () => {
    const f = s3Fake();
    const b = new S3Backend({
      endpoint: 'https://s3.test', region: 'eu-west-1', bucket: 'bucket',
      accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', sessionToken: 'session', fetch: f.fetch,
      now: () => new Date('2026-10-27T12:00:00Z'),
    });
    expect(await b.get('state/bundle.json')).toBeNull();
    await b.put('state/bundle.json', enc.encode('hello'));
    expect(dec.decode((await b.get('state/bundle.json'))!.data)).toBe('hello');
    const auth = f.seen[0].authorization;
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261027\/eu-west-1\/s3\/aws4_request/);
    expect(auth).toMatch(/SignedHeaders=.*x-amz-content-sha256/);
    expect(f.seen[0]['x-amz-date']).toBe('20261027T120000Z');
    expect(f.seen[0]['x-amz-security-token']).toBe('session');
    expect(f.seen[0]['x-amz-content-sha256']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('conditional writes and the lock object behave like the other backends', async () => {
    const f = s3Fake();
    const b = new S3Backend({ endpoint: 'https://s3.test', bucket: 'bucket', accessKeyId: 'AK', secretAccessKey: 'SK', prefix: 'sync', fetch: f.fetch });
    const first = await b.put('state/bundle.json', enc.encode('one'), { ifNoneMatch: true });
    await expect(b.put('state/bundle.json', enc.encode('two'), { ifNoneMatch: true })).rejects.toBeInstanceOf(SyncConflictError);
    await expect(b.put('state/bundle.json', enc.encode('two'), { ifMatch: '"stale"' })).rejects.toBeInstanceOf(SyncConflictError);
    await b.put('state/bundle.json', enc.encode('two'), { ifMatch: first.etag });
    expect(f.files.has('sync/state/bundle.json')).toBe(true);
    const lock = await b.lock('state/bundle.json', 'laptop', 60_000);
    expect(lock).not.toBeNull();
    expect(await b.lock('state/bundle.json', 'desktop', 60_000)).toBeNull();
    await b.unlock('state/bundle.json', lock!);
    expect(await b.lock('state/bundle.json', 'desktop', 60_000)).not.toBeNull();
  });
});

describe('GitHub sync backend', () => {
  it('round-trips via the Contents API, using the file sha for an update', async () => {
    const f = githubFake();
    const b = new GitHubBackend({ owner: 'o', repo: 'r', token: 'tok', branch: 'main', fetch: f.fetch });
    expect(await b.get('state/bundle.json')).toBeNull();
    const first = await b.put('state/bundle.json', enc.encode('one'));
    expect(first.etag).toMatch(/^sha/);
    expect(dec.decode((await b.get('state/bundle.json'))!.data)).toBe('one');
    // unconditional put reads the sha first, so a second put updates rather than failing
    await b.put('state/bundle.json', enc.encode('two'));
    expect(dec.decode((await b.get('state/bundle.json'))!.data)).toBe('two');
    expect(f.seen[0].authorization).toBe('Bearer tok');
    expect(f.seen[0].accept).toBe('application/vnd.github+json');
    await expect(b.put('state/bundle.json', enc.encode('x'), { ifMatch: 'sha-wrong' })).rejects.toBeInstanceOf(SyncConflictError);
  });

  it('locks with a lock file and unlocks it', async () => {
    const f = githubFake();
    const b = new GitHubBackend({ owner: 'o', repo: 'r', token: 'tok', fetch: f.fetch });
    const lock = await b.lock('state/bundle.json', 'laptop', 60_000);
    expect(lock).not.toBeNull();
    expect(await b.lock('state/bundle.json', 'desktop', 60_000)).toBeNull();
    await b.unlock('state/bundle.json', lock!);
    expect(await b.lock('state/bundle.json', 'desktop', 60_000)).not.toBeNull();
  });

  it('refuses traversal keys', async () => {
    const b = new GitHubBackend({ owner: 'o', repo: 'r', token: 'tok', fetch: githubFake().fetch });
    await expect(b.get('../x')).rejects.toThrow();
    await expect(b.put('..\\x', enc.encode('x'))).rejects.toThrow();
  });
});
