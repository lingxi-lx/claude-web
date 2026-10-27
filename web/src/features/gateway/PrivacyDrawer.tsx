import { useGateway, showDrawer } from './state';
import { Drawer } from './Drawer';
import { AuditSettings } from './ShareSettings';
import { PrivacyCenter } from './mounts';
import { tr } from '@/i18n';

// features/privacy/PrivacyCenter.tsx, through mounts.tsx.

/** 隐私 (the shield in the header): the privacy center, and what the request log keeps. */
export function PrivacyDrawer() {
  const open = useGateway((s) => s.drawer === 'privacy');
  return (
    <Drawer id="privacy" title={tr('隐私')} open={open} onClose={() => showDrawer(null)}>
      <PrivacyCenter />
      <AuditSettings />
    </Drawer>
  );
}
