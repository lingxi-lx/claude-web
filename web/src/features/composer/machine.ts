// 选机器 (spec E5): the machine a new conversation runs on, as one string value ('' = this computer,
// 'wsl:<distro>' = a WSL distro, anything else = a peer id).

export type Machine = { kind: 'local' } | { kind: 'peer'; id: string } | { kind: 'wsl'; distro: string };

export function machineOf(v: string): Machine {
  if (!v) return { kind: 'local' };
  if (v.startsWith('wsl:')) return { kind: 'wsl', distro: v.slice(4) };
  return { kind: 'peer', id: v };
}

export function machineValue(m: Machine): string {
  return m.kind === 'local' ? '' : m.kind === 'wsl' ? `wsl:${m.distro}` : m.id;
}

/** 在终端中继续 for a WSL conversation: resume it with the distro's own claude, in its folder. */
export function wslCliCommand(distro: string, linuxCwd: string, sessionId: string): string {
  const cwd = /[\s"']/.test(linuxCwd) ? `"${linuxCwd.replace(/"/g, '\\"')}"` : linuxCwd;
  return `wsl.exe -d ${distro} --cd ${cwd} -- claude --resume ${sessionId}`;
}
