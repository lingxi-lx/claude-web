// 后台's ticker (spec 2026-10-12 §3): one line per event, newest first — 「22:09 · reader-gates · 改了 readerGates.test.ts」,
// the name in its agent's colour, the end of a task in its status colour. A line about an agent opens it. Only lines
// that arrive while it is on screen fade in; what was there when it opened is just there.
import { useRef, type CSSProperties } from 'react';
import type { BgEvent } from '@shared';
import { clsx } from '@/util';
import { agentColor } from './model';

type Pick = (agentKey: string, taskId: string) => void;

const two = (n: number) => String(n).padStart(2, '0');
/** HH:MM, local time. */
export function hhmm(at: number): string {
  const d = new Date(at);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Stable keys for the events, oldest first (two identical events get #1, #2…). */
function keyed(events: BgEvent[]): { e: BgEvent; k: string }[] {
  const seen = new Map<string, number>();
  return events.map((e) => {
    const base = `${e.at}|${e.taskId}|${e.agent ?? ''}|${e.tone}|${e.text}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { e, k: `${base}#${n}` };
  });
}

export function EventFeed({ events, onPick, limit = 30 }: { events: BgEvent[]; onPick: Pick; limit?: number }) {
  const all = keyed(events);
  // the lines there when the feed opened: they do not animate (useRef's first value sticks)
  const initial = useRef<Set<string> | null>(null);
  if (!initial.current) initial.current = new Set(all.map((x) => x.k));
  const lines = all.slice(-Math.max(1, limit)).reverse();
  if (!lines.length) return null;
  return (
    <ol className="bg-feed">
      {lines.map(({ e, k }) => {
        const body = (
          <>
            <time className="at" dateTime={new Date(e.at).toISOString()}>{hhmm(e.at)}</time>
            <span className="sep" aria-hidden>·</span>
            <span className="who" style={e.color ? ({ '--c': agentColor(e.color) } as CSSProperties) : undefined}>{e.who}</span>
            <span className="sep" aria-hidden>·</span>
            <span className="tx">{e.text}</span>
          </>
        );
        const cls = clsx('bg-feed-row', `tone-${e.tone}`, !!e.color && 'tinted');
        return (
          <li key={k} className={clsx(!initial.current!.has(k) && 'bg-feed-new')}>
            {e.agent
              ? <button type="button" className={cls} title={e.text} onClick={() => onPick(e.agent!, e.taskId)}>{body}</button>
              : <div className={cls} title={e.text}>{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}
