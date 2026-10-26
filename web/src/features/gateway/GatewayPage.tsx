import { useMemo } from 'react';
import { OverPage } from '@/features/sections/OverPage';
import { useStore } from '@/store';
import { Icon } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import { useGateway, closeGateway, gatewayEscape, setGatewayQuery, showDrawer } from './state';
import { GATEWAY_TITLE, ROUTING_ID } from './page';
import { SourceDashboard } from './SourceDashboard';
import { SourceDetail } from './SourceDetail';
import { RoutingDetail } from './RoutingDetail';
import { ShareDrawer } from './ShareDrawer';
import { PrivacyDrawer } from './PrivacyDrawer';
import { ActivityView } from './ActivityView';
import { openAddSource } from './add-source';
import { tr } from '@/i18n';

/** The header: search, ＋ 添加来源, then the three side doors (活动, 隐私 shield, 共享). */
function HeaderActions() {
  const query = useGateway((s) => s.query);
  const drawer = useGateway((s) => s.drawer);
  const shared = useGateway((s) => !!s.status?.enabled);
  return (
    <div className="gw-head-actions">
      <label className="gw-search">
        <Icon name="search" size={13} />
        <input
          value={query}
          placeholder={tr('搜索模型或来源')}
          aria-label={tr('搜索模型或来源')}
          onChange={(e) => setGatewayQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || imeComposing(e.nativeEvent)) return;
            e.preventDefault();
            e.stopPropagation();
            if (query) setGatewayQuery('');
            else (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      <button className="icon-btn" data-id="activity" aria-pressed={drawer === 'activity'} title={tr('活动')} aria-label={tr('活动')} onClick={() => showDrawer(drawer === 'activity' ? null : 'activity')}><Icon name="usage" size={15} /></button>
      {/* 隐私中心 entry (shield): the drawer is the mount point for features/privacy/PrivacyCenter.tsx */}
      <button className="icon-btn" data-id="privacy" aria-pressed={drawer === 'privacy'} title={tr('隐私')} aria-label={tr('隐私')} onClick={() => showDrawer(drawer === 'privacy' ? null : 'privacy')}><Icon name="shield" size={15} /></button>
      <button className="btn sm ghost" data-id="share" aria-pressed={drawer === 'share'} onClick={() => showDrawer(drawer === 'share' ? null : 'share')} title={tr('让其它应用也能用这些模型')}>
        <Icon name="share" size={13} /> {tr('共享')}{shared && <span className="gw-on-dot" aria-label={tr('已打开')} />}
      </button>
      <button className="btn sm" data-id="add" onClick={() => openAddSource()}><Icon name="plus" size={13} /> {tr('添加来源')}</button>
    </div>
  );
}

/**
 * 上游 (spec 2026-10-26 §2.1): the sources as cards under a filter, a source's detail on the same page, and drawers
 * for 共享 / 隐私 / 活动. Esc puts away the innermost thing first (drawer → detail → page).
 */
export function GatewayPage() {
  const open = useGateway((s) => s.open);
  const detail = useGateway((s) => s.detail);
  const drawer = useGateway((s) => s.drawer);
  const seenDrawers = useGateway((s) => s.seenDrawers);
  const sources = useGateway((s) => s.sources);
  // the section's own sidebar carries the filter; with it collapsed (or on a phone) the page shows it as a strip
  const sideNav = useStore((s) => !s.mobile && s.sidebarOpen);
  const source = useMemo(() => (detail && detail !== ROUTING_ID ? sources.find((s) => s.id === detail) : undefined), [detail, sources]);
  return (
    <OverPage
      name="gateway"
      label={GATEWAY_TITLE}
      open={open}
      onClose={closeGateway}
      onEscape={gatewayEscape}
      title={GATEWAY_TITLE}
      desc={tr('模型、账号和免费额度，都在一个地方')}
      tab={detail ? 'detail' : drawer ?? 'home'}
      tabs={[]}
      showTabs={false}
      onTab={() => {}}
      actions={<HeaderActions />}
    >
      <div className="gateway-body">
        {/* the dashboard stays mounted under a detail (its scroll and the search survive the round trip) */}
        <div className="gateway-home" hidden={!!detail}><SourceDashboard showFilters={!sideNav} /></div>
        {detail === ROUTING_ID && <RoutingDetail />}
        {source && <SourceDetail key={source.id} source={source} />}
        {detail && detail !== ROUTING_ID && !source && (
          <div className="gw-detail"><div className="empty">{tr('这个来源已经不在了。')}</div></div>
        )}
      </div>
      {seenDrawers.includes('share') && <ShareDrawer />}
      {seenDrawers.includes('privacy') && <PrivacyDrawer />}
      {seenDrawers.includes('activity') && <ActivityView />}
    </OverPage>
  );
}
