// OTLP export (port of Magpie internal/otlp): the gateway's finished requests as OpenTelemetry spans and metrics,
// sent as OTLP/HTTP JSON to a collector the user names. Off by default.
//
// What leaves: model, source (the route member's name), route group, protocol, HTTP status, an error code,
// latency, token counts — and nothing else. Never a prompt, a reply, a key id, a client IP, a header or a secret.
// The collector's headers (an auth token, usually) are kept encrypted with SecretService and never sent to the UI.
//
// Input: the audit log's batches (`AuditLog` 'lines'), so the export follows the request log; with the request log
// switched off there is nothing to export (the status says so).
//
// Delivery: batched every few seconds; a failed POST keeps the batch for the next round (bounded: the oldest are
// dropped beyond MAX_QUEUE). The endpoint passes netguard with the 'local' policy: a collector on this machine or
// the LAN is the usual setup; link-local / cloud metadata addresses never are.
import crypto from 'node:crypto';
import type { MetaStore } from '../meta/store.js';
import type { SecretService } from '../secrets/service.js';
import type { GatewayAuditLine } from '../gateway/types.js';
import { checkUrl, guardedFetch, type FetchFn, type LookupAll } from '../net/netguard.js';
import { tr } from '../i18n/index.js';
import { OTLP_MASK, type OtlpPatch, type OtlpView, type TelemetryRequest } from './types.js';

export const OTLP_SETTING = 'telemetry.otlp';
export const MASK = OTLP_MASK;
const MAX_QUEUE = 2000;
const MAX_BATCH = 500;
const FLUSH_MS = 5000;
const MAX_HEADERS = 20;
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
/** latency buckets, seconds (the OpenTelemetry GenAI duration advice) */
export const DURATION_BOUNDS = [0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92];
/** token buckets (the OpenTelemetry GenAI token-usage advice) */
export const TOKEN_BOUNDS = [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864];

/** As stored in meta.json; `headers` is a SecretService blob of a JSON object. */
export interface OtlpStored {
  enabled?: boolean;
  /** base (`http://host:4318`) or the full `/v1/traces` URL */
  endpoint?: string;
  traces?: boolean;
  metrics?: boolean;
  serviceName?: string;
  headers?: string;
  /** the header names (values only inside `headers`) */
  headerNames?: string[];
}

export type { OtlpView, OtlpPatch, TelemetryRequest };

// ---- payloads (pure) ------------------------------------------------------------------------------------------

type AnyValue = { stringValue: string } | { intValue: string } | { boolValue: boolean } | { doubleValue: number };
interface KeyValue { key: string; value: AnyValue }
const sv = (key: string, v: string): KeyValue => ({ key, value: { stringValue: v } });
const iv = (key: string, v: number): KeyValue => ({ key, value: { intValue: String(Math.round(v)) } });
const nanos = (ms: number) => `${BigInt(Math.round(ms)) * 1_000_000n}`;

/** The allowed fields of one audit line, nothing else (the single place that decides what leaves). */
export interface ExportRecord {
  endMs: number;
  durationMs: number;
  model: string;
  source: string;
  routeGroup: string;
  protocol: string;
  status: number;
  errorCode: string;
  tokensIn: number;
  tokensOut: number;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const s200 = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : '');

export function toRecord(l: GatewayAuditLine): ExportRecord {
  return {
    endMs: num(l.ts) || Date.now(),
    durationMs: num(l.ms),
    model: s200(l.model),
    source: s200(l.member),
    routeGroup: s200(l.routeGroupId),
    protocol: s200(l.protocol),
    status: Math.round(num(l.status)),
    errorCode: s200(l.errorCode),
    tokensIn: Math.round(num(l.tokensIn)),
    tokensOut: Math.round(num(l.tokensOut)),
  };
}

function baseAttrs(r: ExportRecord): KeyValue[] {
  const a = [sv('gen_ai.request.model', r.model || 'unknown'), sv('claude_web.source', r.source || 'unknown')];
  if (r.routeGroup) a.push(sv('claude_web.route_group', r.routeGroup));
  if (r.protocol) a.push(sv('claude_web.protocol', r.protocol));
  return a;
}

function resource(serviceName: string, version: string) {
  return { attributes: [sv('service.name', serviceName || 'claude-web'), sv('service.version', version || '0'), sv('telemetry.sdk.name', 'claude-web')] };
}

export function tracesPayload(records: ExportRecord[], o: { serviceName: string; version: string }) {
  const spans = records.map((r) => {
    const failed = r.status >= 400 || !!r.errorCode;
    const attributes = [...baseAttrs(r), iv('http.response.status_code', r.status), iv('gen_ai.usage.input_tokens', r.tokensIn), iv('gen_ai.usage.output_tokens', r.tokensOut)];
    if (r.errorCode) attributes.push(sv('error.type', r.errorCode));
    return {
      traceId: crypto.randomBytes(16).toString('hex'),
      spanId: crypto.randomBytes(8).toString('hex'),
      name: `chat ${r.model || 'unknown'}`,
      kind: 2, // SERVER: the gateway answered this request
      startTimeUnixNano: nanos(r.endMs - r.durationMs),
      endTimeUnixNano: nanos(r.endMs),
      attributes,
      status: failed ? { code: 2, message: r.errorCode || `HTTP ${r.status}` } : { code: 1 },
    };
  });
  return { resourceSpans: [{ resource: resource(o.serviceName, o.version), scopeSpans: [{ scope: { name: 'claude-web.gateway', version: o.version }, spans }] }] };
}

function histogram(values: number[], bounds: number[]) {
  const counts = new Array(bounds.length + 1).fill(0) as number[];
  for (const v of values) {
    let i = bounds.findIndex((b) => v <= b);
    if (i < 0) i = bounds.length;
    counts[i]++;
  }
  return {
    count: String(values.length),
    sum: values.reduce((a, b) => a + b, 0),
    min: Math.min(...values),
    max: Math.max(...values),
    bucketCounts: counts.map(String),
    explicitBounds: bounds,
  };
}

/** Delta metrics for one window: request count, duration and token histograms, grouped by model / source / status. */
export function metricsPayload(records: ExportRecord[], o: { serviceName: string; version: string; startMs: number; endMs: number }) {
  const groups = new Map<string, { attrs: KeyValue[]; recs: ExportRecord[] }>();
  for (const r of records) {
    const attrs = [...baseAttrs(r), iv('http.response.status_code', r.status)];
    if (r.errorCode) attrs.push(sv('error.type', r.errorCode));
    const k = JSON.stringify(attrs);
    const g = groups.get(k) ?? { attrs, recs: [] };
    g.recs.push(r);
    groups.set(k, g);
  }
  const start = nanos(o.startMs);
  const end = nanos(o.endMs);
  const requests = [...groups.values()].map((g) => ({ attributes: g.attrs, startTimeUnixNano: start, timeUnixNano: end, asInt: String(g.recs.length) }));
  const duration = [...groups.values()].map((g) => ({ attributes: g.attrs, startTimeUnixNano: start, timeUnixNano: end, ...histogram(g.recs.map((r) => r.durationMs / 1000), DURATION_BOUNDS) }));
  const tokens = [...groups.values()].flatMap((g) => (['input', 'output'] as const).map((type) => ({
    attributes: [...g.attrs, sv('gen_ai.token.type', type)],
    startTimeUnixNano: start,
    timeUnixNano: end,
    ...histogram(g.recs.map((r) => (type === 'input' ? r.tokensIn : r.tokensOut)), TOKEN_BOUNDS),
  })));
  const DELTA = 1;
  return {
    resourceMetrics: [{
      resource: resource(o.serviceName, o.version),
      scopeMetrics: [{
        scope: { name: 'claude-web.gateway', version: o.version },
        metrics: [
          { name: 'claude_web.gateway.requests', unit: '{request}', description: 'Requests the gateway answered', sum: { aggregationTemporality: DELTA, isMonotonic: true, dataPoints: requests } },
          { name: 'gen_ai.client.operation.duration', unit: 's', description: 'Request latency', histogram: { aggregationTemporality: DELTA, dataPoints: duration } },
          { name: 'gen_ai.client.token.usage', unit: '{token}', description: 'Tokens per request', histogram: { aggregationTemporality: DELTA, dataPoints: tokens } },
        ],
      }],
    }],
  };
}

/** `http://h:4318` → `{ traces: …/v1/traces, metrics: …/v1/metrics }`; a full signal URL keeps its path for that signal. */
export function signalUrls(endpoint: string): { traces: string; metrics: string } {
  const u = new URL(endpoint.trim());
  const p = u.pathname.replace(/\/+$/, '');
  const m = /^(.*)\/v1\/(traces|metrics|logs)$/.exec(p);
  const base = m ? m[1] : p;
  const at = (sig: string) => { const x = new URL(u.toString()); x.pathname = `${base}/v1/${sig}`; return x.toString(); };
  return { traces: at('traces'), metrics: at('metrics') };
}

// ---- the exporter -----------------------------------------------------------------------------------------------

export interface OtlpDeps {
  meta: Pick<MetaStore, 'settings' | 'setSetting'> & Partial<Pick<MetaStore, 'gatewayAudit'>>;
  secrets?: Pick<SecretService, 'protect' | 'reveal'>;
  version?: string;
  /** tests */
  fetch?: FetchFn;
  lookup?: LookupAll;
  now?: () => number;
}

function validEndpoint(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  let u: URL;
  try { u = new URL(t); } catch { throw new Error(tr('OTLP 地址不合法')); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(tr('OTLP 地址要以 http:// 或 https:// 开头'));
  if (u.username || u.password) throw new Error(tr('地址里不能带账号密码，请放在请求头里'));
  if (t.length > 2000) throw new Error(tr('OTLP 地址不合法'));
  return u.toString();
}

export class OtlpExporter {
  private queue: ExportRecord[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private windowStart = 0;
  private lastExportAt?: number;
  private lastError?: string;
  private exported = 0;
  private dropped = 0;

  constructor(private deps: OtlpDeps) {}

  private now() { return this.deps.now?.() ?? Date.now(); }

  stored(): OtlpStored {
    const v = this.deps.meta.settings()[OTLP_SETTING];
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as OtlpStored) : {};
  }

  private active(): boolean {
    const s = this.stored();
    return s.enabled === true && !!s.endpoint && (s.traces !== false || s.metrics !== false);
  }

  private async headers(): Promise<Record<string, string>> {
    const blob = this.stored().headers;
    if (!blob) return {};
    try {
      const plain = this.deps.secrets ? await this.deps.secrets.reveal(blob) : blob;
      const h = JSON.parse(plain) as Record<string, string>;
      return h && typeof h === 'object' ? h : {};
    } catch {
      return {};
    }
  }

  view(): OtlpView {
    const s = this.stored();
    const names = Array.isArray(s.headerNames) ? s.headerNames.filter((x) => typeof x === 'string') : [];
    const audit = this.deps.meta.gatewayAudit?.();
    return {
      enabled: s.enabled === true,
      endpoint: s.endpoint ?? '',
      traces: s.traces !== false,
      metrics: s.metrics !== false,
      serviceName: s.serviceName || 'claude-web',
      headerNames: names,
      ...(audit && audit.enabled === false ? { auditOff: true } : {}),
      ...(this.lastExportAt ? { lastExportAt: this.lastExportAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      exported: this.exported,
      dropped: this.dropped,
      queued: this.queue.length,
    };
  }

  async set(patch: OtlpPatch): Promise<OtlpView> {
    const next: OtlpStored = { ...this.stored() };
    if (patch.endpoint !== undefined) next.endpoint = validEndpoint(String(patch.endpoint));
    if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
    if (patch.traces !== undefined) next.traces = patch.traces !== false;
    if (patch.metrics !== undefined) next.metrics = patch.metrics !== false;
    if (patch.serviceName !== undefined) next.serviceName = String(patch.serviceName).trim().slice(0, 100) || undefined;
    if (patch.headers !== undefined) {
      if (!patch.headers || typeof patch.headers !== 'object' || Array.isArray(patch.headers)) throw new Error(tr('请求头格式不对'));
      const old = await this.headers();
      const out: Record<string, string> = {};
      const entries = Object.entries(patch.headers);
      if (entries.length > MAX_HEADERS) throw new Error(tr('请求头最多 {n} 个', { n: MAX_HEADERS }));
      for (const [k0, v] of entries) {
        const k = k0.trim();
        if (!k) continue;
        if (!HEADER_NAME_RE.test(k)) throw new Error(tr('请求头名字不合法：{name}', { name: k.slice(0, 60) }));
        if (typeof v !== 'string' || /[\r\n]/.test(v) || v.length > 4000) throw new Error(tr('请求头 {name} 的值不合法', { name: k }));
        const value = v === MASK ? old[k] : v;
        if (value !== undefined && value !== '') out[k] = value;
      }
      const names = Object.keys(out);
      next.headerNames = names;
      if (names.length) {
        const json = JSON.stringify(out);
        next.headers = this.deps.secrets ? await this.deps.secrets.protect(json, 'telemetry-otlp-headers') : json;
      } else delete next.headers;
    }
    if (next.enabled && !next.endpoint) throw new Error(tr('先填 OTLP 地址'));
    if (next.endpoint) {
      // checked now so a wrong address shows up when saving; checked again on every export
      // (a name that does not resolve right now is let through: the collector may simply be offline)
      await checkUrl(signalUrls(next.endpoint).traces, { policy: 'local', ...(this.deps.lookup ? { lookup: this.deps.lookup } : {}) })
        .catch((e: { cls?: string }) => { if (e?.cls) throw e; });
    }
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    await this.deps.meta.setSetting(OTLP_SETTING, next);
    if (!this.active()) { this.queue = []; this.stopTimer(); }
    this.lastError = undefined;
    return this.view();
  }

  /** One batch of finished gateway requests (AuditLog 'lines'). */
  record(lines: GatewayAuditLine[]): void {
    if (!this.active() || !lines.length) return;
    if (!this.windowStart) this.windowStart = this.now();
    for (const l of lines) this.queue.push(toRecord(l));
    if (this.queue.length > MAX_QUEUE) { this.dropped += this.queue.length - MAX_QUEUE; this.queue.splice(0, this.queue.length - MAX_QUEUE); }
    if (!this.timer) {
      this.timer = setInterval(() => { void this.flush(); }, FLUSH_MS);
      this.timer.unref?.();
    }
  }

  private guarded(): FetchFn {
    return guardedFetch({ policy: 'local', ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}), ...(this.deps.lookup ? { lookup: this.deps.lookup } : {}) });
  }

  private async post(url: string, body: unknown): Promise<void> {
    const res = await this.guarded()(url, {
      method: 'POST',
      headers: { ...(await this.headers()), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    try { await res.body?.cancel(); } catch { /* read */ }
    if (!res.ok) throw new Error(tr('OTLP 收集器返回 HTTP {status}', { status: res.status }));
  }

  /** Send what is queued (one batch). A failure keeps the batch for the next round. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      try {
        if (!this.active()) { this.queue = []; this.stopTimer(); return; }
        if (!this.queue.length) { this.stopTimer(); return; }
        const s = this.stored();
        const batch = this.queue.slice(0, MAX_BATCH);
        const urls = signalUrls(s.endpoint!);
        const o = { serviceName: s.serviceName || 'claude-web', version: this.deps.version ?? '0' };
        const end = this.now();
        if (s.traces !== false) await this.post(urls.traces, tracesPayload(batch, o));
        if (s.metrics !== false) await this.post(urls.metrics, metricsPayload(batch, { ...o, startMs: this.windowStart || end, endMs: end }));
        this.queue.splice(0, batch.length);
        this.windowStart = this.queue.length ? end : 0;
        this.exported += batch.length;
        this.lastExportAt = end;
        this.lastError = undefined;
      } catch (e) {
        this.lastError = (e as Error).message;
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  /** 设置页「发一条测试数据」: a synthetic request, sent now; throws the collector's / netguard's answer. */
  async test(): Promise<OtlpView> {
    const s = this.stored();
    if (!s.endpoint) throw new Error(tr('先填 OTLP 地址'));
    const end = this.now();
    const rec: ExportRecord = { endMs: end, durationMs: 1, model: 'claude-web-test', source: 'test', routeGroup: '', protocol: 'test', status: 200, errorCode: '', tokensIn: 0, tokensOut: 0 };
    const urls = signalUrls(s.endpoint);
    const o = { serviceName: s.serviceName || 'claude-web', version: this.deps.version ?? '0' };
    try {
      if (s.traces !== false) await this.post(urls.traces, tracesPayload([rec], o));
      if (s.metrics !== false) await this.post(urls.metrics, metricsPayload([rec], { ...o, startMs: end - 1, endMs: end }));
      this.lastExportAt = end;
      this.lastError = undefined;
    } catch (e) {
      this.lastError = (e as Error).message;
      throw e;
    }
    return this.view();
  }

  private stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  async stop(): Promise<void> {
    this.stopTimer();
    if (this.queue.length && this.active()) await this.flush().catch(() => {});
  }
}

export function isTelemetryRequest(req: { kind: string }): req is TelemetryRequest {
  return req.kind === 'telemetry.otlp.get' || req.kind === 'telemetry.otlp.set' || req.kind === 'telemetry.otlp.test';
}

/** `fromAfar`: a peer machine or a phone may read the state, never point the export somewhere else. */
export async function handleTelemetryRequest(x: OtlpExporter, req: TelemetryRequest, fromAfar = false): Promise<OtlpView> {
  if (req.kind === 'telemetry.otlp.get') return x.view();
  if (fromAfar) throw new Error(tr('只有本机的窗口才能修改 OTLP 导出'));
  if (req.kind === 'telemetry.otlp.set') return x.set(req.patch ?? {});
  return x.test();
}

// the one exporter of this process (index.ts creates it; the hub answers telemetry.* through it)
let current: OtlpExporter | null = null;
export function setOtlpExporter(x: OtlpExporter | null): void { current = x; }
export function otlpExporter(): OtlpExporter | null { return current; }

/** settings.get: the encrypted header blob never goes to a window (names are enough). */
export function maskOtlpSettings<T extends Record<string, unknown>>(settings: T): T {
  const v = settings[OTLP_SETTING];
  if (!v || typeof v !== 'object' || !('headers' in v)) return settings;
  const { headers: _drop, ...rest } = v as OtlpStored;
  void _drop;
  return { ...settings, [OTLP_SETTING]: rest };
}
