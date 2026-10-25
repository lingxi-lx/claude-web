// 项目资料 (stage F2): files dropped on a project page live in `~/.claude-web/projects/<id>/`; the project's
// conversations read them through `additionalDirectories` (runtime/pool.ts). Plain file names only, no folders.
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { ProjectFile } from '../protocol.js';
import { projectFilesDir, safeProjectFile } from '../meta/project.js';
import { tr } from '../i18n/index.js';

export const PROJECT_FILE_MAX = 20 * 1024 * 1024;

export class ProjectFiles {
  constructor(private readonly dataDir: string) {}

  dir(id: string): string { return projectFilesDir(this.dataDir, id); }

  private file(id: string, name: string): string {
    const n = safeProjectFile(name);
    if (!n) throw new Error(tr('文件名不能用：{name}', { name }));
    return path.join(this.dir(id), n);
  }

  async list(id: string): Promise<ProjectFile[]> {
    const d = this.dir(id);
    let names: string[];
    try { names = await fs.promises.readdir(d); } catch { return []; }
    const out: ProjectFile[] = [];
    for (const name of names) {
      const st = await fs.promises.stat(path.join(d, name)).catch(() => null);
      if (st?.isFile()) out.push({ name, size: st.size, mtime: st.mtimeMs });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Writes the file (replacing one of the same name); over PROJECT_FILE_MAX is refused and nothing is left behind. */
  async write(id: string, name: string, data: Buffer | Readable): Promise<ProjectFile> {
    const dest = this.file(id, name);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part-${process.pid}-${Date.now()}`;
    try {
      if (Buffer.isBuffer(data)) {
        if (data.length > PROJECT_FILE_MAX) throw new Error(tr('文件太大（上限 20 MB）'));
        await fs.promises.writeFile(tmp, data);
      } else {
        let size = 0;
        data.on('data', (c: Buffer) => { size += c.length; if (size > PROJECT_FILE_MAX) data.destroy(new Error(tr('文件太大（上限 20 MB）'))); });
        await pipeline(data, fs.createWriteStream(tmp));
      }
      await fs.promises.rename(tmp, dest);
    } catch (e) {
      await fs.promises.rm(tmp, { force: true });
      throw e;
    }
    const st = await fs.promises.stat(dest);
    return { name: path.basename(dest), size: st.size, mtime: st.mtimeMs };
  }

  async remove(id: string, name: string): Promise<void> {
    await fs.promises.rm(this.file(id, name), { force: true });
  }

  hasFiles(id: string): boolean {
    try { return fs.readdirSync(this.dir(id)).length > 0; } catch { return false; }
  }
}
