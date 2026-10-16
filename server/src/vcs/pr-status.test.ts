import { describe, expect, it } from 'vitest';
import { summarizeChecks } from './pr-status.js';

describe('summarizeChecks', () => {
  it('check runs and commit statuses: passed, failed (with where to look), still running', () => {
    expect(summarizeChecks([
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://x/lint', checkSuite: { workflowRun: { databaseId: 42 } } },
      { name: 'build', status: 'IN_PROGRESS', conclusion: null },
      { name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { context: 'ci/legacy', state: 'ERROR', targetUrl: 'https://x/legacy' },
      { context: 'deploy', state: 'PENDING' },
    ])).toEqual({
      total: 6, passed: 2, failed: 2, pending: 2,
      failures: [{ name: 'lint', url: 'https://x/lint', runId: 42 }, { name: 'ci/legacy', url: 'https://x/legacy', runId: undefined }],
    });
  });
  it('no checks at all', () => {
    expect(summarizeChecks([])).toEqual({ total: 0, passed: 0, failed: 0, pending: 0, failures: [] });
  });
});
