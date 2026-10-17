/**
 * The model a conversation's subagents (Task / Agent tool, workflows) run on — `CLAUDE_CODE_SUBAGENT_MODEL`, which
 * both engines read before anything else (an agent's own `model:`, the tool's haiku / sonnet / opus). A user's
 * friend ran out of budget with every subagent on the expensive main model (2026-10-14): the main task stays on the
 * main model, the subagents go to a cheaper one.
 *
 * '' = the same as the main model (nothing set: the engine's own rules). A pick belongs to one provider (its model
 * ids are that provider's): a conversation moved to another provider takes that one's default instead.
 */

/** meta.json setting: provider id ('claude' = the account) → the model new conversations on it give their subagents */
export const SUBAGENT_DEFAULTS = 'subagentModels';

export interface SubagentPick { providerId: string; model: string }

export const providerKey = (id: string | undefined): string => (id && id !== 'claude' ? id : 'claude');

/** The default subagent model of a provider from the `subagentModels` setting ('' = none). */
export function subagentDefault(defaults: unknown, providerId: string | undefined): string {
  if (!defaults || typeof defaults !== 'object') return '';
  const v = (defaults as Record<string, unknown>)[providerKey(providerId)];
  return typeof v === 'string' ? v : '';
}

/** What a conversation's subagents run on: its own pick when it was made for this provider, else the provider's default. */
export function subagentModelFor(o: { recorded?: SubagentPick; defaults: unknown; providerId: string | undefined }): string {
  if (o.recorded && typeof o.recorded.model === 'string' && providerKey(o.recorded.providerId) === providerKey(o.providerId)) return o.recorded.model;
  return subagentDefault(o.defaults, o.providerId);
}

/** The `subagentModels` setting with one provider's default set ('' removes it). */
export function withSubagentDefault(defaults: unknown, providerId: string | undefined, model: string): Record<string, string> {
  const next: Record<string, string> = {};
  if (defaults && typeof defaults === 'object') for (const [k, v] of Object.entries(defaults as Record<string, unknown>)) if (typeof v === 'string' && v) next[k] = v;
  const key = providerKey(providerId);
  if (model) next[key] = model;
  else delete next[key];
  return next;
}

/**
 * A subagent model of another provider than the conversation's: kept in the same string field as any pick
 * (`cw-x:<provider id>:<model>`), so it is saved, defaulted and resumed like one. The engine still sees the plain
 * model id; the conversation's requests go through the gateway's split route (gateway/service.ts `splitEndpoint`),
 * which sends that model's requests to its provider and the rest to the conversation's.
 */
const CROSS = 'cw-x:';
export function crossPick(value: string | undefined): SubagentPick | null {
  if (!value || !value.startsWith(CROSS)) return null;
  const rest = value.slice(CROSS.length);
  const i = rest.indexOf(':');
  if (i <= 0 || i === rest.length - 1) return null;
  return { providerId: decodeURIComponent(rest.slice(0, i)), model: rest.slice(i + 1) };
}
export const crossValue = (providerId: string, model: string): string => `${CROSS}${encodeURIComponent(providerId)}:${model}`;
