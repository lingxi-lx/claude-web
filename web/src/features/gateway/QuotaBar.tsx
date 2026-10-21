import type { QuotaWindow } from '@shared';
import { tr } from '@/i18n';

/** A quota window as a thin bar; an unknown window says so instead of reading as 0. */
export function QuotaBar({ w }: { w: QuotaWindow }) {
  const pct = w.usedPct ?? (w.used !== undefined && w.limit ? Math.round((w.used / w.limit) * 100) : undefined);
  return (
    <span className="quota-bar" title={`${w.label}${pct === undefined ? '' : ` · ${pct}%`}`}>
      <span className="q-label">{w.label}</span>
      <span className="q-track"><span className="q-fill" style={{ width: `${pct ?? 0}%` }} /></span>
      <span className="q-num">{pct === undefined ? tr('未知') : `${pct}%`}</span>
    </span>
  );
}
