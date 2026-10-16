import { describe, expect, it } from 'vitest';
import { taskWorktreeName } from './task-chip-model';

describe('task chip worktree name', () => {
  it('the title in ASCII, short', () => {
    expect(taskWorktreeName('Add retry to the upload client')).toBe('add-retry-to-the-upload-client');
    expect(taskWorktreeName('Fix: Café — crash!!')).toBe('fix-cafe-crash');
    expect(taskWorktreeName('a'.repeat(50))).toHaveLength(30);
  });
  it('a title with no usable letters gets a dated name', () => {
    expect(taskWorktreeName('给上传加重试', new Date(2026, 9, 16, 9, 5))).toBe('task-1016-0905');
  });
});
