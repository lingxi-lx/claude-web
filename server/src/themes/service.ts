// The user's own character themes (spec 2026-10-22 §1, §5): `<dataDir>/themes/<id>/` (saved) and
// `<dataDir>/themes/.drafts/<id>/` (what the theme skill is working on), three files each, watched so every window
// picks a change up. And the trial runs: a draft is handed to one window, which runs it in its sandboxed backdrop
// worker for a few seconds and answers with a picture and how long the frames took (web/src/themes/trial.ts).
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir } from '../files/service.js';
import { checkDraft, type Draft } from './check.js';
import type { ThemePack } from './core/index.js';
import { tr } from '../i18n/index.js';

export interface ThemeSource { id: string; json: string; backdrop?: string; css?: string; draft?: boolean; mtime: number }
export interface TrialRequest { id: string; source: ThemeSource }
export interface TrialResult { png?: string; errors: string[]; avgMs?: number; maxMs?: number; note?: string }

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const FILES = { json: 'theme.json', backdrop: 'backdrop.js', css: 'theme.css' } as const;
const TRIAL_MS = 15_000;

export class ThemeService extends EventEmitter {
  readonly dir: string;
  private watcher: fs.FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private hosts = new Map<object, (r: TrialRequest) => void>();
  private waiting = new Map<string, { key: object; resolve: (r: TrialResult | null) => void; timer: NodeJS.Timeout }>();

  constructor(dir = path.join(dataDir(), 'themes')) {
    super();
    this.dir = dir;
  }

  private folder(id: string, draft: boolean) {
    if (!ID.test(id)) throw new Error(tr('主题 id 只能用小写字母、数字和连字符'));
    return draft ? path.join(this.dir, '.drafts', id) : path.join(this.dir, id);
  }

  private readFolder(dir: string, id: string, draft: boolean): ThemeSource | null {
    try {
      const json = fs.readFileSync(path.join(dir, FILES.json), 'utf8');
      const opt = (f: string) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return undefined; } };
      return { id, json, backdrop: opt(FILES.backdrop), css: opt(FILES.css), draft, mtime: fs.statSync(path.join(dir, FILES.json)).mtimeMs };
    } catch { return null; }
  }

  /** Saved themes (and, with `drafts`, the drafts too), newest first. */
  list(drafts = false): ThemeSource[] {
    const out: ThemeSource[] = [];
    const scan = (base: string, draft: boolean) => {
      let names: string[] = [];
      try { names = fs.readdirSync(base); } catch { return; }
      for (const n of names) if (ID.test(n)) { const s = this.readFolder(path.join(base, n), n, draft); if (s) out.push(s); }
    };
    scan(this.dir, false);
    if (drafts) scan(path.join(this.dir, '.drafts'), true);
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  get(id: string): ThemeSource | null {
    if (!ID.test(id)) return null;
    return this.readFolder(this.folder(id, true), id, true) ?? this.readFolder(this.folder(id, false), id, false);
  }

  /** Check a draft and keep it (the same id replaces the previous draft). No pack = not kept. */
  saveDraft(d: Draft): { pack?: ThemePack; errors: string[]; source?: ThemeSource } {
    const r = checkDraft(d);
    if (!r.pack) return r;
    const dir = this.folder(r.pack.id, true);
    fs.mkdirSync(dir, { recursive: true });
    const json = typeof d.json === 'string' ? d.json : JSON.stringify(d.json, null, 1);
    this.write(dir, FILES.json, json);
    this.write(dir, FILES.backdrop, d.backdrop);
    this.write(dir, FILES.css, d.css);
    return { ...r, source: this.readFolder(dir, r.pack.id, true)! };
  }

  /** The draft becomes a saved theme (replacing a saved one with the same id). */
  publish(id: string): ThemeSource {
    const from = this.folder(id, true);
    if (!fs.existsSync(path.join(from, FILES.json))) throw new Error(tr('没有这个草稿：{id}（先用 theme_draft）', { id }));
    const to = this.folder(id, false);
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    this.changed();
    return this.readFolder(to, id, false)!;
  }

  remove(id: string): boolean {
    let gone = false;
    for (const draft of [false, true]) {
      const dir = this.folder(id, draft);
      if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); gone = true; }
    }
    if (gone) this.changed();
    return gone;
  }

  private write(dir: string, name: string, body: string | undefined) {
    const f = path.join(dir, name);
    if (body === undefined) { fs.rmSync(f, { force: true }); return; }
    fs.writeFileSync(`${f}.tmp`, body);
    fs.renameSync(`${f}.tmp`, f);
  }

  // ---- watching ----

  watch(): void {
    if (this.watcher) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.watcher = fs.watch(this.dir, { recursive: true }, (_e, name) => {
        // drafts change only through theme_draft (which reports them itself): saved themes are what windows show
        if (name && String(name).replace(/\\/g, '/').startsWith('.drafts/')) return;
        this.changed();
      });
      this.watcher.on('error', () => { this.watcher?.close(); this.watcher = null; });
    } catch (e) {
      console.warn(`[themes] cannot watch ${this.dir}: ${(e as Error).message}`);
    }
  }

  private changed() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.emit('changed'); }, 120);
  }

  close() { this.watcher?.close(); this.watcher = null; if (this.timer) clearTimeout(this.timer); }

  // ---- trial runs in a window ----

  /** A window that can run trials (the most recent one asked first). */
  setHost(key: object, on: boolean, send?: (r: TrialRequest) => void) {
    if (on && send) { this.hosts.delete(key); this.hosts.set(key, send); } else this.dropConnection(key);
  }

  dropConnection(key: object) {
    this.hosts.delete(key);
    for (const [id, w] of this.waiting) if (w.key === key) { clearTimeout(w.timer); this.waiting.delete(id); w.resolve(null); }
  }

  hasHost() { return this.hosts.size > 0; }

  /** Run a draft in a window: its answer, or null (no window, it went away, or it took too long). */
  trial(source: ThemeSource, ms = TRIAL_MS): Promise<TrialResult | null> {
    let host: [object, (r: TrialRequest) => void] | null = null;
    for (const e of this.hosts) host = e;
    if (!host) return Promise.resolve(null);
    const [key, send] = host;
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(id); resolve(null); }, ms);
      this.waiting.set(id, { key, resolve, timer });
      try { send({ id, source }); } catch { clearTimeout(timer); this.waiting.delete(id); resolve(null); }
    });
  }

  /** A window's answer to a trial. False: nothing of that connection is waiting for it. */
  trialResult(key: object, id: string, r: TrialResult): boolean {
    const w = this.waiting.get(id);
    if (!w || w.key !== key) return false;
    clearTimeout(w.timer);
    this.waiting.delete(id);
    w.resolve({
      png: typeof r.png === 'string' && r.png.length < 4_000_000 ? r.png : undefined,
      errors: Array.isArray(r.errors) ? r.errors.map((e) => String(e).slice(0, 1000)).slice(0, 30) : [],
      avgMs: typeof r.avgMs === 'number' ? r.avgMs : undefined,
      maxMs: typeof r.maxMs === 'number' ? r.maxMs : undefined,
      note: typeof r.note === 'string' ? r.note.slice(0, 500) : undefined,
    });
    return true;
  }
}
