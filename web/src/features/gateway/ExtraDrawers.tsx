import { useGateway, showDrawer } from './state';
import { Drawer } from './Drawer';
import { PluginList, SyncPanel } from './mounts';
import { tr } from '@/i18n';

// features/sync/SyncPanel.tsx and features/plugins/PluginList.tsx, through mounts.tsx.

export function SyncDrawer() {
  const open = useGateway((s) => s.drawer === 'sync');
  return (
    <Drawer id="sync" title={tr('备份与同步')} open={open} onClose={() => showDrawer(null)}>
      <SyncPanel />
    </Drawer>
  );
}

export function PluginsDrawer() {
  const open = useGateway((s) => s.drawer === 'plugins');
  return (
    <Drawer id="plugins" title={tr('插件')} open={open} onClose={() => showDrawer(null)}>
      <PluginList />
    </Drawer>
  );
}
