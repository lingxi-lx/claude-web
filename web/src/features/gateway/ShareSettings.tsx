import { useEffect, useState } from 'react';
import { ws } from '@/ws/client';
import { useGateway } from './state';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import { tr } from '@/i18n';

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
  const lanFields = (
    <>
      <div className="row">
        <label className="field"><span>{tr('监听地址')}</span><input value={bind} onChange={(e) => setBind(e.target.value)} placeholder="192.168.1.10 / 0.0.0.0" /></label>
        <label className="field"><span>{tr('端口（0 = 随机）')}</span><input type="number" min={0} value={port} onChange={(e) => setPort(Number(e.target.value))} /></label>
        <button className="btn sm" onClick={() => void save({ bind, port })}>{tr('应用')}</button>
      </div>
      <label className="field"><span>{tr('监听器来源 IP 白名单（留空 = 不限制，由密钥组决定）')}</span><textarea rows={3} value={ips} onChange={(e) => setIps(e.target.value)} /></label>
      <button className="btn sm" onClick={() => void save({ ipAllowlist: ips.split('\n').map((s) => s.trim()).filter(Boolean) })}>{tr('保存白名单')}</button>
      <div className="sub">
        {lan?.running ? tr('正在监听 {bind}:{port}', { bind: lan.bind, port: lan.port }) : tr('未监听')}
        {lan?.addresses?.length ? ` · ${tr('本机地址：{list}', { list: lan.addresses.join(', ') })}` : ` · ${tr('没有局域网地址')}`}
      </div>
      <div className="sub">{tr('第一次启用时，系统防火墙可能会询问是否允许；只在可信网络里打开。')}</div>
    </>
  );
  if (part === 'lan') return lanFields;
  return (
    <div className="gateway-tab">
      <h4>{tr('本机地址')}</h4>
      <div className="sub">{tr('这是给 Claude Code、ChatBox、Cline 等本机应用使用的固定地址，不会随桌面应用重启而改变。')}</div>
      <div className="gateway-card gateway-local-card">
        <div className="gateway-row">
          <span className="gw-who">
            <span className="l">{status?.localBaseUrl ? `${status.localBaseUrl}/v1` : tr('准备本机地址')}</span>
            <span className="sub">{status?.localRunning ? tr('正在监听') : status?.localError ?? tr('尚未监听')}</span>
          </span>
          <span className="grow" />
          <button className="btn sm" onClick={() => void saveLocal()}>{tr('保存端口')}</button>
        </div>
        <div className="row">
          <label className="field"><span>{tr('固定端口')}</span><input type="number" min={1024} max={65535} value={localPort} onChange={(e) => setLocalPort(Number(e.target.value))} /></label>
        </div>
        {status?.localError && <div className="sub err">{status.localError}</div>}
      </div>
      {part !== 'local' && (
        <>
          <h4>{tr('局域网')}</h4>
          <label className="chip">
            <input type="checkbox" checked={!!lan?.enabled} onChange={(e) => void save({ enabled: e.target.checked })} /> {tr('允许局域网访问（只开放数据面）')}
          </label>
          {lanFields}
        </>
      )}
      <label className="chip">
        <input
          type="checkbox"
          checked={allowQueryKey}
          onChange={(e) => void ws.request({ kind: 'gateway.settings.set', patch: { allowQueryKey: e.target.checked } }).then(() => useStore.getState().loadMeta())}
        /> {tr('允许用 ?key= 传密钥（默认关闭，URL 会进日志）')}
      </label>
    </div>
  );
}

/** 隐私 → 请求记录: whether requests are audited, and how much is kept. */
export function AuditSettings() {
  const lan = useGateway((s) => s.lan);
  return (
    <div className="gateway-tab">
      <h4>{tr('请求记录')}</h4>
      <div className="sub">{tr('记录每次请求的密钥、来源、模型、状态和用量；不记录提示词和响应正文。')}</div>
      <label className="chip">
        <input
          type="checkbox"
          checked={!!lan?.audit.enabled}
          onChange={(e) => void ws.request({ kind: 'gateway.settings.set', patch: { audit: { enabled: e.target.checked } } }).then(() => useGateway.getState().load())}
        /> {tr('启用审计日志')}
      </label>
      <div className="row">
        <label className="field"><span>{tr('审计文件大小上限（MB）')}</span><input type="number" min={1} value={Math.round((lan?.audit.maxBytes ?? 0) / (1024 * 1024))} onChange={(e) => void ws.request({ kind: 'gateway.settings.set', patch: { audit: { maxBytes: Math.max(1, Number(e.target.value) || 1) * 1024 * 1024 } } }).then(() => useGateway.getState().load())} /></label>
        <label className="field"><span>{tr('保留份数')}</span><input type="number" min={1} value={lan?.audit.keepFiles ?? 5} onChange={(e) => void ws.request({ kind: 'gateway.settings.set', patch: { audit: { keepFiles: Math.max(1, Number(e.target.value) || 1) } } }).then(() => useGateway.getState().load())} /></label>
      </div>
    </div>
  );
}
