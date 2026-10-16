import { describe, expect, it } from 'vitest';
import { dismissKey, fixMessage, groupFindings, openFindings, readFindings } from './findings';

const input = {
  level: 'high',
  findings: [
    { file: 'src/a.ts', line: 10, summary: 'null deref', failure_scenario: 'x is null → crash', category: 'correctness' },
    { file: 'src/b.ts', summary: 'slow loop', failure_scenario: '…' },
    { file: 'src/a.ts', line: 3, summary: 'off by one', failure_scenario: '…', outcome: 'fixed' },
    { nope: true },
  ],
};

describe('ReportFindings card', () => {
  it('reads the findings, skipping malformed ones, keeping their index', () => {
    expect(readFindings(input).map((x) => x.i)).toEqual([0, 1, 2]);
    expect(readFindings({})).toEqual([]);
    expect(readFindings(null)).toEqual([]);
  });
  it('groups by file in first-seen order', () => {
    expect(groupFindings(readFindings(input)).map((g) => [g.file, g.items.map((x) => x.i)])).toEqual([['src/a.ts', [0, 2]], ['src/b.ts', [1]]]);
  });
  it('open = not dismissed here and not reported back as dealt with', () => {
    expect(openFindings(readFindings(input), 't1', [dismissKey('t1', 1)]).map((x) => x.i)).toEqual([0]);
  });
  it('the fix message: one finding, or a numbered list', () => {
    const [a, b] = readFindings(input).map((x) => x.f);
    expect(fixMessage([a])).toBe('修复代码审查发现的这个问题：src/a.ts:10 — null deref');
    expect(fixMessage([a, b])).toBe('修复代码审查发现的这些问题：\n\n1. src/a.ts:10 — null deref\n2. src/b.ts — slow loop');
  });
});
