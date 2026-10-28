import { useState } from 'react';
import { candidateKey, type GatewayGroup, type GatewayMemberState, type RoutingCandidate, type RoutingRule } from '@shared';
import { ws } from '@/ws/client';
import { useGateway } from '@/features/gateway/state';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import { routingPolicyLabel } from '@/features/models/menu';
import { Icon } from '@/ui/icons';
import { clsx } from '@/util';
import { tr } from '@/i18n';
import { showHubPage } from '../state';
import { RoutingDetail } from '@/features/routing/RoutingDetail';
import { RoutesTab } from '@/features/gateway/RoutesTab';

/** The health word that sits above a member box on the stage. */
function healthNote(i: number, health: GatewayMemberState['health']): string {
  if (health === 'cooling') return tr('冷却');
  if (health === 'disabled') return tr('停用');
  return i === 0 ? tr('主模型') : tr('备用');
}

/** A member reference → the name the user knows the source by. */
function memberName(
  c: RoutingCandidate,
  providers: Array<{ id: string; name: string }>,
  accounts: Array<{ id: string; name: string }>,
  pools: Array<{ id: string; name: string }>,
): string {
  if (c.accountId) return accounts.find((a) => a.id === c.accountId)?.name ?? tr('账号 {id}', { id: c.accountId });
  if (c.upstreamGroupId) return pools.find((g) => g.id === c.upstreamGroupId)?.name ?? tr('账号池 {id}', { id: c.upstreamGroupId });
  return providers.find((p) => p.id === c.providerId)?.name ?? c.model;
}

function ruleConditions(rule: RoutingRule): string[] {
  const out: string[] = [];
  if (rule.when.keywords?.length) out.push(tr('关键词「{list}」', { list: rule.when.keywords.join('、') }));
  if (rule.when.needsTools) out.push(tr('需要工具'));
  if (rule.when.needsImages) out.push(tr('需要图片'));
  if (rule.when.longContext) out.push(tr('长上下文'));
  return out;
}

/** The y positions (in the stage's 0–100 box) for one, two or three members. */
const memberYs = (n: number): number[] => (n <= 1 ? [50] : n === 2 ? [34, 66] : [22, 50, 78]);

/**
 * 路由 (spec §6.5): the routing groups on the left, a static stage of who would answer now, and the selected
 * group's rules. The stage is deliberately still — the animated request dot belongs to P3's runtime; this page only
 * has to make today's configuration legible.
 */
export function RoutingPage() {
  const toast = useStore((s) => s.toast);
  const routeGroups = useGateway((s) => s.routeGroups);
  const status = useGateway((s) => s.status);
  const sources = useGateway((s) => s.sources);
  const gatewayProviders = useStore((s) => s.providers);
  const accounts = useGateway((s) => s.accounts);
  const pools = useGateway((s) => s.pools);
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<'smart' | 'groups' | null>(null);

  const groups = status?.groups?.length ? status.groups : routeGroups;
  const group: GatewayGroup | null = groups.find((g) => g.id === picked) ?? groups[0] ?? null;
  const members = group ? status?.states?.[group.id] ?? [] : [];
  const candidates = group?.routing?.candidates ?? [];
  const configured = group?.routing?.rules ?? [];
  const ruleLines = (group?.routing?.ruleText ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

  const candidateLabel = (key: string): string => {
    const c = candidates.find((x) => candidateKey(x) === key);
    return c ? `${memberName(c, gatewayProviders, accounts, pools)} · ${c.model}` : key;
  };

  const stage = members.length
    ? members.slice(0, 3).map((m, i) => ({
        key: m.key || `${m.name}-${i}`,
        note: healthNote(i, m.health),
        value: m.name,
        hot: i === 0 && m.health === 'ok',
      }))
    : candidates.length
      ? candidates.slice(0, 3).map((c, i) => ({
          key: candidateKey(c),
          note: memberName(c, gatewayProviders, accounts, pools),
          value: c.model,
          hot: i === 0,
        }))
      : group
        ? [{ key: 'none', note: tr('没有成员'), value: '—', hot: false }]
        : [];

  const ys = memberYs(stage.length);
  const mode = (g: GatewayGroup): string =>
    g.routing ? routingPolicyLabel(g.routing.policy) : g.strategy === 'round-robin' ? tr('轮流') : tr('顺序');

  const refresh = async () => {
    try {
      await useGateway.getState().load();
      toast(tr('已刷新额度'), true);
    } catch (e: any) {
      toast(e.message);
    }
  };

  const newGroup = async () => {
    const name = await dlg.prompt(tr('组名称'), tr('新组'));
    if (!name) return;
    try {
      await ws.request({ kind: 'gateway.groups.upsert', group: { id: '', name, strategy: 'failover', members: [] } });
      await useGateway.getState().load();
      toast(tr('已创建「{name}」', { name }), true);
    } catch (e: any) { toast(e.message); }
  };
  const openEditor = (kind: 'smart' | 'groups') => setEditing(kind);

  return (
    <div className="hub-body">
      <div className="hub-row" style={{ marginBottom: 12 }}>
        <button className="btn sm" onClick={newGroup}>
          <Icon name="plus" size={13} /> {tr('新建组')}
        </button>
        <button className="btn sm ghost" onClick={() => void refresh()}>
          <Icon name="refresh" size={13} /> {tr('刷新额度')}
        </button>
        <button className="btn sm ghost" onClick={() => openEditor('groups')}>{tr('组和成员')}</button>
        <button className="btn sm ghost" onClick={() => openEditor('smart')}>{tr('智能路由规则')}</button>
        <span className="hub-grow" />
        <span className="hub-muted hub-sml">{tr('规则按顺序生效，先命中先用')}</span>
        {sources.length > 0 && <span className="hub-count">{tr('{n} 个可用来源', { n: sources.length })}</span>}
      </div>

      {!group ? (
        <div className="hub-card hub-empty" style={{ minHeight: 300 }}>
          <b>{tr('还没有路由组')}</b>
          <span>{tr('路由组决定这一轮去哪个模型。先接一个上游，再建一个组。')}</span>
          <div className="hub-row" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => showHubPage('sources')}>{tr('去看上游')}</button>
            <button className="btn sm ghost" onClick={newGroup}>{tr('新建组')}</button>
          </div>
        </div>
      ) : (
        <div className="hub-routing">
          <section className="hub-card hub-groups" aria-label={tr('路由组')}>
            {groups.map((g) => (
              <button key={g.id} className={g.id === group.id ? 'on' : ''} onClick={() => setPicked(g.id)}>
                <span
                  className="dot"
                  style={{ background: g.routing ? 'var(--hub-accent)' : 'var(--hub-muted)' }}
                  aria-hidden="true"
                />
                <span>{g.name}</span>
                <span className="mode hub-chip">{mode(g)}</span>
              </button>
            ))}
            <button onClick={newGroup} style={{ color: 'var(--hub-muted)' }}>
              <Icon name="plus" size={13} /> {tr('新建组')}
            </button>
          </section>

          <div className="hub-stack">
            <section className="hub-card">
              <div className="hd">
                <h3>{tr('实时舞台')}</h3>
                <span className="hub-grow" />
                <span className={clsx('hub-pill', stage[0]?.hot ? '' : 'off')}>
                  <span className="dot" />
                  {stage[0]?.hot ? tr('正在回答') : tr('等待请求')}
                </span>
              </div>
              <div className="bd">
                <div className="hub-stage">
                  <svg className="wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M11 50 H40" fill="none" stroke="var(--hub-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                    {stage.map((n, i) => (
                      <path
                        key={n.key}
                        d={`M40 50 C 58 50, 60 ${ys[i]}, 78 ${ys[i]}`}
                        fill="none"
                        stroke={i === 0 ? 'var(--hub-accent)' : 'var(--hub-line)'}
                        strokeWidth={i === 0 ? 2 : 1.2}
                        strokeDasharray={i === 0 ? undefined : '4 4'}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </svg>
                  <div className="hub-node" style={{ left: '11%', top: '50%' }}>
                    <div className="nt">{tr('Agent')}</div>
                    <div className="nv">Claude Code</div>
                  </div>
                  <div className="hub-node hot" style={{ left: '40%', top: '50%' }}>
                    <div className="nt">{tr('路由组')}</div>
                    <div className="nv">{group.name}</div>
                  </div>
                  {stage.map((n, i) => (
                    <div key={n.key} className={clsx('hub-node', n.hot && 'hot')} style={{ left: '78%', top: `${ys[i]}%` }}>
                      <div className="nt">{n.note}</div>
                      <div className="nv">{n.value}</div>
                    </div>
                  ))}
                </div>
                <div className="hub-row hub-muted hub-sml" style={{ marginTop: 10 }}>
                  <Icon name="orchestra" size={13} />
                  <span>
                    {tr('这一轮会走「{name}」，方式：{mode}', { name: group.name, mode: mode(group) })}
                  </span>
                  <span className="hub-grow" />
                  {candidates.length > 3 && <span>{tr('还有 {n} 个候选', { n: candidates.length - 3 })}</span>}
                </div>
              </div>
            </section>

            <section className="hub-card">
              <div className="hd">
                <h3>{tr('规则 · {name}', { name: group.name })}</h3>
                <span className="hub-grow" />
                <span className="hub-chip">{tr('判断模型 Groq / Llama 3.1 8B')}</span>
                <button className="btn sm ghost" onClick={() => openEditor('smart')}>
                  <Icon name="plus" size={12} /> {tr('添加规则')}
                </button>
              </div>
              <div className="bd hub-rules">
                {configured.map((rule, i) => (
                  <div className="hub-rule" key={rule.id}>
                    <span className="no">{i + 1}</span>
                    <span className="when">
                      {ruleConditions(rule).map((text) => <span className="hub-chip" key={text}>{text}</span>)}
                      {!ruleConditions(rule).length && <span className="hub-chip">{tr('任何请求')}</span>}
                    </span>
                    <span className="to">
                      {rule.prefer.length ? `→ ${rule.prefer.map(candidateLabel).join(' · ')}` : tr('不指定模型')}
                    </span>
                    <button className="icon-btn" title={tr('更多')} aria-label={tr('更多')} onClick={() => toast(tr('设定推理强度 / 暂停该模型 / 复制 / 删除'))}>
                      <Icon name="more" size={14} />
                    </button>
                  </div>
                ))}
                {ruleLines.map((line, i) => (
                  <div className="hub-rule" key={`rule-text-${i}`}>
                    <span className="no">{configured.length + i + 1}</span>
                    <span className="when">
                      <span className="hub-chip">{tr('自定义')}</span>
                      <span className="hub-muted hub-sml">{line}</span>
                    </span>
                  </div>
                ))}
                {!configured.length && !ruleLines.length && (
                  <div className="hub-empty" style={{ minHeight: 130, border: 0 }}>
                    <b>{tr('还没有规则')}</b>
                    <span>{tr('按顺序判断：先命中先生效。想固定某个模型，加一条规则就好。')}</span>
                    <button className="btn sm" onClick={() => openEditor('smart')}>{tr('添加规则')}</button>
                  </div>
                )}
                <div className="hub-row hub-muted hub-sml" style={{ marginTop: 10 }}>
                  <span>{tr('意图判断超时 8 秒 · 结果缓存 10 分钟')}</span>
                  <span className="hub-grow" />
                  <span>{tr('最多 8 层嵌套')}</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
      {editing && (
        <div className="modal-bg dialog-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) { setEditing(null); void useGateway.getState().load().catch(() => {}); } }}>
          <div className="modal hub-edit-modal" role="dialog" aria-label={editing === 'smart' ? tr('智能路由规则') : tr('组和成员')}>
            <div className="gw-detail-head">
              <h3>{editing === 'smart' ? tr('智能路由规则') : tr('组和成员')}</h3>
              <span className="hub-grow" />
              <button className="icon-btn" aria-label={tr('关闭')} onClick={() => { setEditing(null); void useGateway.getState().load().catch(() => {}); }}><Icon name="close" size={15} /></button>
            </div>
            <div className="hub-edit-body">{editing === 'smart' ? <RoutingDetail /> : <RoutesTab />}</div>
          </div>
        </div>
      )}
    </div>
  );
}
