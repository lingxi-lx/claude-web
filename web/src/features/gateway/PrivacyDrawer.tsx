import { lazy, Suspense } from 'react';
import { useGateway, showDrawer } from './state';
import { Drawer } from './Drawer';
import { AuditSettings } from './ShareSettings';
import { tr } from '@/i18n';

// ── MOUNT POINT: 隐私中心 ────────────────────────────────────────────────────────────────────────────────────────
// The privacy pipeline is built on another branch; its UI is `web/src/features/privacy/PrivacyCenter.tsx` with a
// named export `PrivacyCenter` (no props). It plugs in here by itself: the glob finds the file when it exists and the
// placeholder shows until then. Nothing else needs changing when that branch lands.
const found = import.meta.glob<{ PrivacyCenter: React.ComponentType }>('../privacy/PrivacyCenter.tsx');
const loader = Object.values(found)[0];
const PrivacyCenter = loader ? lazy(() => loader().then((m) => ({ default: m.PrivacyCenter }))) : null;

function PrivacyPlaceholder() {
  return (
    <div className="gw-privacy-placeholder" data-mount="privacy-center">
      <div className="l">{tr('隐私保护')}</div>
      <div className="sub">{tr('发出去之前替换掉密钥、手机号这类内容的设置会放在这里。')}</div>
    </div>
  );
}

/** 隐私 (the shield in the header): the privacy center, and what the request log keeps. */
export function PrivacyDrawer() {
  const open = useGateway((s) => s.drawer === 'privacy');
  return (
    <Drawer id="privacy" title={tr('隐私')} open={open} onClose={() => showDrawer(null)}>
      {PrivacyCenter ? <Suspense fallback={null}><PrivacyCenter /></Suspense> : <PrivacyPlaceholder />}
      <AuditSettings />
    </Drawer>
  );
}
