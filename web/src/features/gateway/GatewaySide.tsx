import { useMemo } from 'react';
import { SectionSide } from '@/features/sections/SectionSide';
import { useGateway, setGatewayFilter } from './state';
import { FILTERS, GATEWAY_TITLE, filterCounts, isListed, type SourceFilter } from './page';
import { tr } from '@/i18n';

/** The sidebar while 上游 is in front: only the source filter (with counts) — no parts, no 高级. */
export function GatewaySide() {
  const filter = useGateway((s) => s.filter);
  const sources = useGateway((s) => s.sources);
  const counts = useMemo(() => filterCounts(sources.filter(isListed)), [sources]);
  return (
    <SectionSide
      name="gateway"
      title={GATEWAY_TITLE}
      tab={filter}
      onTab={(id) => setGatewayFilter(id as SourceFilter)}
      tabs={FILTERS.map((f) => ({
        id: f.id,
        label: f.label,
        icon: f.icon,
        count: counts[f.id] ? <span className="count">{counts[f.id]}</span> : undefined,
      }))}
    >
      <div className="sect-note">{tr('账号和密钥只保存在这台电脑上。')}</div>
    </SectionSide>
  );
}
