// 网吧's prices (spec §3): the seat's 网费 is make-believe (元 per hour, `cafe.rate`); the dollars are a rough estimate
// from the real token count — the model's input price on all of it (a sub-agent reports one total), so it is low.
import { claudeInputPrice } from '../../../../server/src/usage/pricing';

export const DEFAULT_RATE = 5;

/** 元 for `ms` at `ratePerHour`, to the fen. */
export function fee(ms: number, ratePerHour: number): number {
  return Math.round((Math.max(0, ms) / 3_600_000) * ratePerHour * 100) / 100;
}

/** ≈ USD for `tokens` of `model`; undefined when the model is not Claude's (no price) or there are no tokens. */
export function estimateUsd(tokens: number | undefined, model: string | undefined): number | undefined {
  const p = claudeInputPrice(model);
  if (p === undefined || !tokens) return undefined;
  return (tokens * p) / 1e6;
}

export const yuan = (n: number) => `¥${n.toFixed(2)}`;
export const usd = (n: number | undefined) => (n === undefined ? '费用未知' : `约 $${n < 0.01 ? n.toFixed(3) : n.toFixed(2)}`);
