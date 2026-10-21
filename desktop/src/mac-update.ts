// A Mac app updating itself without Squirrel.Mac (which refuses an update without an Apple signature; the build is
// unsigned): electron-updater still looks (latest-mac.yml), this downloads this machine's zip, checks its sha512,
// unpacks it with ditto and checks the app inside; on 立即重启更新 / on quit, a detached shell script (MAC_SWAP_SCRIPT)
// waits for the app to exit, swaps the .app and opens it again. Everything lives in <userData>/update.
import { net } from 'electron';
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAC_SWAP_SCRIPT, swapResult, type ReleaseFile } from './update-policy';

const APP_ID = 'com.claude-web.desktop'; // electron-builder.yml appId
const IDLE_MS = 60_000;

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 8 << 20, windowsHide: true }, (e, out, err) =>
      e ? reject(new Error(`${path.basename(cmd)}: ${String(err || e.message).trim().split('\n')[0]}`)) : resolve(out)));

export interface Staged { version: string; app: string }

export class MacSelfUpdate {
  private job: { version: string; p: Promise<Staged> } | null = null;
  private staged: Staged | null = null;

  constructor(readonly dir: string) {}

  /**
   * What the last swap left (the next start reads it once), and the leftovers cleared away. A failure is also kept
   * next to the update folder (`failed()`), so every later start offers that version as a download instead of fetching
   * it again only to be refused again on quit; a successful swap forgets it.
   */
  takeResult(): ReturnType<typeof swapResult> {
    const file = path.join(this.dir, 'result');
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
    fs.rmSync(this.dir, { recursive: true, force: true });
    const r = swapResult(text);
    if (r && !r.ok) fs.writeFileSync(this.failedFile, JSON.stringify({ version: r.version, error: r.error }));
    else fs.rmSync(this.failedFile, { force: true });
    return r;
  }

  private get failedFile() { return `${this.dir}-failed.json`; }

  /** The version whose swap failed, if one did (see takeResult). */
  failed(): { version: string; error: string } | null {
    try {
      const f = JSON.parse(fs.readFileSync(this.failedFile, 'utf8'));
      return typeof f?.version === 'string' ? { version: f.version, error: String(f.error ?? '') } : null;
    } catch { return null; }
  }

  get ready(): Staged | null { return this.staged; }

  /** Download, check and unpack `version` (the same promise while one is under way). */
  fetch(version: string, url: string, file: ReleaseFile, onProgress: (percent: number) => void): Promise<Staged> {
    if (this.staged?.version === version) return Promise.resolve(this.staged);
    if (this.job?.version === version) return this.job.p;
    const p = this.stage(version, url, file, onProgress).then(
      (s) => { this.staged = s; return s; },
      (e) => { if (this.job?.p === p) this.job = null; throw e; },
    );
    this.job = { version, p };
    return p;
  }

  private async stage(version: string, url: string, file: ReleaseFile, onProgress: (percent: number) => void): Promise<Staged> {
    this.staged = null;
    fs.mkdirSync(this.dir, { recursive: true });
    const zip = path.join(this.dir, path.basename(new URL(url).pathname));
    const out = path.join(this.dir, 'new');
    // anything else here is an older download, the app a swap put aside, the script
    for (const f of fs.readdirSync(this.dir)) {
      const p = path.join(this.dir, f);
      if (p !== zip && p !== out) fs.rmSync(p, { recursive: true, force: true });
    }
    // unpacked before the app was restarted without installing it
    const kept = await checkedApp(out, version).catch(() => null);
    if (kept) { onProgress(100); return { version, app: kept }; }

    if (!(fs.existsSync(zip) && (await sha512Of(zip)) === file.sha512)) await download(url, zip, file, onProgress);
    onProgress(100);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out);
    await run('/usr/bin/ditto', ['-x', '-k', zip, out]);
    const app = await checkedApp(out, version);
    // not downloaded by a browser, so not quarantined — but a quarantined app would be translocated on its first start
    await run('/usr/bin/xattr', ['-cr', app]).catch(() => {});
    fs.rmSync(zip, { force: true }); // the unpacked app is what is kept; ~200 MB less
    return { version, app };
  }

  /**
   * Hand over to the swap script; the caller then quits. False when nothing is staged (or it is already handed over:
   * the explicit install quits, and quitting would install again).
   */
  install(bundle: string, relaunch: boolean): boolean {
    const s = this.staged;
    if (!s || !fs.existsSync(s.app)) return false;
    this.staged = null;
    const script = path.join(this.dir, 'swap.sh');
    fs.writeFileSync(script, MAC_SWAP_SCRIPT, { mode: 0o755 });
    const child = spawn('/bin/sh', [script, String(process.pid), bundle, s.app, path.join(this.dir, 'result'), relaunch ? '1' : '0', s.version], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {}); // /bin/sh is always there; never let this take the quitting app down
    child.unref();
    return true;
  }
}

/** The one .app in `dir`, if it is this app at `version` with its executable in place. */
async function checkedApp(dir: string, version: string): Promise<string> {
  const apps = fs.readdirSync(dir).filter((f) => f.endsWith('.app'));
  if (apps.length !== 1) throw new Error(`the update holds ${apps.length} apps`);
  const app = path.join(dir, apps[0]);
  const info = JSON.parse(await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents', 'Info.plist')]));
  if (info.CFBundleIdentifier !== APP_ID) throw new Error(`the update is another app (${info.CFBundleIdentifier})`);
  if (info.CFBundleShortVersionString !== version) throw new Error(`the update is version ${info.CFBundleShortVersionString}, not ${version}`);
  fs.accessSync(path.join(app, 'Contents', 'MacOS', String(info.CFBundleExecutable)), fs.constants.X_OK);
  return app;
}

function sha512Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('base64')));
  });
}

/** Electron's network stack (the system proxy, like electron-updater's own downloads), into `dest` once the sha512 matches. */
async function download(url: string, dest: string, file: ReleaseFile, onProgress: (percent: number) => void) {
  const ac = new AbortController();
  let idle = setTimeout(() => ac.abort(), IDLE_MS);
  const part = `${dest}.part`;
  const out = fs.createWriteStream(part);
  try {
    const res = await net.fetch(url, { signal: ac.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${url}`);
    const total = Number(res.headers.get('content-length')) || file.size || 0;
    const h = crypto.createHash('sha512');
    const reader = res.body.getReader();
    let got = 0;
    let shown = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(idle);
      idle = setTimeout(() => ac.abort(), IDLE_MS);
      h.update(value);
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      const pct = total ? Math.min(99, Math.floor((got / total) * 100)) : 0;
      if (pct !== shown) { shown = pct; onProgress(pct); }
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
    if (file.size && got !== file.size) throw new Error(`downloaded ${got} bytes, expected ${file.size}`);
    if (h.digest('base64') !== file.sha512) throw new Error('sha512 checksum mismatch');
    fs.renameSync(part, dest);
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw ac.signal.aborted ? new Error(`download stalled for ${IDLE_MS / 1000} s`) : e;
  } finally {
    clearTimeout(idle);
  }
}
