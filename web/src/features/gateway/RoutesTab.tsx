import { useEffect } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { useGateway } from './state';
import { dlg } from '@/ui/dialog';
import type { GatewayGroup, GatewayMember } from '@shared';
import { ModelMapEditor } from './ModelMapEditor';
import { tr } from '@/i18n';
import { Select } from '@/ui/Select';

const memberValue = (m: GatewayMember): string =>
  m.accountId ? `a:${m.accountId}` : m.upstreamGroupId ? `u:${m.upstreamGroupId}` : `p:${m.providerId ?? ''}`;

const memberOf = (v: string): GatewayMember =>
  v.startsWith('a:') ? { accountId: v.slice(2) } : v.startsWith('u:') ? { upstreamGroupId: v.slice(2) } : { providerId: v.slice(2) };

/**
 * 分组与路由: the gateway groups keys route into. A member is a supplier profile, one account, or a whole pool;
 * the order is the failover order.
 */
export function RoutesTab() {
  const pools = useGateway((s) => s.pools);
  const accounts = useGateway((s) => s.accounts);
  const routeGroups = useGateway((s) => s.routeGroups);
  const status = useGateway((s) => s.status);
  const providers = useStore((s) => s.providers);
  const toast = useStore((s) => s.toast);
  useEffect(() => { void useGateway.getState().load().catch(() => {}); }, []);

  const reload = () => useGateway.getState().load().catch(() => {});
  const save = async (g: GatewayGroup) => {
    try {
      await ws.request({ kind: 'gateway.groups.upsert', group: g });
      await reload();
    } catch (e: any) { toast(e.message); }
  };
  const add = async () => {
    const name = await dlg.prompt(tr('组名称'), tr('新组'));
    if (!name) return;
    await save({ id: '', name, strategy: 'failover', members: [] });
  };
  const setMembers = (g: GatewayGroup, values: string[]) => save({ ...g, members: values.map(memberOf) });
  const usable = providers.filter((p) => p.type !== 'gateway');
  const allOptions = [
    ...usable.map((p) => ({ value: `p:${p.id}`, label: `${p.name}（${p.type}）` })),
    ...accounts.map((a) => ({ value: `a:${a.id}`, label: `${a.name}（${tr('账号')}）` })),
    ...pools.map((g) => ({ value: `u:${g.id}`, label: `${g.name}（${tr('账号池')}）` })),
  ];
  // the 智能路由 group is edited in its own detail (RoutingDetail): its members are derived from its candidates, so an
  // edit here would be overwritten
  const groups = routeGroups.filter((g) => !g.routing);
  return (
    <div className="gateway-tab">
      <div className="gateway-row"><span className="grow">{tr('网关组')}</span><button className="btn sm" onClick={() => void add()}>{tr('新建组')}</button></div>
      {groups.length === 0 && <div className="empty">{tr('还没有网关组。新建一个，把供应商、账号或账号池加进去。')}</div>}
      {groups.map((g) => (
        <div className="gateway-card" key={g.id} style={{ marginTop: 10 }}>
          <div className="gateway-row">
            <b>{g.name}</b><code className="sub">{g.id}</code>
            <span className="grow" />
            <Select value={g.strategy} onValueChange={(value) => void save({ ...g, strategy: value as GatewayGroup['strategy'] })} aria-label={tr('策略')} options={[
              { value: 'failover', label: tr('按顺序故障转移'), description: tr('前一个失败后尝试下一个') },
              { value: 'round-robin', label: tr('轮询'), description: tr('在成员之间平均分配') },
            ]} />
            <button className="btn sm ghost danger" onClick={async () => {
              if (await dlg.confirm(tr('删除组「{name}」？', { name: g.name }), { danger: true })) {
                await ws.request({ kind: 'gateway.groups.remove', id: g.id }).catch((e) => toast(e.message));
                await reload();
              }
            }}>{tr('删除')}</button>
          </div>
          <div className="sub">{tr('成员（按顺序尝试）')}</div>
          {g.members.map((m, i) => (
            <div className="gateway-row" key={`${g.id}-${i}`}>
              <Select value={memberValue(m)} onValueChange={(value) => {
                const next = [...g.members];
                next[i] = memberOf(String(value));
                void save({ ...g, members: next });
              }} options={allOptions} searchable={allOptions.length > 8} aria-label={tr('成员')} />
              <input
                placeholder={tr('固定模型（可留空）')}
                defaultValue={m.model ?? ''}
                onBlur={(e) => {
                  const model = e.target.value.trim() || undefined;
                  if (model === m.model) return;
                  void save({ ...g, members: g.members.map((x, j) => (j === i ? { ...x, model } : x)) });
                }}
              />
              <button className="btn sm ghost" onClick={() => void setMembers(g, g.members.filter((_, x) => x !== i).map(memberValue))}>{tr('移除')}</button>
            </div>
          ))}
          <div className="row">
            <Select value="" onValueChange={(value) => {
              const selected = String(value);
              if (!selected) return;
              void setMembers(g, [...g.members.map(memberValue), selected]);
            }} options={[{ value: '', label: tr('添加成员…') }, ...allOptions]} searchable={allOptions.length > 8} aria-label={tr('添加成员')} />
          </div>
          <div className="sub">
            {tr('成员状态：{states}', {
              states: (status?.states[g.id] ?? []).map((x) => `${x.name}:${x.health}`).join(' · ') || tr('还没用过'),
            })}
          </div>
          <ModelMapEditor value={g.modelMap} onSave={(modelMap) => void save({ ...g, modelMap })} />
        </div>
      ))}
    </div>
  );
}
