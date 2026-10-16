// PR 监控条 (spec 2026-10-16 review-pr §3): what the bar shows and when it acts on its own.
import type { BranchPr } from '@shared';
import { tr } from '@/i18n';

type Failure = BranchPr['checks']['failures'][number];

/** A failed check on one pushed commit: the CI auto-fix asks about it once (a new push re-arms it). */
export const fixKey = (pr: BranchPr, f: Failure) => `${pr.number}:${f.runId ?? f.name}@${pr.sha}`;

/** The failures the auto-fix has not asked about yet. */
export function newFailures(pr: BranchPr, asked: readonly string[]): Failure[] {
  if (pr.state !== 'open') return [];
  return pr.checks.failures.filter((f) => !asked.includes(fixKey(pr, f)));
}

/** The message the auto-fix sends the conversation. */
export function ciFixMessage(pr: BranchPr, fs: Failure[]): string {
  const lines = fs.map((f) => (f.runId ? `- ${f.name}（gh run view ${f.runId} --log-failed）` : `- ${f.name}${f.url ? ` ${f.url}` : ''}`));
  return `${tr('PR #{n} 的 CI 检查失败了：', { n: pr.number })}\n${lines.join('\n')}\n\n${tr('看一下失败原因，修好后提交并推送到这个分支。')}`;
}

/** 自动归档: the PR is done with (merged or closed). */
export const prSettled = (pr: BranchPr | null | undefined) => !!pr && (pr.state === 'merged' || pr.state === 'closed');
