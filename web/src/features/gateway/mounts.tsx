// Mount points for the parts other features own; each loads lazily (only needed once a drawer / detail shows).
// Contract per file: a named export of the given name; props are passed through (all optional).
//   features/privacy/PrivacyCenter.tsx  → PrivacyCenter  (隐私 drawer, PrivacyDrawer.tsx)
//   features/routing/RoutingDetail.tsx  → RoutingDetail  (智能路由 source detail)
//   features/share/ShareDrawer.tsx      → ShareDrawer    (共享 drawer, the 远程共享 keys part)
//   features/sync/SyncPanel.tsx         → SyncPanel      (⋯ → 备份与同步)
//   features/plugins/PluginList.tsx     → PluginList     (⋯ → 插件)
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

function mounted<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const C = lazy(() => load().then((c) => ({ default: c })));
  return function Mounted(props: P) {
    return <Suspense fallback={null}><C {...(props as any)} /></Suspense>;
  };
}

export const PrivacyCenter = mounted(() => import('../privacy/PrivacyCenter').then((m) => m.PrivacyCenter));
export const ExternalRoutingDetail = mounted(() => import('../routing/RoutingDetail').then((m) => m.RoutingDetail));
export const ExternalShareDrawer = mounted<{ lanAdvanced?: ReactNode }>(() => import('../share/ShareDrawer').then((m) => m.ShareDrawer));
export const SyncPanel = mounted(() => import('../sync/SyncPanel').then((m) => m.SyncPanel));
export const PluginList = mounted(() => import('../plugins/PluginList').then((m) => m.PluginList));
