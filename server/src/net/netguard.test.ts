import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addressAllowed, checkUrl, classifyAddress, guardedAgent, guardedFetch, v6Bytes, type LookupAll } from './netguard.js';

const fixed = (map: Record<string, string[]>): LookupAll => async (host) => {
  const list = map[host];
  if (!list) throw new Error('ENOTFOUND');
  return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

describe('netguard address classes', () => {
  it('classifies IPv4 ranges', () => {
    expect(classifyAddress('8.8.8.8')).toBe('public');
    expect(classifyAddress('127.0.0.1')).toBe('loopback');
    expect(classifyAddress('127.255.0.9')).toBe('loopback');
    expect(classifyAddress('10.1.2.3')).toBe('private');
    expect(classifyAddress('172.16.0.1')).toBe('private');
    expect(classifyAddress('172.32.0.1')).toBe('public');
    expect(classifyAddress('192.168.1.1')).toBe('private');
    expect(classifyAddress('100.64.0.1')).toBe('private');
    expect(classifyAddress('169.254.169.254')).toBe('metadata');
    expect(classifyAddress('169.254.10.1')).toBe('link-local');
    expect(classifyAddress('0.0.0.0')).toBe('unspecified');
    expect(classifyAddress('224.0.0.1')).toBe('multicast');
    expect(classifyAddress('255.255.255.255')).toBe('reserved');
    expect(classifyAddress('198.18.0.5')).toBe('fake-ip');
    expect(classifyAddress('192.0.2.1')).toBe('reserved');
  });

  it('classifies IPv6, including IPv4 hidden inside', () => {
    expect(classifyAddress('::1')).toBe('loopback');
    expect(classifyAddress('[::1]')).toBe('loopback');
    expect(classifyAddress('::')).toBe('unspecified');
    expect(classifyAddress('fe80::1%eth0')).toBe('link-local');
    expect(classifyAddress('fd00::1')).toBe('private');
    expect(classifyAddress('fc12::1')).toBe('private');
    expect(classifyAddress('fd00:ec2::254')).toBe('metadata');
    expect(classifyAddress('ff02::1')).toBe('multicast');
    expect(classifyAddress('2001:db8::1')).toBe('reserved');
    expect(classifyAddress('2606:4700::1111')).toBe('public');
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('loopback');
    expect(classifyAddress('::ffff:169.254.169.254')).toBe('metadata');
    expect(classifyAddress('::ffff:8.8.8.8')).toBe('public');
    expect(classifyAddress('64:ff9b::a9fe:a9fe')).toBe('metadata'); // NAT64 of 169.254.169.254
    expect(classifyAddress('2002:7f00:1::1')).toBe('loopback'); // 6to4 of 127.0.0.1
    expect(classifyAddress('not-an-ip')).toBe('invalid');
    expect(v6Bytes('1:2:3:4:5:6:7:8')?.[15]).toBe(8);
  });

  it('policies widen in order and never allow metadata / link-local', () => {
    expect(addressAllowed('192.168.1.2', 'public')).toBe(false);
    expect(addressAllowed('192.168.1.2', 'lan')).toBe(true);
    expect(addressAllowed('127.0.0.1', 'lan')).toBe(false);
    expect(addressAllowed('127.0.0.1', 'local')).toBe(true);
    for (const p of ['public', 'lan', 'local'] as const) {
      expect(addressAllowed('169.254.169.254', p)).toBe(false);
      expect(addressAllowed('fe80::1', p)).toBe(false);
      expect(addressAllowed('0.0.0.0', p)).toBe(false);
      expect(addressAllowed('8.8.8.8', p)).toBe(true);
    }
  });
});

describe('checkUrl', () => {
  const lookup = fixed({
    'api.example.com': ['93.184.216.34'],
    'nas.home': ['192.168.1.20'],
    'rebind.test': ['93.184.216.34', '127.0.0.1'],
    'meta.test': ['169.254.169.254'],
  });

  it('refuses bad schemes and credentials', async () => {
    await expect(checkUrl('ftp://api.example.com', { policy: 'public', lookup })).rejects.toThrow();
    await expect(checkUrl('https://u:p@api.example.com', { policy: 'public', lookup })).rejects.toThrow();
    await expect(checkUrl('http://api.example.com', { policy: 'public', lookup, protocols: ['https:'] })).rejects.toThrow();
    await expect(checkUrl('not a url', { policy: 'public', lookup })).rejects.toThrow();
  });

  it('judges every DNS answer, literal IPs and localhost names', async () => {
    await expect(checkUrl('https://api.example.com/x', { policy: 'public', lookup })).resolves.toBeInstanceOf(URL);
    await expect(checkUrl('https://nas.home/dav', { policy: 'public', lookup })).rejects.toMatchObject({ code: 'EGRESS_DENIED', cls: 'private' });
    await expect(checkUrl('https://nas.home/dav', { policy: 'lan', lookup })).resolves.toBeInstanceOf(URL);
    await expect(checkUrl('https://rebind.test', { policy: 'lan', lookup })).rejects.toMatchObject({ cls: 'loopback' });
    await expect(checkUrl('http://meta.test/latest', { policy: 'local', lookup })).rejects.toMatchObject({ cls: 'metadata' });
    await expect(checkUrl('http://169.254.169.254/', { policy: 'local', lookup })).rejects.toMatchObject({ cls: 'metadata' });
    await expect(checkUrl('http://[::ffff:7f00:1]/', { policy: 'lan', lookup })).rejects.toMatchObject({ cls: 'loopback' });
    await expect(checkUrl('http://localhost:4318', { policy: 'lan', lookup })).rejects.toMatchObject({ cls: 'loopback' });
    await expect(checkUrl('http://localhost:4318', { policy: 'local', lookup })).resolves.toBeInstanceOf(URL);
    await expect(checkUrl('http://nowhere.test', { policy: 'public', lookup })).rejects.toThrow();
  });
});

describe('guardedFetch', () => {
  it('re-checks every redirect hop', async () => {
    const lookup = fixed({ 'a.example.com': ['93.184.216.34'] });
    const calls: string[] = [];
    const fake = async (u: string | URL | Request) => {
      calls.push(String(u));
      return String(u).startsWith('https://a.example.com/start')
        ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } })
        : new Response('ok');
    };
    const f = guardedFetch({ policy: 'public', lookup, fetch: fake });
    await expect(f('https://a.example.com/start')).rejects.toMatchObject({ cls: 'metadata' });
    expect(calls).toEqual(['https://a.example.com/start']);
    // redirect: 'manual' hands the 3xx back untouched
    const r = await f('https://a.example.com/start', { redirect: 'manual' });
    expect(r.status).toBe(302);
  });

  it('follows a safe redirect', async () => {
    const lookup = fixed({ 'a.example.com': ['93.184.216.34'], 'b.example.com': ['93.184.216.35'] });
    const fake = async (u: string | URL | Request) => (String(u).includes('a.example.com')
      ? new Response(null, { status: 301, headers: { location: 'https://b.example.com/final' } })
      : new Response(`at ${String(u)}`));
    const r = await guardedFetch({ policy: 'public', lookup, fetch: fake })('https://a.example.com/');
    expect(await r.text()).toBe('at https://b.example.com/final');
  });

  it('credentials stay on their origin: a redirect to another host keeps only plain headers (no Authorization, Cookie, x-api-key, tokens)', async () => {
    const lookup = fixed({ 'a.example.com': ['93.184.216.34'], 'b.example.com': ['93.184.216.35'] });
    const seen: Record<string, Headers> = {};
    const fake = async (u: string | URL | Request, i?: RequestInit) => {
      const s = String(u);
      seen[new URL(s).host + new URL(s).pathname] = new Headers(i?.headers);
      if (s.endsWith('/start')) return new Response(null, { status: 302, headers: { location: 'https://a.example.com/same' } });
      if (s.endsWith('/same')) return new Response(null, { status: 302, headers: { location: 'https://b.example.com/other' } });
      return new Response('ok');
    };
    const headers = { authorization: 'Bearer SECRET', cookie: 'sid=1', 'proxy-authorization': 'Basic x', 'x-api-key': 'k', 'x-amz-security-token': 't', 'content-type': 'application/json' };
    await guardedFetch({ policy: 'public', lookup, fetch: fake })('https://a.example.com/start', { headers });
    expect(seen['a.example.com/same'].get('authorization')).toBe('Bearer SECRET');
    const other = seen['b.example.com/other'];
    expect(other.get('authorization')).toBeNull();
    expect(other.get('cookie')).toBeNull();
    expect(other.get('proxy-authorization')).toBeNull();
    expect(other.get('x-api-key')).toBeNull();
    expect(other.get('x-amz-security-token')).toBeNull();
    expect(other.get('content-type')).toBe('application/json');
  });

  describe('connect-time check (DNS rebinding)', () => {
    let server: http.Server;
    let port = 0;
    beforeAll(async () => {
      server = http.createServer((_q, s) => s.end('secret'));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it('a name that answered public at check time and loopback at connect time is refused', async () => {
      let n = 0;
      // first answer (the pre-check) is public, the second (the dial) is loopback
      const flip: LookupAll = async () => [{ address: n++ === 0 ? '93.184.216.34' : '127.0.0.1', family: 4 }];
      const agent = guardedAgent('lan', flip);
      const f = guardedFetch({ policy: 'lan', lookup: flip, fetch: (u, i) => fetch(u, { ...i, dispatcher: agent } as RequestInit) });
      await expect(f(`http://rebind.test:${port}/`)).rejects.toThrow();
      await agent.close();
    });

    it('the same server is reachable when loopback is allowed', async () => {
      const lo: LookupAll = async () => [{ address: '127.0.0.1', family: 4 }];
      const agent = guardedAgent('local', lo);
      const f = guardedFetch({ policy: 'local', lookup: lo, fetch: (u, i) => fetch(u, { ...i, dispatcher: agent } as RequestInit) });
      expect(await (await f(`http://svc.test:${port}/`)).text()).toBe('secret');
      await agent.close();
    });
  });
});
