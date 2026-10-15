import { describe, expect, it } from 'vitest';
import { codexReported } from './reported-models.js';

describe('codexReported (Codex model/list → the menus)', () => {
  it('keeps what Codex lists for the account, in its order, its default marked; hidden ones and repeats left out', () => {
    // the shape codex-cli 0.162 answered on a real machine (2026-10-15)
    const data = [
      { id: 'gpt-6-luna', model: 'gpt-6-luna', displayName: 'GPT-6-Luna', description: 'Fast and affordable model for easier tasks.', hidden: false, isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
      { id: 'gpt-5.6-terra', model: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra', description: '', hidden: false, isDefault: false },
      { id: 'codex-auto-review', model: 'codex-auto-review', displayName: 'Auto review', hidden: true },
      { id: 'gpt-5.6-terra', model: 'gpt-5.6-terra', displayName: 'again' },
      { id: 'gpt-7', model: '', displayName: '' },
    ];
    expect(codexReported(data)).toEqual([
      { value: 'gpt-6-luna', displayName: 'GPT-6-Luna', description: 'Fast and affordable model for easier tasks.', isDefault: true },
      { value: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra' },
      { value: 'gpt-7', displayName: expect.any(String) },
    ]);
  });
  it('anything else is no list', () => {
    expect(codexReported(undefined)).toEqual([]);
    expect(codexReported({ data: [] })).toEqual([]);
    expect(codexReported([null, 3, 'x'])).toEqual([]);
  });
});
