// 来源健康: the models probe + optional one-token call, rate limits, 429 cooldown shown and respected.
import { describe, expect, it } from 'vitest';
import type { Provider } from '../protocol.js';
import { QuotaTracker } from '../routing/quota.js';
import { CHAT_MIN_MS, PROBE_MIN_MS, SourceHealth, chatRequest, handleSourceHealthRequest, isSourceHealthRequest, modelsRequest } from './health.js';

const kilo: Provider = { id: 'kilo', name: 'Kilo', type: 'openai', baseUrl: 'https://api.kilo.ai/api/gateway/v1', apiKey: 'anonymous', createdAt: 0, models: ['free-model'] } as Provider;
const anth: Provider = { id: 'an', name: 'An', type: 'anthropic', baseUrl: 'https://relay.example/v1', apiKey: 'k', createdAt: 0, defaultModel: 'claude-haiku-4-5' } as Provider;

function setup(responses: ((url: string, init: any) => Response)[]) {
  let now = 1_800_000_000_000;
  const calls: { url: string; init: any }[] = [];
  const quota = new QuotaTracker(() => now);
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const f = responses.shift();
    if (!f) throw new Error('unexpected fetch');
    return f(String(url), init);
  }) as typeof fetch;
  const svc = new SourceHealth({
    providers: { list: () => [kilo, anth, { ...kilo, id: 'gw', type: 'gateway' } as Provider], member: (id) => (id === 'kilo' ? kilo : id === 'an' ? anth : null) },
    quota, fetch: fetchImpl, clock: () => now,
  });
  return { svc, calls, quota, tick: (ms: number) => { now += ms; }, now: () => now };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('request shapes', () => {
  it('models + one-token call use the session\'s base and credential style', () => {
    expect(modelsRequest(kilo).url).toBe('https://api.kilo.ai/api/gateway/v1/models');
    expect(modelsRequest(kilo).headers.authorization).toBe('Bearer anonymous');
    expect(modelsRequest(anth).url).toBe('https://relay.example/v1/models');
    expect(modelsRequest(anth).headers['anthropic-version']).toBe('2023-06-01');
    const c = chatRequest(kilo, 'free-model')!;
    expect(c.url).toBe('https://api.kilo.ai/api/gateway/v1/chat/completions');
    expect(JSON.parse(c.body).max_tokens).toBe(1);
    expect(JSON.parse(chatRequest(anth, 'h')!.body).max_tokens).toBe(1);
    expect(chatRequest({ ...kilo, type: 'gemini' } as Provider, 'g')).toBeNull();
  });
});

describe('SourceHealth', () => {
  it('probes the models list, then the one-token call when asked; headers feed the quota', async () => {
    const { svc, calls } = setup([
      json(200, { data: [{ id: 'free-model' }] }),
      json(200, { choices: [{ message: { content: 'o' } }] }, { 'x-ratelimit-limit-requests': '50', 'x-ratelimit-remaining-requests': '45' }),
    ]);
    const v = await svc.probe('kilo', true);
    expect(calls.map((c) => c.url)).toEqual(['https://api.kilo.ai/api/gateway/v1/models', 'https://api.kilo.ai/api/gateway/v1/chat/completions']);
    expect(v.state).toBe('ok');
    expect(v.probe).toMatchObject({ ok: true, models: 1 });
    expect(v.chat).toMatchObject({ ok: true, status: 200 });
    expect(v.quota?.remaining).toBe(0.9);
  });

  it('rate-limited: a second probe inside the window makes no request', async () => {
    const { svc, calls, tick } = setup([json(200, { data: [] }), json(200, { choices: [] }), json(200, { data: [] })]);
    await svc.probe('kilo', true);
    expect(calls).toHaveLength(2);
    await svc.probe('kilo', true);
    expect(calls).toHaveLength(2);
    tick(PROBE_MIN_MS);
    await svc.probe('kilo', true); // list again; the chat waits for its own (longer) window
    expect(calls).toHaveLength(3);
    expect(CHAT_MIN_MS).toBeGreaterThan(PROBE_MIN_MS);
  });

  it('a 429 shows as cooling with its retry-after, and no probe goes out until it ends', async () => {
    const { svc, calls, tick, now } = setup([json(429, { error: { message: 'rate limited' } }, { 'retry-after': '120' }), json(200, { data: [] })]);
    const v = await svc.probe('kilo');
    expect(v.state).toBe('cooling');
    expect(v.quota?.cooldownUntil).toBe(now() + 120_000);
    expect(v.probe?.error).toMatch(/429 rate limited/);
    tick(PROBE_MIN_MS);
    await svc.probe('kilo');
    expect(calls).toHaveLength(1);
    tick(120_000);
    expect((await svc.probe('kilo')).state).toBe('ok');
    expect(calls).toHaveLength(2);
  });

  it('the gateway\'s own 429 (shared tracker) shows on the card without any probe', () => {
    const { svc, quota, now } = setup([]);
    quota.observe('p:an', 429, { 'retry-after': '30' }, now());
    const st = svc.status();
    expect(st.sources.map((s) => s.providerId)).toEqual(['kilo', 'an']); // the gateway profile is not a source here
    expect(st.sources.find((s) => s.providerId === 'an')?.state).toBe('cooling');
  });

  it('a failed list is an error; a network failure too', async () => {
    const { svc } = setup([json(401, { error: { message: 'bad key' } })]);
    const v = await svc.probe('an');
    expect(v.state).toBe('error');
    expect(v.probe?.error).toMatch(/401 bad key/);
    const s2 = setup([() => { throw new Error('ECONNREFUSED'); }]);
    expect((await s2.svc.probe('kilo')).probe?.error).toMatch(/ECONNREFUSED/);
  });

  it('dispatch: kinds, a missing id, an unknown source', async () => {
    const { svc } = setup([]);
    expect(isSourceHealthRequest({ kind: 'channels.health.status' })).toBe(true);
    expect(isSourceHealthRequest({ kind: 'channels.status' })).toBe(false);
    await expect(handleSourceHealthRequest(svc, { kind: 'channels.health.probe', providerId: '' })).rejects.toThrow();
    await expect(handleSourceHealthRequest(svc, { kind: 'channels.health.probe', providerId: 'nope' })).rejects.toThrow();
    expect(await handleSourceHealthRequest(svc, { kind: 'channels.health.status' })).toHaveProperty('sources');
  });
});
