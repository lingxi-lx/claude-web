// 添加 SSH 机器… (stage E5): address / user / key → 测试连接 (one non-interactive ssh: logs in, asks the remote Claude
// Web's health) → a start command when it is not running → 连接并加入 (a saved host + a federation peer over the tunnel).
// Nothing is installed or started on the other machine from here.
import { useEffect, useRef, useState } from 'react';
import type { PeerInfo, RemoteHost } from '@shared';
import { ws } from '@/ws/client';
import { tr } from '@/i18n';
import { imeComposing } from '@/ui/ime';

type HostKey = { type: string; fingerprint: string };
type Probe = ({ ssh: 'ok'; serverUp: boolean; version?: string } | { ssh: 'auth' | 'unreachable' | 'hostkey' | 'no-ssh' | 'error'; detail: string }) & { newHostKeys?: HostKey[] };

export function probeText(p: Probe): string {
  switch (p.ssh) {
    case 'ok': return p.serverUp ? tr('能免密登录 · Claude Web 在运行（{v}）', { v: p.version ?? '?' }) : tr('能免密登录 · 那台机器上没在运行 Claude Web');
    case 'auth': return tr('密钥被拒绝：先把这台电脑的公钥加到那台机器的 ~/.ssh/authorized_keys');
    case 'hostkey': return tr('主机密钥变了：确认没问题后在终端里 ssh 一次');
    case 'unreachable': return tr('连不上这台机器：{detail}', { detail: p.detail });
    case 'no-ssh': return tr('找不到 ssh（请安装 OpenSSH 客户端）');
    default: return p.detail || tr('出错了');
  }
}

export function AddSshDialog({ onClose, onJoined }: { onClose: () => void; onJoined: (peerId: string) => void }) {
  const [host, setHost] = useState('');
  const [user, setUser] = useState('');
  const [key, setKey] = useState('');
  const [more, setMore] = useState(false);
  const [sshPort, setSshPort] = useState('');
  const [remotePort, setRemotePort] = useState('3090');
  const [token, setToken] = useState('');
  const [startCommand, setStartCommand] = useState('');
  const [probe, setProbe] = useState<Probe | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.querySelector<HTMLElement>('input')?.focus();
    // opened from the machine menu: its row is gone by now — back to the chip
    return () => { if (opener?.isConnected && opener !== document.body) opener.focus(); else document.querySelector<HTMLElement>('.machine-chip')?.focus(); };
  }, []);
  const target = user.trim() ? `${user.trim()}@${host.trim()}` : host.trim();
  const port = (s: string) => { const n = Number(s); return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined; };

  const test = async () => {
    if (!host.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      setProbe(await ws.request<Probe>({ kind: 'remote.hosts.test', target, sshPort: port(sshPort), identityFile: key.trim() || undefined, remotePort: port(remotePort) ?? 3090 }));
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    setBusy(false);
  };
  const join = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const h: RemoteHost = { id: crypto.randomUUID(), name: host.trim(), target, remotePort: port(remotePort) ?? 3090, ...(port(sshPort) ? { sshPort: port(sshPort) } : {}), ...(key.trim() ? { identityFile: key.trim() } : {}), ...(token.trim() ? { token: token.trim() } : {}), ...(startCommand.trim() ? { startCommand: startCommand.trim() } : {}) };
      await ws.request({ kind: 'remote.hosts.set', host: h });
      const p = await ws.request<PeerInfo>({ kind: 'peers.add', hostId: h.id });
      onJoined(p.id);
      onClose();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    setBusy(false);
  };
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !imeComposing(e.nativeEvent)) { e.preventDefault(); void (probe?.ssh === 'ok' && probe.serverUp ? join() : test()); } };
  const step3 = probe?.ssh === 'ok' && !probe.serverUp;
  const canJoin = probe?.ssh === 'ok' && (probe.serverUp || !!startCommand.trim());
  return (
    <div className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()} onKeyDown={(e) => { if (e.key === 'Escape' && !imeComposing(e.nativeEvent)) { e.stopPropagation(); if (!busy) onClose(); } }}>
      <div ref={box} className="modal add-ssh-dlg" role="dialog" aria-modal="true" aria-label={tr('添加 SSH 机器')} data-act="add-ssh-dialog">
        <h3>{tr('添加 SSH 机器')}</h3>
        <label className="fld"><span>{tr('地址')}</span><input className="field" value={host} onChange={(e) => { setHost(e.target.value); setProbe(null); }} onKeyDown={enter} placeholder="box.example.com" spellCheck={false} /></label>
        <label className="fld"><span>{tr('用户')}</span><input className="field" value={user} onChange={(e) => { setUser(e.target.value); setProbe(null); }} onKeyDown={enter} spellCheck={false} /></label>
        <label className="fld"><span>{tr('密钥文件（可不填，用 ssh 默认的）')}</span><input className="field mono" value={key} onChange={(e) => { setKey(e.target.value); setProbe(null); }} onKeyDown={enter} spellCheck={false} /></label>
        <button type="button" className="btn ghost sm" aria-expanded={more} onClick={() => setMore(!more)}>{tr('更多')}</button>
        {more && (
          <>
            <label className="fld"><span>{tr('SSH 端口')}</span><input className="field" inputMode="numeric" value={sshPort} onChange={(e) => setSshPort(e.target.value)} onKeyDown={enter} placeholder="22" /></label>
            <label className="fld"><span>{tr('对方的 Claude Web 端口')}</span><input className="field" inputMode="numeric" value={remotePort} onChange={(e) => setRemotePort(e.target.value)} onKeyDown={enter} /></label>
            <label className="fld"><span>{tr('对方的访问令牌（对方设了才要）')}</span><input className="field" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={enter} /></label>
          </>
        )}
        {probe && <div className={probe.ssh === 'ok' ? 'sub ssh-ok' : 'err'} role="status" data-probe={probe.ssh}>{probeText(probe)}</div>}
        {probe?.newHostKeys?.length ? (
          <div className="sub ssh-hostkey" data-act="ssh-new-hostkey">
            <div>{tr('第一次连这台机器，已记下它的主机密钥。请和那台机器上的指纹核对（ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub）：')}</div>
            {probe.newHostKeys.map((k) => <div key={k.fingerprint} className="mono">{k.type} {k.fingerprint}</div>)}
          </div>
        ) : null}
        {step3 && (
          <>
            <label className="fld"><span>{tr('启动命令')}</span><input className="field mono" value={startCommand} onChange={(e) => setStartCommand(e.target.value)} spellCheck={false} /></label>
            <div className="sub">{tr('连接时先在那台机器上跑这条命令启动 Claude Web')}</div>
            <div className="sub dim">{tr('还没装的话，在那台机器上：git clone 本项目 → npm install → npm run build → npm start')}</div>
          </>
        )}
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row-btns">
          <span className="grow" />
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>{tr('取消')}</button>
          <button type="button" className="btn" disabled={busy || !host.trim()} onClick={() => void test()}>{probe ? tr('再测一次') : tr('测试连接')}</button>
          {canJoin && <button type="button" className="btn primary" disabled={busy} onClick={() => void join()}>{tr('连接并加入')}</button>}
        </div>
      </div>
    </div>
  );
}
