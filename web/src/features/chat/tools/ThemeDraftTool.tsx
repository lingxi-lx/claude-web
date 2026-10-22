import type { ToolUseBlock } from '@/model/conversation';
import { tr } from '@/i18n';
import { ProcessGlyph } from '@/themes/ProcessGlyph';

/**
 * The theme skill's draft (server themes/tools.ts theme_draft): what is still wrong, the speed, and the trial picture
 * (the backdrop after 3 s over the 16 process animations) — the same things the model reads, for the user to watch
 * the theme take shape. While the trial runs: the process animation of this step.
 */
export function ThemeDraftBody({ t }: { t: ToolUseBlock }) {
  const r = t.result;
  const name = (t.input as any)?.json?.name;
  if (!r) return <div className="theme-draft running"><ProcessGlyph process="tool" size="stage" /> {tr('检查并试跑主题…')}</div>;
  const text = r.content ?? '';
  return (
    <div className="theme-draft">
      {name && <div className="td-name">{name.zh} · {name.en}</div>}
      <pre className="td-text">{text}</pre>
      {r.images?.map((src, i) => <img key={i} className="td-shot" src={src} alt={tr('主题试跑截图')} />)}
    </div>
  );
}
