// GitHub / GitLab access tokens typed in settings (spec E2). Like LocalEnvStore: their own file
// (`<dataDir>/vcs-tokens.json`, host → `enc:…`), never meta.json's settings — those go to every client, a paired phone
// included. The wire only ever carries host names.
import fs from 'node:fs';
import path from 'node:path';

interface Secrets { protect(p: string, id: string): Promise<string>; reveal(v?: string): Promise<string> }

const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;

/** A bare host (optionally :port), lower case; anything else (URLs, paths, object keys) → null. */
export function normalizeHost(host: string): string | null {
  const h = String(host ?? '').trim().toLowerCase();
  if (!HOST.test(h) || !/[.:]/.test(h)) return null;
  return h;
}

export class VcsTokenStore {
  constructor(private file: string, private secrets: Secrets) {}

  private stored(): Record<string, string> {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
      const out: Record<string, string> = {};
      for (const [k, x] of Object.entries(v)) if (normalizeHost(k) === k && typeof x === 'string') out[k] = x;
      return out;
    } catch {
      return {};
    }
  }

  hosts(): string[] {
    return Object.keys(this.stored()).sort();
  }

  async get(host: string): Promise<string> {
    const h = normalizeHost(host);
    if (!h) return '';
    const v = this.stored()[h];
    if (!v) return '';
    try { return await this.secrets.reveal(v); } catch { return ''; }
  }

  /** `token: null` removes it. */
  async set(host: string, token: string | null): Promise<void> {
    const h = normalizeHost(host);
    if (!h) throw new Error(`invalid host: ${String(host).slice(0, 80)}`);
    const all = this.stored();
    if (token === null || !token.trim()) delete all[h];
    else all[h] = await this.secrets.protect(token.trim(), `vcs-${h}`);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
