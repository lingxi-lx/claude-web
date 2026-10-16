import { describe, expect, it } from 'vitest';
import { nextViewMode, normViewMode } from './view-mode';

describe('view mode', () => {
  it('anything unknown is 普通 — including the dropped summary', () => {
    expect(normViewMode(undefined)).toBe('normal');
    expect(normViewMode('expanded')).toBe('normal');
    expect(normViewMode('summary')).toBe('normal');
    expect(normViewMode('thinking')).toBe('thinking');
  });
  it('Ctrl+O steps 普通 → 显示思考 → 详细 → 普通 (the official order)', () => {
    expect(nextViewMode('normal')).toBe('thinking');
    expect(nextViewMode('thinking')).toBe('verbose');
    expect(nextViewMode('verbose')).toBe('normal');
  });
});
