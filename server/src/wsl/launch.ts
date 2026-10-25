// Starting Claude Code inside a WSL distro (spec E5): the wsl.exe argv, which variables cross into Linux, and the
// injected MCP servers (Windows programs) run through Windows interop. Pure.
import { isWslUnc, toWslPath } from './paths.js';

export type StdioServer = { type: 'stdio'; command: string; args: string[]; env: Record<string, string> };

/** The CLI's own flags out of what the SDK would spawn: after the native binary, or after the JS entry script. */
export function stripExecutable(command: string, args: string[], exe: string): string[] {
  if (command === exe) return [...args];
  const i = args.indexOf(exe);
  return i >= 0 ? args.slice(i + 1) : [...args];
}

/** Flag values that are Windows paths (temp settings files, extra folders) as the distro sees them. */
export function rewriteFlagPaths(args: string[], distro: string): string[] {
  return args.map((a) => {
    if (!/^[A-Za-z]:[\\/]/.test(a) && !isWslUnc(a)) return a;
    return toWslPath(a, distro) ?? a;
  });
}

export function wslArgv(o: { distro: string; cwd: string; cli: string; args: string[] }): string[] {
  return ['-d', o.distro, '--cd', o.cwd, '--', o.cli, ...o.args];
}

/** Variables that only make sense on Windows: never handed to Linux. */
const WIN_ONLY = new Set(['PATH', 'Path', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ComSpec', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'WSLENV']);

/** wsl.exe only passes the variables WSLENV names: name what the runner set on top of this process's own env. */
export function wslEnv(base: Record<string, string | undefined>, env: Record<string, string | undefined>): Record<string, string | undefined> {
  const added = Object.keys(env).filter((k) => env[k] !== undefined && !WIN_ONLY.has(k) && base[k] !== env[k]);
  const own = String(env.WSLENV ?? '').split(':').filter(Boolean);
  return { ...env, WSLENV: [...new Set([...own, ...added])].join(':') };
}

/**
 * The injected MCP servers are Windows programs (Claude Web's own exe as Node). From inside the distro they start
 * through interop at their /mnt path; their arguments stay Windows paths (the Windows program reads them) and their
 * env crosses with WSLENV `/u` (Linux → Windows only). Interop off: none can start — drop them and say which.
 */
export function rewriteMcpForWsl(servers: Record<string, StdioServer>, o: { interop: boolean }): { servers: Record<string, StdioServer>; dropped: string[] } {
  const out: Record<string, StdioServer> = {};
  const dropped: string[] = [];
  for (const [name, s] of Object.entries(servers)) {
    const command = o.interop ? toWslPath(s.command, '') : null;
    if (!command || !command.startsWith('/mnt/')) { dropped.push(name); continue; }
    const env = { ...s.env };
    out[name] = { ...s, command, args: [...s.args], env: { ...env, WSLENV: Object.keys(env).map((k) => `${k}/u`).join(':') } };
  }
  return { servers: out, dropped };
}
