// 发布 (stage F5): a file from the 产物 list becomes a snapshot in `~/.claude-web/published/<id>/` (the page plus the
// local files it refers to), served at `/p/<id>/` with no app token — sandboxed (CSP `sandbox allow-scripts
// allow-popups`, no same-origin) and `nosniff`. 1 day / 7 days / never; 撤回 deletes the snapshot. The LAN link exists
// only while remote listening is on. A copy can go to the always-on machine (its address), and a page can be exported
// as one self-contained HTML file.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { ClientRequest, CloudRequest, PublishedItem, PublishExpiry } from '../protocol.js';
import { PUBLISH_HEADERS, expiresAt, inlineHtml, isExpired, isPublishId, mimeOf, newPublishId, resolveInside, snapshotFiles } from './core.js';
import { tr } from '../i18n/index.js';

const EXPIRIES: PublishExpiry[] = ['1d', '7d', 'never'];
const MAX_PEER_BYTES = 50 * 1024 * 1024;

export interface PublishOpts {
  dir: string;
  exportsDir: string;
  localBase(): string;
  lanBase?(): string | null;
  now?(): number;
  peers?(): { id: string; name: string; url: string; via: string; enabled: boolean; state?: string }[];
  request?<T = unknown>(peerId: string, req: ClientRequest): Promise<T>;
}

export interface PublishedView extends PublishedItem { localUrl?: string; lanUrl?: string | null }

/** A relative path from another machine: plain segments only. */
const safeRel = (rel: unknown): rel is string => typeof rel === 'string' && !!rel && rel.length < 400 && !rel.includes('\0') && !rel.includes('\\') && !rel.startsWith('/') && !/^[a-zA-Z]:/.test(rel) && rel.split('/').every((s) => s && s !== '..' && s !== '.');

export class PublishService {
  constructor(private readonly o: PublishOpts) { fs.mkdirSync(o.dir, { recursive: true }); }

  private now() { return (this.o.now ?? Date.now)(); }
  private get indexFile() { return path.join(this.o.dir, 'index.json'); }
  private items(): PublishedItem[] {
    try { const v = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')); return Array.isArray(v) ? v.filter((x) => x && isPublishId(x.id)) : []; } catch { return []; }
  }
  private save(items: PublishedItem[]) {
    const tmp = `${this.indexFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
    fs.renameSync(tmp, this.indexFile);
  }
  private view(it: PublishedItem): PublishedView {
    if (it.peerId) return it;
    const lan = this.o.lanBase?.() ?? null;
    return { ...it, localUrl: `${this.o.localBase()}/p/${it.id}/`, lanUrl: lan ? `${lan}/p/${it.id}/` : null };
  }
  private checkExpiry(e: unknown): PublishExpiry {
    if (!EXPIRIES.includes(e as PublishExpiry)) throw new Error(tr('有效期只能是 1 天、7 天或永久'));
    return e as PublishExpiry;
  }

  /** Copies `rels` (relative to `fromDir`) into a fresh snapshot directory for `id`, replacing the old one. */
  private writeSnapshot(id: string, write: (tmp: string) => { files: number; bytes: number }) {
    const target = path.join(this.o.dir, id);
    const tmp = path.join(this.o.dir, `${id}.tmp-${process.pid}-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const r = write(tmp);
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(tmp, target);
      return r;
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
  }

  async create(file: string, expiry: PublishExpiry, id?: string): Promise<PublishedView> {
    const exp = this.checkExpiry(expiry);
    const abs = path.resolve(String(file ?? ''));
    let st: fs.Stats;
    try { st = fs.statSync(abs); } catch { throw new Error(tr('找不到这个文件')); }
    if (!st.isFile()) throw new Error(tr('只能发布文件'));
    const items = this.items();
    const prev = id ? items.find((x) => x.id === id && !x.peerId) : undefined;
    if (id && !prev) throw new Error(tr('这个发布已经不在了'));
    const pid = prev?.id ?? newPublishId();
    const fromDir = fs.realpathSync(path.dirname(abs));
    const rels = snapshotFiles(abs);
    const { files, bytes } = this.writeSnapshot(pid, (tmp) => {
      let n = 0, b = 0;
      for (const rel of rels) {
        const src = resolveInside(fromDir, rel);
        if (!src) continue;
        const dest = path.join(tmp, ...rel.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        n++; b += fs.statSync(dest).size;
      }
      return { files: n, bytes: b };
    });
    const now = this.now();
    const item: PublishedItem = { id: pid, name: path.basename(abs), source: abs, entry: rels[0], createdAt: prev?.createdAt ?? now, updatedAt: now, expiresAt: expiresAt(exp, now), files, bytes };
    this.save([...items.filter((x) => x.id !== pid), item]);
    return this.view(item);
  }

  list(): { items: PublishedView[]; local: string; lan: string | null } {
    void this.sweep();
    void this.retryPendingRevokes();
    const now = this.now();
    return { items: this.items().filter((x) => !isExpired(x, now)).sort((a, b) => b.updatedAt - a.updatedAt).map((x) => this.view(x)), local: this.o.localBase(), lan: this.o.lanBase?.() ?? null };
  }

  /**
   * 撤回. A copy on another machine is forgotten here only once that machine said it removed it (its revoke of an id it
   * no longer has succeeds too): offline / refusing, the record stays marked `revokePending` and is retried when the
   * list is read again and when the machine comes back (fix wave F6) — the page must not stay up there unseen.
   */
  async revoke(id: string): Promise<{ pending?: boolean } | null> {
    if (!isPublishId(id)) throw new Error(tr('这个发布已经不在了'));
    const items = this.items();
    const it = items.find((x) => x.id === id);
    if (it?.peerId && this.o.request) {
      const done = await this.o.request(it.peerId, { kind: 'publish.revoke', id }).then(() => true, () => false);
      if (!done) {
        // re-read: the list may have changed while the other machine was asked
        this.save(this.items().map((x) => (x.id === id ? { ...x, revokePending: true } : x)));
        return { pending: true };
      }
    }
    fs.rmSync(path.join(this.o.dir, id), { recursive: true, force: true });
    this.save(this.items().filter((x) => x.id !== id));
    return null;
  }

  private retrying: Promise<void> | null = null;
  /** Revokes another machine could not be told about yet: tried again (one pass at a time). */
  retryPendingRevokes(): Promise<void> {
    if (this.retrying) return this.retrying;
    const online = new Set((this.o.peers?.() ?? []).filter((p) => p.enabled && (!p.state || p.state === 'online')).map((p) => p.id));
    const pending = this.items().filter((x) => x.revokePending && x.peerId && online.has(x.peerId));
    if (!pending.length || !this.o.request) return Promise.resolve();
    this.retrying = (async () => {
      for (const it of pending) await this.revoke(it.id).catch(() => { /* next time */ });
    })().finally(() => { this.retrying = null; });
    return this.retrying;
  }

  /** What a publish of `file` would copy (the dialog lists it before 发布): the page and its own assets. */
  async files(file: string): Promise<{ files: { rel: string; size: number }[]; bytes: number }> {
    const abs = path.resolve(String(file ?? ''));
    let st: fs.Stats;
    try { st = fs.statSync(abs); } catch { throw new Error(tr('找不到这个文件')); }
    if (!st.isFile()) throw new Error(tr('只能发布文件'));
    const fromDir = fs.realpathSync(path.dirname(abs));
    let bytes = 0;
    const files = snapshotFiles(abs).map((rel) => {
      const src = resolveInside(fromDir, rel);
      const size = src ? fs.statSync(src).size : 0;
      bytes += size;
      return { rel, size };
    });
    return { files, bytes };
  }

  /** 发布到常开机器: the same snapshot, sent to the peer; the link is the peer's own address. */
  async toPeer(file: string, expiry: PublishExpiry, peerId: string): Promise<PublishedView> {
    const exp = this.checkExpiry(expiry);
    const peer = this.o.peers?.().find((p) => p.id === peerId && p.enabled);
    if (!peer || !this.o.request) throw new Error(tr('没有这台机器'));
    const abs = path.resolve(String(file ?? ''));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(tr('找不到这个文件'));
    const fromDir = fs.realpathSync(path.dirname(abs));
    let total = 0;
    const files = snapshotFiles(abs).map((rel) => {
      const src = resolveInside(fromDir, rel)!;
      const data = fs.readFileSync(src);
      total += data.length;
      if (total > MAX_PEER_BYTES) throw new Error(tr('文件太大，不能发到其它机器（上限 50 MB）'));
      return { rel, data: data.toString('base64') };
    });
    const r = await this.o.request<PublishedItem>(peerId, { kind: 'publish.receive', name: path.basename(abs), entry: files[0].rel, source: abs, expiry: exp, files });
    if (!r || !isPublishId(r.id)) throw new Error(tr('那台机器没有发布成功'));
    const url = peer.via === 'direct' && /^https?:\/\//.test(peer.url) ? `${peer.url.replace(/\/+$/, '')}/p/${r.id}/` : undefined;
    const now = this.now();
    const item: PublishedItem = { id: r.id, name: path.basename(abs), source: abs, entry: files[0].rel, createdAt: now, updatedAt: now, expiresAt: r.expiresAt ?? expiresAt(exp, now), files: files.length, bytes: total, peerId, peerName: peer.name, ...(url ? { url } : {}) };
    this.save([...this.items().filter((x) => x.id !== r.id), item]);
    return item;
  }

  /** The always-on machine's side of 发布到常开机器. */
  async receive(req: Extract<CloudRequest, { kind: 'publish.receive' }>): Promise<PublishedView> {
    const exp = this.checkExpiry(req.expiry);
    if (!Array.isArray(req.files) || !req.files.length || req.files.length > 200) throw new Error(tr('没有要发布的文件'));
    if (!req.files.every((f) => safeRel(f?.rel) && typeof f.data === 'string')) throw new Error(tr('文件路径不能用'));
    if (!safeRel(req.entry) || !req.files.some((f) => f.rel === req.entry)) throw new Error(tr('文件路径不能用'));
    const id = newPublishId();
    let total = 0;
    const { files, bytes } = this.writeSnapshot(id, (tmp) => {
      for (const f of req.files) {
        const data = Buffer.from(f.data, 'base64');
        total += data.length;
        if (total > MAX_PEER_BYTES) throw new Error(tr('文件太大，不能发到其它机器（上限 50 MB）'));
        const dest = path.join(tmp, ...f.rel.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, data);
      }
      return { files: req.files.length, bytes: total };
    });
    const now = this.now();
    const item: PublishedItem = { id, name: String(req.name || req.entry).slice(0, 200), source: String(req.source || '').slice(0, 1000), entry: req.entry, createdAt: now, updatedAt: now, expiresAt: expiresAt(exp, now), files, bytes };
    this.save([...this.items(), item]);
    return this.view(item);
  }

  /** 导出成单个 HTML: written to `<data>/exports/<name>.html` (a new name when taken). */
  async inline(file: string): Promise<{ path: string }> {
    const abs = path.resolve(String(file ?? ''));
    if (!/\.html?$/i.test(abs) || !fs.existsSync(abs)) throw new Error(tr('只能把网页导出成单个 HTML'));
    const html = inlineHtml(abs);
    fs.mkdirSync(this.o.exportsDir, { recursive: true });
    const base = path.basename(abs).replace(/\.html?$/i, '');
    let out = path.join(this.o.exportsDir, `${base}.html`);
    for (let n = 2; fs.existsSync(out); n++) out = path.join(this.o.exportsDir, `${base}-${n}.html`);
    fs.writeFileSync(out, html);
    return { path: out };
  }

  async sweep(): Promise<void> {
    const now = this.now();
    const items = this.items();
    const gone = items.filter((x) => isExpired(x, now));
    if (!gone.length) return;
    for (const g of gone) fs.rmSync(path.join(this.o.dir, g.id), { recursive: true, force: true });
    this.save(items.filter((x) => !isExpired(x, now)));
  }

  /**
   * `/p/<id>/<path>` — before any token check, on the main and the LAN listener alike. Anything under /p/ is ours:
   * what is not a live snapshot's file is a 404 (never the app's page).
   */
  handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
    const raw = (req.url ?? '').split('?')[0].split('#')[0];
    if (!raw.startsWith('/p/') && !url.pathname.startsWith('/p/') && raw !== '/p' && url.pathname !== '/p') return false;
    const notFound = () => { res.writeHead(404, { ...PUBLISH_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, PUBLISH_HEADERS).end(); return true; }
    const m = /^\/p\/([0-9a-f]{32})(\/.*)?$/.exec(raw);
    if (!m) { notFound(); return true; }
    const it = this.items().find((x) => x.id === m[1] && !x.peerId);
    if (!it) { notFound(); return true; }
    if (isExpired(it, this.now())) { void this.sweep(); notFound(); return true; }
    if (!m[2]) { res.writeHead(301, { ...PUBLISH_HEADERS, Location: `/p/${it.id}/` }); res.end(); return true; }
    const rel = m[2].slice(1) || encodeURIComponent(it.entry).replace(/%2F/g, '/');
    const file = resolveInside(path.join(this.o.dir, it.id), rel);
    if (!file) { notFound(); return true; }
    const size = fs.statSync(file).size;
    res.writeHead(200, { ...PUBLISH_HEADERS, 'Content-Type': mimeOf(file), 'Content-Length': size });
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    return true;
  }
}
