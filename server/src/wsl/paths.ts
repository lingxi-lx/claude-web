// WSL ↔ Windows paths (spec E5). Pure strings, no node imports: the web side uses these through @shared too.

const WSL_UNC = /^\\\\(wsl\.localhost|wsl\$)\\([^\\]+)(?:\\(.*))?$/i;

function resolveSegs(rest: string): string[] | null {
  const out: string[] = [];
  for (const s of rest.split('\\')) {
    if (!s || s === '.') continue;
    if (s === '..') { if (!out.length) return null; out.pop(); continue; }
    out.push(s);
  }
  return out;
}

/** `\\wsl.localhost\<distro>\…` / `\\wsl$\<distro>\…` (either slash, any case) → the distro and its Linux path. */
export function parseWslUnc(p: string): { distro: string; path: string } | null {
  if (typeof p !== 'string') return null;
  const m = WSL_UNC.exec(p.replace(/\//g, '\\'));
  if (!m) return null;
  const segs = resolveSegs(m[3] ?? '');
  if (!segs) return null;
  return { distro: m[2], path: '/' + segs.join('/') };
}

export const isWslUnc = (p: string): boolean => parseWslUnc(p) !== null;

/** A Windows path as the distro sees it: drives under /mnt, its own UNC as its path; another distro / a share → null. */
export function toWslPath(p: string, distro: string): string | null {
  if (typeof p !== 'string' || !p) return null;
  const d = /^([A-Za-z]):(?:[\\/](.*))?$/.exec(p);
  if (d) {
    const segs = (d[2] ?? '').split(/[\\/]+/).filter(Boolean);
    return `/mnt/${d[1].toLowerCase()}${segs.length ? '/' + segs.join('/') : ''}`;
  }
  const u = parseWslUnc(p);
  if (u) return u.distro.toLowerCase() === String(distro).toLowerCase() ? u.path : null;
  if (p.startsWith('/') && !p.startsWith('//')) return p;
  return null;
}

/** A Linux path of the distro as Windows reaches it: /mnt/<drive> back to the drive, the rest under \\wsl.localhost. */
export function wslToWin(p: string, distro: string): string {
  const m = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(p);
  if (m) {
    const segs = (m[2] ?? '').split('/').filter(Boolean);
    return `${m[1].toUpperCase()}:\\${segs.join('\\')}`;
  }
  const segs = p.split('/').filter(Boolean);
  return `\\\\wsl.localhost\\${distro}\\${segs.join('\\')}`;
}
