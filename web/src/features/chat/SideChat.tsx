// 旁聊 (spec 2026-10-16 chat-input §1): a card over the input box — ask about the conversation without it hearing.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import { tr } from '@/i18n';
import { Markdown } from './Markdown';
import { askSide, closeSideChat, dropSide, useSideChat } from './side-chat';
import { sideDraft } from './side-chat-model';

export function SideChat({ sessionId, onDraft }: { sessionId: string; onDraft: (text: string) => void }) {
  const open = useSideChat((s) => s.sessionId === sessionId);
  const qas = useSideChat((s) => s.qas);
  const focusTick = useSideChat((s) => s.focusTick);
  const [q, setQ] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open, focusTick]);
  // a quote handed over by the selection menu's 旁聊: into the input line, not sent
  useEffect(() => {
    const d = useSideChat.getState().draft;
    if (open && d) { setQ(d); useSideChat.setState({ draft: '' }); }
  }, [open, focusTick]);
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [qas]);
  if (!open) return null;
  const last = [...qas].reverse().find((x) => typeof x.response === 'string');
  const ask = () => { if (!q.trim()) return; void askSide(q); setQ(''); };
  return (
    <div className="side-chat" role="dialog" aria-label={tr('旁聊')}>
      <div className="sc-head">
        <Icon name="chat" size={13} />
        <span className="t">{tr('旁聊')}</span>
        <span className="sub">{tr('问的和答的都不进对话')}</span>
        <span style={{ flex: 1 }} />
        {last && <button className="sc-btn" title={tr('把最后一问一答放进输入框（不会自动发送）')} onClick={() => { onDraft(sideDraft(last)); closeSideChat(); }}>{tr('放进对话')}</button>}
        <button className="icon-btn" aria-label={tr('关闭旁聊')} onClick={closeSideChat}><Icon name="close" size={13} /></button>
      </div>
      {qas.length > 0 && (
        <div className="sc-list" ref={list}>
          {qas.map((x) => (
            <div key={x.id} className="sc-qa">
              <div className="sc-q">{x.question}</div>
              {x.error ? <div className="sc-err">{x.error}</div>
                : x.response === undefined ? <div className="sc-wait"><span className="spin" /> {tr('在想…')} <button className="sc-btn" onClick={() => dropSide(x.id)}>{tr('不等了')}</button></div>
                : x.response === null ? <div className="sc-err">{tr('没有回答')}</div>
                : <div className="sc-a"><Markdown text={x.response} /></div>}
            </div>
          ))}
        </div>
      )}
      <div className="sc-input">
        <textarea
          ref={input}
          // as tall as its lines (a handed-over quote is 3+), up to the CSS max-height
          rows={Math.min(4, q.split('\n').length)}
          value={q}
          placeholder={qas.length ? tr('接着问…') : tr('问一个关于这个对话的小问题…')}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (imeComposing(e.nativeEvent)) return;
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSideChat(); }
          }}
        />
        <button className="icon-btn" aria-label={tr('问')} disabled={!q.trim()} onClick={ask}><Icon name="send" size={14} /></button>
      </div>
    </div>
  );
}
