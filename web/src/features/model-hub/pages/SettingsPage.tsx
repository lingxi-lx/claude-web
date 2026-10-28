import { useState } from 'react';
import type { GatewayStatus } from '@shared';
import { ws } from '@/ws/client';
import { useGateway } from '@/features/gateway/state';
import { ShareSettings, AuditSettings } from '@/features/gateway/ShareSettings';
import { SyncPanel } from '@/features/sync/SyncPanel';
import { RemoteSyncPanel } from '@/features/sync/RemoteSyncPanel';
import { OtlpSettings } from '../settings/OtlpSettings';
import { RemoteCatalogSettings } from '../settings/RemoteCatalogSettings';
import { FingerprintSettings } from '../settings/FingerprintSettings';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import { Icon } from '@/ui/icons';
import { tr } from '@/i18n';

/** 设置 → 网关: the switch, the local address external tools use, and the gateway key. */
function GatewayCard() {
  const status = useGateway((s) => s.status);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);

  const setEnabled = async (on: boolean) => {
    setBusy(true);
    try {
      await ws.request<GatewayStatus>({ kind: 'gateway.set', enabled: on });
      await useGateway.getState().load();
      toast(on ? tr('网关已启用') : tr('网关已关闭'), true);
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  const copyKey = async () => {
    try {
      const k = await ws.request<string>({ kind: 'gateway.revealKey' });
      await navigator.clipboard.writeText(k);
      toast(tr('已复制网关密钥'), true);
    } catch (e: any) { toast(e.message); }
  };
  const regenerate = async () => {
    if (!(await dlg.confirm(tr('重新生成网关密钥？'), { message: tr('旧密钥立即失效。已经在跑的对话要重开才会拿到新密钥；手动配置过的外部工具需要换成新的。'), danger: true, okLabel: tr('重新生成') }))) return;
    try {
      await ws.request<GatewayStatus>({ kind: 'gateway.regenerateKey' });
      await useGateway.getState().load();
      toast(tr('已生成新密钥。运行中的对话还拿着旧密钥，需要重开才能继续走网关'), true);
    } catch (e: any) { toast(e.message); }
  };

  return (
    <div className="hub-setcard">
      <div className="hub-setrow">
        <div className="hub-setlabel">
          <b>{tr('启用模型网关')}</b>
          <span>{tr('在本机同时提供 Anthropic / OpenAI / Gemini 三种接口，给 Claude Code、Codex、Cline 这些程序用。')}</span>
        </div>
        <span className="hub-grow" />
        <button
          type="button"
          role="switch"
          aria-checked={!!status?.enabled}
          aria-label={tr('启用模型网关')}
          className={`hub-switch ${status?.enabled ? 'on' : ''}`}
          disabled={busy}
          onClick={() => void setEnabled(!status?.enabled)}
        />
      </div>
      <div className="hub-setrow">
        <div className="hub-setlabel">
          <b>{tr('本机地址')}</b>
          <span>{status?.localError ? status.localError : status?.localRunning ? tr('正在监听；重启应用后地址不变。') : tr('尚未监听。')}</span>
        </div>
        <span className="hub-grow" />
        <code className="hub-mono">{status?.localBaseUrl ? `${status.localBaseUrl}/v1` : '—'}</code>
      </div>
      <div className="hub-setrow">
        <div className="hub-setlabel">
          <b>{tr('网关密钥')}</b>
          <span>{tr('外部程序连接网关时用它；不是模型厂商的 Key。')}</span>
        </div>
        <span className="hub-grow" />
        <code className="hub-mono">{status?.keyMasked ?? '—'}</code>
        <button className="btn sm ghost" onClick={() => void copyKey()}><Icon name="copy" size={12} /> {tr('复制')}</button>
        <button className="btn sm ghost danger" onClick={() => void regenerate()}>{tr('重新生成')}</button>
      </div>
    </div>
  );
}

/** 设置 (spec §6.12): gateway runtime, sharing, backup, and request records — one row per decision. */
export function SettingsPage() {
  return (
    <div className="hub-body">
      <div className="hub-settings">
        <section className="hub-card">
          <div className="hd"><h3>{tr('网关')}</h3></div>
          <div className="bd"><GatewayCard /></div>
        </section>
        <section className="hub-card">
          <div className="hd"><h3>{tr('客户端指纹')}</h3></div>
          <div className="bd"><FingerprintSettings /></div>
        </section>
        <section className="hub-card">
          <div className="hd"><h3>{tr('分享与局域网')}</h3></div>
          <div className="bd"><ShareSettings /></div>
        </section>
        <section className="hub-card">
          <div className="hd"><h3>{tr('备份与同步')}</h3></div>
          <div className="bd">
            <RemoteSyncPanel />
            <div style={{ height: 10 }} />
            <SyncPanel />
          </div>
        </section>
        <section className="hub-card">
          <div className="hd"><h3>{tr('请求记录')}</h3></div>
          <div className="bd">
            <AuditSettings />
            <div style={{ height: 10 }} />
            <OtlpSettings />
          </div>
        </section>
        <section className="hub-card">
          <div className="hd"><h3>{tr('远程模型目录')}</h3></div>
          <div className="bd"><RemoteCatalogSettings /></div>
        </section>
      </div>
    </div>
  );
}
