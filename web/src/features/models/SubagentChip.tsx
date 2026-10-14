import { useRef, useState } from 'react';
import type { Provider } from '@shared';
import { useStore } from '@/store';
import { modelsFor } from '@catalog';
import { clsx, shortModel } from '@/util';
import { Icon } from '@/ui/icons';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { ModelMenu } from './ModelMenu';
import { OWN_PROVIDER, providerModelName } from './menu';
import { SUBAGENT_DEFAULTS, subagentDefault, withSubagentDefault } from '../../../../server/src/models/subagent';

/** What the chip says for a subagent model: the provider's display name for it, the account list's, else the id. */
export function subagentLabel(o: { providers: Provider[]; providerId: string; model: string; builtin?: { value: string; displayName: string }[] }): string {
  if (!o.model) return '同主模型';
  if (o.providerId !== OWN_PROVIDER) return providerModelName(o.providers.find((p) => p.id === o.providerId), o.model);
  return o.builtin?.find((m) => m.value === o.model)?.displayName ?? modelsFor('claude', [{ id: o.model }])[0]?.displayName ?? o.model;
}

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
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const providers = useStore((s) => s.providers);
  const defaults = useStore((s) => s.settings[SUBAGENT_DEFAULTS]);
  const setSetting = useStore((s) => s.setSetting);
  const label = subagentLabel({ providers, providerId: p.providerId, model: p.value, builtin: p.builtin });
  const def = subagentDefault(defaults, p.providerId);
  const providerName = p.providerId === OWN_PROVIDER ? 'Claude 账号' : providers.find((x) => x.id === p.providerId)?.name ?? '这个供应商';
  const title = `子代理用的模型：${p.value ? label : '跟主模型一样'}${def === p.value && p.value ? `（${providerName}的新对话默认）` : ''}\n主任务用主模型，子代理（Task / 工作流）用这里选的，可以选个便宜的省额度`;
  return (
    <span ref={anchor} className={clsx('mm-anchor sub-anchor', !p.value && 'same')}>
      <button type="button" className={clsx('chip', open && 'active', p.value && 'on')} title={title} disabled={p.disabled} aria-label={`子代理：${label}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="agent" size={13} />
        {/* nothing picked: just 「子代理」 (the row is full already); a pick: its name, 「子代理 · 」 when there is room */}
        <span className="mm-chip-label">{p.value ? <><span className="opt">子代理 · </span>{label === p.value ? shortModel(label) : label}</> : '子代理'}</span>
        <span className="caret"><Icon name="chevronDown" size={10} /></span>
      </button>
      {open && (
        <ErrorBoundary area="子代理菜单" compact onReset={() => setOpen(false)}>
          <ModelMenu
            agent="claude"
            current={{ providerId: p.providerId, model: p.value || null }}
            builtin={p.builtin}
            builtinTitle={p.builtinTitle}
            lockProvider={p.providerId}
            lockNote="子代理（Task、工作流）用哪个模型：主任务还是用主模型"
            anchor={anchor}
            onClose={() => setOpen(false)}
            onPick={(it) => p.onPick(it.model)}
            subagent={{
              same: !p.value,
              onSame: () => p.onPick(''),
              isDefault: def === p.value,
              onToggleDefault: () => void setSetting(SUBAGENT_DEFAULTS, withSubagentDefault(defaults, p.providerId, def === p.value ? '' : p.value)),
            }}
          />
        </ErrorBoundary>
      )}
    </span>
  );
}
