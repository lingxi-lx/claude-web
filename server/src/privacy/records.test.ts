import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dayOf, KEEP_DAYS, RecordStore } from './records.js';
import { PrivacyService } from './service.js';
import type { PrivacyRecord } from './types.js';

const tmp: string[] = [];
const mkdir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-privrec-')); tmp.push(d); return d; };
afterEach(() => { for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const rec = (ts: number, extra: Partial<PrivacyRecord> = {}): PrivacyRecord => ({ ts, source: 'gateway', count: 1, categories: { email: 1 }, placeholders: ['{{EMAIL_0123abcd}}'], entries: [{ category: 'email', length: 12, prefix: 'ab' }], ...extra });

describe('privacy records on disk (Magpie maskrec)', () => {
  it('one file a day, newest first back, survives a new store', async () => {
    const dir = mkdir();
    const now = Date.now();
    const s = new RecordStore(dir, () => now);
    await s.add(rec(now - 86_400_000));
    await s.add(rec(now - 1000));
    await s.add(rec(now));
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).length).toBeGreaterThanOrEqual(2);
    const back = new RecordStore(dir, () => now).recent(10);
    expect(back.map((r) => r.ts)).toEqual([now, now - 1000, now - 86_400_000]);
    expect(new RecordStore(dir, () => now).recent(1)).toHaveLength(1);
  });

  it('never writes a value: only the known fields, placeholders of the right shape, short prefixes', async () => {
    const dir = mkdir();
    const s = new RecordStore(dir);
    await s.add({ ...rec(Date.now()), placeholders: ['{{EMAIL_0123abcd}}', 'alice@example.com'], entries: [{ category: 'email', length: 5, prefix: 'alice@example.com' }], value: 'alice@example.com' } as any);
    const text = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    expect(text).not.toContain('alice@example.com');
    expect(text).toContain('{{EMAIL_0123abcd}}');
  });

  it('drops days past 30 and clears everything', async () => {
    const dir = mkdir();
    const now = Date.now();
    const old = now - (KEEP_DAYS + 2) * 86_400_000;
    fs.writeFileSync(path.join(dir, `${dayOf(old)}.jsonl`), `${JSON.stringify(rec(old))}\n`);
    const s = new RecordStore(dir, () => now);
    expect(s.recent(10)).toEqual([]);
    await s.add(rec(now));
    s.prune();
    expect(fs.existsSync(path.join(dir, `${dayOf(old)}.jsonl`))).toBe(false);
    await s.clear();
    expect(s.recent(10)).toEqual([]);
  });

  it('a half-written line is skipped', () => {
    const dir = mkdir();
    const now = Date.now();
    fs.writeFileSync(path.join(dir, `${dayOf(now)}.jsonl`), `${JSON.stringify(rec(now))}\n{"ts":12`);
    expect(new RecordStore(dir, () => now).recent(10)).toHaveLength(1);
  });

  it('the service loads the kept records at start and clears them on request', async () => {
    const dir = mkdir();
    const cfg: any = { enabled: true };
    const meta: any = { privacyConfig: () => cfg, savePrivacy: async () => {} };
    const a = new PrivacyService(meta, { dataDir: dir });
    a.note('gateway', [{ category: 'email', action: 'redact', placeholder: '{{EMAIL_0123abcd}}', length: 5 }], false);
    await a.recordsWritten();
    const b = new PrivacyService(meta, { dataDir: dir });
    expect(b.status().stats.recent).toHaveLength(1);
    await b.clearRecords();
    expect(new PrivacyService(meta, { dataDir: dir }).status().stats.recent).toHaveLength(0);
  });
});
