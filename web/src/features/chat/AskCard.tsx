// The question card in the conversation (stage C1, spec C1): an AskUserQuestion waits at the end of the turn, above
// the plan, instead of over the composer — one question a page (‹ 1 / 3 ›), answers kept while paging, ↑↓ / 1–9 /
// Enter / Ctrl+Enter, 「其它」 with its own box, an option's preview beside it. The logic is ask-card.ts; the answer
// keeps the shape the CLI expects (`updatedInput.answers`). It never takes the focus when it appears (the user may be
// typing): an empty Enter in the composer moves the focus into it (`usePrimary`); words typed there and Enter deny
// the question with them (the composer's `dockAction`, as before).
import { useMemo, useRef, useState } from 'react';
import type { PermissionRequestEvent } from '@shared';
import { clsx } from '@/util';
import { Icon } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import { tr } from '@/i18n';
import { denyResponse, permissionTitle } from './permission-dock';
import { usePrimary, useRespond } from './PermissionCards';
import { answerOf, askKey, askQuestions, EMPTY_DRAFT, OTHER, pick, skip, step, type AskDraft, type Assembled } from './ask-card';

export function AskCard({ p, sessionId, scope }: { p: PermissionRequestEvent; sessionId: string; scope: string }) {
  const qs = useMemo(() => askQuestions(p.input), [p.input]);
  const [cur, setCur] = useState(0);
  const [drafts, setDrafts] = useState<AskDraft[]>([]);
  const [focus, setFocus] = useState(0);
  const { busy, send } = useRespond(p);
  const root = useRef<HTMLElement>(null);
  const otherRef = useRef<HTMLInputElement>(null);
  const q = qs[cur];
  const d = drafts[cur] ?? EMPTY_DRAFT;

  const rows = () => [...(root.current?.querySelectorAll<HTMLElement>('.ask-opt') ?? [])];
  const focusRow = (i: number) => { setFocus(i); rows()[i]?.focus(); };
  /** the composer's empty Enter: into the card, on the current page's chosen row (or the first) */
  const focusCard = () => {
    if (!q) return false;
    const i = d.otherOn ? q.options.length : Math.max(0, q.options.findIndex((o) => d.picked.includes(o.label)));
    focusRow(i);
    return true;
  };
  usePrimary(scope, p.requestId, focusCard);

  const goto = (i: number) => { setCur(i); setFocus(0); };
  const finish = (r: Exclude<Assembled, { kind: 'incomplete' }>) => send(r.kind === 'allow' ? { behavior: 'allow', updatedInput: { ...p.input, answers: r.answers } } : denyResponse(p, ''));
  const run = (ds: AskDraft[]) => {
    const r = step(qs, ds, cur);
    if (r.t === 'goto') goto(r.index);
    else if (r.t === 'send') finish(r.result);
  };
  const next = () => run(drafts);
  const setDraft = (nd: AskDraft) => { const ds = [...drafts]; ds[cur] = nd; setDrafts(ds); return ds; };
  const choose = (label: string) => {
    if (!q) return;
    const nd = pick(q, d, label);
    setDraft(nd);
    if (label === OTHER && nd.otherOn) requestAnimationFrame(() => otherRef.current?.focus());
  };
  const skipCur = () => run(setDraft(skip(d)));

  if (!q) return null;
  const n = q.options.length;
  const onKey = (e: React.KeyboardEvent) => {
    const a = askKey({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, composing: imeComposing(e.nativeEvent), inText: e.target instanceof HTMLInputElement }, n);
    if (!a) return;
    const el = e.target instanceof HTMLElement ? e.target : null;
    const row = el?.classList.contains('ask-opt') ? el : null;
    // a plain Enter on the card's other buttons (‹ › 跳过 提交) is their own click
    if (a.t === 'next' && !row && el instanceof HTMLButtonElement && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (a.t === 'move') focusRow((focus + a.by + n + 1) % (n + 1));
    else if (a.t === 'pick') { choose(a.index === n ? OTHER : q.options[a.index].label); focusRow(a.index); }
    else if (busy) return;
    else if (row && !e.ctrlKey && !e.metaKey) {
      // Enter on a row: a single choice is picked and the card goes on; a multi choice row ticks (as Space);
      // 其它 opens its box the first time
      const i = Number(row.dataset.index);
      if (i === n) { if (!d.otherOn) choose(OTHER); else next(); }
      else if (q.multiSelect) choose(q.options[i].label);
      else run(setDraft(pick(q, d, q.options[i].label)));
    } else next();
  };
  const preview = q.options[focus]?.preview ?? q.options.find((o) => d.picked.includes(o.label) && o.preview)?.preview;
  const last = cur === qs.length - 1;
  const ready = answerOf(q, d) !== null;
  const box = (on: boolean) => (q.multiSelect ? <span className={clsx('opt-mark box', on && 'on')}>{on && <Icon name="check" size={11} />}</span> : <span className="opt-mark"><Icon name={on ? 'checkCircle' : 'circle'} size={14} /></span>);

  return (
    <section ref={root} className="ask-card" data-id="ask-card" data-request={p.requestId} data-session={sessionId} role="group" aria-label={permissionTitle(p)} onKeyDown={onKey}>
      <div className="ask-top">
        <div className="ask-q">{q.header && <span className="badge">{q.header}</span>} <span className="ask-qt">{q.question}</span></div>
        {qs.length > 1 && (
          <div className="ask-pager">
            <button className="icon-btn" data-act="prev" disabled={cur === 0} aria-label={tr('上一题')} title={tr('上一题')} onClick={() => goto(cur - 1)}><Icon name="chevronLeft" size={14} /></button>
            <span className="ask-page">{cur + 1} / {qs.length}</span>
            <button className="icon-btn" data-act="next-page" disabled={last} aria-label={tr('下一题')} title={tr('下一题')} onClick={() => goto(cur + 1)}><Icon name="chevronRight" size={14} /></button>
          </div>
        )}
      </div>
      <div className={clsx('ask-main', preview && 'with-preview')}>
        <div className="ask-opts" role={q.multiSelect ? 'group' : 'radiogroup'} aria-label={q.question}>
          {q.options.map((o, i) => {
            const on = d.picked.includes(o.label);
            return (
              <button key={o.label} className={clsx('ask-opt', on && 'sel')} data-index={i} role={q.multiSelect ? 'checkbox' : 'radio'} aria-checked={on} tabIndex={i === focus ? 0 : -1} onFocus={() => setFocus(i)} onClick={() => choose(o.label)}>
                {box(on)}
                <span className="ask-txt"><span className="ask-l">{i < 9 && <kbd className="ask-n">{i + 1}</kbd>}{o.label}</span>{o.description && <span className="ask-d">{o.description}</span>}</span>
              </button>
            );
          })}
          <button className={clsx('ask-opt other', d.otherOn && 'sel')} data-index={n} data-act="other" role={q.multiSelect ? 'checkbox' : 'radio'} aria-checked={d.otherOn} tabIndex={focus === n ? 0 : -1} onFocus={() => setFocus(n)} onClick={() => choose(OTHER)}>
            {box(d.otherOn)}
            <span className="ask-txt"><span className="ask-l">{n < 9 && <kbd className="ask-n">{n + 1}</kbd>}{tr('其它')}</span></span>
          </button>
          {d.otherOn && <input ref={otherRef} className="ask-other" placeholder={tr('其它（自定义回答）')} aria-label={tr('其它（自定义回答）')} value={d.other} onChange={(e) => setDraft({ ...d, other: e.target.value })} />}
        </div>
        {preview && <pre className="ask-preview">{preview}</pre>}
      </div>
      <div className="ask-foot">
        <span className="ask-need"><span className="dot" />{tr('需要你回答')}</span>
        <span className="grow" />
        <button className="btn sm" data-act="skip" disabled={busy} onClick={skipCur}>{tr('跳过')}</button>
        <button className="btn sm primary" data-act={last ? 'submit' : 'next'} disabled={busy || !ready} onClick={next}>
          {last ? tr('提交') : <>{tr('下一题')} <kbd>Ctrl ↵</kbd></>}
        </button>
      </div>
    </section>
  );
}
