// 智能路由: what a request needs, what each candidate can do and costs, and who is left after the hard filter.
// Pure apart from the lookups passed in, so it can be unit-tested without the gateway.
import type { Provider } from '../protocol.js';
import type { IrRequest } from '../gateway/ir.js';
import { estimateTokens } from '../gateway/ir.js';
import { contextWindowFor, knownContextWindow } from '../models/context-window.js';
import { modelCaps } from '../models/catalog.js';
import type { CostClass, RoutingCandidate, RoutingCaps, RoutingConfig, RoutingNeeds, RoutingPolicy } from './types.js';
import { candidateKey } from './types.js';
import { tr } from '../i18n/index.js';
import { isClaudeModel } from '../usage/pricing.js';
import { modelAllowed } from '../upstreams/routing.js';

/** Past this share of a window the request does not fit (the answer needs room too). */
const FIT = 0.9;

export function needsOf(ir: IrRequest | null, json: any): RoutingNeeds {
  let tools = false, images = false, afterTool = false, tokens = 0;
  if (ir) {
    tools = !!ir.tools?.length;
    images = ir.messages.some((m) => m.parts.some((p) => p.type === 'image' || (p.type === 'tool_result' && Array.isArray(p.content) && p.content.some((x) => x.type === 'image'))));
    const last = ir.messages[ir.messages.length - 1];
    afterTool = !!last && last.role === 'user' && last.parts.some((p) => p.type === 'tool_result');
    try { tokens = estimateTokens(ir); } catch { tokens = 0; }
  }
  const t = json?.thinking;
  const thinking = !!ir?.effort || (!!t && typeof t === 'object' && t.type !== 'disabled') || !!json?.reasoning_effort || !!json?.reasoning?.effort;
  return { tools, images, thinking, tokens, afterTool };
}

export interface CandidateLookup {
  provider(id: string): Provider | undefined;
  /** an account's / a pool's family (claude / gemini / workbuddy) */
  accountKind(c: RoutingCandidate): string | undefined;
}

const LOCAL_URL = /^https?:\/\/(127\.|localhost|\[::1\]|0\.0\.0\.0)/i;
/** families known not to take pictures (their chat models) */
const NO_IMAGES = /deepseek|kimi-k2|qwen3?-coder|glm-4\.[5-9](?!v)|glm-[5-9](?!v)|minimax|codestral|devstral/i;

export function costOf(c: RoutingCandidate, look: CandidateLookup): CostClass {
  if (c.cost) return c.cost;
  if (/:free$/i.test(c.model)) return 'free';
  const kind = look.accountKind(c);
  if (kind === 'gemini' || kind === 'workbuddy') return 'free';
  if (kind) return 'subscription';
  const p = c.providerId ? look.provider(c.providerId) : undefined;
  if (p?.type === 'claude-account') return 'subscription';
  if (p && LOCAL_URL.test(p.baseUrl ?? '')) return 'free';
  return 'paid';
}

export function capsOf(c: RoutingCandidate, look: CandidateLookup): RoutingCaps {
  const p = c.providerId ? look.provider(c.providerId) : undefined;
  const kind = look.accountKind(c);
  const id = c.model.replace(/\[1m\]$/i, '');
  const claude = kind === 'claude' || /claude|opus|sonnet|haiku|fable/i.test(id);
  const out: RoutingCaps = {
    tools: true,
    images: NO_IMAGES.test(id) ? false : undefined,
    thinking: claude || (p ? modelCaps(p, id).reasoning : false) || /thinking|reason|r1\b|o[34]\b|gpt-5/i.test(id) ? true : undefined,
    context: (p ? contextWindowFor(p, id) : undefined) ?? knownContextWindow(id) ?? (claude ? 200_000 : undefined),
  };
  return { ...out, ...(c.caps ?? {}) };
}

export const candidateLabel = (c: RoutingCandidate, look: CandidateLookup): string => {
  const p = c.providerId ? look.provider(c.providerId) : undefined;
  const where = p?.name ?? look.accountKind(c) ?? c.accountId ?? c.upstreamGroupId ?? c.providerId ?? '?';
  return `${where} / ${c.model}`;
};

/** paid with no price the budget can use: none set on the candidate, and not a Claude model (list price) */
export const unpriced = (c: RoutingCandidate): boolean => !c.price && !isClaudeModel(c.model);

/**
 * What the gateway key that sent the request may reach (spec §7.4: routing is no way around a key's permissions).
 * Absent = the owner's own traffic (no extra limits).
 */
export interface RouteAccess {
  /** the key group's model lists: the candidate's model must pass them (not just the virtual `smart-*` name) */
  modelAllowlist?: string[];
  modelDeny?: string[];
  /** subscription accounts (account logins) — false for share keys unless the key opts in */
  subscription?: boolean;
  /** paid candidates: false = never; else this key's own daily USD budget and what it spent today */
  paid?: false | { budgetUsd: number; spentTodayUsd: number };
  /** source refs (`p:<id>` / `a:<id>` / `u:<id>`) or candidate keys this key may use; absent / empty = all */
  sources?: string[];
}

/** `p:id` / `a:id` / `u:id` of a candidate key (`p:id#model`). */
export const sourceOfKey = (key: string): string => key.slice(0, key.indexOf('#') < 0 ? key.length : key.indexOf('#'));

/** Why the key may not use this candidate, or null. */
export function accessDenied(access: RouteAccess | undefined, c: RoutingCandidate, key: string, cost: CostClass): string | null {
  if (!access) return null;
  if (access.sources?.length && !access.sources.includes(key) && !access.sources.includes(sourceOfKey(key))) return tr('这个密钥不能用这个来源');
  if (!modelAllowed(c.model, access.modelAllowlist, access.modelDeny)) return tr('这个密钥不能用模型 {model}', { model: c.model });
  if (cost === 'subscription' && access.subscription === false) return tr('共享密钥不能用订阅账号');
  if (cost === 'paid' && access.paid !== undefined) {
    if (access.paid === false) return tr('这个密钥没有付费额度');
    // the key's own budget cannot hold what an unpriced one spends (the owner's allowUnpriced is not the key's)
    if (unpriced(c)) return tr('不知道价格，预算算不出它的花费');
    if (access.paid.spentTodayUsd >= access.paid.budgetUsd) return tr('这个密钥今天的付费额度用完了');
  }
  return null;
}

export interface Eligible { c: RoutingCandidate; key: string; label: string; cost: CostClass; caps: RoutingCaps; index: number }
export interface Filtered { ok: Eligible[]; out: { c: RoutingCandidate; key: string; label: string; cost: CostClass; caps: RoutingCaps; why: string }[] }

/**
 * The hard filter (§7.2 step 2): not allowed for routing, missing / unusable source, cooling or disabled, a need the
 * model cannot meet, free-only for 免费优先, paid without permission or past the budget.
 */
export function filterCandidates(o: {
  config: RoutingConfig;
  policy: RoutingPolicy;
  needs: RoutingNeeds;
  look: CandidateLookup;
  /** why the source cannot be used right now (missing, cooling, disabled); null = usable */
  unusable(c: RoutingCandidate, key: string): string | null;
  spentTodayUsd: number;
  /** the calling key's limits (share keys): checked on every candidate */
  access?: RouteAccess;
}): Filtered {
  const res: Filtered = { ok: [], out: [] };
  o.config.candidates.forEach((c, index) => {
    const key = candidateKey(c);
    const label = candidateLabel(c, o.look);
    const cost = costOf(c, o.look);
    const caps = capsOf(c, o.look);
    const why = ((): string | null => {
      if (!c.allowAuto) return tr('没有允许自动路由使用');
      const denied = accessDenied(o.access, c, key, cost);
      if (denied) return denied;
      const u = o.unusable(c, key);
      if (u) return u;
      if (o.needs.tools && caps.tools === false) return tr('不支持工具');
      if (o.needs.images && caps.images === false) return tr('不支持图片');
      if (o.needs.thinking && caps.thinking === false) return tr('不支持思考');
      if (caps.context && o.needs.tokens > caps.context * FIT) return tr('上下文不够（约 {n}K）', { n: Math.round(caps.context / 1000) });
      if (o.policy === 'free' && cost !== 'free') return tr('免费优先只用免费的');
      if (cost === 'paid') {
        if (!o.config.allowPaid) return tr('没有允许用付费的');
        if (!o.config.budgetUsd || o.config.budgetUsd <= 0) return tr('没有设付费预算');
        if (o.spentTodayUsd >= o.config.budgetUsd) return tr('今天的付费预算用完了');
        // what it spends is unknown, so the budget cannot hold it: counted as over budget unless the user allowed it
        if (unpriced(c) && !c.allowUnpriced) return tr('不知道价格，预算算不出它的花费');
      }
      return null;
    })();
    if (why) res.out.push({ c, key, label, cost, caps, why });
    else res.ok.push({ c, key, label, cost, caps, index });
  });
  return res;
}
