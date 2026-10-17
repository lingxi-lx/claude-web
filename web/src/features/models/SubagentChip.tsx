import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { clsx, shortModel } from '@/util';
import { Icon } from '@/ui/icons';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { ModelMenu } from './ModelMenu';
import { OWN_PROVIDER } from './menu';
import { SUBAGENT_DEFAULTS, crossPick, crossValue, subagentDefault, withSubagentDefault } from '../../../../server/src/models/subagent';
import { crossProviders, subagentLabel } from './subagent-label';
export { subagentLabel } from './subagent-label';
import { tr } from '@/i18n';

/**
 * 子代理: the model a conversation's subagents (and workflows) run on, next to the model chip — the main task on the
 * main model, the subagents on a cheaper one (user request 2026-10-14: a friend's subagents spent the budget on the
 * main model). Its menu is the model menu locked to this conversation's provider; '' = the same as the main model.
 * The bottom of the menu makes the pick this provider's default for new conversations (`subagentModels` in meta.json).
 */
export function SubagentChip(p: {
  providerId: string;
  value: string;
  onPick: (model: string) => void;
  builtin?: { value: string; displayName: string; description?: string }[];
  builtinTitle?: string;
  disabled?: boolean;
  /** bumped by the model menu's 「子代理用的模型」 row: open this menu */
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  // only a bump while mounted opens it: a chip mounted again (resumed from the phone, handed back) keeps it closed
  const seenSignal = useRef(p.openSignal);
  useEffect(() => {
    if (p.openSignal === seenSignal.current) return;
    seenSignal.current = p.openSignal;
    if (p.openSignal) setOpen(true);
  }, [p.openSignal]);
  const anchor = useRef<HTMLSpanElement>(null);
  const providers = useStore((s) => s.providers);
  const defaults = useStore((s) => s.settings[SUBAGENT_DEFAULTS]);
  const setSetting = useStore((s) => s.setSetting);
  const label = subagentLabel({ providers, providerId: p.providerId, model: p.value, builtin: p.builtin });
  const def = subagentDefault(defaults, p.providerId);
  const also = p.providerId === OWN_PROVIDER ? [] : crossProviders(providers, p.providerId);
  const cross = crossPick(p.value);
  const providerName = p.providerId === OWN_PROVIDER ? tr('Claude 账号') : providers.find((x) => x.id === p.providerId)?.name ?? tr('这个供应商');
  const title = tr("子代理用的模型：{label}{v}\n主任务用主模型，子代理（Task / 工作流）用这里选的，可以选个便宜的省额度", { label: p.value ? label : tr('跟主模型一样'), v: def === p.value && p.value ? tr('（{providerName}的新对话默认）', { providerName }) : '' });
  return (
    <span ref={anchor} className={clsx('mm-anchor sub-anchor', !p.value && 'same')}>
      <button type="button" className={clsx('chip', open && 'active', p.value && 'on')} title={title} disabled={p.disabled} aria-label={tr('子代理：{label}', { label })} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="agent" size={13} />
        {/* nothing picked: just 「子代理」 (the row is full already); a pick: its name, 「子代理 · 」 when there is room */}
        <span className="mm-chip-label">{p.value ? <><span className="opt">{tr('子代理 ·')} </span>{label === p.value ? shortModel(label) : label}</> : tr('子代理')}</span>
        <span className="caret"><Icon name="chevronDown" size={10} /></span>
      </button>
      {open && (
        <ErrorBoundary area={tr('子代理菜单')} compact onReset={() => setOpen(false)}>
          <ModelMenu
            agent="claude"
            current={cross ? { providerId: cross.providerId, model: cross.model } : { providerId: p.providerId, model: p.value || null }}
            builtin={p.builtin}
            builtinTitle={p.builtinTitle}
            lockProvider={p.providerId}
            lockNote={also.length ? tr('子代理（Task、工作流）用哪个模型，任何供应商的都行：主任务还是用主模型') : p.providerId === OWN_PROVIDER ? tr('子代理（Task、工作流）用哪个模型：主任务还是用主模型。用 Claude 账号的对话只能选账号里的模型，要用别家的，把对话换到一个供应商上') : tr('子代理（Task、工作流）用哪个模型：主任务还是用主模型')}
            anchor={anchor}
            onClose={() => setOpen(false)}
            onPick={(it) => p.onPick(it.providerId === p.providerId || !it.providerId ? it.model : crossValue(it.providerId, it.model))}
            subagent={{
              same: !p.value,
              onSame: () => p.onPick(''),
              isDefault: def === p.value,
              onToggleDefault: () => void setSetting(SUBAGENT_DEFAULTS, withSubagentDefault(defaults, p.providerId, def === p.value ? '' : p.value)),
              alsoProviders: also,
            }}
          />
        </ErrorBoundary>
      )}
    </span>
  );
}
