import { useEffect, useState, type ReactNode } from 'react';
import { ws } from '@/ws/client';
import { useGateway } from './state';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import { Switch } from '@/ui/Switch';
import { tr } from '@/i18n';

/** One settings row: the label (and a line under it) on the left, the controls on the right. */
function SetRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="hub-setrow">
      <div className="hub-setlabel"><b>{label}</b>{hint ? <span>{hint}</span> : null}</div>
      <span className="hub-grow" />
      {children}
    </div>
  );
}

/**
 * 共享 → 连接设置: the fixed local port, where the LAN listener listens and who may reach it.
 * part 'local' = the local port and ?key= only; 'lan' = the listener's address / port / allowlist only (no toggle:
 * the 局域网共享 card has it); absent = everything.
 */
export function ShareSettings({ part }: { part?: 'local' | 'lan' } = {}) {
  const lan = useGateway((s) => s.lan);
  const status = useGateway((s) => s.status);
  const toast = useStore((s) => s.toast);
  const allowQueryKey = useStore((s) => s.settings['gateway.allowQueryKey'] === true);
  const [bind, setBind] = useState('127.0.0.1');
  const [port, setPort] = useState(0);
  const [localPort, setLocalPort] = useState(61697);
  const [ips, setIps] = useState('');
  useEffect(() => {
    if (!lan) return;
    setBind(lan.bind);
    setPort(lan.port);
    setLocalPort(status?.localPort ?? 61697);
    setIps(lan.ipAllowlist.join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lan?.bind, lan?.port, lan?.ipAllowlist.join(','), status?.localPort]);
  const save = async (patch: Record<string, unknown>) => {
    try {
      if (patch.bind === '0.0.0.0' && !(await dlg.confirm(tr('监听 0.0.0.0 会让同一网络里的设备都能访问数据面，确定吗？'), { danger: true }))) return;
      await ws.request({ kind: 'gateway.lan.set', config: { ...patch, ...(patch.bind === '0.0.0.0' ? { confirmAny: true } : {}) } });
      await useGateway.getState().load();
      toast(tr('已保存'), true);
    } catch (e: any) { toast(e.message); }
  };
  const saveLocal = async () => {
    try {
      await ws.request({ kind: 'gateway.local.set', port: localPort });
      await useGateway.getState().load();
      toast(tr('本机网关地址已保存'), true);
    } catch (e: any) { toast(e.message); }
  };
  const lanStatus = (
    <>
      {lan?.running ? tr('正在监听 {bind}:{port}', { bind: lan.bind, port: lan.port }) : tr('未监听')}
      {lan?.addresses?.length ? ` · ${tr('本机地址：{list}', { list: lan.addresses.join(', ') })}` : ` · ${tr('没有局域网地址')}`}
    </>
  );
  const lanFields = (
    <>
      <SetRow label={tr('监听地址')} hint={lanStatus}>
        <input className="input" aria-label={tr('监听地址')} value={bind} onChange={(e) => setBind(e.target.value)} placeholder="192.168.1.10 / 0.0.0.0" />
      </SetRow>
      <SetRow label={tr('端口（0 = 随机）')} hint={tr('第一次启用时，系统防火墙可能会询问是否允许；只在可信网络里打开。')}>
        <input className="input" type="number" min={0} aria-label={tr('端口（0 = 随机）')} value={port} onChange={(e) => setPort(Number(e.target.value))} />
        <button className="btn sm" onClick={() => void save({ bind, port })}>{tr('应用')}</button>
      </SetRow>
      <div className="hub-setrow hub-setrow-stack">
        <label className="hub-setlabel" htmlFor="cw-lan-ips"><b>{tr('监听器来源 IP 白名单（留空 = 不限制，由密钥组决定）')}</b></label>
        <textarea id="cw-lan-ips" className="input" rows={3} value={ips} spellCheck={false} placeholder="192.168.1.0/24" onChange={(e) => setIps(e.target.value)} />
        <div className="hub-setrow-actions">
          <button className="btn sm" onClick={() => void save({ ipAllowlist: ips.split('\n').map((s) => s.trim()).filter(Boolean) })}>{tr('保存白名单')}</button>
        </div>
      </div>
    </>
  );
  if (part === 'lan') return <div className="hub-setcard">{lanFields}</div>;
  return (
    <div className="hub-setcard">
      <SetRow label={tr('本机地址')} hint={tr('这是给 Claude Code、ChatBox、Cline 等本机应用使用的固定地址，不会随桌面应用重启而改变。')}>
        <code className="hub-mono">{status?.localBaseUrl ? `${status.localBaseUrl}/v1` : tr('准备本机地址')}</code>
      </SetRow>
      <SetRow label={tr('固定端口')} hint={<span className={status?.localError ? 'err' : undefined}>{status?.localRunning ? tr('正在监听') : status?.localError ?? tr('尚未监听')}</span>}>
        <input className="input" type="number" min={1024} max={65535} aria-label={tr('固定端口')} value={localPort} onChange={(e) => setLocalPort(Number(e.target.value))} />
        <button className="btn sm" onClick={() => void saveLocal()}>{tr('保存端口')}</button>
      </SetRow>
      {part !== 'local' && (
        <>
          <SetRow label={tr('允许局域网访问（只开放数据面）')}>
            <Switch hub on={!!lan?.enabled} label={tr('允许局域网访问（只开放数据面）')} onChange={(on) => void save({ enabled: on })} />
          </SetRow>
          {lanFields}
        </>
      )}
      <SetRow label={tr('允许用 ?key= 传密钥（默认关闭，URL 会进日志）')}>
        <Switch
          hub
          on={allowQueryKey}
          label={tr('允许用 ?key= 传密钥（默认关闭，URL 会进日志）')}
          onChange={(on) => void ws.request({ kind: 'gateway.settings.set', patch: { allowQueryKey: on } }).then(() => useStore.getState().loadMeta())}
        />
      </SetRow>
    </div>
  );
}

/** 隐私 → 请求记录: whether requests are audited, and how much is kept. */
export function AuditSettings() {
  const lan = useGateway((s) => s.lan);
  const patch = (audit: Record<string, unknown>) => void ws.request({ kind: 'gateway.settings.set', patch: { audit } }).then(() => useGateway.getState().load());
  return (
    <div className="hub-setcard">
      <SetRow label={tr('启用审计日志')} hint={tr('记录每次请求的密钥、来源、模型、状态和用量；不记录提示词和响应正文。')}>
        <Switch hub on={!!lan?.audit.enabled} label={tr('启用审计日志')} onChange={(on) => patch({ enabled: on })} />
      </SetRow>
      <SetRow label={tr('审计文件大小上限（MB）')}>
        <input className="input" type="number" min={1} aria-label={tr('审计文件大小上限（MB）')} value={Math.round((lan?.audit.maxBytes ?? 0) / (1024 * 1024))} onChange={(e) => patch({ maxBytes: Math.max(1, Number(e.target.value) || 1) * 1024 * 1024 })} />
      </SetRow>
      <SetRow label={tr('保留份数')}>
        <input className="input" type="number" min={1} aria-label={tr('保留份数')} value={lan?.audit.keepFiles ?? 5} onChange={(e) => patch({ keepFiles: Math.max(1, Number(e.target.value) || 1) })} />
      </SetRow>
    </div>
  );
}
