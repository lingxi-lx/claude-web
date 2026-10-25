// The PR bar's comment list (stage E1): comments 自动处理评论 does not send by itself (other people's, bots', or all of
// them while it is off). Shown as plain text — never rendered markdown — and handed over one at a time, by the user.
import { useRef } from 'react';
import type { BranchPr, PrComment } from '@shared';
import { tr } from '@/i18n';
import { Popover } from '@/features/composer/Popover';

const firstLines = (s: string) => s.split(/\r?\n/).filter((l) => l.trim()).slice(0, 2).join('\n');

export function PrComments({ pr, items, label, open, setOpen, onSend }: {
  pr: BranchPr;
  items: PrComment[];
  label: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  onSend: (c: PrComment) => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} className="pr-ci pr-comments" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <Popover anchor={btn} onClose={() => setOpen(false)} prefer="down" align="right" className="pr-menu pr-comment-list" label={label}>
          {items.map((c) => (
            <div key={c.id} className="pr-cm" data-host={pr.host ?? 'github'}>
              <div className="pr-cm-h">
                <a className="pr-cm-a" href={c.url} target="_blank" rel="noreferrer">{c.author}</a>
                {c.bot && <span className="pr-cm-bot">{tr('机器人')}</span>}
                {c.path && <span className="pr-cm-at">{c.path}{c.line ? `:${c.line}` : ''}</span>}
              </div>
              <div className="pr-cm-b">{firstLines(c.body)}</div>
              <button data-mi className="pr-cm-go" onClick={() => { onSend(c); setOpen(false); }}>{tr('交给 Claude')}</button>
            </div>
          ))}
        </Popover>
      )}
    </>
  );
}
