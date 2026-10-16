// 本机环境变量 (spec 2026-10-16 sessions-env §6; the official app's local environment variables): set once, in every
// conversation and terminal started here. Stored encrypted in their own file (LocalEnvStore); what processes get is
// the decrypted copy below, put in place at startup and on every change.
import fs from 'node:fs';
import path from 'node:path';

/** Names that pick the model, the account or the engine: those belong to 供应商 and must not be overridden from here. */
const RESERVED = /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_WEB_|CLAUDE_CONFIG_DIR$|OPENAI_|GEMINI_API_KEY$|GOOGLE_GEMINI_|AWS_BEARER_TOKEN_BEDROCK$|CW_)/i;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** Object keys of their own: a name like these would read or write the store object's prototype */
const OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString', 'valueOf']);

/** Why a name cannot be used here, or null. */
export function envNameProblem(name: string): 'invalid' | 'reserved' | null {
  if (!NAME.test(name) || OBJECT_KEYS.has(name)) return 'invalid';
  if (RESERVED.test(name)) return 'reserved';
  return null;
}

let current: Record<string, string> = {};

export function setLocalEnv(vars: Record<string, string>): void {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) if (!envNameProblem(k)) next[k] = v;
  current = next;
}

/** A copy: callers spread it under their own values. */
export function localEnv(): Record<string, string> {
  return { ...current };
}

interface Secrets { protect(plain: string, id: string): Promise<string>; reveal(v: string | undefined): Promise<string> }

/**
 * The stored side behind env.list / env.set / env.reveal: its own file (`<dataDir>/local-env.json`, name → `enc:…`),
 * not meta.json's settings — those go to every client, a paired phone included, and on Linux `enc:plain:` is base64.
 */
export class LocalEnvStore {
  constructor(private file: string, private secrets: Secrets) {}

  private stored(): Record<string, string> {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }

  /** Decrypt everything into the copy processes get (startup, and after every change). */
  async load(): Promise<void> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.stored())) {
      try { out[k] = await this.secrets.reveal(v); } catch (e) { console.error(`[local-env] cannot decrypt ${k}:`, (e as Error).message); }
    }
    setLocalEnv(out);
  }

  names(): string[] {
    return Object.keys(this.stored()).sort();
  }

  /** `value: null` removes it. Throws 'invalid' / 'reserved' on a name that cannot be used here. */
  async set(name: string, value: string | null): Promise<void> {
    const problem = envNameProblem(name);
    if (problem) throw new Error(problem);
    const all = this.stored();
    // Windows: PATH and Path are one variable — a second spelling would be a duplicate the child sees twice
    const same = process.platform === 'win32' ? Object.keys(all).find((k) => k !== name && k.toLowerCase() === name.toLowerCase()) : undefined;
    if (same) { if (value === null) delete all[same]; else throw new Error('exists'); }
    if (value === null) delete all[name];
    else all[name] = await this.secrets.protect(value, `env-${name}`);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    await this.load();
  }

  async reveal(name: string): Promise<string> {
    const all = this.stored();
    return Object.hasOwn(all, name) && typeof all[name] === 'string' ? this.secrets.reveal(all[name]) : '';
  }
}
