import { SectionSide } from '@/features/sections/SectionSide';
import { useGateway, showGatewayTab, toggleGatewayAdvanced } from './state';
import { GATEWAY_TITLE, gatewayTabsFor, type GatewayTab } from './page';
import { tr } from '@/i18n';

/** The sidebar while the gateway section is in front: its parts as rows; 高级 holds the sharing / tuning parts. */
export function GatewaySide() {
  const tab = useGateway((s) => s.tab);
  const advanced = useGateway((s) => s.advanced);
  const accounts = useGateway((s) => s.accounts.length);
  return (
    <SectionSide
      name="gateway"
      title={GATEWAY_TITLE}
      tab={tab}
      onTab={(id) => showGatewayTab(id as GatewayTab)}
      tabs={gatewayTabsFor(advanced).map((t) => ({
        id: t.id,
        label: t.label,
        icon: t.icon,
        title: t.title,
        count: t.id === 'accounts' && accounts ? <span className="count">{accounts}</span> : undefined,
      }))}
    >
      <div className="sect-note">{tr('账号只保存在这台电脑上。')}</div>
      <button className="link" onClick={toggleGatewayAdvanced}>{advanced ? tr('收起高级') : tr('高级设置')}</button>
    </SectionSide>
  );
}
