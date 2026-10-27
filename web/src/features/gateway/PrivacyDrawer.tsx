import { useGateway, showDrawer } from './state';
import { Drawer } from './Drawer';
import { AuditSettings } from './ShareSettings';
import { PrivacyCenter } from './mounts';
import { Placeholder } from './Placeholder';
import { tr } from '@/i18n';

// MOUNT POINT: features/privacy/PrivacyCenter.tsx (see mounts.tsx) — the placeholder shows until it exists.

/** 隐私 (the shield in the header): the privacy center, and what the request log keeps. */
export function PrivacyDrawer() {
  const open = useGateway((s) => s.drawer === 'privacy');
  return (
    <Drawer id="privacy" title={tr('隐私')} open={open} onClose={() => showDrawer(null)}>
      {PrivacyCenter ? <PrivacyCenter /> : <Placeholder mount="privacy-center" title={tr('隐私保护')} note={tr('发出去之前替换掉密钥、手机号这类内容的设置会放在这里。')} />}
      <AuditSettings />
    </Drawer>
  );
}
