// Mount points for parts other branches build. Each one is picked up by itself when its file exists (import.meta.glob
// finds nothing until then) and loads lazily; until it lands the caller shows its own fallback / a placeholder.
// Contract per file: a named export of the given name, no props.
//   features/privacy/PrivacyCenter.tsx  → PrivacyCenter  (隐私 drawer, PrivacyDrawer.tsx)
//   features/routing/RoutingDetail.tsx  → RoutingDetail  (智能路由 source detail)
//   features/share/ShareDrawer.tsx      → ShareDrawer    (共享 drawer body)
//   features/sync/SyncPanel.tsx         → SyncPanel      (⋯ → 备份与同步)
//   features/plugins/PluginList.tsx     → PluginList     (⋯ → 插件)
import { lazy, Suspense, type ComponentType } from 'react';

type Found = Record<string, () => Promise<any>>;

function optional(found: Found, name: string): ComponentType | null {
  const load = Object.values(found)[0];
  if (!load) return null;
  const C = lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
  return function Mounted() {
    return <Suspense fallback={null}><C /></Suspense>;
  };
}

export const PrivacyCenter = optional(import.meta.glob('../privacy/PrivacyCenter.tsx'), 'PrivacyCenter');
export const ExternalRoutingDetail = optional(import.meta.glob('../routing/RoutingDetail.tsx'), 'RoutingDetail');
export const ExternalShareDrawer = optional(import.meta.glob('../share/ShareDrawer.tsx'), 'ShareDrawer');
export const SyncPanel = optional(import.meta.glob('../sync/SyncPanel.tsx'), 'SyncPanel');
export const PluginList = optional(import.meta.glob('../plugins/PluginList.tsx'), 'PluginList');
