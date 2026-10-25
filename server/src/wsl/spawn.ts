// The SDK's spawn hook for a WSL conversation (spec E5): the same CLI flags, run by the distro's own `claude`.
import { spawn, type ChildProcess } from 'node:child_process';
import { rewriteFlagPaths, stripExecutable, wslArgv, wslEnv } from './launch.js';

export function spawnWsl(
  o: { command: string; args: string[]; cwd?: string; env: Record<string, string | undefined>; signal?: AbortSignal },
  w: { distro: string; cwd: string; exe: string },
): ChildProcess {
  const args = rewriteFlagPaths(stripExecutable(o.command, o.args, w.exe), w.distro);
  return spawn('wsl.exe', wslArgv({ distro: w.distro, cwd: w.cwd, cli: 'claude', args }), {
    env: wslEnv(process.env, o.env) as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    signal: o.signal,
  });
}
