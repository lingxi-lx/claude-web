import { useGateway, showDrawer } from './state';
import { Drawer } from './Drawer';
import { PluginList, SyncPanel } from './mounts';
import { Placeholder } from './Placeholder';
import { tr } from '@/i18n';

// MOUNT POINTS: features/sync/SyncPanel.tsx and features/plugins/PluginList.tsx (see mounts.tsx).

export function SyncDrawer() {
  const open = useGateway((s) => s.drawer === 'sync');
  return (
    <Drawer id="sync" title={tr('备份与同步')} open={open} onClose={() => showDrawer(null)}>
      {SyncPanel ? <SyncPanel /> : <Placeholder mount="sync-panel" title={tr('备份与同步')} note={tr('把来源、账号和设置加密备份，或在几台电脑之间同步，会放在这里。')} />}
    </Drawer>
  );
}

export function PluginsDrawer() {
  const open = useGateway((s) => s.drawer === 'plugins');
  return (
    <Drawer id="plugins" title={tr('插件')} open={open} onClose={() => showDrawer(null)}>
      {PluginList ? <PluginList /> : <Placeholder mount="plugin-list" title={tr('插件')} note={tr('给上游加新来源或新功能的插件会列在这里。')} />}
    </Drawer>
  );
}
