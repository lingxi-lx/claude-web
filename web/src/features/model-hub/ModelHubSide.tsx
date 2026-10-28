import { SectionSide } from '@/features/sections/SectionSide';
import { useGateway } from '@/features/gateway/state';
import { tr } from '@/i18n';
import { HUB_PAGES, HUB_TITLE, type HubPageId } from './page';
import { showHubPage, useHub } from './state';

/** The sidebar while the model hub is in front: one row per first-level page. */
export function ModelHubSide() {
  const page = useHub((s) => s.page);
  const accounts = useGateway((s) => s.accounts.length);
  return (
    <SectionSide
      name="hub"
      title={HUB_TITLE}
      tab={page}
      onTab={(id) => showHubPage(id as HubPageId)}
      tabs={HUB_PAGES.map((p) => ({
        id: p.id,
        label: p.label,
        icon: p.icon,
        title: p.desc,
        count: p.id === 'sources' && accounts ? <span className="count">{accounts}</span> : undefined,
      }))}
    >
      <div className="sect-note">{tr('所有来源、账号、路由和额度都只在这台电脑上。')}</div>
      <div className="sect-note">{tr('模型调用仍然在「对话」里；这里只管理来源与路由。')}</div>
    </SectionSide>
  );
}
