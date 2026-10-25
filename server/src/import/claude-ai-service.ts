// 导入 claude.ai 数据 (stage F4): a one-time import of the export zip (not a live sync; claude.ai is never contacted).
// Conversations → `<data>/claude-ai/conversations/<uuid>.json` (the claude.ai library source reads them); projects →
// projects here (one sub-folder per project in the folder the user picked, the project's documents written there, its
// custom instructions as the project's instructions). Read-only toward the user's files except that folder, where an
// existing file is never overwritten. Re-importing dedupes by uuid (a newer conversation replaces the old copy).
import fs from 'node:fs';
import path from 'node:path';
import type { AgentKind, ClaudeAiImportResult, ClaudeAiScan } from '../protocol.js';
import { readZip } from './zip.js';
import { parseExport, planImport, safeName, type ClaudeAiExport } from './claude-ai.js';
import { conversationsDir, type StoredConversation } from '../library/claudeai-source.js';
import { tr } from '../i18n/index.js';

export const CLAUDEAI_UPLOAD_MAX = 2 * 1024 * 1024 * 1024;

export interface ClaudeAiImportOpts {
  root: string;
  meta: {
    workspaces(): { id: string; path: string; name: string; claudeAiUuid?: string }[];
    addWorkspace(p: string): Promise<{ id: string; path: string }>;
    updateWorkspace(id: string, patch: { instructions?: string | null; claudeAiUuid?: string }): Promise<unknown>;
  };
  library: { join(kind: AgentKind, on: boolean): Promise<void>; invalidate(kind?: AgentKind): void };
  source?: { invalidate(): void };
  now?(): number;
}

export class ClaudeAiImport {
  constructor(private readonly o: ClaudeAiImportOpts) {}

  uploadsDir() { return path.join(this.o.root, 'uploads'); }

  /** Only a file our own upload endpoint wrote. */
  private zipPath(p: string): string {
    const abs = path.resolve(String(p ?? ''));
    const dir = path.resolve(this.uploadsDir());
    if (!abs.startsWith(dir + path.sep) || !abs.endsWith('.zip') || !fs.existsSync(abs)) throw new Error(tr('找不到上传的导出包，请重新选择'));
    return abs;
  }

  private parse(p: string): ClaudeAiExport {
    const buf = fs.readFileSync(this.zipPath(p));
    let files: Map<string, Buffer>;
    try { files = readZip(buf); } catch { throw new Error(tr('这不是一个 zip 文件')); }
    return parseExport(files);
  }

  private existing(): Map<string, string> {
    const out = new Map<string, string>();
    const dir = conversationsDir(this.o.root);
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return out; }
    for (const n of names) {
      try { const s = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) as StoredConversation; if (s?.conv?.uuid) out.set(s.conv.uuid, s.conv.updatedAt); } catch { /* skipped */ }
    }
    return out;
  }

  private summary(x: ClaudeAiExport): ClaudeAiScan {
    const plan = planImport(x.conversations, this.existing());
    return {
      conversations: x.conversations.length, projects: x.projects.length, docs: x.projects.reduce((n, p) => n + p.docs.length, 0),
      add: plan.add.length, update: plan.update.length, same: plan.same.length, skipped: x.skipped,
      ...(x.user ? { user: x.user.name || x.user.email } : {}),
    };
  }

  async scan(p: string): Promise<ClaudeAiScan> { return this.summary(this.parse(p)); }

  async run(p: string, folder?: string): Promise<ClaudeAiImportResult> {
    const x = this.parse(p);
    const scan = this.summary(x);
    const plan = planImport(x.conversations, this.existing());
    let projectsCreated = 0, projectsUpdated = 0, filesWritten = 0, filesKept = 0;
    const projectDir = new Map<string, string>();
    const base = folder?.trim() ? path.resolve(folder.trim()) : '';
    if (base) {
      if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) throw new Error(tr('找不到这个文件夹：{f}', { f: base }));
      for (const pr of x.projects) {
        let w = this.o.meta.workspaces().find((ws) => ws.claudeAiUuid === pr.uuid);
        if (w) projectsUpdated++;
        else {
          const dir = path.join(base, safeName(pr.name, pr.uuid.slice(0, 8)));
          fs.mkdirSync(dir, { recursive: true });
          const added = await this.o.meta.addWorkspace(dir);
          w = this.o.meta.workspaces().find((ws) => ws.id === added.id) ?? { ...added, name: pr.name };
          projectsCreated++;
        }
        await this.o.meta.updateWorkspace(w.id, { claudeAiUuid: pr.uuid, ...(pr.instructions.trim() ? { instructions: pr.instructions } : {}) });
        projectDir.set(pr.uuid, w.path);
        if (!fs.existsSync(w.path)) fs.mkdirSync(w.path, { recursive: true });
        for (const d of pr.docs) {
          const file = path.join(w.path, safeName(d.filename, 'document.txt'));
          if (fs.existsSync(file)) { filesKept++; continue; }
          fs.writeFileSync(file, d.content, { flag: 'wx' });
          filesWritten++;
        }
      }
    }
    const dir = conversationsDir(this.o.root);
    fs.mkdirSync(dir, { recursive: true });
    const write = new Set([...plan.add, ...plan.update]);
    const now = (this.o.now ?? Date.now)();
    for (const c of x.conversations) {
      if (!write.has(c.uuid) || !/^[\w-]{1,80}$/.test(c.uuid)) continue;
      const cwd = (c.projectUuid && projectDir.get(c.projectUuid)) || undefined;
      const stored: StoredConversation = { conv: c, ...(cwd ? { cwd } : {}), importedAt: now };
      const file = path.join(dir, `${c.uuid}.json`);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(stored));
      fs.renameSync(`${file}.tmp`, file);
    }
    if (x.conversations.length) await this.o.library.join('claudeai', true);
    this.o.source?.invalidate();
    this.o.library.invalidate('claudeai');
    fs.rmSync(this.zipPath(p), { force: true });
    return { ...scan, projectsCreated, projectsUpdated, filesWritten, filesKept };
  }
}
