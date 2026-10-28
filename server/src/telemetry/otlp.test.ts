import { describe, expect, it } from 'vitest';
import type { GatewayAuditLine } from '../gateway/types';
import { handleTelemetryRequest, MASK, metricsPayload, OTLP_SETTING, OtlpExporter, signalUrls, toRecord, tracesPayload } from './otlp';

function fakeMeta(audit = true) {
  const settings: Record<string, unknown> = {};
  return {
    settings: () => settings,
    setSetting: async (k: string, v: unknown) => { settings[k] = v; },
    gatewayAudit: () => ({ enabled: audit, maxBytes: 1, keepFiles: 1 }) as never,
  };
}
const secrets = { protect: async (p: string) => `enc:test:${Buffer.from(p).toString('base64')}`, reveal: async (v?: string) => Buffer.from(String(v).slice('enc:test:'.length), 'base64').toString() };
const lookup = async (host: string) => [{ address: host === 'collector.lan' ? '192.168.1.5' : host === 'meta.test' ? '169.254.169.254' : '93.184.216.34', family: 4 }];

const line = (o: Partial<GatewayAuditLine> = {}): GatewayAuditLine => ({
  ts: 1_800_000_000_000, keyId: 'gk_secret_id', ip: '10.1.2.3', protocol: 'anthropic', model: 'claude-x', routeGroupId: 'rg1',
  member: 'My Relay', status: 200, ms: 1500, tokensIn: 1200, tokensOut: 300, errorCode: '', ...o,
} as GatewayAuditLine);

describe('payloads', () => {
  it('carry model / source / status / latency / tokens and never the key id, IP or anything else', () => {
    const rec = toRecord({ ...line(), prompt: 'TOP SECRET PROMPT', authorization: 'Bearer sk-live' } as unknown as GatewayAuditLine);
    const t = JSON.stringify(tracesPayload([rec], { serviceName: 'claude-web', version: '1.2.3' }));
    const m = JSON.stringify(metricsPayload([rec], { serviceName: 'claude-web', version: '1.2.3', startMs: 0, endMs: 1 }));
    for (const s of [t, m]) {
      expect(s).toContain('claude-x');
      expect(s).toContain('My Relay');
      expect(s).not.toContain('gk_secret_id');
      expect(s).not.toContain('10.1.2.3');
      expect(s).not.toContain('TOP SECRET');
      expect(s).not.toContain('sk-live');
    }
    const span = tracesPayload([rec], { serviceName: 's', version: 'v' }).resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)).toBe(1_500_000_000n);
    expect(span.status.code).toBe(1);
    expect(span.attributes).toContainEqual({ key: 'gen_ai.usage.input_tokens', value: { intValue: '1200' } });
    const failed = tracesPayload([toRecord(line({ status: 502, errorCode: 'upstream_error' }))], { serviceName: 's', version: 'v' }).resourceSpans[0].scopeSpans[0].spans[0];
    expect(failed.status).toEqual({ code: 2, message: 'upstream_error' });
  });

  it('metrics: request sum and histograms grouped by attributes', () => {
    const recs = [toRecord(line()), toRecord(line({ ms: 100 })), toRecord(line({ model: 'other' }))];
    const ms = metricsPayload(recs, { serviceName: 's', version: 'v', startMs: 0, endMs: 10 }).resourceMetrics[0].scopeMetrics[0].metrics;
    const reqs = ms.find((x) => x.name === 'claude_web.gateway.requests')!.sum!.dataPoints;
    expect(reqs.map((d) => d.asInt).sort()).toEqual(['1', '2']);
    const dur = ms.find((x) => x.name === 'gen_ai.client.operation.duration')!.histogram!.dataPoints;
    const two = dur.find((d) => d.count === '2')!;
    expect(two.sum).toBeCloseTo(1.6);
    expect(two.bucketCounts.reduce((a, b) => a + Number(b), 0)).toBe(2);
    expect(two.bucketCounts.length).toBe(two.explicitBounds.length + 1);
    const tok = ms.find((x) => x.name === 'gen_ai.client.token.usage')!.histogram!.dataPoints;
    expect(tok).toHaveLength(4); // 2 groups × input / output
  });

  it('signal URLs from a base or a full signal URL', () => {
    expect(signalUrls('http://localhost:4318')).toEqual({ traces: 'http://localhost:4318/v1/traces', metrics: 'http://localhost:4318/v1/metrics' });
    expect(signalUrls('https://otel.example.com/otlp/v1/traces')).toEqual({ traces: 'https://otel.example.com/otlp/v1/traces', metrics: 'https://otel.example.com/otlp/v1/metrics' });
  });
});

describe('OtlpExporter', () => {
  it('is off by default: nothing queued, nothing sent', async () => {
    const sent: string[] = [];
    const x = new OtlpExporter({ meta: fakeMeta(), secrets, fetch: async (u) => { sent.push(String(u)); return new Response('{}'); }, lookup });
    x.record([line()]);
    await x.flush();
    expect(sent).toEqual([]);
    expect(x.view()).toMatchObject({ enabled: false, queued: 0 });
  });

  it('headers are stored encrypted and never come back; MASK keeps a value; export posts both signals with them', async () => {
    const meta = fakeMeta();
    const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
    const x = new OtlpExporter({ meta, secrets, version: '9.9.9', lookup, fetch: async (u, init) => { sent.push({ url: String(u), headers: init?.headers as Record<string, string>, body: String(init?.body) }); return new Response('{}'); } });
    await x.set({ enabled: true, endpoint: 'http://collector.lan:4318', headers: { authorization: 'Bearer otlp-token', 'x-team': 'a' } });
    const stored = meta.settings()[OTLP_SETTING] as Record<string, unknown>;
    expect(JSON.stringify(stored)).not.toContain('otlp-token');
    expect(String(stored.headers)).toMatch(/^enc:/);
    const v = await handleTelemetryRequest(x, { kind: 'telemetry.otlp.get' });
    expect(JSON.stringify(v)).not.toContain('otlp-token');
    expect(v.headerNames).toEqual(['authorization', 'x-team']);
    // MASK keeps the stored value; an empty one removes the header
    await x.set({ headers: { authorization: MASK, 'x-team': '' } });
    x.record([line(), line({ status: 500, errorCode: 'boom' })]);
    await x.flush();
    expect(sent.map((s) => s.url)).toEqual(['http://collector.lan:4318/v1/traces', 'http://collector.lan:4318/v1/metrics']);
    expect(sent[0].headers.authorization).toBe('Bearer otlp-token');
    expect(sent[0].headers['x-team']).toBeUndefined();
    expect(JSON.parse(sent[0].body).resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
    expect(x.view()).toMatchObject({ exported: 2, queued: 0 });
  });

  it('a failed export keeps the batch and reports the error', async () => {
    let fail = true;
    const x = new OtlpExporter({ meta: fakeMeta(), secrets, lookup, fetch: async () => new Response('no', { status: fail ? 503 : 200 }) });
    await x.set({ enabled: true, endpoint: 'https://otel.example.com', metrics: false });
    x.record([line()]);
    await x.flush();
    expect(x.view()).toMatchObject({ queued: 1, exported: 0 });
    expect(x.view().lastError).toContain('503');
    fail = false;
    await x.flush();
    expect(x.view()).toMatchObject({ queued: 0, exported: 1 });
    expect(x.view().lastError).toBeUndefined();
  });

  it('netguard: a metadata endpoint is refused when saving; bad schemes and credentials too', async () => {
    const x = new OtlpExporter({ meta: fakeMeta(), secrets, lookup, fetch: async () => new Response('{}') });
    await expect(x.set({ enabled: true, endpoint: 'http://meta.test/v1/traces' })).rejects.toMatchObject({ code: 'EGRESS_DENIED' });
    await expect(x.set({ enabled: true, endpoint: 'http://169.254.169.254:4318' })).rejects.toThrow();
    await expect(x.set({ endpoint: 'ftp://otel.example.com' })).rejects.toThrow();
    await expect(x.set({ endpoint: 'https://u:p@otel.example.com' })).rejects.toThrow();
    await expect(x.set({ enabled: true })).rejects.toThrow();
    await expect(x.set({ headers: { 'bad name': 'v' } })).rejects.toThrow();
    await expect(x.set({ headers: { ok: 'a\r\nb' } })).rejects.toThrow();
  });

  it('a peer / phone can read the state but not change it; the request log off shows', async () => {
    const x = new OtlpExporter({ meta: fakeMeta(false), secrets, lookup });
    await expect(handleTelemetryRequest(x, { kind: 'telemetry.otlp.set', patch: { enabled: false } }, true)).rejects.toThrow();
    await expect(handleTelemetryRequest(x, { kind: 'telemetry.otlp.test' }, true)).rejects.toThrow();
    expect((await handleTelemetryRequest(x, { kind: 'telemetry.otlp.get' }, true)).auditOff).toBe(true);
  });
});
