/**
 * The model a conversation's subagents (Task / Agent tool, workflows) run on — `CLAUDE_CODE_SUBAGENT_MODEL`, which
 * both engines read before anything else (an agent's own `model:`, the tool's haiku / sonnet / opus). A user's
 * friend ran out of budget with every subagent on the expensive main model (2026-10-14): the main task stays on the
 * main model, the subagents go to a cheaper one.
 *
 * A pick is a whole (provider, model) — `cw-x:<provider id>:<model>`, 'claude' = the account — and has nothing to do
 * with the main model (user, 2026-10-18: 「主模型 / 会话不影响子代理的设置」): moving the conversation to another
 * provider keeps it. '' = the same as the main model. Values from before (a plain model id) belonged to the provider
 * they were picked on and are read that way (`fullPick`).
 */
import type { ProviderType } from '../protocol.js';

/** meta.json setting: the subagent model new conversations get (a full pick, '' = the main model) */
export const SUBAGENT_DEFAULT = 'subagentModel';
/** meta.json setting before 2026-10-18: provider id → plain model, one default per provider (read when the above is unset) */
export const SUBAGENT_DEFAULTS = 'subagentModels';

export interface SubagentPick { providerId: string; model: string }

export const providerKey = (id: string | undefined): string => (id && id !== 'claude' ? id : 'claude');

const CROSS = 'cw-x:';
export function crossPick(value: string | undefined): SubagentPick | null {
  if (!value || !value.startsWith(CROSS)) return null;
  const rest = value.slice(CROSS.length);
  const i = rest.indexOf(':');
  if (i <= 0 || i === rest.length - 1) return null;
  try { return { providerId: decodeURIComponent(rest.slice(0, i)), model: rest.slice(i + 1) }; } catch { return null; }
}
export const crossValue = (providerId: string, model: string): string => `${CROSS}${encodeURIComponent(providerKey(providerId))}:${model}`;

/** A pick as a whole (provider, model): a plain id is a model of `providerId` (where it was picked). */
export function fullPick(value: string | undefined, providerId: string | undefined): string {
  if (!value) return '';
  return crossPick(value) ? value : crossValue(providerKey(providerId), value);
}

/** The old per-provider default of `providerId` ('' = none). */
function oldDefault(defaults: unknown, providerId: string | undefined): string {
  if (!defaults || typeof defaults !== 'object') return '';
  const v = (defaults as Record<string, unknown>)[providerKey(providerId)];
  return typeof v === 'string' ? v : '';
}

/** What a conversation's subagents run on: its own pick, else the default for new conversations. */
export function subagentModelFor(o: { recorded?: SubagentPick; settings: Record<string, unknown> | undefined; providerId: string | undefined }): string {
  if (o.recorded && typeof o.recorded.model === 'string') return fullPick(o.recorded.model, o.recorded.providerId);
  const s = o.settings ?? {};
  const global = s[SUBAGENT_DEFAULT];
  if (typeof global === 'string') return global;
  return fullPick(oldDefault(s[SUBAGENT_DEFAULTS], o.providerId), o.providerId);
}

/** The old `subagentModels` map with one provider's default set ('' removes it). */
export function withSubagentDefault(defaults: unknown, providerId: string | undefined, model: string): Record<string, string> {
  const next: Record<string, string> = {};
  if (defaults && typeof defaults === 'object') for (const [k, v] of Object.entries(defaults as Record<string, unknown>)) if (typeof v === 'string' && v) next[k] = v;
  const key = providerKey(providerId);
  if (model) next[key] = model;
  else delete next[key];
  return next;
}

/**
 * Where a pick sends the subagents of a conversation on `mainProviderId`: a model of that provider is given to the
 * engine as it is ('same'); one of another goes through the gateway's split route ('cross'). null: the main model.
 */
export function subagentTarget(value: string | undefined, mainProviderId: string | undefined): { kind: 'same'; model: string } | { kind: 'cross'; pick: SubagentPick } | null {
  if (!value) return null;
  const x = crossPick(value);
  if (!x) return { kind: 'same', model: value };
  return providerKey(x.providerId) === providerKey(mainProviderId) ? { kind: 'same', model: x.model } : { kind: 'cross', pick: x };
}

/**
 * Which (main, subagent) kinds the split route can join ('claude' = this machine's own login). A provider's model
 * works under any main (the gateway translates). Another account's token needs an Anthropic-format request to
 * pass on. This machine's login has no token we hold: the engine keeps it, which only an Anthropic-format provider
 * main allows (its requests get the provider's key on the way out).
 */
export type SplitKind = ProviderType | 'claude';
export function splitSupport(o: { mainType: SplitKind; subType: SplitKind }): boolean {
  const anthropicWire = o.mainType === 'anthropic' || o.mainType === 'gateway' || o.mainType === 'claude' || o.mainType === 'claude-account';
  if (o.subType === 'claude-account') return anthropicWire;
  if (o.subType === 'claude') return o.mainType === 'anthropic' || o.mainType === 'gateway';
  // a gateway profile goes to its whole group (2026-10-26 user report: WorkBuddy's models live only in the gateway, so
  // a conversation on another provider could not give them to its subagents)
  return true;
}

/**
 * The model id the engine is given for subagents through the split route: never one the main conversation can use,
 * so the route tells the two apart by it (the route sends the provider the real id). The Anthropic wire keeps the
 * name readable; the engine's Gemini / Grok clients swap any id with haiku / sonnet / opus in it for a family default,
 * so on those wires it is hex.
 */
export const SUB_ALIAS = 'cw-sub/';
const SUB_HEX = 'cw-sub-';
export const subAlias = (model: string, wire: 'anthropic' | 'other' = 'anthropic') => (wire === 'anthropic' ? `${SUB_ALIAS}${model}` : `${SUB_HEX}${[...new TextEncoder().encode(model)].map((b) => b.toString(16).padStart(2, '0')).join('')}`);
export const isSubAlias = (id: string, model: string) => id === subAlias(model) || id === subAlias(model, 'other');
/** The real model behind an alias (any other id as it is): what usage / cost is counted under. */
export function unalias(id: string): string {
  if (id.startsWith(SUB_ALIAS)) return id.slice(SUB_ALIAS.length);
  const hex = id.startsWith(SUB_HEX) ? id.slice(SUB_HEX.length) : '';
  if (!hex || hex.length % 2 || !/^[0-9a-f]+$/.test(hex)) return id;
  return new TextDecoder().decode(new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16))));
}
