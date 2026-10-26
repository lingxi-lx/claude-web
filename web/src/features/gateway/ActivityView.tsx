import { useGateway, showDrawer } from './state';
import { Drawer } from './Drawer';
import { LogsTab } from './LogsTab';
import { tr } from '@/i18n';

/** 活动: every request that went through (what 日志 was); one source's lines are in its detail under 诊断. */
export function ActivityView() {
  const open = useGateway((s) => s.drawer === 'activity');
  return (
    <Drawer id="activity" title={tr('活动')} open={open} onClose={() => showDrawer(null)}>
      <div className="sub gw-drawer-note">{tr('只记模型、来源、状态和耗时，不记提示词和回复。')}</div>
      <LogsTab />
    </Drawer>
  );
}
