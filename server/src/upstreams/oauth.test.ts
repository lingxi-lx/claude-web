import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import {
  authorizeUrl, createPkce, createState, exchangeCode, exchangeCopilotToken, idTokenClaims,
  pollDeviceToken, startDeviceAuthorization, startLoopbackReceiver, stateMatches,
  type DeviceAuthorization,
} from './oauth.js';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});
const asFetch = (fn: (url: string, init?: RequestInit) => Promise<Response>) => fn as unknown as typeof fetch;

describe('PKCE and state', () => {
  it('derives an S256 challenge from the verifier', () => {
    const p = createPkce('a'.repeat(43));
    const expected = crypto.createHash('sha256').update(p.verifier).digest('base64url');
    expect(p.challenge).toBe(expected);
    expect(p.verifier).toHaveLength(43);
    expect(() => createPkce('short')).toThrow();
  });

  it('creates random states and compares them without leaking a prefix match', () => {
    const a = createState();
    const b = createState();
    expect(a).not.toBe(b);
    expect(stateMatches(a, a)).toBe(true);
    expect(stateMatches(a, `${a.slice(0, -1)}x`)).toBe(false);
    expect(stateMatches('', '')).toBe(false);
  });

  it('builds an authorization URL with PKCE and the extra vendor params', () => {
    const u = new URL(authorizeUrl({
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'client',
      scopes: ['openid', 'offline_access'],
      pkce: true,
      extraAuthParams: { prompt: 'login' },
    }, { redirectUri: 'http://127.0.0.1:1234/cb', state: 'st', challenge: 'ch' }));
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('client');
    expect(u.searchParams.get('scope')).toBe('openid offline_access');
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.get('code_challenge')).toBe('ch');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('prompt')).toBe('login');
  });
});

describe('loopback receiver', () => {
  it('accepts one matching callback and hands the code to the caller', async () => {
    const r = await startLoopbackReceiver({ path: '/cb', state: 's1', timeoutMs: 2_000 });
    try {
      const u = new URL(r.redirectUri);
      u.searchParams.set('state', 's1');
      u.searchParams.set('code', 'abc123');
      const res = await fetch(u);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<html');
      await expect(r.code).resolves.toBe('abc123');
    } finally {
      await r.close();
    }
  });

  it('rejects a callback whose state does not match', async () => {
    const r = await startLoopbackReceiver({ path: '/cb', state: 'right', timeoutMs: 2_000 });
    const code = r.code.catch((e) => e as Error);
    try {
      const u = new URL(r.redirectUri);
      u.searchParams.set('state', 'wrong');
      u.searchParams.set('code', 'stolen');
      const res = await fetch(u);
      expect(res.status).toBe(400);
      expect((await code).message).toMatch(/state/i);
    } finally {
      await r.close();
    }
  });

  it('closes cleanly when a login is cancelled', async () => {
    const r = await startLoopbackReceiver({ path: '/cb', state: 's', timeoutMs: 2_000 });
    const code = r.code.catch((e) => e as Error);
    await r.close();
    expect((await code).message).toBeTruthy();
  });
});

describe('authorization-code exchange', () => {
  it('sends the verifier and never the wrong grant', async () => {
    let body = '';
    const fake = asFetch(async (_url, init) => {
      body = String(init?.body ?? '');
      return response({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 's' });
    });
    const tokens = await exchangeCode(fake, {
      authorizationUrl: 'https://x/authorize',
      tokenUrl: 'https://x/token',
      clientId: 'client',
      clientSecret: 'secret',
      scopes: ['s'],
      pkce: true,
    }, { code: 'code', redirectUri: 'http://127.0.0.1/cb', verifier: 'v'.repeat(43) }, 1_000);
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code_verifier')).toBe('v'.repeat(43));
    expect(params.get('client_secret')).toBe('secret');
    expect(tokens).toMatchObject({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1000 + 3_600_000 });
  });
});

describe('device code', () => {
  const cfg = {
    deviceAuthorizationUrl: 'https://github.com/login/device/code',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientId: 'client',
    scopes: ['read:user'],
    headers: { accept: 'application/json' },
  };

  it('starts a device authorization', async () => {
    const fake = asFetch(async () => response({ device_code: 'dev', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }));
    const d = await startDeviceAuthorization(fake, cfg, 1_000);
    expect(d).toMatchObject({ deviceCode: 'dev', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', expiresAt: 901_000, intervalMs: 5_000 });
  });

  it('keeps polling through authorization_pending and stops on the token', async () => {
    let n = 0;
    const fake = asFetch(async () => {
      n++;
      if (n === 1) return response({ error: 'authorization_pending' });
      if (n === 2) return response({ error: 'slow_down' });
      return response({ access_token: 'tok', refresh_token: 'rt', expires_in: 60 });
    });
    const device: DeviceAuthorization = { deviceCode: 'dev', userCode: 'U', verificationUri: 'https://x', expiresAt: 9_999_999, intervalMs: 1 };
    const tokens = await pollDeviceToken(fake, cfg, device, { sleep: async () => {}, now: () => 1_000 });
    expect(tokens).toMatchObject({ accessToken: 'tok', refreshToken: 'rt' });
    expect(n).toBe(3);
  });

  it('stops on access_denied', async () => {
    const fake = asFetch(async () => response({ error: 'access_denied', error_description: 'no' }));
    const device: DeviceAuthorization = { deviceCode: 'dev', userCode: 'U', verificationUri: 'https://x', expiresAt: 9_999_999, intervalMs: 1 };
    await expect(pollDeviceToken(fake, cfg, device, { sleep: async () => {}, now: () => 1_000 })).rejects.toThrow();
  });
});

describe('Copilot token exchange and id_token identity', () => {
  it('exchanges a GitHub token for the Copilot token with the editor headers', async () => {
    let auth = '';
    const fake = asFetch(async (_url, init) => {
      auth = String((init?.headers as Record<string, string>).authorization);
      return response({ token: 'cop', expires_at: 1_893_456_000 });
    });
    const r = await exchangeCopilotToken(fake, 'gh', { 'editor-version': 'Neovim/0.6.1' });
    expect(auth).toBe('Bearer gh');
    expect(r.token).toBe('cop');
    expect(r.expiresAt).toBe(1_893_456_000_000);
  });

  it('reads chatgpt_account_id from the nested claims', () => {
    const payload = Buffer.from(JSON.stringify({
      email: 'a@b.c',
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' },
    })).toString('base64url');
    const claims = idTokenClaims(`x.${payload}.y`);
    expect(claims.email).toBe('a@b.c');
    expect(claims['https://api.openai.com/auth'].chatgpt_account_id).toBe('acct_123');
  });
});
