import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '@/store';
import { clsx } from '@/util';
import { Segmented } from '@/ui/Segmented';
import { imeComposing } from '@/ui/ime';

// The controls of one settings row (a meta.json key through `settings.set`) and the row itself: 标题 + 一句后果 +
// 右侧控件 (spec §5.7). Every row of the settings window uses these; section components may use `Row` too.

export function Toggle({ k, def = false, label }: { k: string; def?: boolean; label?: string }) {
  const v = useStore((s) => s.settings[k]);
  const set = useStore((s) => s.setSetting);
  const on = (v ?? def) as boolean;
  return <button className={clsx('toggle', on && 'on')} role="switch" aria-checked={on} aria-label={label} onClick={() => void set(k, !on)} />;
}

export function Select({ k, def, options, label }: { k: string; def: string; options: { id: string; l: string }[]; label?: string }) {
  const v = useStore((s) => s.settings[k]);
  const set = useStore((s) => s.setSetting);
  return (
    <select className="field" aria-label={label} value={String(v ?? def)} onChange={(e) => void set(k, e.target.value)}>
      {options.map((o) => <option key={o.id} value={o.id}>{o.l}</option>)}
    </select>
  );
}

/** A line of text, saved when it loses focus or on Enter ('' = not set). */
export function TextSetting({ k, label, placeholder, mono }: { k: string; label?: string; placeholder?: string; mono?: boolean }) {
  const v = useStore((s) => s.settings[k]);
  const set = useStore((s) => s.setSetting);
  const saved = typeof v === 'string' ? v : '';
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const commit = () => { const t = text.trim(); if (t !== saved) void set(k, t || undefined); };
  return (
    <input className={clsx('field', mono && 'mono')} aria-label={label} placeholder={placeholder} value={text} spellCheck={false}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter' && !imeComposing(e.nativeEvent)) { e.preventDefault(); commit(); } }} />
  );
}

export function NumberSelect({ k, def, options, label }: { k: string; def: number; options: readonly number[]; label?: string }) {
  const v = useStore((s) => s.settings[k]);
  const set = useStore((s) => s.setSetting);
  return (
    <select className="field" aria-label={label} value={String(v ?? def)} onChange={(e) => void set(k, Number(e.target.value))}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** A segmented choice for two or three short options (改动的显示方式: 上下对照 / 左右并排). */
export function Seg({ k, def, options, label, norm }: { k: string; def: string; options: { id: string; l: string }[]; label?: string; /** an older stored value → one of the options */ norm?: (v: unknown) => string }) {
  const v = useStore((s) => s.settings[k]);
  const set = useStore((s) => s.setSetting);
  const cur = norm ? norm(v) : String(v ?? def);
  return (
    <Segmented className="sp-seg" label={label ?? ''} arrows value={cur} options={options.map((o) => ({ value: o.id, label: o.l }))} onChange={(id) => { if (id !== cur) void set(k, id); }} />
  );
}

export function Row({ label, hint, tag, children }: { label: ReactNode; hint?: ReactNode; tag?: string; children?: ReactNode }) {
  return (
    <div className="sp-row">
      <div className="grow">
        <div className="l">{label}{tag && <span className="sp-tag">{tag}</span>}</div>
        {hint && <div className="sub">{hint}</div>}
      </div>
      {children !== undefined && <div className="ctl">{children}</div>}
    </div>
  );
}
