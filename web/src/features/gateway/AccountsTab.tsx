import { useMemo, useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import { Icon } from '@/ui/icons';
import { useGateway } from './state';
import { AccountRow } from './AccountRow';
import { AddAccountWizard } from './AddAccountWizard';
import { ProviderLoginWizard } from './ProviderLoginWizard';
import { AccountEditor } from './AccountEditor';
import type { UpstreamAccountView, UpstreamGroup, UpstreamKind } from '@shared';
import { ModelMapEditor } from './ModelMapEditor';
import { FAMILY_LABEL } from './tasks-model';
import { tr } from '@/i18n';
import { canSignIn, forgetGeminiLogin, signInGemini } from './gemini-login';
import { Select } from '@/ui/Select';

const KINDS: UpstreamKind[] = ['claude', 'gemini', 'workbuddy', 'provider'];

const POOL_STRATEGY: Record<UpstreamGroup['strategy'], string> = {
  failover: tr('按顺序故障转移'),
  'round-robin': tr('轮询'),
  'least-used': tr('用得最少的先用'),
  'most-quota': tr('剩余额度最多的先用'),
};

/**
 * A source's 账号 module: the subscription logins of one family (`kind`), and the pools a gateway group can route to
 * as one member. Without `kind`: every family.
 */
export function AccountsTab({ kind }: { kind?: UpstreamKind }) {
  const allAccounts = useGateway((s) => s.accounts);
  const allPools = useGateway((s) => s.pools);
  const accounts = useMemo(() => (kind ? allAccounts.filter((a) => a.kind === kind) : allAccounts), [allAccounts, kind]);
  const pools = useMemo(() => (kind ? allPools.filter((g) => g.kind === kind) : allPools), [allPools, kind]);
  const routeGroups = useGateway((s) => s.routeGroups);
  const families = useGateway((s) => s.families);
  const warnings = useGateway((s) => s.warnings);
  const status = useGateway((s) => s.status);
  const toast = useStore((s) => s.toast);
  const [add, setAdd] = useState(false);
  const [login, setLogin] = useState(false);
  const [editing, setEditing] = useState<UpstreamAccountView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => useGateway.getState().load().catch(() => {});
  const run = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(id);
    try {
      await fn();
      if (ok) toast(ok, true);
      await reload();
    } catch (e: any) { toast(e.message); } finally { setBusy(null); }
  };
  const remove = async (id: string, name: string) => {
    if (!(await dlg.confirm(tr('删除账号「{name}」？', { name }), { message: tr('会从所有账号池和网关组里移除，凭据一并删除。'), danger: true, okLabel: tr('删除') }))) return;
    await run(id, async () => {
      await ws.request({ kind: 'upstreams.remove', id });
      await forgetGeminiLogin(id);
    }, tr('已删除'));
  };
  const signIn = (a: UpstreamAccountView) => run(a.id, async () => {
    // sign in through the exit the account already uses: on a network that only reaches Google through
    // it, a direct login window would never load the page
    const r = await signInGemini({ accountId: a.id, proxyId: a.sidecarProxy?.id });
    if (!r) return;
    if (r.account.health === 'ok') toast(tr('登录已更新'), true);
    else toast(tr('登录了，但检查没通过：{e}', { e: r.account.lastError ?? tr('没有登录态') }));
  });
  const savePool = async (g: UpstreamGroup, patch: Partial<UpstreamGroup>) => {
    try {
      await ws.request({ kind: 'upstreams.groups.upsert', group: { ...g, ...patch } });
      await reload();
    } catch (e: any) { toast(e.message); }
  };
  const createPool = async () => {
    const name = await dlg.prompt(tr('账号池名称'), tr('默认账号池'));
    if (!name) return;
    try {
      await ws.request({ kind: 'upstreams.groups.upsert', group: { kind: kind ?? 'claude', name, strategy: 'failover', members: [] } });
      await reload();
    } catch (e: any) { toast(e.message); }
  };
  const accountName = (id: string) => allAccounts.find((a) => a.id === id)?.name ?? id;
  // an account counts as routed when a gateway group names it or a pool it belongs to
  const routed = (id: string) => routeGroups.some((g) => g.members.some((m) => m.accountId === id || (!!m.upstreamGroupId && (allPools.find((x) => x.id === m.upstreamGroupId)?.members ?? []).includes(id))));
  const enable = async () => {
    try {
      await ws.request({ kind: 'gateway.set', enabled: true });
      await reload();
    } catch (e: any) { toast(e.message); }
  };
  return (
    <div className="gateway-tab">
      {status?.enabled === false && (
        <div className="gateway-card gateway-start">
          <div className="gateway-row">
            <span className="gw-who">
              <span className="l">{tr('账号还没开始工作')}</span>
              <span className="sub">{tr('打开一下就好，只在这台电脑上用。')}</span>
            </span>
            <span className="grow" />
            <button className="btn sm" onClick={() => void enable()}>{tr('打开')}</button>
          </div>
        </div>
      )}
      {warnings.map((w) => (
        <div key={w} className="gateway-row" style={{ color: 'var(--warn)' }}><Icon name="alert" size={13} /><span>{w}</span></div>
      ))}
      <div className="gateway-row">
        <span className="grow">{tr('账号（{n}）', { n: accounts.length })}</span>
        {!kind && <span className="sub">{KINDS.map((k) => `${FAMILY_LABEL[k]} ${accounts.filter((a) => a.kind === k).length}`).join(' · ')}</span>}
        {!kind && <button className="btn sm ghost" onClick={() => setLogin(true)}>{tr('第三方登录')}</button>}
        <button className="btn sm" onClick={() => setAdd(true)}>{tr('添加账号')}</button>
      </div>
      {accounts.length === 0 && <div className="empty">{tr('还没有账号。点「添加账号」登录一个。')}</div>}
      {accounts.map((a) => (
        <AccountRow
          key={a.id}
          a={a}
          busy={busy === a.id}
          routed={routed(a.id)}
          onAttach={() => run(a.id, () => ws.request({ kind: 'upstreams.attachDefault', id: a.id }), tr('已可用'))}
          onProbe={() => run(a.id, () => ws.request({ kind: 'upstreams.probe', id: a.id }))}
          onToggle={() => run(a.id, () => ws.request({ kind: 'upstreams.update', id: a.id, patch: { enabled: !a.enabled } }))}
          onEdit={() => setEditing(a)}
          onRemove={() => void remove(a.id, a.name)}
          onSignIn={a.kind === 'gemini' && canSignIn() ? () => void signIn(a) : undefined}
        />
      ))}

      <div className="gateway-row" style={{ marginTop: 14 }}>
        <span className="gw-who">
          <span className="l">{tr('账号池')}</span>
          <span className="sub">{tr('同类账号自动轮换；要组合不同来源，用「智能路由」。')}</span>
        </span>
        <span className="grow" />
        <button className="btn sm" onClick={() => void createPool()}>{tr('新建账号池')}</button>
      </div>
      {pools.length === 0 && <div className="empty">{tr('一般不用建账号池：加进来的账号会自动轮换着用。')}</div>}
      {pools.map((g) => {
        const rest = allAccounts.filter((a) => a.kind === g.kind && !g.members.includes(a.id));
        return (
          <div className="gateway-card" key={g.id} style={{ marginTop: 10 }}>
            <div className="gateway-row">
              <b>{g.name}</b>
              <Select value={g.kind} onValueChange={(value) => {
                const k = String(value) as UpstreamKind;
                void savePool(g, { kind: k, members: g.members.filter((id) => accounts.find((a) => a.id === id)?.kind === k) });
              }} aria-label={tr('类型')} options={KINDS.map((k) => ({ value: k, label: FAMILY_LABEL[k] }))} />
              <span className="grow" />
              <Select value={g.strategy} onValueChange={(value) => void savePool(g, { strategy: String(value) as UpstreamGroup['strategy'] })} aria-label={tr('策略')} options={Object.entries(POOL_STRATEGY).map(([id, label]) => ({ value: id, label, description: id === 'most-quota' ? tr('依据最近记录的额度使用情况排序') : undefined }))} />
              <button className="btn sm ghost danger" onClick={async () => {
                if (await dlg.confirm(tr('删除账号池「{name}」？', { name: g.name }), { danger: true })) {
                  await ws.request({ kind: 'upstreams.groups.remove', id: g.id }).catch((e) => toast(e.message));
                  await reload();
                }
              }}>{tr('删除')}</button>
            </div>
            {g.members.map((id) => (
              <div className="gateway-row" key={id}>
                <span className="grow">{accountName(id)}</span>
                <button className="btn sm ghost" onClick={() => void savePool(g, { members: g.members.filter((x) => x !== id) })}>{tr('移出账号池')}</button>
              </div>
            ))}
            {g.members.length === 0 && <div className="sub">{tr('池里还没有账号')}</div>}
            {rest.length > 0 && (
              <div className="row">
                <Select value="" onValueChange={(value) => {
                  const id = String(value);
                  if (!id) return;
                  void savePool(g, { members: [...g.members, id] });
                }} aria-label={tr('添加账号')} options={[{ value: '', label: tr('添加账号…') }, ...rest.map((a) => ({ value: a.id, label: a.name }))]} searchable={rest.length > 8} />
                <span className="sub">{tr('按列表顺序尝试')}</span>
              </div>
            )}
            <ModelMapEditor value={g.modelMap} onSave={(modelMap) => void savePool(g, { modelMap })} />
          </div>
        );
      })}

      {families.filter((f) => !f.ready).map((f) => (
        <div className="gateway-row" key={f.kind}>
          <span className="grow">{f.kind} · {f.detail ?? tr('后续阶段提供')}</span>
        </div>
      ))}
      {add && <AddAccountWizard kind={kind} onClose={() => { setAdd(false); void reload(); }} />}
      {login && <ProviderLoginWizard onClose={() => { setLogin(false); void reload(); }} />}
      {editing && <AccountEditor account={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}
