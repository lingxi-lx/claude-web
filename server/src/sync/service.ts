// sync.* over the hub: export a bundle (the browser saves it as a file), import = preview, then apply.
// A preview is kept in memory for 10 minutes with the decrypted secrets; nothing of it is written until apply.
import crypto from 'node:crypto';
import type { MetaStore } from '../meta/store.js';
import type { SecretService } from '../secrets/service.js';
import { buildBundle, openSecret, parseBundle, type SyncBundle, type SyncSecret } from './backup.js';
import { applyMerge, planMerge } from './merge.js';
import type { SyncApplyResult, SyncExportResult, SyncPlanItem, SyncPreview, SyncRequest } from './types.js';
export type { SyncApplyResult, SyncExportResult, SyncPreview, SyncRequest } from './types.js';
import { tr } from '../i18n/index.js';

const TTL = 10 * 60_000;
const MAX_TEXT = 20 * 1024 * 1024;

export class SyncService {
  private pending = new Map<string, { bundle: SyncBundle; secret: SyncSecret | null; plan: SyncPlanItem[]; at: number }>();

  constructor(private deps: { meta: MetaStore; secrets?: SecretService }) {}

  /** The bundle text both 导出 and remote push write; `encrypted` says whether secrets are in it. */
  async buildText(passphrase?: string): Promise<{ text: string; encrypted: boolean }> {
    const b = await buildBundle(this.deps.meta, this.deps.secrets, { passphrase: passphrase || undefined });
    return { text: JSON.stringify(b, null, 2), encrypted: !!b.secret };
  }

  async exportBundle(passphrase?: string): Promise<SyncExportResult> {
    const b = await this.buildText(passphrase);
    const day = new Date().toISOString().slice(0, 10);
    return { filename: `claude-web-sync-${day}.json`, ...b };
  }

  async preview(text: string, passphrase?: string): Promise<SyncPreview> {
    if (typeof text !== 'string' || text.length > MAX_TEXT) throw new Error(tr('不是同步文件'));
    for (const [k, v] of this.pending) if (Date.now() - v.at > TTL) this.pending.delete(k);
    const bundle = parseBundle(text);
    const secret = await openSecret(bundle, passphrase);
    const plan = await planMerge(this.deps.meta, this.deps.secrets, bundle, secret);
    const token = crypto.randomBytes(12).toString('hex');
    this.pending.set(token, { bundle, secret, plan, at: Date.now() });
    return { token, createdAt: bundle.createdAt, from: bundle.from, encrypted: !!bundle.secret, items: plan };
  }

  async apply(token: string, skip: string[] = []): Promise<SyncApplyResult> {
    const p = this.pending.get(token);
    if (!p || Date.now() - p.at > TTL) { this.pending.delete(token); throw new Error(tr('预览过期了，重新选一次文件')); }
    this.pending.delete(token);
    return applyMerge(this.deps.meta, this.deps.secrets, p.bundle, p.secret, p.plan, skip);
  }

  cancel(token: string): null { this.pending.delete(token); return null; }
}

export const isSyncRequest = (req: { kind: string }): req is SyncRequest => req.kind.startsWith('sync.');

export async function handleSyncRequest(svc: SyncService, req: SyncRequest): Promise<unknown> {
  switch (req.kind) {
    case 'sync.export': return svc.exportBundle(typeof req.passphrase === 'string' ? req.passphrase : undefined);
    case 'sync.import': return svc.preview(req.text, typeof req.passphrase === 'string' ? req.passphrase : undefined);
    case 'sync.apply': return svc.apply(String(req.token), Array.isArray(req.skip) ? req.skip.map(String) : []);
    case 'sync.cancel': return svc.cancel(String(req.token));
  }
  throw new Error(`unknown sync request ${(req as { kind: string }).kind}`);
}
