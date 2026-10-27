import { useEffect, useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { useGateway } from '@/features/gateway/state';
import { dlg } from '@/ui/dialog';
import { Select } from '@/ui/Select';
import { tr } from '@/i18n';
import { ROUTING_POLICIES, candidateKey, type RoutingCandidate, type RoutingConfig, type RoutingPolicy, type RoutingRule, type RoutingStatus } from '@shared';
import { routingPolicyHint, routingPolicyLabel } from '@/features/models/menu';

const costLabel = (c: 'free' | 'subscription' | 'paid') => (c === 'free' ? tr('免费') : c === 'subscription' ? tr('订阅') : tr('付费'));

const refOf = (v: string): Pick<RoutingCandidate, 'providerId' | 'accountId' | 'upstreamGroupId'> =>
  v.startsWith('a:') ? { accountId: v.slice(2) } : v.startsWith('u:') ? { upstreamGroupId: v.slice(2) } : { providerId: v.slice(2) };

/**
 * 智能路由 detail (spec 2026-10-26 §7): the strategy, the candidates (each with 允许自动路由使用), their order,
 * the paid budget, how many tries, free → paid, the custom rules and the recent decisions. Self-contained: the
 * gateway page mounts it; everything goes through `gateway.routing.*`.
 */
export function RoutingDetail() {
  const [st, setSt] = useState<RoutingStatus | null>(null);
  const providers = useStore((s) => s.providers);
  const toast = useStore((s) => s.toast);
  const accounts = useGateway((s) => s.accounts);
  const pools = useGateway((s) => s.pools);

  const load = () => ws.request<RoutingStatus>({ kind: 'gateway.routing.status' }).then(setSt).catch((e) => toast(e.message));
  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!st) return <div className="routing-detail empty">{tr('加载中…')}</div>;

  if (!st.groupId) {
    return (
      <div className="routing-detail gateway-card">
        <p>{tr('智能路由会在你允许的模型里，按请求需要和策略自动挑一个；失败时只在还没输出、没执行工具之前换下一个。')}</p>
        <button className="btn sm" onClick={() => void ws.request({ kind: 'gateway.routing.ensure' }).then(load).catch((e) => toast(e.message))}>{tr('开启智能路由')}</button>
      </div>
    );
  }

  const cfg = st.config;
  const save = async (patch: Partial<RoutingConfig>) => {
    try {
      await ws.request({ kind: 'gateway.routing.set', patch });
      await load();
    } catch (e: any) { toast(e.message); }
  };
  const setCandidates = (candidates: RoutingCandidate[]) => save({ candidates });
  const options = [
    ...providers.filter((p) => p.type !== 'gateway').map((p) => ({ value: `p:${p.id}`, label: p.name })),
    ...accounts.map((a) => ({ value: `a:${a.id}`, label: `${a.name}（${tr('账号')}）` })),
    ...pools.map((g) => ({ value: `u:${g.id}`, label: `${g.name}（${tr('账号池')}）` })),
  ];
  const add = async (source: string) => {
    const ref = refOf(source);
    const p = ref.providerId ? providers.find((x) => x.id === ref.providerId) : undefined;
    const model = (await dlg.prompt(tr('用这个来源的哪个模型？'), p?.models?.[0] ?? ''))?.trim();
    if (!model) return;
    if (cfg.candidates.some((c) => candidateKey(c) === candidateKey({ ...ref, model }))) return toast(tr('已经在候选里了'));
    await setCandidates([...cfg.candidates, { ...ref, model, allowAuto: true }]);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= cfg.candidates.length) return;
    const l = [...cfg.candidates];
    [l[i], l[j]] = [l[j], l[i]];
    void setCandidates(l);
  };
  const patchCand = (i: number, p: Partial<RoutingCandidate>) => void setCandidates(cfg.candidates.map((c, k) => (k === i ? { ...c, ...p } : c)));
  const rules = cfg.rules ?? [];
  const setRules = (r: RoutingRule[]) => void save({ rules: r });
  const candOptions = cfg.candidates.map((c) => ({ value: candidateKey(c), label: st.candidates.find((x) => x.key === candidateKey(c))?.label ?? c.model }));

  return (
    <div className="routing-detail">
      <div className="gateway-card">
        <div className="gateway-row">
          <span className="grow">{tr('没指明策略时用')}</span>
          <Select value={cfg.policy} onValueChange={(v) => void save({ policy: v as RoutingPolicy })} aria-label={tr('策略')}
            options={ROUTING_POLICIES.map((p) => ({ value: p, label: routingPolicyLabel(p), description: routingPolicyHint(p) }))} />
        </div>
        <div className="sub">{tr('对话的模型菜单里「智能路由」下的每一项就是一个策略。')}</div>
        <div className="gateway-row">
          <label><input type="checkbox" checked={cfg.failover} onChange={(e) => void save({ failover: e.target.checked })} /> {tr('失败时换下一个候选（只在还没输出、没执行工具之前）')}</label>
        </div>
        <div className="gateway-row">
          <span className="grow">{tr('一次请求最多试几个')}</span>
          <input type="number" min={1} max={5} value={cfg.maxAttempts} style={{ width: 60 }} onChange={(e) => void save({ maxAttempts: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })} />
        </div>
        <div className="gateway-row">
          <label><input type="checkbox" checked={cfg.allowPaid} onChange={(e) => void save({ allowPaid: e.target.checked })} /> {tr('允许用付费的候选（免费优先永远不会）')}</label>
        </div>
        <div className="gateway-row">
          <span className="grow">{tr('每天付费预算（美元，0 = 不用付费的）')}</span>
          <input type="number" min={0} step={0.5} value={cfg.budgetUsd ?? 0} style={{ width: 80 }} onChange={(e) => void save({ budgetUsd: Math.max(0, Number(e.target.value) || 0) })} />
          <span className="sub">{tr('今天已用 ${n}', { n: st.spentTodayUsd.toFixed(2) })}</span>
        </div>
        <div className="sub">{tr('今天切换了 {n} 次', { n: st.switchesToday })}</div>
      </div>

      <div className="gateway-card" style={{ marginTop: 10 }}>
        <div className="gateway-row">
          <b className="grow">{tr('候选模型')}</b>
          <Select value="" onValueChange={(v) => { if (v) void add(String(v)); }} aria-label={tr('添加候选')} placeholder={tr('添加候选…')} options={options} searchable />
        </div>
        {cfg.candidates.length === 0 && <div className="empty">{tr('还没有候选。从上面添加一个来源和它的模型。')}</div>}
        {cfg.candidates.map((c, i) => {
          const key = candidateKey(c);
          const v = st.candidates.find((x) => x.key === key);
          return (
            <div className="gateway-row routing-cand" key={key}>
              <span className="sub">{i + 1}</span>
              <span className="grow">
                {v?.label ?? c.model}
                <span className="sub"> · {costLabel(v?.cost ?? 'paid')}{v?.caps.context ? ` · ${Math.round(v.caps.context / 1000)}K` : ''}{v && (v.ok + v.fail) > 0 ? ` · ${tr('成功 {ok}/{all}', { ok: v.ok, all: v.ok + v.fail })}` : ''}{v?.latencyMs !== undefined ? ` · ${v.latencyMs}ms` : ''}{v?.health === 'cooling' ? ` · ${tr('冷却中')}` : v?.health === 'disabled' ? ` · ${tr('已停用')}` : ''}</span>
              </span>
              <label title={tr('允许自动路由使用')}><input type="checkbox" checked={c.allowAuto} onChange={(e) => patchCand(i, { allowAuto: e.target.checked })} /> {tr('允许自动路由使用')}</label>
              <Select value={c.cost ?? ''} onValueChange={(x) => patchCand(i, { cost: (x || undefined) as RoutingCandidate['cost'] })} aria-label={tr('计费')}
                options={[{ value: '', label: tr('自动判断') }, { value: 'free', label: tr('免费') }, { value: 'subscription', label: tr('订阅') }, { value: 'paid', label: tr('付费') }]} />
              <button className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={tr('上移')}>↑</button>
              <button className="btn sm ghost" disabled={i === cfg.candidates.length - 1} onClick={() => move(i, 1)} aria-label={tr('下移')}>↓</button>
              <button className="btn sm ghost" onClick={() => void setCandidates(cfg.candidates.filter((_, k) => k !== i))}>{tr('移除')}</button>
            </div>
          );
        })}
      </div>

      <div className="gateway-card" style={{ marginTop: 10 }}>
        <b>{tr('自定义规则')}</b>
        <textarea className="input" rows={2} style={{ width: '100%', marginTop: 6 }} defaultValue={cfg.ruleText ?? ''} placeholder={tr('用自己的话写规则（先存着；现在按下面的条件挑）')}
          onBlur={(e) => { if (e.target.value !== (cfg.ruleText ?? '')) void save({ ruleText: e.target.value }); }} />
        {rules.map((r, i) => (
          <div className="gateway-row" key={r.id}>
            <input className="input grow" defaultValue={(r.when.keywords ?? []).join(', ')} placeholder={tr('包含这些词（逗号分隔）')}
              onBlur={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, when: { ...x.when, keywords: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) } } : x)))} />
            <label><input type="checkbox" checked={!!r.when.needsTools} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, when: { ...x.when, needsTools: e.target.checked || undefined } } : x)))} /> {tr('要用工具')}</label>
            <label><input type="checkbox" checked={!!r.when.longContext} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, when: { ...x.when, longContext: e.target.checked || undefined } } : x)))} /> {tr('长上下文')}</label>
            <Select multiple value={r.prefer} onValueChange={(v) => setRules(rules.map((x, k) => (k === i ? { ...x, prefer: (Array.isArray(v) ? v : [v]).map(String) } : x)))} aria-label={tr('优先用')} placeholder={tr('优先用…')} options={candOptions} />
            <button className="btn sm ghost" onClick={() => setRules(rules.filter((_, k) => k !== i))}>{tr('移除')}</button>
          </div>
        ))}
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setRules([...rules, { id: `r${Date.now().toString(36)}`, when: {}, prefer: [] }])}>{tr('添加规则')}</button>
      </div>

      <div className="gateway-card" style={{ marginTop: 10 }}>
        <div className="gateway-row"><b className="grow">{tr('最近的决定')}</b><button className="btn sm ghost" onClick={() => void load()}>{tr('刷新')}</button></div>
        {st.decisions.length === 0 && <div className="empty">{tr('还没有经过智能路由的请求。')}</div>}
        {st.decisions.slice(0, 30).map((d) => (
          <details key={d.id} className="routing-decision">
            <summary>
              <span className="sub">{new Date(d.ts).toLocaleTimeString()}</span>{' '}
              {routingPolicyLabel(d.policy)} → {d.chosen ? d.chosen.label : tr('没有结果')}
              {d.switched ? ` · ${tr('换过候选')}` : ''}{!d.ok ? ` · ${tr('失败')}` : ''}
            </summary>
            <div className="sub">{d.reason}</div>
            <div className="sub">{tr('需要')}：{[d.needs.tools && tr('工具'), d.needs.images && tr('图片'), d.needs.thinking && tr('思考'), `~${Math.round(d.needs.tokens / 1000)}K`].filter(Boolean).join(' · ')}</div>
            <ul>
              {d.candidates.map((c) => <li key={c.key}>{c.label} {c.excluded ? <span className="sub">— {c.excluded}</span> : <span className="sub">— {c.score}</span>}</li>)}
            </ul>
            {d.attempts.length > 0 && <ol>{d.attempts.map((a, k) => <li key={k}>{a.label} · {a.status || '—'} · {a.outcome}</li>)}</ol>}
          </details>
        ))}
      </div>
    </div>
  );
}
