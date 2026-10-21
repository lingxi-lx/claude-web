// The app's own updates, the parts that decide rather than do (main.ts wires them to electron-updater). No electron
// imports: desktop/src/update-policy.test.ts runs them under vitest.
//
// Before v0.1.3 nothing ever looked for a new version by itself — only 设置 → 高级 → 更新 did, so nobody updated.
// Now: the Windows installer build downloads a new release in the background and asks to restart into it, and so does
// macOS — not through Squirrel.Mac (it refuses an update without an Apple signature, and the build is unsigned) but by
// replacing its own .app (mac-update.ts) when it can. Builds that cannot install one themselves get the same prompt
// with a download button instead — the portable exe (electron-updater does not update it), a Mac app that cannot
// replace itself (macSelfUpdateBlocker), Linux. A release whose notes carry REQUIRED_MARK cannot be put off.

export type UpdateMode = 'auto' | 'manual';

/** The Windows installer (NSIS) and a Mac app that can replace itself install by themselves; the rest are told where to download. */
export function updateMode(platform: string, env: Record<string, string | undefined>, macCanReplace = false): UpdateMode {
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_FILE ? 'manual' : 'auto';
  if (platform === 'darwin') return macCanReplace ? 'auto' : 'manual';
  return 'manual';
}

/** The .app the running macOS main process belongs to (`…/X.app/Contents/MacOS/X`), or null. */
export function macBundle(execPath: string): string | null {
  return /^(\/.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath)?.[1] ?? null;
}

export type MacBlocker = 'dev' | 'not-bundle' | 'translocated' | 'read-only';
/**
 * Why this Mac app cannot replace itself, or null when it can. Translocated: opened straight from Downloads or a dmg,
 * macOS runs it from a read-only random path. `writable`: the .app and the folder holding it (moving a directory needs both).
 */
export function macSelfUpdateBlocker(o: { packaged: boolean; bundle: string | null; writable: boolean }): MacBlocker | null {
  if (!o.packaged) return 'dev'; // `electron .` would replace node_modules/electron's Electron.app
  if (!o.bundle) return 'not-bundle';
  if (o.bundle.includes('/AppTranslocation/')) return 'translocated';
  if (!o.writable) return 'read-only';
  return null;
}

/** An entry of latest-mac.yml's `files`. */
export interface ReleaseFile { url: string; sha512?: string; size?: number }
/** The zip a Mac app replaces itself from: this machine's architecture (an Intel build under Rosetta takes arm64). */
export function macZip(files: ReleaseFile[] | undefined, arch: string, arm64Translated = false): ReleaseFile | null {
  const want = `-mac-${arch === 'arm64' || arm64Translated ? 'arm64' : 'x64'}.zip`;
  return files?.find((f) => typeof f.url === 'string' && f.url.endsWith(want) && !!f.sha512) ?? null;
}

/** Where a file of a release is downloaded from (a name in latest*.yml, or already a full URL). */
export function releaseFileUrl(repo: string, version: string, name: string, feed?: string): string {
  if (/^https?:\/\//i.test(name)) return name;
  const base = feed ? feed.replace(/\/*$/, '/') : `https://github.com/${repo}/releases/download/v${version}/`;
  return base + name;
}

/**
 * Run detached by a Mac app that is quitting into its update: waits for the app to exit, puts the new .app where the
 * old one was (the old one back if that fails), opens it again. The outcome goes into the result file the next start
 * reads (`ok <version>` / `fail <version> <why>`) — a failure there makes that version a manual download.
 *   sh swap.sh <pid> <app> <new app> <result file> <relaunch 1|0> <version>
 */
export const MAC_SWAP_SCRIPT = `#!/bin/sh
pid="$1"; app="$2"; new="$3"; result="$4"; relaunch="$5"; version="$6"
old="$(dirname "$new")/previous.app"
err="$result.err"
say() { printf '%s\\n' "$1" > "$result"; }
reopen() { if [ "$relaunch" = 1 ]; then open "$app"; fi; }
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 1200 ]; then say "fail $version the app did not quit"; exit 1; fi
  sleep 0.1
done
rm -rf "$old"
if ! mv "$app" "$old" 2>"$err"; then say "fail $version $(head -n 1 "$err")"; reopen; exit 1; fi
if ! mv "$new" "$app" 2>"$err"; then
  why="$(head -n 1 "$err")"
  mv "$old" "$app"
  say "fail $version $why"; reopen; exit 1
fi
xattr -cr "$app" 2>/dev/null
rm -rf "$old" "$err"
say "ok $version"
reopen
exit 0
`;

/** The result file MAC_SWAP_SCRIPT leaves, read. */
export function swapResult(text: string): { ok: boolean; version: string; error?: string } | null {
  const m = /^(ok|fail) (\S+)(?: (.*))?/.exec(text.trim());
  if (!m) return null;
  return m[1] === 'ok' ? { ok: true, version: m[2] } : { ok: false, version: m[2], error: (m[3] ?? '').trim() || 'unknown' };
}

/** Written into a release's notes, it makes the prompt for that release impossible to dismiss. */
export const REQUIRED_MARK = '【必须更新】';
export const isRequired = (notes: string | undefined): boolean => !!notes && notes.includes(REQUIRED_MARK);

/** The first look shortly after start (the window and the server come first), then every few hours. */
export const FIRST_CHECK_MS = 15_000;
export const CHECK_EVERY_MS = 4 * 60 * 60_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * electron-updater's `releaseNotes` as plain text: from GitHub it is the release body rendered to HTML (an array of
 * `{version, note}` when full changelogs are on); from a generic feed, whatever latest.yml says.
 */
export function notesText(n: unknown): string | undefined {
  if (Array.isArray(n)) {
    const parts = n.map((x) => notesText((x as { note?: unknown } | null)?.note)).filter((x): x is string => !!x);
    return parts.length ? parts.join('\n\n') : undefined;
  }
  if (typeof n !== 'string') return undefined;
  // HTML's own line breaks mean nothing: the block tags decide (a paragraph / heading / list ends in a blank line)
  const text = n
    .replace(/>\s*\n\s*</g, '><')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(li|tr|div)>/gi, '\n')
    .replace(/<\/(p|h[1-6]|pre|blockquote|ul|ol|table)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    });
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: string[] = [];
  for (const l of lines) if (l || (out.length && out[out.length - 1])) out.push(l);
  const s = out.join('\n').trim();
  return s || undefined;
}

export interface ManualTarget {
  /** owner/repo on GitHub */
  repo: string;
  version: string;
  platform: string;
  arch: string;
  /** an x64 build running on Apple Silicon (Rosetta): offer the arm64 one */
  arm64Translated?: boolean;
  portable?: boolean;
  /** a generic feed (end-to-end checks): files sit next to latest.yml */
  feed?: string;
}

/** The file a build that cannot update itself should download: its own kind, for this machine. */
export function manualDownloadUrl(t: ManualTarget): string {
  const v = t.version;
  const file = (name: string) => releaseFileUrl(t.repo, v, name, t.feed);
  if (t.platform === 'darwin') return file(`ClaudeWeb-${v}-mac-${t.arch === 'arm64' || t.arm64Translated ? 'arm64' : 'x64'}.dmg`);
  if (t.platform === 'win32') return file(`ClaudeWeb-${v}-${t.portable ? 'portable' : 'win-x64'}.exe`);
  return t.feed ? file('') : releasePage(t.repo, v); // Linux builds are not published: the release page says what there is
}

export const releasePage = (repo: string, version: string) => `https://github.com/${repo}/releases/tag/v${version}`;

/** An error's first line, for the status in settings (electron-updater's messages carry whole HTTP dumps). */
export const firstLine = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300);
