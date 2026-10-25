// WSL distros on this Windows computer (spec E5): which there are, whether Claude Code is in them, the folders of
// theirs we may read, and the one install we run — only after the user saw the command and said yes.
import { execFile } from 'node:child_process';
import type { WslDistro } from '../protocol.js';
import { tr } from '../i18n/index.js';
import { INSTALL_CMD, parseDistroList, parseWslCheck, WSL_CHECK_SCRIPT } from './distros.js';

export type WslRun = (args: string[], o?: { timeoutMs?: number; input?: string }) => Promise<{ code: number | null; stdout: Buffer; stderr: string }>;

const defaultRun: WslRun = (args, o = {}) =>
  new Promise((resolve) => {
    const child = execFile('wsl.exe', args, { windowsHide: true, encoding: 'buffer', timeout: o.timeoutMs ?? 20_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : null) : 0;
      resolve({ code, stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? '')), stderr: Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? '') });
    });
    if (o.input !== undefined) child.stdin?.end(o.input);
  });

export class WslService {
  private platform: NodeJS.Platform;
  private run: WslRun;
  private names: string[] = [];
  private listedAt = 0;
  private checks = new Map<string, WslDistro>();
  constructor(o: { platform?: NodeJS.Platform; run?: WslRun } = {}) {
    this.platform = o.platform ?? process.platform;
    this.run = o.run ?? defaultRun;
  }

  available(): boolean { return this.platform === 'win32'; }

  /** `wsl.exe -l -q` (cached 30 s); not Windows / no WSL / it failed → []. */
  async list(): Promise<WslDistro[]> {
    if (!this.available()) return [];
    if (Date.now() - this.listedAt > 30_000 || !this.names.length) {
      try {
        const r = await this.run(['-l', '-q'], { timeoutMs: 10_000 });
        this.names = r.code === 0 ? parseDistroList(r.stdout) : [];
      } catch { this.names = []; }
      this.listedAt = Date.now();
    }
    return this.names.map((name) => this.checks.get(name) ?? { name, claude: null, interop: null, home: null });
  }

  known(distro: string): boolean { return typeof distro === 'string' && this.names.includes(distro); }

  private async ensureKnown(distro: string) {
    if (!this.known(distro)) await this.list();
    if (!this.known(distro)) throw new Error(tr('没有这个 WSL 发行版：{d}', { d: String(distro).slice(0, 80) }));
  }

  /** Home, whether claude is on its PATH, whether Windows interop is on (20 s; cached until the next check / install). */
  async check(distro: string): Promise<WslDistro> {
    await this.ensureKnown(distro);
    const r = await this.run(['-d', distro, '--', 'sh', '-lc', WSL_CHECK_SCRIPT], { timeoutMs: 20_000 });
    const d: WslDistro = { name: distro, ...parseWslCheck(r.stdout.toString('utf8')) };
    this.checks.set(distro, d);
    return d;
  }

  cached(distro: string): WslDistro | undefined { return this.checks.get(distro); }

  /** The UNC roots of the listed distros — the only WSL paths files / git / search may touch. */
  roots(): string[] {
    return this.names.flatMap((n) => [`\\\\wsl.localhost\\${n}`, `\\\\wsl$\\${n}`]);
  }

  /** The distro's Claude Code transcripts folder as Windows reads it (needs a check for its home). */
  projectsRoot(distro: string): string | null {
    const home = this.checks.get(distro)?.home;
    if (!home || !home.startsWith('/')) return null;
    return `\\\\wsl.localhost\\${distro}${home.split('/').filter(Boolean).map((s) => `\\${s}`).join('')}\\.claude\\projects`;
  }

  /** Only the shown command, in a login shell of that distro (10 minutes). */
  async install(distro: string): Promise<{ code: number | null; tail: string }> {
    await this.ensureKnown(distro);
    const r = await this.run(['-d', distro, '--', 'bash', '-lc', INSTALL_CMD], { timeoutMs: 600_000 });
    this.checks.delete(distro);
    const all = `${r.stdout.toString('utf8')}${r.stderr ? `\n${r.stderr}` : ''}`;
    return { code: r.code, tail: all.slice(-4000) };
  }
}

/** The one WslService of this process (index.ts sets it; the runner reads distros' homes / interop from it). */
let current: WslService | null = null;
export function setWslService(w: WslService | null): void { current = w; }
export function wslService(): WslService | null { return current; }
