import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tr } from '../i18n/index.js';

export type OpenApp = 'explorer' | 'code' | 'cursor';

/** macOS app bundles for the editors `shell.open` knows (`open -a <name>`). */
const MAC_APPS: Record<Exclude<OpenApp, 'explorer'>, string> = { code: 'Visual Studio Code', cursor: 'Cursor' };

/**
 * One way to open something. `show`: the program's own window must not be started hidden — `windowsHide` makes
 * Windows start explorer.exe with SW_HIDE, and its window then never appears (user report: 「在资源管理器打开」 did
 * nothing; the windows were there, invisible). `shell`: a Windows command that is a `.cmd` (`code.cmd`, `cursor.cmd`
 * — Node runs no `.cmd` without a shell, and gave ENOENT, so 「在 VS Code 打开」 did nothing either); the shell's own
 * console stays hidden, the editor it starts shows.
 */
export interface Launch { cmd: string; args: string[]; show?: boolean; shell?: boolean }

/**
 * Commands to try, in order, to show `p` in the file manager (`explorer`) or open it in an editor. On macOS the
 * editor's shell command is optional (VS Code only gets `code` after "Install 'code' command in PATH", and a
 * Finder-launched app may not see it), so `open -a <app>` — which finds the bundle through Launch Services —
 * comes next. Pure: exported for tests.
 */
export function openCommands(p: string, app: OpenApp = 'explorer', platform: NodeJS.Platform = process.platform): Launch[] {
  if (platform === 'win32') {
    // explorer.exe reads `C:/a/b` as nothing it knows and opens Documents: backslashes
    if (app === 'explorer') return [{ cmd: 'explorer', args: [path.win32.normalize(p)], show: true }];
    return [{ cmd: app, args: [`"${path.win32.normalize(p)}"`], shell: true }];
  }
  if (app === 'explorer') return [{ cmd: platform === 'darwin' ? 'open' : 'xdg-open', args: [p] }];
  return platform === 'darwin' ? [{ cmd: app, args: [p] }, { cmd: 'open', args: ['-a', MAC_APPS[app], p] }] : [{ cmd: app, args: [p] }];
}

/**
 * Fire and forget: the next command is tried only when one is not installed (ENOENT). A path that is not there is an
 * error for the caller to show (explorer would open Documents instead, an editor an empty window).
 */
export function openPath(p: string, app: OpenApp = 'explorer') {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  if (!p || !existsSync(p)) throw new Error(tr('找不到这个文件夹：{p}', { p: p || tr('（空）') }));
  const cmds = openCommands(p, app);
  const run = (i: number) => {
    const c = cmds[i];
    if (!c) return;
    const child = spawn(c.cmd, c.args, { windowsHide: !c.show, shell: c.shell, detached: true, stdio: 'ignore' });
    child.on('error', (err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') run(i + 1); });
    child.unref();
  };
  run(0);
}
