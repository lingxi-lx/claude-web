// Who may ask the shell for what over IPC (stage B fix wave, S3 / S8).
//
// `BrowserWindow.fromWebContents(sender)` is no check: for a <webview> guest it returns the window embedding it, so a
// handler that "only answers our windows" that way answered any page of the built-in browser that could reach IPC.
// The asker has to be a window's own webContents, one of ours, asking from its top frame.

/** What of an IPC event the check looks at (Electron's IpcMainEvent / IpcMainInvokeEvent). */
export interface IpcAsker {
  sender: { getType(): string; mainFrame?: unknown };
  senderFrame?: unknown;
}

/** The asker is the top frame of a window's own webContents, and `isOurs(sender)` says that window is the app's. */
export function fromOurWindow(e: IpcAsker, isOurs: (sender: IpcAsker['sender']) => boolean): boolean {
  try {
    if (e.sender.getType() !== 'window') return false;
    if (e.senderFrame !== undefined && e.senderFrame !== e.sender.mainFrame) return false;
    return isOurs(e.sender);
  } catch { return false; }
}

/**
 * A path the shell may hand to the system to open (`desktop:openPath`): a local absolute path. Not a network path
 * (`\\host\share`, `//host`, `\\?\UNC\…`, `\??\UNC\…` — Windows would connect and hand that machine the user's NTLM
 * credentials), not a device path, not an address with a scheme (`https:`, `ms-settings:`, `file:`).
 */
export function openablePath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.length > 4096 || p.includes('\0')) return false;
  const s = p.replace(/\//g, '\\');
  if (/^\\\?\?\\/.test(s)) return false;
  if (s.startsWith('\\\\')) return /^\\\\\?\\[A-Za-z]:\\/.test(s);
  // a drive letter is no scheme; anything else before a colon is
  if (/^[A-Za-z]:\\/.test(s)) return true;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(p)) return false;
  // POSIX absolute paths (macOS / Linux)
  return p.startsWith('/') && !p.startsWith('//');
}
