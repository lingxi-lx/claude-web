// Output-side masking (after Magpie internal/redact's scrub of what it writes): what claude-web itself writes out —
// its log lines (server.log is the server's stdout / stderr), diagnostics bundles, exported files — has secrets masked
// as `[API_KEY]` whatever the settings say, and, with 隐私保护 on and 「日志和导出也遮住」 on, every other type the user
// turned on (emails, phones, names, custom words …) too. Tags, not placeholders: nothing in an output is ever restored.
import { Transform, type TransformCallback } from 'node:stream';
import util from 'node:util';
import { compile, find, scrubForLog, TAG, type Compiled } from './detect.js';
import type { PrivacyCategory, PrivacySettings } from './types.js';

/** The detectors an output is masked with (null: only the always-on secrets). */
export function outputCompiled(s: PrivacySettings): Compiled | null {
  if (!s.enabled || !s.output) return null;
  const actions = { ...s.actions };
  for (const k of Object.keys(actions) as PrivacyCategory[]) if (actions[k] !== 'off') actions[k] = 'redact';
  return compile({ ...s, actions });
}

/** `text` with secrets (always) and the configured types (when `c`) replaced by `[TYPE]`. */
export function maskOutput(text: string, c: Compiled | null): string {
  if (!text) return text;
  let out = scrubForLog(text);
  if (!c) return out;
  const ms = find(out, c);
  if (!ms.length) return out;
  let s = '';
  let at = 0;
  for (const m of ms) { s += `${out.slice(at, m.start)}[${TAG[m.category]}]`; at = m.end; }
  out = s + out.slice(at);
  return out;
}

/**
 * A stream that masks what goes through it, a line at a time (a value cut across two chunks is still found). A line
 * longer than `max` goes out masked as it is.
 */
export class OutputMaskStream extends Transform {
  private buf = '';
  constructor(private mask: (s: string) => string, private max = 256 * 1024) { super(); }
  _transform(chunk: Buffer | string, _enc: BufferEncoding, cb: TransformCallback) {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const nl = this.buf.lastIndexOf('\n');
    if (nl >= 0) {
      const whole = this.buf.slice(0, nl + 1);
      this.buf = this.buf.slice(nl + 1);
      this.push(this.mask(whole));
    }
    if (this.buf.length > this.max) { this.push(this.mask(this.buf)); this.buf = ''; }
    cb();
  }
  _flush(cb: TransformCallback) {
    if (this.buf) this.push(this.mask(this.buf));
    this.buf = '';
    cb();
  }
}

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
let installed: { restore: () => void } | null = null;
/** the process's output mask (set by installConsoleMask; secrets only until then) */
let current: (s: string) => string = (s) => scrubForLog(s);

/** Mask a text claude-web is about to write out (a diagnostics bundle, an exported file) the way its logs are. */
export function maskForOutput(text: string): string {
  try { return current(text); } catch { return scrubForLog(text); }
}

/**
 * Mask the server's console output (what server.log gets). `mask` is read on every line, so a settings change applies
 * at once. A line with nothing to mask goes out exactly as the caller wrote it. Returns the undo.
 */
export function installConsoleMask(mask: (s: string) => string): () => void {
  installed?.restore();
  current = mask;
  const orig = Object.fromEntries(METHODS.map((m) => [m, console[m]])) as Record<(typeof METHODS)[number], (...a: unknown[]) => void>;
  for (const m of METHODS) {
    console[m] = (...args: unknown[]) => {
      let line = '';
      try { line = util.format(...args); } catch { return orig[m].apply(console, args); }
      let masked = line;
      try { masked = mask(line); } catch { /* masking failed: the secrets-only pass */ masked = scrubForLog(line); }
      if (masked === line) return orig[m].apply(console, args);
      return orig[m].call(console, masked);
    };
  }
  const restore = () => { for (const m of METHODS) console[m] = orig[m]; installed = null; current = (t) => scrubForLog(t); };
  installed = { restore };
  return restore;
}
