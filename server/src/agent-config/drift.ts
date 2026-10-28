// P8 漂移: what the agent's config says now vs what the active 方案 last wrote. Pure and small on purpose — the
// 接入 page can call it on every refresh and show one marker per agent ("配置文件被改过") without asking the disk
// itself. Only fields named by `expected` are compared; null / '' on either side both mean "not set".

export type DriftField = 'model' | 'effort';

export interface ModelSelection {
  model?: string | null;
  effort?: string | null;
}

export interface DriftChange {
  field: DriftField;
  /** what the config holds now ('' = absent) */
  current: string;
  /** what the saved selection expects ('' = absent) */
  expected: string;
}

export interface DriftReport {
  drifted: boolean;
  changes: DriftChange[];
}

const FIELDS: DriftField[] = ['model', 'effort'];

const norm = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Compare the current on-disk selection with the expected one. A field missing from `expected` is not checked at
 * all; an explicit null (or '') in `expected` means the key should be absent.
 */
export function compare(current: ModelSelection | null | undefined, expected: ModelSelection): DriftReport {
  const changes: DriftChange[] = [];
  for (const field of FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(expected, field)) continue;
    if (expected[field] === undefined) continue;
    const want = norm(expected[field]);
    const have = norm(current?.[field]);
    if (want !== have) changes.push({ field, current: have, expected: want });
  }
  return { drifted: changes.length > 0, changes };
}

/** `compare` under the name the UI thinks in. */
export const driftOf = compare;
export const drift = compare;

export function same(current: ModelSelection | null | undefined, expected: ModelSelection): boolean {
  return !compare(current, expected).drifted;
}

export interface AgentDrift extends DriftReport {
  agent: string;
}

/** Compare a map of agents (id → current) against a saved 方案 (id → expected). */
export function compareAll(
  current: Record<string, ModelSelection | null | undefined>,
  expected: Record<string, ModelSelection>,
): AgentDrift[] {
  return Object.entries(expected).map(([agent, want]) => ({ agent, ...compare(current[agent], want) }));
}
