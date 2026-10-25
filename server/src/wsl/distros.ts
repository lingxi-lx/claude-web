// `wsl.exe -l -q` and the per-distro check script (spec E5). Pure.

/** `wsl -l -q` prints UTF-16LE with a BOM (UTF-8 when WSL_UTF8=1): the distro names, without Docker Desktop's own. */
export function parseDistroList(buf: Buffer): string[] {
  if (!buf || !buf.length) return [];
  let utf16 = false;
  for (let i = 1; i < buf.length; i += 2) if (buf[i] === 0) { utf16 = true; break; }
  const text = buf.toString(utf16 ? 'utf16le' : 'utf8').replace(/^\ufeff/, '').replace(/\0/g, '');
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^docker-desktop(-data)?$/.test(l));
}

/** Run with `sh -lc` inside the distro: home, where claude is (or a marker), whether Windows interop is on. */
export const WSL_CHECK_SCRIPT = `printf '%s\\n' "$HOME"; command -v claude || echo CW_NO_CLAUDE; cat /proc/sys/fs/binfmt_misc/WSLInterop /proc/sys/fs/binfmt_misc/WSLInterop-late 2>/dev/null | head -1`;

/** The official installer, shown to the user word for word before it is ever run. */
export const INSTALL_CMD = 'curl -fsSL https://claude.ai/install.sh | bash';

export function parseWslCheck(stdout: string): { home: string | null; claude: boolean | null; interop: boolean | null } {
  const lines = String(stdout ?? '').split(/\r?\n/).map((l) => l.trim());
  const home = lines[0] ? lines[0] : null;
  const c = lines[1];
  const claude = !c ? null : c === 'CW_NO_CLAUDE' ? false : true;
  const i = lines[2];
  const interop = i === 'enabled' ? true : i === 'disabled' ? false : null;
  return { home, claude, interop };
}
