import { useEffect, useRef, useState } from 'react';
import type { CompactSource } from '@shared';
import { ws } from '@/ws/client';
import { Segmented } from '@/ui/Segmented';
import { imeComposing } from '@/ui/ime';
import { tr } from '@/i18n';
import { compactErrText, compactText, compactValue, nowLine, type CompactMode } from './compact-model';

/** `config.compactSource` once per editor: the point in effect when nothing is set here, and where it comes from. */
function useCompactSource(): CompactSource | null {
  const [src, setSrc] = useState<CompactSource | null>(null);
  useEffect(() => {
    let live = true;
    ws.request<CompactSource>({ kind: 'config.compactSource' }).then((s) => live && setSrc(s)).catch(() => live && setSrc({ source: 'none' }));
    return () => { live = false; };
  }, []);
  return src;
}

/**
 * 「自动压缩」 (spec 2026-10-24 A7): 跟着上下文窗口 (unset) or 在这个大小时压缩 (50K up to `window`; 700, 700k, 700000, 1m).
 * `onChange(value, error)`: the value to save (undefined = unset) and, while the box holds something that is not
 * saved, why — the owner keeps 保存 from going through with it. `window` undefined: only the 50K floor.
 */
export function CompactAt({ value, window, onChange, onEnter }: { value: number | undefined; window: number | undefined; onChange: (v: number | undefined, error?: string) => void; onEnter?: () => void }) {
  const src = useCompactSource();
  const [mode, setMode] = useState<CompactMode>(value ? 'at' : 'follow');
  const [text, setText] = useState(compactText(value));
  const r = compactValue(mode, text, window);
  const emit = (m: CompactMode, t: string) => {
    const x = compactValue(m, t, window);
    onChange(x.value, x.error ? compactErrText(x.error) : undefined);
  };
  // the window moved under a typed point (the account's picks went 1M → 200K): tell the owner again
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } emit(mode, text); }, [window]);
  const pick = (m: CompactMode) => {
    if (m === mode) return;
    // the first time the box opens: start from what is in effect now (settings.json / the environment), if anything
    const t = m === 'at' && !text.trim() && src?.value ? compactText(src.value) : text;
    setMode(m);
    setText(t);
    emit(m, t);
  };
  return (
    <div className="compact-at" data-act="compact-at" data-mode={mode}>
      <div className="compact-at-h">{tr('自动压缩')}</div>
      <div className="compact-at-ctl">
        <Segmented<CompactMode> className="sp-seg" label={tr('自动压缩')} arrows value={mode} onChange={pick}
          options={[{ value: 'follow', label: tr('跟着上下文窗口'), data: { 'data-mode': 'follow' } }, { value: 'at', label: tr('在这个大小时压缩'), data: { 'data-mode': 'at' } }]} />
        {mode === 'at' && (
          <input className="field mono" data-act="compact-at-input" aria-label={tr('自动压缩')} placeholder={tr('例如 700k')} value={text} spellCheck={false} autoComplete="off"
            aria-invalid={!!r.error && !!text.trim()}
            onChange={(e) => { setText(e.target.value); emit(mode, e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !imeComposing(e.nativeEvent)) { e.preventDefault(); onEnter?.(); } }} />
        )}
      </div>
      {mode === 'at' && r.error && text.trim() !== '' && <div className="sub compact-at-err" role="alert">{compactErrText(r.error)}</div>}
      {mode === 'follow' && src && <div className="sub compact-at-now">{nowLine(src)}</div>}
      <div className="sub compact-at-hint">{tr('对话用到这么多 token 时自动压缩。设了就以这里为准，不看你 settings.json 里的。正在跑的对话下一轮用上。')}</div>
    </div>
  );
}
