import { useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { Icon } from '@/ui/icons';
import { useGateway, showSource, showDrawer } from './state';
import { RoutesTab } from './RoutesTab';
import { ExternalRoutingDetail } from './mounts';
import { tr } from '@/i18n';

/**
 * 智能路由 (the virtual source): route groups — which sources, in what order, with which model mapping. What 分组与路由
 * was. A group can also be used in this app's conversations as a provider of its own.
 */
export function RoutingDetail() {
  // MOUNT POINT: features/routing/RoutingDetail.tsx (mounts.tsx) replaces the body once it exists
  if (ExternalRoutingDetail) {
    return (
      <div className="gw-detail" data-source="routing">
        <div className="gw-detail-head">
          <button className="btn sm ghost" onClick={() => showSource(null)} title={tr('返回 (Esc)')}><Icon name="arrowLeft" size={13} /> {tr('全部来源')}</button>
        </div>
        <ExternalRoutingDetail />
      </div>
    );
  }
  return <RouteGroupsDetail />;
}

/** The route groups (what 分组与路由 was) — the 智能路由 detail until features/routing lands. */
function RouteGroupsDetail() {
  const routeGroups = useGateway((s) => s.routeGroups);
  const status = useGateway((s) => s.status);
  const providers = useStore((s) => s.providers);
  const toast = useStore((s) => s.toast);
  const [using, setUsing] = useState<string | null>(null);
  const useInApp = async (groupId: string, groupName: string) => {
    if (using) return;
    setUsing(groupId);
    try {
      // read the store once more: an upsert without an id always creates a row (a double click would leave two)
      const have = useStore.getState().providers.find((p) => p.type === 'gateway' && p.gatewayGroupId === groupId);
      const name = have?.name ?? tr('智能路由 · {name}', { name: groupName });
      await ws.request({
        kind: 'providers.upsert',
        provider: { ...(have ? { id: have.id } : {}), name, type: 'gateway', gatewayGroupId: groupId, baseUrl: '', apiKey: '' },
      });
      await useStore.getState().loadProviders();
      toast(tr('已可用：在对话的模型菜单里选「{name}」', { name }), true);
    } catch (e: any) { toast(e.message); } finally { setUsing(null); }
  };
  return (
    <div className="gw-detail" data-source="routing">
      <div className="gw-detail-head">
        <button className="btn sm ghost" onClick={() => showSource(null)} title={tr('返回 (Esc)')}><Icon name="arrowLeft" size={13} /> {tr('全部来源')}</button>
        <span className="grow" />
      </div>
      <div className="gw-detail-title">
        <h3>{tr('智能路由')}</h3>
        <span className="sub">{tr('一个来源失败或没额度时，按顺序换下一个。')}</span>
      </div>
      {!status?.enabled && (
        <div className="gateway-card gateway-start">
          <div className="gateway-row">
            <span className="grow">{tr('路由要先打开共享才会工作。')}</span>
            <button className="btn sm" onClick={() => showDrawer('share')}>{tr('打开共享')}</button>
          </div>
        </div>
      )}
      <section className="gw-module" data-module="in-app">
        <div className="gw-module-head"><b>{tr('在对话里用')}</b></div>
        {routeGroups.map((g) => {
          const inApp = providers.find((p) => p.type === 'gateway' && p.gatewayGroupId === g.id);
          return (
            <div className="gateway-row" key={g.id}>
              <span className="grow">{g.name}</span>
              {inApp
                ? <span className="sub">{tr('已在模型菜单里：{name}', { name: inApp.name })}</span>
                : <button className="btn sm" disabled={using === g.id} onClick={() => void useInApp(g.id, g.name)}>{using === g.id ? tr('正在添加…') : tr('加到模型菜单')}</button>}
            </div>
          );
        })}
      </section>
      <section className="gw-module" data-module="groups">
        <div className="gw-module-head"><b>{tr('路由组')}</b><span className="sub">{tr('成员按顺序尝试；可以固定模型、改模型映射。')}</span></div>
        <RoutesTab />
      </section>
    </div>
  );
}
