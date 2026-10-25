// 添加 SSH 机器… → 测试连接 (spec E5): one non-interactive ssh that logs in and asks the remote Claude Web's health.
import { assertTarget } from './tunnel.js';

/** A host key this test trusted for the first time (accept-new wrote it to known_hosts): shown so the user can compare. */
export type NewHostKey = { type: string; fingerprint: string };

export type SshProbe =
  | { ssh: 'ok'; serverUp: boolean; version?: string; newHostKeys?: NewHostKey[] }
  | { ssh: 'auth' | 'unreachable' | 'hostkey' | 'no-ssh' | 'error'; detail: string; newHostKeys?: NewHostKey[] };

/** ssh's own word that StrictHostKeyChecking=accept-new just added the host's key. */
export const addedHostKey = (output: string): boolean => /Permanently added .* to the list of known hosts/i.test(String(output ?? ''));

/** The name known_hosts files the host under (what `ssh-keygen -F` looks up): host, or [host]:port off port 22. */
export function knownHostSpec(target: string, sshPort?: number): string {
  const host = target.includes('@') ? target.slice(target.lastIndexOf('@') + 1) : target;
  return sshPort && sshPort !== 22 ? `[${host}]:${sshPort}` : host;
}

/** `ssh-keygen -l -F <host>` → each key's type and fingerprint. */
export function keygenFingerprints(out: string): NewHostKey[] {
  const keys: NewHostKey[] = [];
  for (const line of String(out ?? '').split(/\r?\n/)) {
    if (line.startsWith('#')) continue;
    const m = /^\S+\s+(\S+)\s+((?:SHA256|MD5):\S+)/.exec(line.trim());
    if (m) keys.push({ type: m[1], fingerprint: m[2] });
  }
  return keys;
}

export function sshProbeArgs(h: { target: string; sshPort?: number; identityFile?: string; remotePort?: number }): string[] {
  assertTarget(h.target);
  const port = Number.isInteger(h.remotePort) && h.remotePort! > 0 ? h.remotePort! : 3090;
  const url = `http://127.0.0.1:${port}/api/health`;
  return [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new',
    ...(h.sshPort ? ['-p', String(h.sshPort)] : []),
    ...(h.identityFile ? ['-i', h.identityFile] : []),
    h.target,
    `curl -fsS --max-time 5 ${url} || wget -qO- -T 5 ${url} || echo CW_NO_SERVER`,
  ];
}

const lastLine = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? '';

export function classifySshProbe(r: { code: number | null; output: string; enoent?: boolean }): SshProbe {
  const out = String(r.output ?? '');
  if (r.enoent) return { ssh: 'no-ssh', detail: lastLine(out) };
  if (r.code === 255) {
    const detail = lastLine(out);
    if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(out)) return { ssh: 'hostkey', detail };
    if (/Permission denied|publickey/i.test(out)) return { ssh: 'auth', detail };
    if (/Could not resolve|Name or service not known|timed out|Connection refused|No route to host/i.test(out)) return { ssh: 'unreachable', detail };
    return { ssh: 'error', detail };
  }
  for (const m of out.matchAll(/\{[^{}]*\}/g)) {
    try {
      const j = JSON.parse(m[0]);
      return typeof j?.version === 'string' ? { ssh: 'ok', serverUp: true, version: j.version } : { ssh: 'ok', serverUp: true };
    } catch { /* not JSON */ }
  }
  return { ssh: 'ok', serverUp: false };
}
