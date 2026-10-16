import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/store';
import { ws } from '@/ws/client';
import { tr } from '@/i18n';
import { parseAnsi } from './ansi';

const RUNNING_EVERY_MS = 10_000;

/**
 * statusLine (phase 6 §3): what the user's `statusLine` command in ~/.claude/settings.json prints, over the box like in
 * the terminal. Asked for when the conversation opens, when a turn ends, and every 10 s while one runs; nothing set
 * (or 设置 → 显示 statusLine off) → nothing drawn.
 */
export function StatusLine({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s.open[sessionId]?.state);
  const cwd = useStore((s) => s.open[sessionId]?.cwd);
  const on = useStore((s) => s.settings['ui.statusLine'] !== false);
  const [out, setOut] = useState<{ text: string; padding?: number } | null>(null);
  const busy = state === 'running' || state === 'waiting';

  useEffect(() => {
    if (!on || state === 'starting') return;
    let live = true;
    const ask = () => ws.request<{ text: string; padding?: number } | null>({ kind: 'session.statusLine', sessionId, cwd }).then((r) => { if (live) setOut(r); }, () => {});
    void ask();
    const t = busy ? setInterval(ask, RUNNING_EVERY_MS) : undefined;
    return () => { live = false; if (t) clearInterval(t); };
  }, [sessionId, cwd, on, busy, state === 'starting']);

  const lines = useMemo(() => (out ? out.text.split('\n').map(parseAnsi) : []), [out]);
  if (!on || !lines.length) return null;
  return (
    <div className="cmp-statusline" aria-label={tr('状态行')} style={out?.padding ? { paddingInline: `${out.padding}ch` } : undefined}>
      {lines.map((runs, i) => (
        <div key={i} className="sl-line">
          {runs.map((r, j) => (
            <span key={j} style={{ color: r.style.fg, backgroundColor: r.style.bg, fontWeight: r.style.bold ? 600 : undefined, opacity: r.style.dim ? 0.65 : undefined, fontStyle: r.style.italic ? 'italic' : undefined, textDecoration: r.style.underline ? 'underline' : undefined }}>{r.text}</span>
          ))}
          {!runs.length && '\u00a0'}
        </div>
      ))}
    </div>
  );
}
