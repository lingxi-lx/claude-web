// What `workspaces.add` / `workspaces.update` accept as a project folder (stage C fix wave C-S2).
import fs from 'node:fs';
import path from 'node:path';
import { isUncPath } from '../files/service.js';
import { tr } from '../i18n/index.js';

/** How long the stat of a network folder may take: SMB to a host that is gone hangs for tens of seconds. */
export const UNC_STAT_MS = 5000;

/**
 * Refuses (throws) a project path another machine sent as a network path: a project folder becomes a trust root —
 * files / search / git and the conversation's own tools may then reach into that share (FilesService.pathAllowed
 * lets a UNC path through when it is inside a project) — and touching it hands the user's NTLM credentials to that
 * host. A folder the user picked on this machine (a window here, a phone they paired) may be a share.
 */
export function refusePeerUnc(p: unknown, fromPeer: boolean): void {
  if (fromPeer && typeof p === 'string' && isUncPath(p)) throw new Error(tr('不支持网络路径'));
}

/**
 * Each extra folder must be an absolute path to an existing folder; the error names the first that is not. A user's
 * network folder becomes a trust root the same way `workspaces.add` makes one; its stat gives up after `UNC_STAT_MS`
 * (the libuv thread stays blocked until SMB times out, but the request and the dialog do not wait for it).
 */
export async function checkExtraFolders(folders: unknown, o: { fromPeer: boolean; stat?: (p: string) => Promise<{ isDirectory(): boolean }>; uncMs?: number }): Promise<void> {
  if (folders === undefined) return;
  if (!Array.isArray(folders)) throw new Error(tr('文件夹列表不对'));
  const stat = o.stat ?? ((p: string) => fs.promises.stat(p));
  for (const f of folders) {
    refusePeerUnc(f, o.fromPeer);
    let ok = typeof f === 'string' && path.isAbsolute(f);
    if (ok) {
      const look = stat(f as string).then((st) => st.isDirectory(), () => false);
      if (isUncPath(f as string)) {
        let timer: NodeJS.Timeout | undefined;
        const late = new Promise<boolean>((res) => { timer = setTimeout(() => res(false), o.uncMs ?? UNC_STAT_MS); timer.unref?.(); });
        ok = await Promise.race([look, late]);
        clearTimeout(timer);
      } else ok = await look;
    }
    if (!ok) throw new Error(tr('找不到这个文件夹：{f}', { f: String(f) }));
  }
}
