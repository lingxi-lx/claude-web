import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ProviderLoginService, readClaudeCredentials, readOpenCodeAuth, refreshProviderCredential,
} from './provider-login.js';
import type { ProviderLoginDef } from './oauth-registry.js';
import type { UpstreamAccountInput, UpstreamAccountView } from './types.js';

const asFetch = (fn: (url: string, init?: RequestInit) => Promise<Response>) => fn as unknown as typeof fetch;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

function view(input: UpstreamAccountInput, id = 'acct_1'): UpstreamAccountView {
  return {
    id,
    kind: input.kind,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    name: input.name ?? id,
    enabled: true,
    credentialKind: input.credentialKind ?? 'token',
    source: input.source ?? 'paste',
    createdAt: 1,
    updatedAt: 1,
    health: 'unknown',
    credentialMasked: 'token · ••••',
    hasProxy: false,
  };
}

function sink() {
  const inputs: UpstreamAccountInput[] = [];
  return {
    inputs,
    accounts: {
      add: vi.fn(async (input: UpstreamAccountInput) => {
        inputs.push(input);
        return { account: view(input, `acct_${inputs.length}`), duplicate: false, id: `acct_${inputs.length}` };
      }),
    },
  };
}

async function waitDone(svc: ProviderLoginService, id: string, ms = 2_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = svc.status(id);
    if (s.state !== 'pending') return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('login did not finish');
}

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cw-login-'));

describe('local credential readers', () => {
  it('reads OpenCode auth.json without modifying it (OAuth Claude + API keys)', async () => {
    const home = tempHome();
    const dir = path.join(home, '.local', 'share', 'opencode');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'auth.json');
    const body = {
      anthropic: { type: 'oauth', access: 'sk-ant-oat01-open', refresh: 'refresh', expires: 123 },
      openai: { type: 'api', key: 'sk-openai' },
      google: { type: 'api', key: 'AIza-google' },
    };
    fs.writeFileSync(file, JSON.stringify(body));
    const inputs = await readOpenCodeAuth(['~/.local/share/opencode/auth.json'], home, {});
    expect(inputs.map((x) => [x.kind, x.providerId])).toEqual([
      ['claude', undefined],
      ['provider', 'openai'],
      ['provider', 'google'],
    ]);
    expect(JSON.parse(String((fs.readFileSync(file, 'utf8'))))).toEqual(body);
  });

  it('reads Claude Code credentials, and returns nothing when the file is missing', async () => {
    const home = tempHome();
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: 'at', refreshToken: 'rt', expiresAt: 9 },
    }));
    const inputs = await readClaudeCredentials(['~/.claude/.credentials.json'], home, {});
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ kind: 'claude', credentialKind: 'oauth', source: 'file' });
    expect(await readClaudeCredentials(['~/.claude/.credentials.json'], tempHome(), {})).toEqual([]);
  });

  it('expands %VAR% paths and skips an unset variable', async () => {
    const home = tempHome();
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ openai: { type: 'api', key: 'k' } }));
    expect(await readOpenCodeAuth(['%CW_TEST_HOME%/auth.json'], home, { CW_TEST_HOME: home })).toHaveLength(1);
    expect(await readOpenCodeAuth(['%CW_TEST_MISSING%/auth.json'], home, {})).toEqual([]);
  });
});

describe('ProviderLoginService', () => {
  it('is honest about a provider without a public flow', async () => {
    const s = sink();
    const svc = new ProviderLoginService({ accounts: s.accounts, fetch: asFetch(async () => response({})) });
    const out = await svc.begin({ providerId: 'gemini' });
    expect(out.state).toBe('unavailable');
    expect(out.message).toContain('Code Assist');
    expect(s.inputs).toEqual([]);
  });

  it('imports the local OpenCode login and reports the resulting accounts', async () => {
    const home = tempHome();
    const dir = path.join(home, '.local', 'share', 'opencode');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({
      anthropic: { type: 'oauth', access: 'at', refresh: 'rt', expires: 1 },
      openai: { type: 'api', key: 'sk-o' },
    }));
    const s = sink();
    const svc = new ProviderLoginService({ accounts: s.accounts, home, env: {} });
    const out = await svc.begin({ providerId: 'opencode', mode: 'local' });
    expect(out.state).toBe('done');
    expect(out.accounts).toHaveLength(2);
    expect(s.inputs[0]).toMatchObject({ kind: 'claude', credentialKind: 'oauth' });
    expect(s.inputs[1]).toMatchObject({ kind: 'provider', providerId: 'openai' });
  });

  it('runs a loopback OAuth login end-to-end with a fake token endpoint', async () => {
    const s = sink();
    const tokenBodies: string[] = [];
    const fake = asFetch(async (url, init) => {
      if (url === 'https://example.test/token') {
        tokenBodies.push(String(init?.body ?? ''));
        return response({ access_token: 'at-oauth', refresh_token: 'rt', expires_in: 60, id_token: 'x.eyJlbWFpbCI6Im9AdGVzdC5kZXYifQ.y' });
      }
      return response({ error: 'unexpected' }, 404);
    });
    const def: ProviderLoginDef = {
      id: 'test-oauth',
      name: 'Test OAuth',
      auth: 'oauth-loopback',
      instructions: 'x',
      available: true,
      oauth: {
        authorizationUrl: 'https://example.test/authorize',
        tokenUrl: 'https://example.test/token',
        clientId: 'client',
        scopes: ['openid'],
        pkce: true,
        redirectPath: '/cb',
      },
      account: {
        kind: 'provider', providerId: 'test-oauth', credentialKind: 'oauth', protocol: 'openai',
        baseUrl: 'https://api.example.test/v1', usable: true,
      },
    };
    const svc = new ProviderLoginService({ accounts: s.accounts, fetch: fake, lookup: (id) => (id === def.id ? def : undefined) });
    const began = await svc.begin({ providerId: def.id });
    expect(began.state).toBe('pending');
    const auth = new URL(began.url!);
    const redirect = auth.searchParams.get('redirect_uri')!;
    const cb = new URL(redirect);
    cb.searchParams.set('state', auth.searchParams.get('state')!);
    cb.searchParams.set('code', 'code-1');
    expect((await fetch(cb)).status).toBe(200);
    const done = await waitDone(svc, began.id);
    expect(done.state).toBe('done');
    expect(tokenBodies).toHaveLength(1);
    expect(new URLSearchParams(tokenBodies[0]).get('code_verifier')).toBeTruthy();
    expect(s.inputs[0]).toMatchObject({ kind: 'provider', providerId: 'test-oauth', credentialKind: 'oauth' });
    const envelope = s.inputs[0].credential as Record<string, unknown>;
    expect(envelope).toMatchObject({ accessToken: 'at-oauth', refreshToken: 'rt', protocol: 'openai', baseUrl: 'https://api.example.test/v1' });
  });

  it('polls a device login and exchanges the GitHub token for a Copilot token', async () => {
    const s = sink();
    const fake = asFetch(async (url) => {
      if (url === 'https://github.test/device') {
        return response({ device_code: 'dev', user_code: 'ABCD-EFGH', verification_uri: 'https://github.test/enter', expires_in: 900, interval: 5 });
      }
      if (url === 'https://github.test/token') return response({ access_token: 'gh-token', token_type: 'bearer' });
      if (url === 'https://api.github.com/copilot_internal/v2/token') return response({ token: 'cop-token', expires_at: 1_893_456_000 });
      if (url === 'https://api.github.com/user') return response({ login: 'octocat', email: 'octo@example.test' });
      return response({ error: 'unexpected' }, 404);
    });
    const def: ProviderLoginDef = {
      id: 'test-copilot',
      name: 'Test Copilot',
      auth: 'device-code',
      instructions: 'x',
      available: true,
      device: {
        deviceAuthorizationUrl: 'https://github.test/device',
        tokenUrl: 'https://github.test/token',
        clientId: 'client',
        scopes: ['read:user'],
        identityUrl: 'https://api.github.com/user',
      },
      account: {
        kind: 'provider', providerId: 'test-copilot', credentialKind: 'token', protocol: 'openai',
        baseUrl: 'https://api.githubcopilot.com', chatPath: '/chat/completions', exchange: 'copilot', usable: true,
      },
    };
    const svc = new ProviderLoginService({
      accounts: s.accounts, fetch: fake, minDevicePollMs: 10,
      lookup: (id) => (id === def.id ? def : undefined),
    });
    const began = await svc.begin({ providerId: def.id });
    expect(began.state).toBe('pending');
    expect(began.userCode).toBe('ABCD-EFGH');
    const done = await waitDone(svc, began.id);
    expect(done.state).toBe('done');
    const envelope = s.inputs[0].credential as Record<string, unknown>;
    expect(envelope).toMatchObject({ token: 'cop-token', refreshToken: 'gh-token', providerId: 'test-copilot', chatPath: '/chat/completions' });
  });

  it('adds a pasted token through the same account mapping', async () => {
    const s = sink();
    const def: ProviderLoginDef = {
      id: 'test-paste', name: 'Test Paste', auth: 'paste-token', instructions: 'x', available: true,
      paste: { placeholder: 'token' },
      account: { kind: 'provider', providerId: 'test-paste', credentialKind: 'token', protocol: 'openai', baseUrl: 'https://api.example.test/v1', usable: true },
    };
    const svc = new ProviderLoginService({ accounts: s.accounts, lookup: (id) => (id === def.id ? def : undefined) });
    const out = await svc.begin({ providerId: def.id, mode: 'paste', credential: 'pasted-token' });
    expect(out.state).toBe('done');
    expect(s.inputs[0].credential).toMatchObject({ token: 'pasted-token', providerId: 'test-paste' });
  });

  it('cancels a pending loopback login', async () => {
    const s = sink();
    const def: ProviderLoginDef = {
      id: 'test-cancel', name: 'Cancel', auth: 'oauth-loopback', instructions: 'x', available: true,
      oauth: { authorizationUrl: 'https://example.test/a', tokenUrl: 'https://example.test/t', clientId: 'c', scopes: ['s'], pkce: true },
      account: { kind: 'provider', providerId: 'test-cancel', credentialKind: 'oauth', protocol: 'openai', baseUrl: 'https://x/v1', usable: true },
    };
    const svc = new ProviderLoginService({ accounts: s.accounts, lookup: (id) => (id === def.id ? def : undefined) });
    const began = await svc.begin({ providerId: def.id });
    await svc.cancel(began.id);
    expect(svc.status(began.id).state).toBe('cancelled');
  });
});

describe('token refresh', () => {
  it('refreshes a Codex OAuth credential with its refresh grant', async () => {
    let body = '';
    const fake = asFetch(async (_url, init) => {
      body = String(init?.body ?? '');
      return response({ access_token: 'new-at', refresh_token: 'new-rt', expires_in: 60 });
    });
    const out = await refreshProviderCredential(fake, 'codex', { kind: 'oauth', providerId: 'codex', accessToken: 'old', refreshToken: 'rt', protocol: 'responses', baseUrl: 'https://chatgpt.com/backend-api/codex' }, 1_000);
    expect(out).toMatchObject({ accessToken: 'new-at', refreshToken: 'new-rt', expiresAt: 61_000 });
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
  });

  it('refreshes Copilot by exchanging the stored GitHub token again', async () => {
    const fake = asFetch(async (url) => {
      expect(url).toBe('https://api.github.com/copilot_internal/v2/token');
      return response({ token: 'cop-new', expires_at: 1_893_456_000 });
    });
    const out = await refreshProviderCredential(fake, 'copilot', { kind: 'token', providerId: 'copilot', token: 'old', refreshToken: 'gh' }, 1_000);
    expect(out).toMatchObject({ token: 'cop-new', refreshToken: 'gh', expiresAt: 1_893_456_000_000 });
  });
});
