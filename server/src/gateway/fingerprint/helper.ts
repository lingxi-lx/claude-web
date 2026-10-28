// The tlsfp helper (helpers/tlsfp, Go + uTLS): started on first use when its binary is there, a loopback listener that
// makes the real client's ClientHello. Absent / not ready / crashed → callers use the Node approximation instead.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type HelperState = 'absent' | 'starting' | 'ready' | 'failed';

const here = path.dirname(fileURLToPath(import.meta.url));
const exe = process.platform === 'win32' ? 'tlsfp.exe' : 'tlsfp';
const RETRY_MS = 60_000;

/** Where the binary may be: CLAUDE_WEB_TLSFP, the repo's helpers/tlsfp/bin, the data dir's bin. */
export function helperCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  if (env.CLAUDE_WEB_TLSFP) out.push(env.CLAUDE_WEB_TLSFP);
  // server/src/gateway/fingerprint (or server/dist/gateway/fingerprint) → the repo root
  out.push(path.resolve(here, '../../../../helpers/tlsfp/bin', exe));
  const data = env.CLAUDE_WEB_DIR ?? path.join(env.USERPROFILE ?? env.HOME ?? '.', '.claude-web');
  out.push(path.join(data, 'bin', exe));
  return out;
}

export function findHelper(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const p of helperCandidates(env)) { try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ } }
  return null;
}

class Helper {
  state: HelperState = 'absent';
  private child: ChildProcess | null = null;
  private ep: { port: number; token: string } | null = null;
  private failedAt = 0;
  private bin: string | null | undefined;

  /** The running helper's port + token, or null (it is then started in the background when it can be). */
  endpoint(): { port: number; token: string } | null {
    if (this.state === 'ready') return this.ep;
    if (this.state === 'starting') return null;
    if (this.state === 'failed' && Date.now() - this.failedAt < RETRY_MS) return null;
    if (this.bin === undefined || this.state === 'failed') this.bin = findHelper();
    if (!this.bin) { this.state = 'absent'; return null; }
    this.start(this.bin);
    return null;
  }

  private start(bin: string) {
    this.state = 'starting';
    const token = randomBytes(24).toString('hex');
    let child: ChildProcess;
    try {
      // a minimal environment: the token, and what Go's networking needs on Windows
      const env: NodeJS.ProcessEnv = { TLSFP_TOKEN: token };
      if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
      child = spawn(bin, ['-listen', '127.0.0.1:0'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env });
    } catch { this.fail(); return; }
    this.child = child;
    let buf = '';
    const timer = setTimeout(() => { if (this.state === 'starting') { child.kill(); this.fail(); } }, 5000);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      if (this.state !== 'starting') return;
      buf += d;
      const m = /LISTEN\s+127\.0\.0\.1:(\d+)/.exec(buf);
      if (m) { clearTimeout(timer); this.ep = { port: Number(m[1]), token }; this.state = 'ready'; }
    });
    child.on('error', () => { clearTimeout(timer); this.fail(); });
    child.on('exit', () => { clearTimeout(timer); if (this.child === child) this.fail(); });
    // the helper exits when its stdin closes: it never outlives this process
    child.unref();
    (child.stdout as any)?.unref?.();
    (child.stdin as any)?.unref?.();
  }

  private fail() {
    this.state = 'failed';
    this.failedAt = Date.now();
    this.ep = null;
    this.child = null;
  }

  stop() {
    const c = this.child;
    this.child = null;
    this.ep = null;
    this.state = 'absent';
    this.bin = undefined;
    try { c?.stdin?.end(); c?.kill(); } catch { /* gone */ }
  }
}

export const helper = new Helper();
