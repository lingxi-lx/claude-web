import { describe, expect, it } from 'vitest';
import { compare, compareAll, same } from './drift.js';

describe('agent selection drift', () => {
  it('no drift when the expected model and effort match', () => {
    const r = compare({ model: 'claude-opus-4-7', effort: 'high' }, { model: 'claude-opus-4-7', effort: 'high' });
    expect(r).toEqual({ drifted: false, changes: [] });
    expect(same({ model: 'x' }, { model: ' x ' })).toBe(true);
  });

  it('reports the fields that differ and which side changed', () => {
    const r = compare({ model: 'gpt-5', effort: 'low' }, { model: 'gpt-5.5', effort: 'high' });
    expect(r.drifted).toBe(true);
    expect(r.changes).toEqual([
      { field: 'model', current: 'gpt-5', expected: 'gpt-5.5' },
      { field: 'effort', current: 'low', expected: 'high' },
    ]);
  });

  it('only compares fields the saved selection names; null / empty means absent', () => {
    expect(compare({ model: 'a', effort: 'high' }, { model: 'a' }).drifted).toBe(false);
    expect(compare({ model: 'a' }, { model: 'a', effort: null }).drifted).toBe(false);
    expect(compare({ model: 'a', effort: '' }, { model: 'a', effort: null }).drifted).toBe(false);
    expect(compare({ model: 'a', effort: 'high' }, { model: 'a', effort: null }).drifted).toBe(true);
  });

  it('a missing current selection drifts from a named model', () => {
    const r = compare(null, { model: 'claude-opus-4-7' });
    expect(r.changes).toEqual([{ field: 'model', current: '', expected: 'claude-opus-4-7' }]);
  });

  it('compares a whole saved 方案 across agents', () => {
    const r = compareAll(
      { 'claude-code': { model: 'claude-opus-4-7', effort: 'high' }, codex: { model: 'gpt-5' } },
      { 'claude-code': { model: 'claude-opus-4-7', effort: 'low' }, codex: { model: 'gpt-5' }, cursor: { model: 'gpt-5.5' } },
    );
    expect(r.find((x) => x.agent === 'claude-code')?.changes).toEqual([{ field: 'effort', current: 'high', expected: 'low' }]);
    expect(r.find((x) => x.agent === 'codex')?.drifted).toBe(false);
    expect(r.find((x) => x.agent === 'cursor')?.changes).toEqual([{ field: 'model', current: '', expected: 'gpt-5.5' }]);
  });
});
