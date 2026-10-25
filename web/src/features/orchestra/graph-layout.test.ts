import { describe, expect, it } from 'vitest';
import { nextNodeId, promptVars } from './graph-layout';

describe('orchestra graph layout', () => {
  it('next node id skips taken ones', () => {
    expect(nextNodeId([])).toBe('n1');
    expect(nextNodeId(['n1', 'n2'])).toBe('n3');
    expect(nextNodeId(['n2'])).toBe('n3');
    expect(nextNodeId(['x', 'n2'])).toBe('n3');
  });
  it('prompt variables list input + other nodes', () => {
    const v = promptVars([{ id: 'a', kind: 'task', title: 'A' }, { id: 'g', kind: 'approval', title: 'G' }, { id: 'me', kind: 'task', title: 'Me' }], 'me');
    expect(v.map((x) => x.token)).toEqual(['{{input}}', '{{nodes.a.output}}', '{{nodes.g.approval}}']);
  });
});
