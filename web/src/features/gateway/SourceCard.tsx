import { Icon, type IconName } from '@/ui/icons';
import { clsx } from '@/util';
import { tr } from '@/i18n';
import { SourceTags } from './CatalogForm';

export interface CardModel {
  id: string;
  name: string;
  /** an icon of the family, else the name's first letters */
  icon?: IconName;
  sub: string;
  status: { l: string; c: string };
  free?: boolean | 'some';
  /** the vendor says it may train on prompts */
  mayTrain?: boolean;
  /** it comes from a plugin */
  plugin?: boolean;
  /** not added yet: a catalog entry / engine offered under 免费 / 本机运行内核 */
  offer?: boolean;
  /** known quota left in %, with its words (never made up: absent when unknown) */
  quota?: { pct: number; label: string };
  action: { label: string; run(): void; busy?: boolean };
}

const letters = (name: string) => (name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || '?').toUpperCase();

/** One source on the dashboard: who it is, whether it works, how much is left, and the one thing to do now. */
export function SourceCard({ c, onOpen }: { c: CardModel; onOpen(): void }) {
  return (
    <div
      className={clsx('gw-source', c.free && 'free', c.offer && 'offer')}
      data-source={c.id}
      role="button"
      tabIndex={0}
      aria-label={c.name}
      onClick={onOpen}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen(); } }}
    >
      <div className="gw-source-top">
        <span className="gw-logo">{c.icon ? <Icon name={c.icon} size={16} /> : letters(c.name)}</span>
        <span className="gw-source-who">
          <b>{c.name}</b>
          <span className="sub">{c.sub}</span>
        </span>
        <SourceTags free={c.free} mayTrain={c.mayTrain} plugin={c.plugin} />
        <span className={clsx('gw-status', c.status.c)} title={c.status.l}><i />{c.status.l}</span>
      </div>
      {c.quota && (
        <>
          <div className="gw-progress"><i style={{ width: `${c.quota.pct}%` }} /></div>
          <div className="gw-meter"><span>{c.quota.label}</span><span>{c.quota.pct}%</span></div>
        </>
      )}
      <div className="gw-source-foot">
        <span className="grow" />
        <button
          className="btn sm ghost"
          disabled={c.action.busy}
          onClick={(e) => { e.stopPropagation(); c.action.run(); }}
          onKeyDown={(e) => e.stopPropagation()}
        >{c.action.label}</button>
      </div>
    </div>
  );
}
