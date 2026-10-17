import type { Provider } from '@shared';
import { modelsFor } from '@catalog';
import { OWN_PROVIDER, providerModelName } from './menu';
import { crossPick } from '../../../../server/src/models/subagent';
import { tr } from '@/i18n';

/** What the chip says for a subagent model: the provider's display name for it, the account list's, else the id. */
export function subagentLabel(o: { providers: Provider[]; providerId: string; model: string; builtin?: { value: string; displayName: string }[] }): string {
  if (!o.model) return tr('同主模型');
  const x = crossPick(o.model);
  if (x) { const other = o.providers.find((p) => p.id === x.providerId); return `${other?.name ?? x.providerId} / ${providerModelName(other, x.model)}`; }
  if (o.providerId !== OWN_PROVIDER) return providerModelName(o.providers.find((p) => p.id === o.providerId), o.model);
  return o.builtin?.find((m) => m.value === o.model)?.displayName ?? modelsFor('claude', [{ id: o.model }])[0]?.displayName ?? o.model;
}

/** Provider kinds the gateway's split route can send an Anthropic-format request to (gateway/convert.ts outboundOf). */
const SPLIT_TO = new Set(['anthropic', 'openai', 'grok', 'gemini']);

/**
 * The providers a conversation's subagents may also use: any other one the split route can reach — only when the
 * conversation itself is on an Anthropic-format provider (the route passes its requests on with that provider's key).
 */
export function crossProviders(providers: Provider[], mainId: string): string[] {
  const main = providers.find((x) => x.id === mainId);
  if (!main || main.type !== 'anthropic') return [];
  return providers.filter((x) => x.id !== mainId && SPLIT_TO.has(x.type)).map((x) => x.id);
}
