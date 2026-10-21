import { OverPage } from '@/features/sections/OverPage';
import { useStore } from '@/store';
import { useGateway, closeGateway, showGatewayTab, toggleGatewayAdvanced } from './state';
import { GATEWAY_TITLE, gatewayTabsFor, type GatewayTab } from './page';
import { OverviewTab } from './OverviewTab';
import { AccountsTab } from './AccountsTab';
import { TasksTab } from './TasksTab';
import { RoutesTab } from './RoutesTab';
import { KeysTab } from './KeysTab';
import { LogsTab } from './LogsTab';
import { GatewaySettingsTab } from './GatewaySettingsTab';
import { tr } from '@/i18n';

/** 网关: add an account and use it; 高级 holds the pools / routing / keys / logs / LAN parts. */
export function GatewayPage() {
  const open = useGateway((s) => s.open);
  const tab = useGateway((s) => s.tab);
  const seen = useGateway((s) => s.seen);
  const advanced = useGateway((s) => s.advanced);
  // the section's own sidebar carries the parts; with it collapsed (or on a phone) the page shows them as tabs
  const sideNav = useStore((s) => !s.mobile && s.sidebarOpen);
  const tabs = [
    ...gatewayTabsFor(advanced).map((t) => ({ id: t.id, label: t.label, icon: t.icon, title: t.title })),
    // the toggle lives in the strip too when the sidebar is not on screen
    ...(sideNav ? [] : [{ id: '__advanced', label: advanced ? tr('收起高级') : tr('高级设置'), icon: 'settings' as const }]),
  ];
  return (
    <OverPage
      name="gateway"
      label={GATEWAY_TITLE}
      open={open}
      onClose={closeGateway}
      title={GATEWAY_TITLE}
      desc={tr('把账号接进来，给其它应用一个统一的模型地址')}
      tab={tab}
      tabs={tabs}
      showTabs={!sideNav}
      onTab={(id) => (id === '__advanced' ? toggleGatewayAdvanced() : showGatewayTab(id as GatewayTab))}
    >
      {seen.includes('overview') && <div hidden={tab !== 'overview'}><OverviewTab /></div>}
      {seen.includes('accounts') && <div hidden={tab !== 'accounts'}><AccountsTab /></div>}
      {seen.includes('tasks') && <div hidden={tab !== 'tasks'}><TasksTab /></div>}
      {seen.includes('routes') && <div hidden={tab !== 'routes'}><RoutesTab /></div>}
      {seen.includes('keys') && <div hidden={tab !== 'keys'}><KeysTab /></div>}
      {seen.includes('logs') && <div hidden={tab !== 'logs'}><LogsTab /></div>}
      {seen.includes('settings') && <div hidden={tab !== 'settings'}><GatewaySettingsTab /></div>}
    </OverPage>
  );
}
