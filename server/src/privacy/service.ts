// The privacy pipeline's owner (spec 2026-10-26 §4): settings in meta.json (`privacy`), the per-install placeholder
// secret, the in-memory reverse map (placeholder → value; never written anywhere, rebuilt as requests are redacted
// after a restart), and the hit counters the privacy center shows. Request paths ask `forRequest()` for a guard.
import crypto from 'node:crypto';
import type { MetaStore } from '../meta/store.js';
import { tr } from '../i18n/index.js';
import { compile, customDetectors, redactText, scrubForLog, TAG, type Compiled } from './detect.js';
import { redactBody, restoreResponse } from './pipeline.js';
import { DEFAULT_PRIVACY, PRIVACY_CATEGORIES, type PrivacyCategory, type PrivacyHit, type PrivacyPreview, type PrivacyRecord, type PrivacyRequest, type PrivacySettings, type PrivacyStats, type PrivacyStatus } from './types.js';
import type http from 'node:http';

/** The request was refused by a `block` rule: nothing was sent. */
export class PrivacyBlocked extends Error {
  constructor(readonly categories: PrivacyCategory[]) {
    super(tr('按隐私设置拦截：内容里有 {cats}，请求没有发出', { cats: categories.map(categoryLabel).join('、') }));
  }
}
/** The pipeline itself failed while it is on: the request is refused (fail closed), never sent raw. */
export class PrivacyFailed extends Error {
  constructor(cause: string) { super(tr('隐私保护处理失败，请求没有发出：{cause}', { cause })); }
}

export function categoryLabel(c: PrivacyCategory): string {
  switch (c) {
    case 'api_key': return tr('API Key');
    case 'private_key': return tr('私钥');
    case 'jwt': return 'JWT';
    case 'password': return tr('密码 / Token');
    case 'email': return tr('邮箱');
    case 'phone': return tr('手机号');
    case 'id_card': return tr('身份证号');
    case 'bank_card': return tr('银行卡号');
    case 'custom': return tr('自定义内容');
  }
}

const RECENT = 50;
const MAP_LIMIT = 20_000;

/** Host on this machine or the local network (an upstream that keeps the prompt here). */
export function isLocalUrl(url: string | undefined): boolean {
  let h = '';
  try { h = new URL(url ?? '').hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { return false; }
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
}

/** One request's view of the pipeline (one upstream attempt). */
export class PrivacyGuard {
  readonly hits: PrivacyHit[] = [];
  constructor(private svc: PrivacyService, private c: Compiled, readonly source: string) {}
  /** A body before it leaves. Throws PrivacyBlocked / PrivacyFailed — the caller refuses the request. */
  body(b: Buffer): Buffer {
    let r: { body: Buffer; hits: PrivacyHit[] };
    try { r = redactBody(b, this.c, this.svc.secret(), this.svc.map); } catch (e: any) { throw new PrivacyFailed(e?.message ?? String(e)); }
    const blocked = [...new Set(r.hits.filter((h) => h.action === 'block').map((h) => h.category))];
    this.hits.push(...r.hits);
    if (blocked.length) throw new PrivacyBlocked(blocked);
    return r.body;
  }
  /** A variant of the same request (a retry without one field): the same placeholders, its hits not counted again. */
  variant(b: Buffer | null): Buffer | null {
    if (!b) return b;
    const before = this.hits.length;
    let r: { body: Buffer; hits: PrivacyHit[] };
    try { r = redactBody(b, this.c, this.svc.secret(), this.svc.map); } catch (e: any) { throw new PrivacyFailed(e?.message ?? String(e)); }
    if (r.hits.some((h) => h.action === 'block')) throw new PrivacyBlocked([...new Set(r.hits.filter((h) => h.action === 'block').map((h) => h.category))]);
    this.hits.length = before;
    return r.body;
  }
  get redacted(): boolean { return this.hits.some((h) => h.action === 'redact'); }
  /** Put placeholders back in what goes to the client. */
  restore(res: http.ServerResponse, stream: boolean) { if (this.redacted) restoreResponse(res, this.svc.map, stream); }
  /** Count it, and the audit line's summary (types, counts, placeholders — never values). */
  done(blocked = false): PrivacyRecord | undefined { return this.svc.note(this.source, this.hits, blocked); }
}

export class PrivacyService {
  /** placeholder → original value, this process only */
  readonly map = new Map<string, string>();
  private compiled: Compiled | null = null;
  private stats: PrivacyStats = { since: Date.now(), requests: 0, redacted: 0, warned: 0, blocked: 0, hits: {}, recent: [] };
  private onChange: (() => void) | null = null;

  constructor(private meta: MetaStore) {}

  /** Called on every change of settings or counters (the hub broadcasts `privacy.changed`). */
  listen(fn: () => void) { this.onChange = fn; }

  settings(): PrivacySettings {
    const raw = (this.meta.privacyConfig() ?? {}) as Partial<PrivacySettings>;
    return {
      ...DEFAULT_PRIVACY,
      ...raw,
      actions: { ...DEFAULT_PRIVACY.actions, ...(raw.actions ?? {}) },
      words: raw.words ?? [],
      patterns: raw.patterns ?? [],
      allow: raw.allow ?? [],
    };
  }

  secret(): Buffer {
    const cfg = this.meta.privacyConfig();
    if (!cfg.secret) { cfg.secret = crypto.randomBytes(32).toString('hex'); void this.meta.savePrivacy(); }
    return Buffer.from(cfg.secret, 'hex');
  }

  private compiledNow(): Compiled { return (this.compiled ??= compile(this.settings())); }

  status(): PrivacyStatus {
    const s = this.settings();
    return { settings: s, stats: this.stats, badPatterns: customDetectors(s).bad };
  }

  async set(patch: Extract<PrivacyRequest, { kind: 'privacy.set' }>['patch']): Promise<PrivacyStatus> {
    const cfg = this.meta.privacyConfig();
    const cur = this.settings();
    const clean = (l: unknown) => (Array.isArray(l) ? [...new Set(l.map((x) => String(x)).filter((x) => x.trim()))].slice(0, 500) : undefined);
    const next: PrivacySettings = {
      enabled: patch.enabled ?? cur.enabled,
      skipLocal: patch.skipLocal ?? cur.skipLocal,
      actions: { ...cur.actions },
      words: clean(patch.words) ?? cur.words,
      patterns: clean(patch.patterns) ?? cur.patterns,
      allow: clean(patch.allow) ?? cur.allow,
    };
    for (const [k, v] of Object.entries(patch.actions ?? {})) if ((PRIVACY_CATEGORIES as string[]).includes(k) && ['off', 'redact', 'warn', 'block'].includes(String(v))) next.actions[k as PrivacyCategory] = v as PrivacySettings['actions'][PrivacyCategory];
    Object.assign(cfg, next);
    this.compiled = null;
    await this.meta.savePrivacy();
    this.onChange?.();
    return this.status();
  }

  /**
   * A guard for one request to `url` (null = the pipeline does not apply: off, or a local upstream with 本机跳过).
   * `cloud`: the upstream forwards elsewhere though its address is local (a sidecar) — never skipped.
   */
  forRequest(o: { url?: string; source: string; cloud?: boolean }): PrivacyGuard | null {
    const s = this.settings();
    if (!s.enabled) return null;
    if (s.skipLocal && !o.cloud && isLocalUrl(o.url)) return null;
    let c: Compiled;
    try { c = this.compiledNow(); } catch (e: any) { throw new PrivacyFailed(e?.message ?? String(e)); }
    return new PrivacyGuard(this, c, o.source);
  }

  /** What an upstream would get for this text. Nothing is stored: a throwaway map, no counters. */
  preview(text: string, settings?: PrivacySettings): PrivacyPreview {
    const s = settings ? { ...DEFAULT_PRIVACY, ...settings, actions: { ...DEFAULT_PRIVACY.actions, ...settings.actions } } : this.settings();
    const c = compile(s);
    const r = redactText(String(text ?? '').slice(0, 200_000), c, this.secret(), new Map());
    return { text: r.text, hits: r.hits, blocked: r.hits.some((h) => h.action === 'block'), badPatterns: c.bad };
  }

  /** Logs, errors and diagnostics: secrets (and the user's custom words) masked whatever the settings. */
  scrub(text: string): string {
    if (!text) return text;
    try {
      const s = this.settings();
      return scrubForLog(text, s.enabled ? customDetectors(s).list : []);
    } catch { return scrubForLog(text); }
  }

  note(source: string, hits: PrivacyHit[], blocked: boolean): PrivacyRecord | undefined {
    this.stats.requests++;
    if (this.map.size > MAP_LIMIT) {
      // oldest first: a long-running process keeps the recent placeholders, which are the ones a stream can echo
      const drop = this.map.size - MAP_LIMIT;
      let i = 0;
      for (const k of this.map.keys()) { if (i++ >= drop) break; this.map.delete(k); }
    }
    if (!hits.length) return undefined;
    const categories: Partial<Record<PrivacyCategory, number>> = {};
    for (const h of hits) { categories[h.category] = (categories[h.category] ?? 0) + 1; this.stats.hits[h.category] = (this.stats.hits[h.category] ?? 0) + 1; }
    const redacted = hits.filter((h) => h.action === 'redact');
    const warned = hits.filter((h) => h.action === 'warn').length;
    if (redacted.length) this.stats.redacted++;
    if (warned) this.stats.warned++;
    if (blocked) this.stats.blocked++;
    const rec: PrivacyRecord = { ts: Date.now(), source, count: hits.length, categories, placeholders: [...new Set(redacted.map((h) => h.placeholder!))].slice(0, 20), ...(blocked ? { blocked } : {}), ...(warned ? { warned } : {}) };
    this.stats.recent.unshift(rec);
    if (this.stats.recent.length > RECENT) this.stats.recent.length = RECENT;
    this.onChange?.();
    return rec;
  }

  clearStats() { this.stats = { since: Date.now(), requests: 0, redacted: 0, warned: 0, blocked: 0, hits: {}, recent: [] }; this.onChange?.(); }
}

export { TAG };

/** Hub dispatch for `privacy.*`. */
export const isPrivacyRequest = (req: { kind: string }): req is PrivacyRequest => req.kind.startsWith('privacy.');
export async function handlePrivacyRequest(p: PrivacyService, req: PrivacyRequest): Promise<unknown> {
  switch (req.kind) {
    case 'privacy.get': return p.status();
    case 'privacy.set': return p.set(req.patch ?? {});
    case 'privacy.preview': return p.preview(req.text, req.settings);
  }
  throw new Error(`unknown request ${(req as { kind: string }).kind}`);
}
