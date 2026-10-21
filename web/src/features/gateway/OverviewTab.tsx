import { useState } from 'react';
import { ws } from '@/ws/client';
import { useGateway, showGatewayTab } from './state';
import { useStore } from '@/store';
import { SidecarCard } from './SidecarCard';
import { tr } from '@/i18n';

/**
 * 概览: one switch, one fixed address and a key to copy, then the accounts. An ordinary user should not have to
 * learn route groups or key groups — adding an account puts it in the 默认 group, and the root /v1 serves it.
 */
export function OverviewTab() {
  const accounts = useGateway((s) => s.accounts);
  const keys = useGateway((s) => s.keys);
  const logs = useGateway((s) => s.logs);
  const status = useGateway((s) => s.status);
  const routeGroups = useGateway((s) => s.routeGroups);
  const sidecars = useGateway((s) => s.sidecars);
  const toast = useStore((s) => s.toast);
  const providers = useStore((s) => s.providers);
  const [using, setUsing] = useState(false);
  const toggle = async (on: boolean) => {
    try {
      await ws.request({ kind: 'gateway.set', enabled: on });
      await useGateway.getState().load();
    } catch (e: any) { toast(e.message); }
  };
  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast(tr('{what}已复制', { what }), true));
  const healthy = accounts.filter((a) => a.health === 'ok').length;
  const today = keys.reduce((n, k) => n + (k.stats?.requests ?? 0), 0);
  const errors = logs.filter((l) => l.status >= 400).length;
  const root = status?.localBaseUrl ?? '';
  const defaultKey = keys.find((k) => k.id === 'key_default');
  // the local components only matter once a Gemini / WorkBuddy account exists
  const usesSidecars = accounts.some((a) => a.kind !== 'claude');
  const group = routeGroups.find((g) => g.id === 'default') ?? routeGroups[0];
  const inApp = group ? providers.find((p) => p.type === 'gateway' && p.gatewayGroupId === group.id) : undefined;
  const reveal = async () => {
    if (!defaultKey) { showGatewayTab('keys'); return; }
    try {
      const key = await ws.request<string>({ kind: 'gateway.keys.reveal', id: defaultKey.id });
      await navigator.clipboard.writeText(key);
      toast(tr('密钥已复制'), true);
    } catch (e: any) { toast(e.message); }
  };
  // a gateway profile of this app: the address / key are filled per session, so nothing here goes stale
  const useInApp = async () => {
    if (!group || using) return;
    setUsing(true);
    try {
      // read the store once more: the provider list may have arrived after this render, and an upsert without an
      // id always creates a row (a double click would leave two 「模型网关」)
      const have = useStore.getState().providers.find((p) => p.type === 'gateway' && p.gatewayGroupId === group.id);
      const name = have?.name ?? tr('模型网关');
      await ws.request({
        kind: 'providers.upsert',
        provider: { ...(have ? { id: have.id } : {}), name, type: 'gateway', gatewayGroupId: group.id, baseUrl: '', apiKey: '' },
      });
      await useStore.getState().loadProviders();
      toast(tr('已添加供应商「{name}」，在对话的模型菜单里选它', { name }), true);
    } catch (e: any) { toast(e.message); } finally { setUsing(false); }
  };
  return (
    <div className="gateway-tab">
      {!status?.enabled && (
        <div className="gateway-card gateway-start">
          <div className="gateway-row">
            <span className="gw-who">
              <span className="l">{tr('网关还没启用')}</span>
              <span className="sub">{tr('启用后，账号才能给别的应用用。只在这台电脑上监听，局域网默认关闭。')}</span>
            </span>
            <span className="grow" />
            <button className="btn sm" onClick={() => void toggle(true)}>{tr('启用网关')}</button>
          </div>
        </div>
      )}
      {status?.enabled && (
        <>
          <div className="gateway-row">
            <span className="gateway-badge ok">{tr('已启用')}</span>
            <span className="grow" />
            <button className="btn sm ghost" onClick={() => void toggle(false)}>{tr('关闭')}</button>
          </div>
          <div className="gw-endpoint">
            <div className="gw-kv">
              <span className="muted">{tr('地址')}</span>
              <code>{root}/v1</code>
              <button className="link" onClick={() => copy(`${root}/v1`, tr('地址'))}>{tr('复制')}</button>
            </div>
            <div className="gw-kv">
              <span className="muted">{tr('密钥')}</span>
              <code>{status.keyMasked}</code>
              <button className="link" onClick={() => void reveal()}>{tr('复制密钥')}</button>
            </div>
            <div className="sub">
              {status.localRunning
                ? tr('这是固定地址，重启应用不变。在 Claude Code、ChatBox、Cline 等应用里填这两个。')
                : status.localError ?? tr('固定地址当前没有监听，到「高级设置 → 设置」里换一个端口。')}
            </div>
            {group && (
              <div className="gw-kv">
                <span className="muted">{tr('本应用内')}</span>
                {inApp
                  ? <span>{tr('已添加供应商「{name}」，在模型菜单里选它', { name: inApp.name })}</span>
                  : <button className="btn sm" disabled={using} onClick={() => void useInApp()}>{using ? tr('正在添加…') : tr('不用复制，直接在本应用里用')}</button>}
              </div>
            )}
          </div>
        </>
      )}
      <div className="gateway-cards">
        <div className="gateway-card"><div className="n">{accounts.length}</div><div className="l">{tr('账号')} · {tr('{n} 个正常', { n: healthy })}</div></div>
        <div className="gateway-card"><div className="n">{today}</div><div className="l">{tr('今天请求')}</div></div>
        <div className="gateway-card"><div className="n">{errors}</div><div className="l">{tr('最近错误')}</div></div>
      </div>
      <div className="gateway-row" style={{ marginTop: 16 }}>
        <span className="grow">{tr('账号')}</span>
        <button className="btn sm" onClick={() => showGatewayTab('accounts')}>{accounts.length ? tr('管理账号') : tr('添加账号')}</button>
      </div>
      {accounts.length === 0 && <div className="empty">{tr('还没添加账号。加一个 Claude 账号、Gemini cookie 或 WorkBuddy 登录就能用。')}</div>}
      {usesSidecars && sidecars.length > 0 && (
        <>
          <div className="gateway-row" style={{ marginTop: 16 }}>
            <span className="grow">{tr('连接方式')}</span>
            <span className="sub">{tr('第一次添加账号时会自动准备好')}</span>
          </div>
          {sidecars.map((s) => <SidecarCard key={s.id} s={s} />)}
        </>
      )}
    </div>
  );
}
