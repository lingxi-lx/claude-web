// PR 监控条 (spec 2026-10-16 review-pr §3): a pull request's checks, summed up from GitHub's statusCheckRollup contexts.
import type { PrChecks } from '../protocol.js';

/** One `contexts` node: a CheckRun (`name`, `status`, `conclusion`) or a commit StatusContext (`context`, `state`). */
export interface RollupContext {
  __typename?: string;
  name?: string;
  status?: string;
  conclusion?: string | null;
  detailsUrl?: string;
  checkSuite?: { workflowRun?: { databaseId?: number } | null } | null;
  context?: string;
  state?: string;
  targetUrl?: string;
}

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

export function summarizeChecks(nodes: RollupContext[]): PrChecks {
  const out: PrChecks = { total: 0, passed: 0, failed: 0, pending: 0, failures: [] };
  for (const n of nodes) {
    out.total++;
    const isRun = n.name !== undefined;
    const verdict = isRun ? (n.status === 'COMPLETED' ? (n.conclusion ?? '') : '') : (n.state ?? '');
    if (FAILED.has(verdict)) {
      out.failed++;
      out.failures.push({ name: (isRun ? n.name : n.context) ?? '?', url: (isRun ? n.detailsUrl : n.targetUrl) ?? '', runId: n.checkSuite?.workflowRun?.databaseId ?? undefined });
    } else if (PASSED.has(verdict)) out.passed++;
    else out.pending++;
  }
  return out;
}
