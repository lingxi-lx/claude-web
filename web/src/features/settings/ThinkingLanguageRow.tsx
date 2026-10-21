// 思考用的语言 of one conversation: the row in its ··· menu (SessionMeta.thinkingLanguage; thinking-language.ts).
// It sits inside an anchored menu, so it does not open a menu of its own (that would close this one): the row
// expands into its choices in place.
import { useState } from 'react';
import { useStore } from '@/store';
import { Icon } from '@/ui/icons';
import { clsx } from '@/util';
import { tr } from '@/i18n';
import { THINKING_LANGUAGE_KEY, conversationThinkingOptions } from './thinking-language';

export function ThinkingLanguageRow({ sessionId }: { sessionId: string }) {
  const own = useStore((s) => s.sessionMeta[sessionId]?.thinkingLanguage ?? '');
  const setting = useStore((s) => s.settings[THINKING_LANGUAGE_KEY]);
  const [open, setOpen] = useState(false);
  const options = conversationThinkingOptions(setting);
  const now = options.find((o) => o.id === own)?.l ?? options[0].l;
  return (
    <>
      <button
        className={clsx('menu-select', open && 'on')}
        data-act="thinking-language"
        aria-expanded={open}
        title={tr('只改模型思考过程用的语言，回答还是跟着你说的语言。对话空闲时会重启一次进程，下一轮生效。')}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="web" size={14} /> <span style={{ flex: 1 }}>{tr('思考语言')}<span className="menu-sub">{tr('只对这个对话')}</span></span>
        <span className="menu-value">{now}</span>
        <Icon name="chevronDown" size={13} className={clsx(open && 'flip-v')} />
      </button>
      {open && (
        <div className="menu-grid thinking-langs" role="group" aria-label={tr('思考语言')}>
          {options.map((o) => (
            <button
              key={o.id}
              data-mi=""
              role="menuitemradio"
              aria-checked={o.id === own}
              className={clsx(o.id === own && 'on')}
              onClick={() => {
                // '' (follow the setting) goes over the wire as '': an absent key would not reach the server's restart
                void useStore.getState().setSessionMeta(sessionId, { thinkingLanguage: o.id });
                setOpen(false);
              }}
            >
              {o.l}{o.id === own && <Icon name="check" size={13} />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
