import { useMemo, useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { clsx } from '@/util';
import { Icon, type IconName } from '@/ui/icons';
import type { CatalogSummary, ChannelStatus, EngineStatus, SourceSummary, UpstreamAccountView } from '@shared';
import { useGateway, setGatewayFilter, showSource } from './state';
import {
  FILTERS, HEALTH_TEXT, CATEGORY_TEXT, ROUTING_ID, accountsOf, familyModels, filterCounts, isFree, isListed,
  matchesFilter, matchesQuery, quotaLeft,
} from './page';
import { SourceCard, type CardModel } from './SourceCard';
import { openAddSource, openAddSourceEntry } from './add-source';
import { engineStateText, ENGINE_STEP_TEXT } from './EnginePanel';
import { tr } from '@/i18n';

const FAMILY_ICON: Partial<Record<SourceSummary['kind'], IconName>> = { 'claude-account': 'claude', 'gemini-web': 'gemini', workbuddy: 'agent' };

/** How many models a source has: its own list, or what its accounts / pools reported. */
export function sourceModelIds(s: SourceSummary, accounts: UpstreamAccountView[], poolIds: string[], poolModels: Record<string, string[]> | undefined): string[] {
  if (s.models.length) return s.models.map((m) => m.id);
  const mine = accountsOf(s, accounts);
  const own = mine.flatMap((a) => a.models ?? []);
  if (!s.upstreamKind && !s.providerId) return [...new Set(own)];
  return [...new Set([...own, ...familyModels(mine.map((a) => a.id), poolIds, poolModels)])];
}

const resetText = (t?: number) => (t ? tr('{time} 重置', { time: new Date(t).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' }) }) : '');

/** The filters as a strip — where the sidebar that normally carries them is not on screen (a phone, a folded sidebar). */
export function FilterStrip({ counts }: { counts: Record<string, number> }) {
  const filter = useGateway((s) => s.filter);
  return (
    <div className="gw-filter-strip" role="tablist" aria-label={tr('来源分类')}>
      {FILTERS.map((f) => (
        <button key={f.id} role="tab" aria-selected={filter === f.id} className={clsx('chip', filter === f.id && 'on')} data-id={f.id} onClick={() => setGatewayFilter(f.id)}>
          {f.label} <span className="count">{counts[f.id] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

/** The dashboard: three numbers, then a card per source under the current filter and search. */
export function SourceDashboard({ showFilters }: { showFilters: boolean }) {
  const sources = useGateway((s) => s.sources);
  const accounts = useGateway((s) => s.accounts);
  const pools = useGateway((s) => s.pools);
  const routeGroups = useGateway((s) => s.routeGroups);
  const status = useGateway((s) => s.status);
  const filter = useGateway((s) => s.filter);
  const query = useGateway((s) => s.query);
  const loaded = useGateway((s) => s.loaded);
  const warnings = useGateway((s) => s.sourceWarnings);
  const catalog = useGateway((s) => s.catalog);
  const engines = useGateway((s) => s.engines);
  const engineStep = useGateway((s) => s.engineStep);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState<string | null>(null);

  const listed = useMemo(() => sources.filter(isListed), [sources]);
  const counts = useMemo(() => filterCounts(listed), [listed]);
  const poolIdsOf = (s: SourceSummary) => (s.upstreamKind ? pools.filter((p) => p.kind === s.upstreamKind).map((p) => p.id) : []);
  const shown = listed.filter((s) => matchesFilter(s, filter) && matchesQuery(s, query));

  const ready = listed.filter((s) => s.health === 'ready');
  const attention = listed.filter((s) => s.health === 'attention').length;
  const modelIds = new Set<string>();
  let freeModels = 0;
  for (const s of ready) for (const id of sourceModelIds(s, accounts, poolIdsOf(s), status?.poolModels)) modelIds.add(id);
  for (const s of ready) freeModels += s.models.filter((m) => m.free).length;
  const left = quotaLeft(accounts);

  const refresh = async (s: SourceSummary) => {
    setBusy(s.id);
    try {
      const r = await ws.request<ChannelStatus>({ kind: 'channels.refresh', id: s.id });
      useGateway.setState({ sources: r.sources, sourceWarnings: r.warnings });
    } catch (e: any) { toast(e.message); } finally { setBusy(null); }
  };

  const card = (s: SourceSummary): CardModel => {
    const acc = accountsOf(s, accounts);
    const models = sourceModelIds(s, accounts, poolIdsOf(s), status?.poolModels).length;
    const q = s.upstreamKind ? quotaLeft(acc) : undefined;
    const parts = [CATEGORY_TEXT[s.category]];
    if (s.upstreamKind) parts.push(tr('{n} 个账号', { n: s.accountCount ?? acc.length }));
    parts.push(models ? tr('{n} 个模型', { n: models }) : tr('模型待读取'));
    const action: CardModel['action'] = s.health === 'attention'
      ? { label: tr('去处理'), run: () => showSource(s.id) }
      : s.kind === 'provider' && !models
        ? { label: busy === s.id ? tr('读取中…') : tr('读取模型'), run: () => void refresh(s), busy: busy === s.id }
        : s.actions.canAddAccount
          ? { label: tr('管理账号'), run: () => showSource(s.id) }
          : { label: tr('查看'), run: () => showSource(s.id) };
    return {
      id: s.id,
      name: s.name,
      icon: FAMILY_ICON[s.kind],
      sub: parts.join(' · '),
      status: s.detail && s.health !== 'ready' ? { l: HEALTH_TEXT[s.health].l, c: HEALTH_TEXT[s.health].c } : HEALTH_TEXT[s.health],
      free: isFree(s) || (s.models.some((m) => m.free) ? 'some' : undefined),
      mayTrain: s.mayTrain,
      plugin: !!s.catalogId?.startsWith('plugin:'),
      ...(q ? { quota: { pct: q.pct, label: resetText(q.resetAt) || tr('剩余额度') } } : {}),
      action,
    };
  };

  // 智能路由: the smart routing group plus any ordinary route groups, as one virtual source (only under 全部 and when
  // nothing is searched)
  const plainGroups = routeGroups.filter((g) => !g.routing).length;
  const routing: CardModel | null = filter === 'all' && !query.trim()
    ? {
      id: ROUTING_ID,
      name: tr('智能路由'),
      icon: 'orchestra',
      sub: plainGroups ? tr('{n} 个路由组 · 按顺序换来源', { n: plainGroups }) : tr('失败或没额度时自动换来源'),
      status: status?.enabled ? { l: tr('可用'), c: 'ok' } : { l: tr('没打开'), c: '' },
      action: { label: tr('调整'), run: () => showSource(ROUTING_ID) },
    }
    : null;

  // 免费 / 本机运行内核: what the catalog offers that is not added yet, next to what is (one click → its form)
  const offerCard = (c: CatalogSummary): CardModel => {
    const engine: EngineStatus | undefined = c.driver.startsWith('engine:') ? engines.find((e) => e.id === c.driver.slice(7)) : undefined;
    const step = engine ? engineStep[engine.id] : undefined;
    return {
      id: `offer:${c.id}`,
      name: c.name,
      sub: step ? ENGINE_STEP_TEXT[step] : engine ? engineStateText(engine) : c.plugin ? tr('来自插件「{id}」', { id: c.plugin.id }) : c.limits ?? CATEGORY_TEXT[c.category],
      status: { l: tr('未添加'), c: '' },
      free: c.free,
      mayTrain: c.mayTrain,
      plugin: !!c.plugin,
      offer: true,
      action: { label: engine ? (engine.detected ? tr('连接') : engine.installed ? tr('启动') : tr('安装')) : tr('添加'), run: () => openAddSourceEntry(c.id), busy: !!step },
    };
  };
  const q = query.trim().toLowerCase();
  const offers = (filter === 'free' || filter === 'local-engine')
    ? catalog.filter((c) => !c.added && !c.retired && (filter === 'free' ? c.category === 'free' || !!c.free : c.category === 'local-engine')
      && (!q || c.name.toLowerCase().includes(q) || c.id.includes(q)))
    : [];

  return (
    <div className="gw-dash">
      {showFilters && <FilterStrip counts={counts} />}
      <div className="gw-stats">
        <div className="gw-stat">
          <b>{ready.length}</b>
          <span>{tr('可用来源')}</span>
          <em className={attention ? 'warn' : ''}>{attention ? tr('{n} 个需要处理', { n: attention }) : listed.length ? tr('全部正常') : tr('还没有来源')}</em>
        </div>
        <div className="gw-stat">
          <b>{modelIds.size}</b>
          <span>{tr('可用模型')}</span>
          <em>{freeModels ? tr('含 {n} 个免费模型', { n: freeModels }) : '\u00a0'}</em>
        </div>
        {left && (
          <div className="gw-stat">
            <b>{left.pct}%</b>
            <span>{tr('今日剩余额度')}</span>
            <em>{resetText(left.resetAt) || tr('按最紧的额度算')}</em>
          </div>
        )}
      </div>
      {warnings.map((w) => <div key={w} className="gw-warn"><Icon name="alert" size={13} /><span>{w}</span></div>)}
      <div className="gw-section-head">
        <b>{FILTERS.find((f) => f.id === filter)?.label}</b>
        <span className="sub">{query.trim() ? tr('搜索「{q}」', { q: query.trim() }) : ''}</span>
      </div>
      <div className="gw-grid">
        {routing && <SourceCard c={routing} onOpen={() => showSource(ROUTING_ID)} />}
        {shown.map((s) => <SourceCard key={s.id} c={card(s)} onOpen={() => showSource(s.id)} />)}
      </div>
      {offers.length > 0 && (
        <>
          <div className="gw-section-head"><b>{filter === 'free' ? tr('还可以添加的免费来源') : tr('可以在这台电脑上运行')}</b></div>
          <div className="gw-grid">
            {offers.map((c) => <SourceCard key={c.id} c={offerCard(c)} onOpen={() => openAddSourceEntry(c.id)} />)}
          </div>
        </>
      )}
      {loaded && !shown.length && !routing && !offers.length && (
        <div className="empty">{listed.length ? tr('这一类里还没有来源') : tr('还没有来源。点「添加来源」接一个模型或登录一个账号。')}</div>
      )}
      <button className="gw-more" onClick={() => openAddSource()}>
        <Icon name="plus" size={13} /> {tr('浏览更多来源')}
        <span className="sub">{tr('免费模型、订阅账号、自己的 API')}</span>
      </button>
    </div>
  );
}
