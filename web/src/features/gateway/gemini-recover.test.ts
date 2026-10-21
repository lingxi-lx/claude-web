import { describe, expect, it, vi, beforeEach } from 'vitest';

const sent: { kind: string; [k: string]: unknown }[] = [];
let refreshed: { cookie: string; userAgent: string } | null = { cookie: 'SID=1; SAPISID=2', userAgent: 'UA' };

vi.mock('@/ws/client', () => ({
  ws: {
    request: (r: { kind: string }) => {
      sent.push(r);
      if (r.kind === 'upstreams.probe') return Promise.resolve({ id: 'acct_1', health: 'ok' });
      return Promise.resolve({});
    },
  },
}));

vi.mock('@/desktop', () => ({
  desktop: { geminiRefresh: async () => refreshed },
}));

vi.mock('@/store', () => ({
  useStore: {
    getState: () => ({
      settings: { 'gateway.geminiLogins': { acct_1: 'persist:gemini-abcdef12' } },
      setSetting: async () => {},
      toast: () => {},
    }),
  },
}));

beforeEach(() => {
  sent.length = 0;
  refreshed = { cookie: 'SID=1; SAPISID=2', userAgent: 'UA' };
  vi.resetModules();
});

const load = () => import('./gemini-login');

describe('recoverGeminiAccount', () => {
  it('writes the renewed cookie back, re-enables the account and checks it', async () => {
    const { recoverGeminiAccount } = await load();
    expect(await recoverGeminiAccount('acct_1')).toBe(true);
    expect(sent.find((r) => r.kind === 'upstreams.update')).toMatchObject({
      id: 'acct_1',
      patch: { credential: { cookie: 'SID=1; SAPISID=2', userAgent: 'UA' }, enabled: true },
    });
    expect(sent.some((r) => r.kind === 'upstreams.probe')).toBe(true);
  });

  it('tries a given account at most once an hour', async () => {
    const { recoverGeminiAccount } = await load();
    expect(await recoverGeminiAccount('acct_1')).toBe(true);
    const after = sent.length;
    expect(await recoverGeminiAccount('acct_1')).toBe(false);
    expect(sent.length).toBe(after);
  });

  it('does nothing for an account with no Chrome profile behind it', async () => {
    const { recoverGeminiAccount } = await load();
    expect(await recoverGeminiAccount('acct_unknown')).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('leaves the account alone when Chrome had no new cookie to give', async () => {
    refreshed = null;
    const { recoverGeminiAccount } = await load();
    expect(await recoverGeminiAccount('acct_1')).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
