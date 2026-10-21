import { useState } from 'react';
import { tr } from '@/i18n';

/**
 * Entry model → upstream model. Keys may end in `*`; an exact key wins, then the wildcard. Saved on blur /
 * remove (no separate save button: nothing here is destructive).
 */
export function ModelMapEditor({ value, onSave }: { value?: Record<string, string>; onSave(next: Record<string, string>): void }) {
  const rows = Object.entries(value ?? {});
  const [draft, setDraft] = useState<[string, string][]>(rows);
  const save = (next: [string, string][]) => {
    setDraft(next);
    onSave(Object.fromEntries(next.map(([k, v]) => [k.trim(), v.trim()]).filter(([k, v]) => k && v)));
  };
  return (
    <div className="gw-map">
      <div className="sub">{tr('模型映射（入口模型 → 出口模型；可用 * 通配）')}</div>
      {draft.map(([k, v], i) => (
        <div className="gateway-row" key={`${i}-${k}`}>
          <input defaultValue={k} placeholder={tr('入口模型')} aria-label={tr('入口模型')} onBlur={(e) => save(draft.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
          <span className="muted">→</span>
          <input defaultValue={v} placeholder={tr('出口模型')} aria-label={tr('出口模型')} onBlur={(e) => save(draft.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
          <button className="btn sm ghost" onClick={() => save(draft.filter((_, j) => j !== i))}>{tr('删除映射')}</button>
        </div>
      ))}
      <button className="btn sm ghost" onClick={() => setDraft([...draft, ['', '']])}>{tr('添加映射')}</button>
    </div>
  );
}
