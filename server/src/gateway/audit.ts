// Gateway audit: one JSON line per request, whitelist fields only — never a prompt, a response body, a key,
// a cookie or an Authorization header. Lines are written in batches (at most 200 per event) and the file
// rotates by size.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { GatewayAuditConfig, GatewayAuditLine } from './types.js';

const FILE = 'gateway-audit.jsonl';
const NUM = new Set(['ts', 'status', 'ms', 'tokensIn', 'tokensOut']);
const FIELDS = ['ts', 'keyId', 'ip', 'protocol', 'model', 'routeGroupId', 'member', 'status', 'ms', 'tokensIn', 'tokensOut', 'errorCode'] as const;

const clean = (l: GatewayAuditLine): GatewayAuditLine => {
  const out: any = {};
  for (const k of FIELDS) out[k] = (l as any)[k] ?? (NUM.has(k) ? 0 : '');
  return out as GatewayAuditLine;
};

export class AuditLog extends EventEmitter {
  private buf: GatewayAuditLine[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private dir: string, private cfg: () => GatewayAuditConfig) { super(); }

  write(line: GatewayAuditLine): void {
    if (!this.cfg().enabled) return;
    this.buf.push(clean(line));
    if (!this.timer) {
      this.timer = setInterval(() => { void this.flushNow(); }, 1000);
      this.timer.unref?.();
    }
  }

  async flushNow(): Promise<void> {
    if (!this.buf.length) {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      return;
    }
    const lines = this.buf.splice(0, 200);
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, FILE);
    await fs.appendFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
    this.emit('lines', lines);
    const cfg = this.cfg();
    try {
      const st = await fs.stat(file);
      if (st.size > cfg.maxBytes) await this.rotate(file, cfg.keepFiles);
    } catch { /* nothing to rotate */ }
  }

  private async rotate(file: string, keep: number): Promise<void> {
    for (let i = keep - 1; i >= 1; i--) await fs.rename(`${file}.${i}`, `${file}.${i + 1}`).catch(() => {});
    await fs.rename(file, `${file}.1`).catch(() => {});
  }

  async list(opts: { limit?: number; since?: number; keyId?: string; status?: number }): Promise<GatewayAuditLine[]> {
    await this.flushNow();
    let text = '';
    try { text = await fs.readFile(path.join(this.dir, FILE), 'utf8'); } catch { return []; }
    let lines = text.split('\n').filter(Boolean)
      .map((s) => { try { return JSON.parse(s) as GatewayAuditLine; } catch { return null; } })
      .filter((x): x is GatewayAuditLine => !!x);
    if (opts.since) lines = lines.filter((l) => l.ts >= opts.since!);
    if (opts.keyId) lines = lines.filter((l) => l.keyId === opts.keyId);
    if (opts.status) lines = lines.filter((l) => l.status === opts.status);
    return lines.slice(-(opts.limit ?? 500));
  }

  async clear(): Promise<void> {
    this.buf = [];
    await fs.rm(path.join(this.dir, FILE), { force: true });
    for (let i = 1; i < 100; i++) await fs.rm(path.join(this.dir, `${FILE}.${i}`), { force: true });
  }

  async exportText(): Promise<string> {
    const lines = await this.list({ limit: Number.MAX_SAFE_INTEGER });
    return lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : '');
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
