import { useEscClose } from './use-esc-close';
import { useEffect, useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import type { SidecarProxy, UpstreamAccountView } from '@shared';
import { tr } from '@/i18n';
import { Select } from '@/ui/Select';
import { SwitchChip } from '@/ui/Switch';

/** One account's settings: its name, its exit (sidecar accounts) or own proxy, its daily limits, a new credential. */
export function AccountEditor({ account, onClose, onSaved }: { account: UpstreamAccountView; onClose(): void; onSaved(): void }) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(account.name);
  const [proxy, setProxy] = useState('');
  const [clearProxy, setClearProxy] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(account.maxConcurrent ?? 0);
  const [daily, setDaily] = useState(account.dailyRequestLimit ?? 0);
  const [credential, setCredential] = useState('');
  const [busy, setBusy] = useState(false);
  const sidecar = account.kind === 'gemini';
  const [exits, setExits] = useState<SidecarProxy[]>([]);
  const [exitId, setExitId] = useState(account.sidecarProxy?.id ?? 0);
  useEffect(() => {
    if (!sidecar) return;
    ws.request<SidecarProxy[]>({ kind: 'upstreams.proxies', id: 'gemini' }).then(setExits).catch(() => setExits([]));
  }, [sidecar]);
  const save = async () => {
    setBusy(true);
    try {
      await ws.request({
        kind: 'upstreams.update',
        id: account.id,
        patch: {
          name,
          ...(sidecar ? { proxyId: exitId || null } : {}),
          ...(proxy.trim() ? { proxy: proxy.trim() } : clearProxy ? { proxy: null } : {}),
          maxConcurrent: maxConcurrent > 0 ? maxConcurrent : null,
          dailyRequestLimit: daily > 0 ? daily : null,
          ...(credential.trim() ? { credential: credential.trim() } : {}),
        },
      });
      toast(tr('已保存'), true);
      onSaved();
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  const escRef = useEscClose<HTMLDivElement>(() => { if (!busy) onClose(); });
  return (
    <div ref={escRef} className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ width: 520 }}>
        <h3>{tr('编辑账号')}</h3>
        <label className="field"><span>{tr('名称')}</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        {sidecar ? (
          <label className="field">
            <span>{tr('出口（住宅 IP）')}</span>
            <Select value={String(exitId)} onValueChange={(value) => setExitId(Number(value))} aria-label={tr('出口（住宅 IP）')} options={[{ value: '0', label: tr('自动（组件挑一个，之后记住）') }, ...exits.map((x) => ({ value: String(x.id), label: `${x.name}${x.enabled ? '' : tr('（已停用）')}`, description: x.url, disabled: !x.enabled }))]} searchable={exits.length > 8} />
          </label>
        ) : (
          <>
            <label className="field">
              <span>{tr('这个账号的代理（留空保持不变）')}</span>
              <input type="password" value={proxy} onChange={(e) => { setProxy(e.target.value); setClearProxy(false); }} placeholder={account.hasProxy ? tr('已设置代理') : 'http://127.0.0.1:7890 / socks5://…'} />
            </label>
            {account.hasProxy && <SwitchChip on={clearProxy} onChange={(on) => { setClearProxy(on); if (on) setProxy(''); }}>{tr('清除代理（直连）')}</SwitchChip>}
          </>
        )}
        <div className="row">
          <label className="field"><span>{tr('同时进行的请求上限（0 = 不限）')}</span><input type="number" min={0} value={maxConcurrent} onChange={(e) => setMaxConcurrent(Number(e.target.value) || 0)} /></label>
          <label className="field"><span>{tr('每天请求上限（0 = 不限）')}</span><input type="number" min={0} value={daily} onChange={(e) => setDaily(Number(e.target.value) || 0)} /></label>
        </div>
        <label className="field">
          <span>{tr('新的凭据（留空不换）')}</span>
          <textarea className="field" rows={3} value={credential} onChange={(e) => setCredential(e.target.value)} placeholder={account.kind === 'gemini' ? tr('粘贴新的 cookie') : account.kind === 'workbuddy' ? tr('粘贴新的 cockpit JSON') : tr('粘贴新的令牌或 OAuth JSON')} />
        </label>
        <div className="row"><span className="grow" /><button className="btn sm ghost" onClick={onClose} disabled={busy}>{tr('取消')}</button><button className="btn sm" onClick={() => void save()} disabled={busy}>{busy ? tr('保存中…') : tr('保存')}</button></div>
      </div>
    </div>
  );
}
