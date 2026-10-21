import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuditLog } from './audit.js';

const line = (i: number, over: any = {}) => ({
  ts: i, keyId: 'key_1', ip: '127.0.0.1', protocol: 'anthropic' as const, model: 'm',
  routeGroupId: 'main', member: 'P', status: 200, ms: 5, tokensIn: 10, tokensOut: 2, errorCode: '', ...over,
});

describe('AuditLog', () => {
  it('appends JSONL, filters and clears', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-audit-'));
    const a = new AuditLog(dir, () => ({ enabled: true, maxBytes: 1_000_000, keepFiles: 3 }));
    a.write(line(1));
    a.write(line(2, { status: 500, errorCode: '500' }));
    await a.flushNow();
    const all = await a.list({ limit: 10 });
    expect(all).toHaveLength(2);
    expect(await a.list({ status: 500 })).toHaveLength(1);
    await a.clear();
    expect(await a.list({})).toEqual([]);
    a.stop();
  });

  it('never writes fields outside the whitelist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-audit-'));
    const a = new AuditLog(dir, () => ({ enabled: true, maxBytes: 1_000_000, keepFiles: 3 }));
    a.write(line(1, { prompt: 'SECRET PROMPT', authorization: 'Bearer SECRET' } as any));
    await a.flushNow();
    const text = await a.exportText();
    expect(text).not.toContain('SECRET');
    expect(JSON.parse(text.trim())).toMatchObject({ keyId: 'key_1', status: 200 });
    a.stop();
  });

  it('writes nothing when disabled', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-audit-'));
    const a = new AuditLog(dir, () => ({ enabled: false, maxBytes: 1_000_000, keepFiles: 3 }));
    a.write(line(1));
    await a.flushNow();
    expect(await a.list({})).toEqual([]);
    a.stop();
  });
});
