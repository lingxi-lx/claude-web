import { useEffect, useState } from 'react';
import type { ChannelStatus, RemoteCatalogState } from '@shared';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { useGateway } from '@/features/gateway/state';
import { tr } from '@/i18n';

const when = (t: number) => new Date(t).toLocaleString();

/**
 * 设置 → 远程模型目录: a signed list of sources that adds to the built-in one. Nothing ships preset: it is off until
 * the user enters an https address and the Ed25519 public key the list is signed with.
 */
export function RemoteCatalogSettings() {
  const toast = useStore((s) => s.toast);
  const [state, setState] = useState<RemoteCatalogState | null>(null);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  const adopt = (st: ChannelStatus) => {
    const r = st.remoteCatalog ?? { enabled: false, hasKey: false, ready: false, entries: 0 };
    setState(r);
    setUrl(r.url ?? '');
  };
  useEffect(() => {
    let live = true;
    ws.request<ChannelStatus>({ kind: 'channels.status' }).then((st) => { if (live) adopt(st); }, () => {});
    return () => { live = false; };
  }, []);

  const save = async (enabled: boolean) => {
    setBusy(true);
    try {
      const st = await ws.request<ChannelStatus>({ kind: 'channels.catalog.remote', setting: { enabled, url, ...(key.trim() ? { publicKey: key } : {}) } });
      adopt(st);
      setKey('');
      void useGateway.getState().loadCatalog().catch(() => {});
      const r = st.remoteCatalog;
      if (r?.error) toast(r.error);
      else toast(enabled && r?.ready ? tr('远程模型目录已更新：{n} 个来源', { n: r.entries }) : tr('已保存'), true);
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  const update = async () => {
    setBusy(true);
    try {
      adopt(await ws.request<ChannelStatus>({ kind: 'channels.catalog.update' }));
      void useGateway.getState().loadCatalog().catch(() => {});
      toast(tr('远程模型目录已更新'), true);
    } catch (e: any) {
      toast(e.message);
      ws.request<ChannelStatus>({ kind: 'channels.status' }).then(adopt, () => {});
    } finally { setBusy(false); }
  };

  if (!state) return null;
  return (
    <div className="gateway-tab cw-remote-catalog">
      <div className="gateway-card">
        <div className="gateway-row">
          <b>{tr('远程模型目录')}</b>
          <span className="sub">{tr('从你信任的地址拉一份签过名的来源列表，补充内置目录。只是数据，不会运行代码；签名不对就丢弃。')}</span>
          <span className="grow" />
          <button
            type="button"
            role="switch"
            aria-checked={state.enabled}
            aria-label={tr('远程模型目录')}
            className={`hub-switch ${state.enabled ? 'on' : ''}`}
            disabled={busy || (!state.enabled && (!url.trim() || (!state.hasKey && !key.trim())))}
            onClick={() => void save(!state.enabled)}
          />
        </div>
        <div className="gateway-row">
          <span className="sub" style={{ minWidth: 90 }}>{tr('地址')}</span>
          <input className="input grow" placeholder="https://" value={url} disabled={busy} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="gateway-row">
          <span className="sub" style={{ minWidth: 90 }}>{tr('验证公钥')}</span>
          <textarea
            className="input grow"
            rows={2}
            placeholder={state.hasKey ? tr('已设置；粘贴新的公钥可替换') : tr('Ed25519 公钥（PEM 或 base64）')}
            value={key}
            disabled={busy}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <div className="gateway-row">
          <button className="btn sm" disabled={busy} onClick={() => void save(state.enabled)}>{tr('保存')}</button>
          <button className="btn sm" disabled={busy || !state.ready} onClick={() => void update()}>{tr('立即更新')}</button>
        </div>
        {state.error && <div className="sub" style={{ color: 'var(--warn)' }}>{state.error}</div>}
        <div className="sub">
          {!state.url || !state.hasKey
            ? tr('还没设置：需要地址和验证公钥。没有内置的官方地址。')
            : state.fetchedAt
              ? tr('上次验证通过：{time} · {n} 个来源', { time: when(state.fetchedAt), n: state.entries })
              : tr('还没有拉取过')}
        </div>
      </div>
    </div>
  );
}
