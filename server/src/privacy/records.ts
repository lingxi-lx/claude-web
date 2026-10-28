// The privacy center's records on disk (after Magpie internal/maskrec, MIT): a day is a file of its own
// (`<data dir>/privacy-records/YYYY-MM-DD.jsonl`, one request a line), kept 30 days and 100 MB in all. A record holds
// types, counts, lengths, short prefixes and placeholder hashes — never a value (PrivacyRecord). Writing one must never
// break a request: every error is swallowed.
import fs from 'node:fs';
import path from 'node:path';
import type { PrivacyRecord } from './types.js';

export const KEEP_DAYS = 30;
export const KEEP_BYTES = 100 * 1024 * 1024;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

const pad = (n: number) => String(n).padStart(2, '0');
/** the local day a time falls on (the file it goes to) */
export const dayOf = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** What may go on disk of a record: only the known fields (a stray field never carries text out). */
function clean(r: PrivacyRecord): PrivacyRecord {
  return {
    ts: r.ts,
    source: String(r.source ?? '').slice(0, 200),
    count: r.count,
    categories: r.categories,
    placeholders: (r.placeholders ?? []).filter((p) => /^\{\{[A-Z][A-Z_]*_[a-f0-9]{8}\}\}$/.test(p)).slice(0, 20),
    ...(r.entries ? { entries: r.entries.slice(0, 100).map((e) => ({ category: e.category, length: e.length, ...(e.prefix ? { prefix: String(e.prefix).slice(0, 8) } : {}) })) } : {}),
    ...(r.blocked ? { blocked: true } : {}),
    ...(r.warned ? { warned: r.warned } : {}),
  };
}

export class RecordStore {
  private chain: Promise<void> = Promise.resolve();
  private pruned = 0;
  /** `dir` null: memory only (tests, or no data dir) */
  constructor(private dir: string | null, private now: () => number = Date.now) {}

  private files(): { day: string; file: string }[] {
    if (!this.dir) return [];
    let names: string[] = [];
    try { names = fs.readdirSync(this.dir); } catch { return []; }
    return names.map((n) => DAY_FILE.exec(n)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ day: m[1], file: path.join(this.dir!, m[0]) })).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }

  idle(): Promise<void> { return this.chain; }

  /** Append one record to its day (in order; never throws). */
  add(r: PrivacyRecord): Promise<void> {
    if (!this.dir) return Promise.resolve();
    const dir = this.dir;
    const line = `${JSON.stringify(clean(r))}\n`;
    this.chain = this.chain.then(async () => {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.appendFile(path.join(dir, `${dayOf(r.ts)}.jsonl`), line, { encoding: 'utf8', mode: 0o600 });
        if (this.now() - this.pruned > 3600_000) { this.pruned = this.now(); this.prune(); }
      } catch { /* the record is lost, the request is not */ }
    });
    return this.chain;
  }

  /** Drop the days older than KEEP_DAYS, then the oldest until what is left fits KEEP_BYTES. */
  prune() {
    const oldest = dayOf(this.now() - KEEP_DAYS * 86_400_000);
    const fsList = this.files();
    const sizes = fsList.map((f) => { try { return fs.statSync(f.file).size; } catch { return 0; } });
    let total = sizes.reduce((a, b) => a + b, 0);
    for (let i = 0; i < fsList.length; i++) {
      if (fsList[i].day >= oldest && total <= KEEP_BYTES) break;
      try { fs.rmSync(fsList[i].file, { force: true }); total -= sizes[i]; } catch { /* stays */ }
    }
  }

  /** The latest `limit` records of the kept days, newest first (a line that does not parse is skipped). */
  recent(limit: number): PrivacyRecord[] {
    const out: PrivacyRecord[] = [];
    const cutoff = this.now() - KEEP_DAYS * 86_400_000;
    const days = this.files();
    for (let i = days.length - 1; i >= 0 && out.length < limit; i--) {
      let text = '';
      try { text = fs.readFileSync(days[i].file, 'utf8'); } catch { continue; }
      const day: PrivacyRecord[] = [];
      for (const l of text.split('\n')) {
        if (!l.trim()) continue;
        try { const r = JSON.parse(l) as PrivacyRecord; if (typeof r.ts === 'number' && r.ts >= cutoff) day.push(clean(r)); } catch { /* half-written */ }
      }
      day.sort((a, b) => b.ts - a.ts);
      for (const r of day) { if (out.length >= limit) break; out.push(r); }
    }
    return out;
  }

  /** Delete every day file (after the writes under way). */
  async clear(): Promise<void> {
    await this.chain;
    for (const f of this.files()) { try { fs.rmSync(f.file, { force: true }); } catch { /* stays */ } }
  }
}
