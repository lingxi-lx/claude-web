import { describe, expect, it } from 'vitest';
import { pickedOf, withPicked } from './ModelPicker';

describe('picking a provider\'s models (ui.disabledModels)', () => {
  const models = ['claude-haiku-4-5', 'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5'];
  it('the unpicked ones become hidden keys; other providers\' keys and models no longer listed stay', () => {
    const before = ['other:gpt-5', 'p1:claude-opus-5', 'p1:old-model'];
    const after = withPicked(before, 'p1', models, new Set(['claude-opus-5', 'claude-sonnet-5']));
    expect(after.sort()).toEqual(['other:gpt-5', 'p1:claude-haiku-4-5', 'p1:claude-opus-5-5', 'p1:old-model'].sort());
  });
  it('what the picker starts from: the listed models that are not hidden; a new provider (no id yet) has all', () => {
    expect([...pickedOf(['p1:claude-opus-5', 'other:claude-sonnet-5'], 'p1', models)]).toEqual(['claude-haiku-4-5', 'claude-opus-5-5', 'claude-sonnet-5']);
    expect(pickedOf(['p1:claude-opus-5'], undefined, models).size).toBe(4);
  });
  it('picking everything clears this provider\'s hidden keys for listed models', () => {
    expect(withPicked(['p1:claude-opus-5'], 'p1', models, new Set(models))).toEqual([]);
  });
});
