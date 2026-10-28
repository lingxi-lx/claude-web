// OTLP export: what the window and the server exchange (no imports: protocol.ts and the web read this).

/** the header value the UI sends back to keep a stored one */
export const OTLP_MASK = '••••••';

/** What the UI sees: header names only, values masked. */
export interface OtlpView {
  enabled: boolean;
  endpoint: string;
  traces: boolean;
  metrics: boolean;
  serviceName: string;
  headerNames: string[];
  /** the request log is off: nothing reaches the exporter */
  auditOff?: boolean;
  lastExportAt?: number;
  lastError?: string;
  exported: number;
  dropped: number;
  queued: number;
}

/** What the UI sends. A header value equal to OTLP_MASK keeps the stored one; `headers` absent keeps them all. */
export interface OtlpPatch {
  enabled?: boolean;
  endpoint?: string;
  traces?: boolean;
  metrics?: boolean;
  serviceName?: string;
  headers?: Record<string, string>;
}

export type TelemetryRequest =
  | { kind: 'telemetry.otlp.get' }
  | { kind: 'telemetry.otlp.set'; patch: OtlpPatch }
  /** send one synthetic span + metric now (nothing from a real request) */
  | { kind: 'telemetry.otlp.test' };
