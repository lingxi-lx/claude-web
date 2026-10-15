import { useMemo, useState } from 'react';
import { imeComposing } from '@/ui/ime';
import { tr } from '@/i18n';

/** `ui.disabledModels` keys of one provider's models (`<providerId>:<model>`). */
export const modelHideKey = (providerId: string, model: string) => `${providerId}:${model}`;

/**
 * The hidden list after picking for one provider: its keys for the listed models are replaced by the unpicked ones;
 * other providers' keys, and this provider's keys for models no longer listed, stay as they were.
 */
export function withPicked(disabled: readonly string[], providerId: string, models: readonly string[], picked: ReadonlySet<string>): string[] {
  const listed = new Set(models.map((m) => modelHideKey(providerId, m)));
  const keep = disabled.filter((k) => !listed.has(k));
  return [...keep, ...models.filter((m) => !picked.has(m)).map((m) => modelHideKey(providerId, m))];
}

/** The models of a provider that are shown (not hidden), from the hidden list. */
export function pickedOf(disabled: readonly string[], providerId: string | undefined, models: readonly string[]): Set<string> {
  const off = new Set(providerId ? disabled : []);
  return new Set(models.filter((m) => !off.has(modelHideKey(providerId ?? '', m))));
}

/**
 * 「选择要用的模型」 (忍冬, 2026-10-14: a relay lists 12 models, he uses 3): which of a provider's models the composer's
 * model menu lists. The others stay hidden (`ui.disabledModels`, like the switches on Settings → Models).
 */
export function ModelPicker({ name, models, names, initial, onDone }: { name: string; models: string[]; names?: Record<string, string>; initial: ReadonlySet<string>; onDone: (picked: Set<string> | null) => void }) {
  const [picked, setPicked] = useState(() => new Set(initial));
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return ql ? models.filter((m) => m.toLowerCase().includes(ql) || (names?.[m] ?? '').toLowerCase().includes(ql)) : models;
  }, [models, names, q]);
  const allOn = shown.length > 0 && shown.every((m) => picked.has(m));
  const flip = (m: string) => setPicked((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n; });
  const setShown = (on: boolean) => setPicked((s) => { const n = new Set(s); for (const m of shown) if (on) n.add(m); else n.delete(m); return n; });
  return (
    <div className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)} onKeyDown={(e) => { if (e.key === 'Escape' && !imeComposing(e.nativeEvent)) { e.stopPropagation(); onDone(null); } }}>
      <div className="modal model-picker" role="dialog" aria-modal="true" aria-label={tr('选择要用的模型')}>
        <h3>{tr('选择要用的模型')}</h3>
        <div className="sub">{tr('「{name}」提供 {count} 个模型。勾上的会出现在输入框的模型菜单里，其它的隐藏（以后在「设置 → 模型」里也能改）。', { name, count: models.length })}</div>
        <div className="mp-bar">
          <input className="field" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('搜索模型')} aria-label={tr('搜索模型')} onKeyDown={(e) => { if (e.key === 'Enter' && !imeComposing(e.nativeEvent)) e.preventDefault(); }} />
          <button type="button" className="btn sm ghost" data-act="mp-all" disabled={!shown.length} onClick={() => setShown(!allOn)}>{allOn ? tr('全不选') : tr('全选')}</button>
        </div>
        <div className="mp-list" role="group" aria-label={tr('模型')}>
          {shown.map((m) => (
            <label key={m} className="mp-row">
              <input type="checkbox" checked={picked.has(m)} onChange={() => flip(m)} />
              <span className="mono">{m}</span>
              {names?.[m] && names[m] !== m && <span className="sub">{names[m]}</span>}
            </label>
          ))}
          {!shown.length && <div className="sub mp-empty">{tr('没有匹配「{q}」的模型', { q })}</div>}
        </div>
        <div className="row-btns">
          <span className="sub">{tr('已选 {n} / {count}', { n: models.filter((m) => picked.has(m)).length, count: models.length })}</span>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={() => onDone(null)}>{tr('取消')}</button>
          <button type="button" className="btn primary" data-act="mp-ok" disabled={!models.some((m) => picked.has(m))} onClick={() => onDone(picked)}>{tr('确定')}</button>
        </div>
      </div>
    </div>
  );
}
