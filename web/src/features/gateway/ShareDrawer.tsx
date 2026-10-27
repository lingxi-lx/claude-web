import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import { useGateway, showDrawer } from './state';
import { Drawer } from './Drawer';
import { KeysTab } from './KeysTab';
import { ShareSettings } from './ShareSettings';
import { ExternalShareDrawer } from './mounts';
import { tr } from '@/i18n';

/**
 * 共享: let other apps on this computer (or the LAN) use these sources through one address and a key. Off by default.
 * Holds what 概览's switch / address, 密钥 and 设置 (port, LAN, ?key=) used to.
 */
export function ShareDrawer() {
  const open = useGateway((s) => s.drawer === 'share');
  return (
    <Drawer id="share" title={tr('共享')} open={open} onClose={() => showDrawer(null)}>
      {/* MOUNT POINT: features/share/ShareDrawer.tsx (mounts.tsx) fills the body once it exists; ours is the fallback */}
      {ExternalShareDrawer ? <ExternalShareDrawer /> : <ShareFallback />}
    </Drawer>
  );
}

/** The 共享 body until features/share lands: the switch, address and key, key groups, port / LAN. */
function ShareFallback() {
  const status = useGateway((s) => s.status);
  const toast = useStore((s) => s.toast);
  const reload = () => useGateway.getState().load().catch(() => {});
  const toggle = async (on: boolean) => {
    try {
      await ws.request({ kind: 'gateway.set', enabled: on });
      await reload();
    } catch (e: any) { toast(e.message); }
  };
  const address = status?.localBaseUrl ? `${status.localBaseUrl}/v1` : '';
  const copyAddress = () => void navigator.clipboard.writeText(address).then(() => toast(tr('地址已复制'), true));
  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(await ws.request<string>({ kind: 'gateway.revealKey' }));
      toast(tr('密钥已复制'), true);
    } catch (e: any) { toast(e.message); }
  };
  const regen = async () => {
    if (!(await dlg.confirm(tr('重新生成密钥？'), { message: tr('旧密钥立即失效。已经在跑的对话要重开才会拿到新密钥；手动配置过的外部工具需要换成新的。'), danger: true, okLabel: tr('重新生成') }))) return;
    try {
      await ws.request({ kind: 'gateway.regenerateKey' });
      await reload();
      toast(tr('已生成新密钥'), true);
    } catch (e: any) { toast(e.message); }
  };
  return (
    <>
      <div className="gateway-tab">
        <div className="gateway-card gw-share-switch">
          <div className="gateway-row">
            <span className="gw-who">
              <span className="l">{tr('给其它应用用')}</span>
              <span className="sub">{tr('打开后，Claude Code、ChatBox、Cline 等应用填上地址和密钥就能用这里的模型。只在这台电脑上，局域网默认关闭。')}</span>
            </span>
            <span className="grow" />
            <label className="chip"><input type="checkbox" checked={!!status?.enabled} onChange={(e) => void toggle(e.target.checked)} /> {status?.enabled ? tr('已打开') : tr('已关闭')}</label>
          </div>
        </div>
        {status?.enabled && (
          <div className="gw-endpoint">
            <div className="gw-kv">
              <span className="muted">{tr('地址')}</span>
              <code>{address || tr('准备中…')}</code>
              {address && <button className="link" onClick={copyAddress}>{tr('复制')}</button>}
            </div>
            <div className="gw-kv">
              <span className="muted">{tr('密钥')}</span>
              <code>{status.keyMasked}</code>
              <button className="link" onClick={() => void copyKey()}>{tr('复制密钥')}</button>
              <button className="link danger" onClick={() => void regen()}>{tr('重新生成')}</button>
            </div>
            <div className="sub">{status.localRunning ? tr('地址固定，重启应用不变。') : status.localError ?? tr('地址当前没有监听，在下面换一个端口。')}</div>
          </div>
        )}
      </div>
      <h4 className="gw-drawer-h">{tr('密钥和权限')}</h4>
      <div className="sub gw-drawer-note">{tr('每组密钥能用哪些模型、能不能从局域网来、限速和预算。')}</div>
      <KeysTab />
      <h4 className="gw-drawer-h">{tr('连接设置')}</h4>
      <ShareSettings />
    </>
  );
}
