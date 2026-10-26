import { Icon } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import { tr } from '@/i18n';

/**
 * A drawer over the 上游 page (共享 / 隐私 / 活动). Mounted once opened, then only hidden (its forms keep their state).
 * Esc closes the drawer only — never the page under it.
 */
export function Drawer({ id, title, open, onClose, children }: { id: string; title: string; open: boolean; onClose(): void; children: React.ReactNode }) {
  return (
    <div className="gw-drawer-wrap" data-drawer={id} hidden={!open}>
      <div className="gw-scrim" onMouseDown={onClose} />
      <aside
        className="gw-drawer"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || imeComposing(e.nativeEvent) || e.defaultPrevented) return;
          // a dialog / menu opened from the drawer closes itself first
          if ((e.target as HTMLElement).closest('.modal-bg, .menu')) return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <div className="gw-drawer-head">
          <h3>{title}</h3>
          <span className="grow" />
          <button className="icon-btn" aria-label={tr('关闭')} title={tr('关闭 (Esc)')} onClick={onClose}><Icon name="close" size={15} /></button>
        </div>
        <div className="gw-drawer-body">{children}</div>
      </aside>
    </div>
  );
}
