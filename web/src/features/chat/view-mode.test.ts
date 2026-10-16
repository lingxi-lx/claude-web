import { describe, expect, it } from 'vitest';
import { nextViewMode, normViewMode } from './view-mode';

describe('view mode', () => {
  it('anything unknown is 普通', () => {
    expect(normViewMode(undefined)).toBe('normal');
    expect(normViewMode('expanded')).toBe('normal');
    expect(normViewMode('summary')).toBe('summary');
  });
  it('Ctrl+O steps 普通 → 详细 → 精简 → 普通', () => {
    expect(nextViewMode('normal')).toBe('verbose');
    expect(nextViewMode('verbose')).toBe('summary');
    expect(nextViewMode('summary')).toBe('normal');
  });
});
